/**
 * CLI Agent Manager — manages external CLI agent sessions.
 *
 * Uses the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) for the
 * `claude-code` backend. The SDK spawns a Claude Code subprocess and
 * provides a typed async generator of messages. Codex remains a stub.
 *
 * Architecture: Each `send()` calls `query()` which returns an
 * `AsyncGenerator<SDKMessage>`. The generator is consumed in a background
 * loop that normalizes SDK messages into CliAgentMessage and emits them
 * via IPC. Session continuity uses the SDK's `resume` option.
 *
 * The SDK needs `pathToClaudeCodeExecutable` to find the Claude Code CLI.
 * Resolution order: explicit setting → bundled in app → workspace
 * node_modules → global `claude` in PATH.
 */

import { randomUUID } from 'crypto'
import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { app, type WebContents } from 'electron'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Query } from '@anthropic-ai/claude-agent-sdk'
import { IpcChannels, deriveTitle } from '@aide/shared'
import type {
  AgentBackend, CliAgentProcessStatus, CliAgentMessage,
  CliAgentSession, CliAgentStreamDelta,
  CliAgentStatusPayload, CliAgentResultPayload, CliAgentMessagePayload,
  ConversationListChangedPayload,
} from '@aide/shared'
import type { ConversationStore } from './conversationStore'

// ---------------------------------------------------------------------------
// Internal session state
// ---------------------------------------------------------------------------

interface CliAgentSessionInternal {
  id: string
  workspaceId: string
  backend: AgentBackend
  queryInstance: Query | null
  abortController: AbortController | null
  processStatus: CliAgentProcessStatus
  messages: CliAgentMessage[]
  model?: string
  sessionToolNames?: string[]
  lastError?: string
  totalCostUsd: number
  /** Claude Code session ID for resume across sends */
  claudeSessionId?: string
  /** Worktree path this session operates in (if any). */
  worktreePath?: string
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface CliAgentManagerOpts {
  workspaceRoot: string
  getWebContents: () => WebContents | null
  claudeCodePath?: string
  codexPath?: string
  conversationStore?: ConversationStore
  loadClaudeHistory?: (claudeSessionId: string) => Promise<CliAgentMessage[]>
}

function comparableHistoryCount(messages: CliAgentMessage[]): number {
  return messages.filter((message) =>
    message.type === 'user' ||
    message.type === 'assistant' ||
    message.type === 'tool_use' ||
    message.type === 'tool_result'
  ).length
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class CliAgentManager {
  private sessions = new Map<string, CliAgentSessionInternal>()
  private workspaceRoot: string
  private getWebContents: () => WebContents | null
  private claudeCodePath: string
  private codexPath: string
  private conversationStore: ConversationStore | null
  private loadClaudeHistory: ((claudeSessionId: string) => Promise<CliAgentMessage[]>) | null
  /** Resolved path to the Claude Code CLI, cached after first lookup */
  private resolvedClaudeCodePath: string | null = null

  constructor(opts: CliAgentManagerOpts) {
    this.workspaceRoot = opts.workspaceRoot
    this.getWebContents = opts.getWebContents
    this.claudeCodePath = opts.claudeCodePath ?? ''
    this.codexPath = opts.codexPath ?? ''
    this.conversationStore = opts.conversationStore ?? null
    this.loadClaudeHistory = opts.loadClaudeHistory ?? null
  }

  // ─── Public API ──────────────────────────────

  /**
   * Initialize a CLI agent session. Does not start a query yet — that
   * happens on the first `send()`.
   *
   * If `conversationId` is provided, resumes an existing conversation
   * (loads claudeSessionId from the store for SDK resume).
   */
  async start(
    workspaceId: string,
    backend: AgentBackend,
    conversationId?: string,
    worktreePath?: string,
  ): Promise<{ sessionId: string } | { error: string }> {
    if (backend === 'codex') {
      return { error: 'Codex integration coming soon.' }
    }

    if (backend === 'built-in') {
      return { error: 'Use the built-in agent chat panel instead.' }
    }

    // If resuming an existing conversation, load from store
    let existingMessages: CliAgentMessage[] = []
    let existingClaudeSessionId: string | undefined

    if (conversationId && this.conversationStore) {
      const meta = await this.conversationStore.get(conversationId)
      if (meta?.claudeSessionId) {
        existingClaudeSessionId = meta.claudeSessionId
      }
      const saved = await this.conversationStore.loadMessages(conversationId) as { messages?: CliAgentMessage[], claudeSessionId?: string } | null
      if (saved?.messages) {
        existingMessages = saved.messages
      }
      if (saved?.claudeSessionId) {
        existingClaudeSessionId = saved.claudeSessionId
      }
    }

    if (!existingClaudeSessionId && conversationId?.startsWith('claude-native:')) {
      const raw = conversationId.slice('claude-native:'.length)
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
        existingClaudeSessionId = raw
      }
    }

    if (existingClaudeSessionId && this.loadClaudeHistory) {
      try {
        const nativeMessages = await this.loadClaudeHistory(existingClaudeSessionId)
        if (
          nativeMessages.length > 0 &&
          comparableHistoryCount(nativeMessages) > comparableHistoryCount(existingMessages)
        ) {
          existingMessages = nativeMessages
        }
      } catch {
        // Fall back to persisted shadow copy when native Claude history is unavailable.
      }
    }

    const sessionId = conversationId ?? randomUUID()

    if (this.conversationStore && !sessionId.startsWith('claude-native:')) {
      await this.conversationStore.ensure(sessionId, {
        workspaceId,
        backend,
        worktreePath,
      })
    }

    // If session already in memory, return it
    if (this.sessions.has(sessionId)) {
      return { sessionId }
    }

    const session: CliAgentSessionInternal = {
      id: sessionId,
      workspaceId,
      backend,
      queryInstance: null,
      abortController: null,
      processStatus: 'stopped',
      messages: existingMessages,
      totalCostUsd: 0,
      claudeSessionId: existingClaudeSessionId,
      worktreePath,
    }

    this.sessions.set(sessionId, session)
    this.emitStatus(session)

    return { sessionId }
  }

  /**
   * Send a prompt to the CLI agent. Starts an SDK query that streams
   * messages back via IPC. Uses `resume` for conversation continuity.
   */
  async send(
    sessionId: string,
    content: string,
  ): Promise<{ success: true } | { error: string }> {
    const session = this.sessions.get(sessionId)
    if (!session) return { error: 'Session not found' }

    // If a query is already running, reject (one at a time)
    if (session.queryInstance) {
      return { error: 'Agent is already processing a request. Stop it first or wait.' }
    }

    // Add user message to history
    const userMsg: CliAgentMessage = {
      id: randomUUID(),
      type: 'user',
      content,
      timestamp: Date.now(),
    }
    session.messages.push(userMsg)
    this.emitMessage(session, userMsg)

    // Auto-title on first user message
    await this.maybeAutoTitle(session, content)

    // Reset error state
    session.lastError = undefined

    // Fire and forget the consumption loop
    this.consumeQuery(session, content).catch(err => {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error(`[CliAgentManager] Unhandled consumeQuery error for session ${session.id}:`, errMsg)
      if (err instanceof Error && err.stack) console.error(`[CliAgentManager] Stack:`, err.stack)
      session.lastError = errMsg
      this.setStatus(session, 'error')
    })

    return { success: true }
  }

  stop(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    if (session.queryInstance || session.abortController) {
      this.setStatus(session, 'stopping')
      session.abortController?.abort()
      session.queryInstance?.close()
    }
  }

  getSession(workspaceId: string): CliAgentSession | null {
    // Find the most recent session for this workspace
    for (const session of this.sessions.values()) {
      if (session.workspaceId === workspaceId) {
        return this.toPublicSession(session)
      }
    }
    return null
  }

  /** Check if any active (running/starting) session uses the given worktree path. */
  hasActiveSessionsForWorktree(worktreePath: string): boolean {
    for (const session of this.sessions.values()) {
      if (session.worktreePath === worktreePath && session.queryInstance) {
        return true
      }
    }
    return false
  }

  getSessionById(sessionId: string): CliAgentSession | null {
    const session = this.sessions.get(sessionId)
    if (!session) return null
    return this.toPublicSession(session)
  }

  ownsSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  private toPublicSession(session: CliAgentSessionInternal): CliAgentSession {
    return {
      id: session.id,
      workspaceId: session.workspaceId,
      backend: session.backend,
      processStatus: session.processStatus,
      messages: session.messages,
      model: session.model,
      sessionToolNames: session.sessionToolNames,
      lastError: session.lastError,
      totalCostUsd: session.totalCostUsd,
      worktreePath: session.worktreePath,
    }
  }

  updatePaths(claudeCodePath: string, codexPath: string): void {
    this.claudeCodePath = claudeCodePath
    this.codexPath = codexPath
    // Invalidate cache so next query re-resolves
    this.resolvedClaudeCodePath = null
  }

  getRunningSessionCount(): number {
    let count = 0
    for (const session of this.sessions.values()) {
      if (session.queryInstance) count += 1
    }
    return count
  }

  async destroy(): Promise<void> {
    for (const session of this.sessions.values()) {
      session.abortController?.abort()
      session.queryInstance?.close()
      await this.persistSession(session).catch(() => {})
    }
    this.sessions.clear()
  }

  // ─── Claude Code CLI Resolution ─────────────

  /**
   * Resolve the path to the Claude Code CLI executable.
   * The SDK spawns Claude Code as a subprocess, so we need to tell it
   * where the actual binary lives via `pathToClaudeCodeExecutable`.
   */
  private resolveClaudeCodeExecutable(): string | null {
    if (this.resolvedClaudeCodePath) return this.resolvedClaudeCodePath

    // 1. Explicit path from settings
    if (this.claudeCodePath && existsSync(this.claudeCodePath)) {
      console.log(`[CliAgentManager] Using explicit Claude Code path: ${this.claudeCodePath}`)
      this.resolvedClaudeCodePath = this.claudeCodePath
      return this.claudeCodePath
    }

    // 2. Bundled in Electron app
    const bundledCandidates: string[] = []
    if (app.isPackaged) {
      bundledCandidates.push(
        join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
      )
    }
    bundledCandidates.push(
      join(app.getAppPath(), 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
    )
    for (const candidate of bundledCandidates) {
      if (existsSync(candidate)) {
        console.log(`[CliAgentManager] Using bundled Claude Code: ${candidate}`)
        this.resolvedClaudeCodePath = candidate
        return candidate
      }
    }

    // 3. Workspace-local installation
    const workspaceCli = join(this.workspaceRoot, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js')
    if (existsSync(workspaceCli)) {
      console.log(`[CliAgentManager] Using workspace Claude Code: ${workspaceCli}`)
      this.resolvedClaudeCodePath = workspaceCli
      return workspaceCli
    }

    // 4. Global `claude` in PATH
    try {
      const result = execFileSync('which', ['claude'], { encoding: 'utf-8' }).trim()
      if (result) {
        console.log(`[CliAgentManager] Using global Claude Code: ${result}`)
        this.resolvedClaudeCodePath = result
        return result
      }
    } catch {
      // Not found in PATH
    }

    console.warn('[CliAgentManager] Claude Code CLI not found in any location')
    return null
  }

  // ─── SDK Query Consumption ──────────────────

  private async consumeQuery(
    session: CliAgentSessionInternal,
    prompt: string,
  ): Promise<void> {
    const abortController = new AbortController()
    session.abortController = abortController

    const cwd = session.worktreePath ?? this.workspaceRoot
    console.log(`[CliAgentManager] Starting SDK query for session ${session.id}`)
    console.log(`[CliAgentManager]   cwd: ${cwd}`)
    console.log(`[CliAgentManager]   resume: ${session.claudeSessionId ?? '(new session)'}`)
    console.log(`[CliAgentManager]   prompt: ${prompt.slice(0, 200)}${prompt.length > 200 ? '...' : ''}`)

    // Collect stderr output for diagnostics
    const stderrChunks: string[] = []

    // Resolve the Claude Code executable path for the SDK
    const executablePath = this.resolveClaudeCodeExecutable()
    if (!executablePath) {
      session.lastError = 'Claude Code CLI not found. Install @anthropic-ai/claude-code globally or set agent.claudeCodePath in settings.'
      const errorMsg: CliAgentMessage = {
        id: randomUUID(),
        type: 'error',
        content: session.lastError,
        timestamp: Date.now(),
      }
      session.messages.push(errorMsg)
      this.emitMessage(session, errorMsg)
      this.setStatus(session, 'error')
      return
    }
    console.log(`[CliAgentManager]   executable: ${executablePath}`)

    const options: Record<string, unknown> = {
      cwd,
      abortController,
      pathToClaudeCodeExecutable: executablePath,
      includePartialMessages: true,
      permissionMode: 'default' as const,
      settingSources: ['user', 'project', 'local'],
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      stderr: (data: string) => {
        stderrChunks.push(data)
        console.warn(`[CliAgentManager] stderr: ${data.trimEnd()}`)
      },
    }

    if (session.claudeSessionId) {
      options.resume = session.claudeSessionId
    }

    let queryInstance: ReturnType<typeof query>
    try {
      queryInstance = query({ prompt, options: options as Parameters<typeof query>[0]['options'] })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      const errStack = err instanceof Error ? err.stack : undefined
      console.error(`[CliAgentManager] Failed to create query:`, errMsg)
      if (errStack) console.error(`[CliAgentManager] Stack:`, errStack)
      session.lastError = `Failed to start agent: ${errMsg}`
      this.setStatus(session, 'error')

      // Surface the error in the chat as a message
      const errorMsg: CliAgentMessage = {
        id: randomUUID(),
        type: 'error',
        content: `Failed to start agent: ${errMsg}${stderrChunks.length ? '\n\nstderr:\n' + stderrChunks.join('') : ''}`,
        timestamp: Date.now(),
      }
      session.messages.push(errorMsg)
      this.emitMessage(session, errorMsg)
      return
    }

    session.queryInstance = queryInstance
    this.setStatus(session, 'running')

    let messageCount = 0
    try {
      for await (const message of queryInstance) {
        if (abortController.signal.aborted) break
        messageCount++
        this.handleSDKMessage(session, message)
      }
      console.log(`[CliAgentManager] Query completed for session ${session.id} — ${messageCount} messages received`)
    } catch (err) {
      if (!abortController.signal.aborted) {
        const errMsg = err instanceof Error ? err.message : String(err)
        const errStack = err instanceof Error ? err.stack : undefined
        console.error(`[CliAgentManager] Query error for session ${session.id}:`, errMsg)
        if (errStack) console.error(`[CliAgentManager] Stack:`, errStack)
        if (stderrChunks.length) {
          console.error(`[CliAgentManager] Captured stderr:\n${stderrChunks.join('')}`)
        }
        console.error(`[CliAgentManager] Messages received before error: ${messageCount}`)

        // Build a detailed error message for the UI
        const stderrText = stderrChunks.join('').trim()
        const detailedError = stderrText
          ? `${errMsg}\n\nstderr output:\n${stderrText.slice(-2000)}`
          : errMsg
        session.lastError = detailedError

        // Surface the error in the chat
        const errorMsg: CliAgentMessage = {
          id: randomUUID(),
          type: 'error',
          content: detailedError,
          timestamp: Date.now(),
        }
        session.messages.push(errorMsg)
        this.emitMessage(session, errorMsg)

        this.setStatus(session, 'error')
      }
    } finally {
      session.queryInstance = null
      session.abortController = null
      if (session.processStatus === 'stopping') {
        this.setStatus(session, 'stopped')
      } else if (session.processStatus !== 'error') {
        this.setStatus(session, 'stopped')
      }
      await this.persistSession(session).catch(() => {})
    }
  }

  // ─── SDK Message Handling ───────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleSDKMessage(session: CliAgentSessionInternal, message: any): void {
    const type = message.type as string
    const subtype = message.subtype as string | undefined

    // Log all non-streaming messages (stream_event is too noisy)
    if (type !== 'stream_event') {
      console.log(`[CliAgentManager] SDK message: type=${type}${subtype ? ` subtype=${subtype}` : ''} session=${session.id.slice(0, 8)}`)
    }

    if (type === 'system') {
      this.handleSystemMessage(session, message)
    } else if (type === 'assistant') {
      this.handleAssistantMessage(session, message)
    } else if (type === 'stream_event') {
      this.handleStreamEvent(session, message)
    } else if (type === 'tool_progress') {
      this.handleToolProgress(session, message)
    } else if (type === 'tool_use_summary') {
      this.handleToolUseSummary(session, message)
    } else if (type === 'result') {
      this.handleResultMessage(session, message)
    } else if (type === 'rate_limit_event') {
      console.warn(`[CliAgentManager] Rate limited — session ${session.id.slice(0, 8)}`)
      this.setStatus(session, 'rate_limited')
    } else {
      // Log unknown message types so we can add handling later
      console.log(`[CliAgentManager] Unhandled SDK message type: ${type}`, JSON.stringify(message).slice(0, 500))
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleSystemMessage(session: CliAgentSessionInternal, message: any): void {
    const subtype = message.subtype as string | undefined

    if (subtype === 'init') {
      // Capture session ID for resume
      const sdkSessionId = message.session_id as string | undefined
      if (sdkSessionId) {
        session.claudeSessionId = sdkSessionId
        this.conversationStore?.updateMeta(session.id, { claudeSessionId: sdkSessionId }).catch(() => {})
      }

      session.model = (message.model as string) ?? undefined
      const tools = message.tools as string[] | undefined
      session.sessionToolNames = tools

      this.setStatus(session, 'running')

      const msg: CliAgentMessage = {
        id: (message.uuid as string) ?? randomUUID(),
        type: 'system',
        content: `Session initialized — model: ${session.model ?? 'unknown'}`,
        timestamp: Date.now(),
        raw: message,
      }
      session.messages.push(msg)
      this.emitMessage(session, msg)
    } else if (subtype === 'status') {
      const msg: CliAgentMessage = {
        id: (message.uuid as string) ?? randomUUID(),
        type: 'status',
        content: String(message.status ?? message.message ?? 'status update'),
        timestamp: Date.now(),
      }
      session.messages.push(msg)
      this.emitMessage(session, msg)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleAssistantMessage(session: CliAgentSessionInternal, message: any): void {
    const betaMessage = message.message
    if (!betaMessage || !Array.isArray(betaMessage.content)) return

    let text = ''
    for (const block of betaMessage.content) {
      if (block.type === 'text') {
        text += block.text ?? ''
      } else if (block.type === 'tool_use') {
        // Emit tool use as separate message
        const toolMsg: CliAgentMessage = {
          id: (block.id as string) ?? randomUUID(),
          type: 'tool_use',
          content: `Running ${block.name ?? 'tool'}...`,
          timestamp: Date.now(),
          toolName: block.name as string,
          toolUseId: block.id as string,
        }
        session.messages.push(toolMsg)
        this.emitMessage(session, toolMsg)
      }
    }

    if (text) {
      const msg: CliAgentMessage = {
        id: (message.uuid as string) ?? randomUUID(),
        type: 'assistant',
        content: text,
        timestamp: Date.now(),
        raw: message,
      }
      session.messages.push(msg)
      this.emitMessage(session, msg)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleStreamEvent(session: CliAgentSessionInternal, message: any): void {
    const event = message.event
    if (!event) return

    const eventType = event.type as string | undefined

    if (eventType === 'content_block_delta') {
      const delta = event.delta
      if (delta?.type === 'text_delta') {
        const text = (delta.text as string) ?? ''
        if (text) {
          const streamDelta: CliAgentStreamDelta = {
            workspaceId: session.workspaceId,
            sessionId: session.id,
            messageId: (message.uuid as string) ?? session.id,
            delta: text,
          }
          this.getWebContents()?.send(IpcChannels.CLI_AGENT_STREAM_DELTA, streamDelta)
        }
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleToolProgress(session: CliAgentSessionInternal, message: any): void {
    const msg: CliAgentMessage = {
      id: (message.uuid as string) ?? randomUUID(),
      type: 'tool_use',
      content: `Running ${message.tool_name ?? 'tool'}...`,
      timestamp: Date.now(),
      toolName: (message.tool_name as string) ?? undefined,
      toolUseId: (message.tool_use_id as string) ?? undefined,
    }
    session.messages.push(msg)
    this.emitMessage(session, msg)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleToolUseSummary(session: CliAgentSessionInternal, message: any): void {
    const msg: CliAgentMessage = {
      id: (message.uuid as string) ?? randomUUID(),
      type: 'tool_result',
      content: (message.summary as string) ?? 'Tool completed',
      timestamp: Date.now(),
    }
    session.messages.push(msg)
    this.emitMessage(session, msg)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleResultMessage(session: CliAgentSessionInternal, message: any): void {
    const subtype = message.subtype as string | undefined
    const isSuccess = subtype === 'success'
    const durationMs = (message.duration_ms as number) ?? 0
    const totalCostUsd = (message.total_cost_usd as number) ?? 0

    session.totalCostUsd += totalCostUsd

    // Capture session ID from result as well
    const resultSessionId = message.session_id as string | undefined
    if (resultSessionId && !session.claudeSessionId) {
      session.claudeSessionId = resultSessionId
      this.conversationStore?.updateMeta(session.id, { claudeSessionId: resultSessionId }).catch(() => {})
    }

    // Build detailed error content for non-success results
    let errorDetail = ''
    if (!isSuccess) {
      const errors = message.errors as string[] | undefined
      if (errors?.length) {
        errorDetail = errors.join('\n')
      }
      console.error(`[CliAgentManager] Result error for session ${session.id.slice(0, 8)}: subtype=${subtype}`)
      if (errorDetail) console.error(`[CliAgentManager] Error details:\n${errorDetail}`)
      console.error(`[CliAgentManager] Full result message:`, JSON.stringify(message).slice(0, 2000))
    }

    const msg: CliAgentMessage = {
      id: (message.uuid as string) ?? randomUUID(),
      type: isSuccess ? 'result' : 'error',
      content: isSuccess
        ? `Completed in ${(durationMs / 1000).toFixed(1)}s`
        : `Failed: ${subtype ?? 'unknown error'}${errorDetail ? '\n\n' + errorDetail : ''}`,
      timestamp: Date.now(),
      durationMs,
      totalCostUsd,
      isSuccess,
      raw: message,
    }
    session.messages.push(msg)
    this.emitMessage(session, msg)

    const resultPayload: CliAgentResultPayload = {
      workspaceId: session.workspaceId,
      sessionId: session.id,
      durationMs,
      totalCostUsd: session.totalCostUsd,
      isSuccess,
    }
    this.getWebContents()?.send(IpcChannels.CLI_AGENT_RESULT, resultPayload)
  }

  // ─── IPC Emission Helpers ────────────────────

  private setStatus(session: CliAgentSessionInternal, status: CliAgentProcessStatus): void {
    session.processStatus = status
    this.emitStatus(session)
  }

  private emitStatus(session: CliAgentSessionInternal): void {
    const payload: CliAgentStatusPayload = {
      workspaceId: session.workspaceId,
      sessionId: session.id,
      processStatus: session.processStatus,
      error: session.lastError,
    }
    this.getWebContents()?.send(IpcChannels.CLI_AGENT_STATUS, payload)
  }

  private emitMessage(session: CliAgentSessionInternal, msg: CliAgentMessage): void {
    const ipcMsg: CliAgentMessagePayload = { ...msg, workspaceId: session.workspaceId, sessionId: session.id }
    this.getWebContents()?.send(IpcChannels.CLI_AGENT_MESSAGE, ipcMsg)

    if (session.processStatus === 'rate_limited' && msg.type !== 'status') {
      this.setStatus(session, 'running')
    }
  }

  // ─── Persistence Helpers ─────────────────────

  private async persistSession(session: CliAgentSessionInternal): Promise<void> {
    if (!this.conversationStore) return
    await this.conversationStore.saveMessages(session.id, {
      messages: session.messages,
      claudeSessionId: session.claudeSessionId,
    })
    await this.conversationStore.updateMeta(session.id, {
      updatedAt: Date.now(),
      messageCount: session.messages.length,
      firstMessage: session.messages.find(m => m.type === 'user')?.content.slice(0, 100),
      claudeSessionId: session.claudeSessionId,
      worktreePath: session.worktreePath,
    })
  }

  private async maybeAutoTitle(session: CliAgentSessionInternal, content: string): Promise<void> {
    if (!this.conversationStore) return

    const userMessages = session.messages.filter(m => m.type === 'user')
    if (userMessages.length !== 1) return

    const meta = await this.conversationStore.get(session.id)
    if (!meta || !meta.autoTitled) return

    const title = deriveTitle(content)
    await this.conversationStore.updateMeta(session.id, { title, updatedAt: Date.now() })

    const index = await this.conversationStore.loadIndex()
    this.getWebContents()?.send(IpcChannels.CONVERSATION_LIST_CHANGED, {
      workspaceId: session.workspaceId,
      conversations: index,
    } satisfies ConversationListChangedPayload)
  }
}
