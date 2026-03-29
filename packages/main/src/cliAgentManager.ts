/**
 * CLI Agent Manager — spawns and manages external CLI agent processes.
 *
 * Supports Claude Code (`claude -p --output-format stream-json`) and
 * Codex (stub for now). Parses structured JSON output, normalizes events
 * into CliAgentMessage format, and emits them to the renderer via IPC.
 *
 * Architecture: Claude Code's `-p` flag is one-shot (one prompt per process).
 * Each `send()` spawns a new process with the prompt as an argument and
 * `--resume` to continue the conversation. The session persists across
 * multiple send() calls via Claude Code's built-in session management.
 */

import { spawn } from 'child_process'
import { execFileSync } from 'child_process'
import type { ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { WebContents } from 'electron'
import { IpcChannels, deriveTitle } from '@aide/shared'
import type {
  AgentBackend, CliAgentProcessStatus, CliAgentMessage,
  CliAgentSession, CliAgentStreamDelta,
  CliAgentStatusPayload, CliAgentResultPayload,
  ConversationListChangedPayload,
} from '@aide/shared'
import { StructuredOutputParser, type ParsedEvent } from './structuredOutputParser'
import type { ConversationStore } from './conversationStore'

// ---------------------------------------------------------------------------
// Internal session state
// ---------------------------------------------------------------------------

interface CliAgentSessionInternal {
  id: string
  workspaceId: string
  backend: AgentBackend
  process: ChildProcess | null
  processStatus: CliAgentProcessStatus
  messages: CliAgentMessage[]
  model?: string
  sessionToolNames?: string[]
  lastError?: string
  totalCostUsd: number
  stderrBuffer: string
  killTimer?: ReturnType<typeof setTimeout>
  /** Claude Code session ID for --resume across sends */
  claudeSessionId?: string
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

  constructor(opts: CliAgentManagerOpts) {
    this.workspaceRoot = opts.workspaceRoot
    this.getWebContents = opts.getWebContents
    this.claudeCodePath = opts.claudeCodePath ?? ''
    this.codexPath = opts.codexPath ?? ''
    this.conversationStore = opts.conversationStore ?? null
  }

  // ─── Public API ──────────────────────────────

  /**
   * Initialize a CLI agent session for a workspace. Does not spawn a process
   * yet — that happens on the first `send()`. Returns immediately.
   */
  /**
   * Initialize a CLI agent session. Does not spawn a process yet — that
   * happens on the first `send()`.
   *
   * If `conversationId` is provided, resumes an existing conversation
   * (loads claudeSessionId from the store for --resume).
   */
  async start(
    workspaceId: string,
    backend: AgentBackend,
    conversationId?: string,
  ): Promise<{ sessionId: string } | { error: string }> {
    if (backend === 'codex') {
      return { error: 'Codex integration coming soon.' }
    }

    if (backend === 'built-in') {
      return { error: 'Use the built-in agent chat panel instead.' }
    }

    // Resolve binary path eagerly so we can report errors before first send
    const binaryPath = this.resolveBinaryPath(backend)
    if (!binaryPath) {
      return {
        error: 'Claude Code CLI not found. Install @anthropic-ai/claude-code globally or set agent.claudeCodePath in settings.',
      }
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

    const sessionId = conversationId ?? randomUUID()

    // If session already in memory, return it
    if (this.sessions.has(sessionId)) {
      return { sessionId }
    }

    const session: CliAgentSessionInternal = {
      id: sessionId,
      workspaceId,
      backend,
      process: null,
      processStatus: 'stopped',
      messages: existingMessages,
      stderrBuffer: '',
      totalCostUsd: 0,
      claudeSessionId: existingClaudeSessionId,
    }

    this.sessions.set(sessionId, session)
    this.emitStatus(session)

    return { sessionId }
  }

  /**
   * Send a prompt to the CLI agent. Spawns a new process per message.
   * Uses `--resume` with Claude Code's session ID for conversation continuity.
   */
  async send(
    sessionId: string,
    content: string,
  ): Promise<{ success: true } | { error: string }> {
    const session = this.sessions.get(sessionId)
    if (!session) return { error: 'Session not found' }

    // If a process is already running, reject (one at a time)
    if (session.process) {
      return { error: 'Agent is already processing a request. Stop it first or wait.' }
    }

    const binaryPath = this.resolveBinaryPath(session.backend)
    if (!binaryPath) {
      return { error: 'Claude Code CLI not found.' }
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

    // Build args
    const args = [
      '-p', content,
      '--output-format', 'stream-json',
      '--verbose',
    ]

    // Resume previous session if we have one
    if (session.claudeSessionId) {
      args.push('--resume', session.claudeSessionId)
    }

    // Reset stderr buffer
    session.stderrBuffer = ''
    session.lastError = undefined

    // Spawn the process
    const parser = new StructuredOutputParser()

    parser.on('event', (event: ParsedEvent) => {
      this.handleParsedEvent(session, event)
    })
    parser.on('error', (err: Error) => {
      console.warn('[CliAgentManager] parse error:', err.message)
    })

    const proc = spawn(binaryPath, args, {
      cwd: this.workspaceRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })
    session.process = proc

    this.setStatus(session, 'running')

    proc.stdout?.on('data', (chunk: Buffer) => {
      parser.feed(chunk.toString('utf-8'))
    })

    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8')
      session.stderrBuffer += text
      if (session.stderrBuffer.length > 4000) {
        session.stderrBuffer = session.stderrBuffer.slice(-4000)
      }
    })

    proc.on('error', (err: Error) => {
      session.lastError = err.message
      session.process = null
      this.setStatus(session, 'error')
    })

    proc.on('exit', (code, signal) => {
      parser.flush()
      session.process = null
      if (session.killTimer) {
        clearTimeout(session.killTimer)
        session.killTimer = undefined
      }

      if (session.processStatus === 'stopping') {
        this.setStatus(session, 'stopped')
      } else if (code === 0) {
        // Successful completion — ready for next message
        this.setStatus(session, 'stopped')
      } else {
        session.lastError = session.stderrBuffer.trim().slice(-2000) ||
          `Process exited with ${signal ? `signal ${signal}` : `code ${code}`}`
        this.setStatus(session, 'error')
      }
    })

    return { success: true }
  }

  stop(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    if (session.process) {
      this.setStatus(session, 'stopping')
      session.process.kill('SIGTERM')

      // Force kill after 5 seconds
      session.killTimer = setTimeout(() => {
        if (session.process) {
          session.process.kill('SIGKILL')
        }
      }, 5000)
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

  getSessionById(sessionId: string): CliAgentSession | null {
    const session = this.sessions.get(sessionId)
    if (!session) return null
    return this.toPublicSession(session)
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
    }
  }

  updatePaths(claudeCodePath: string, codexPath: string): void {
    this.claudeCodePath = claudeCodePath
    this.codexPath = codexPath
  }

  async destroy(): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.process) {
        session.process.kill('SIGKILL')
        if (session.killTimer) clearTimeout(session.killTimer)
      }
      // Persist messages and claudeSessionId
      await this.persistSession(session).catch(() => {})
    }
    this.sessions.clear()
  }

  // ─── Binary Resolution ───────────────────────

  private resolveBinaryPath(backend: AgentBackend): string | null {
    if (backend === 'claude-code') {
      // 1. Explicit setting
      if (this.claudeCodePath && existsSync(this.claudeCodePath)) {
        return this.claudeCodePath
      }
      // 2. node_modules/.bin in workspace
      const localBin = join(this.workspaceRoot, 'node_modules', '.bin', 'claude')
      if (existsSync(localBin)) return localBin
      // 3. Try to find in PATH
      try {
        const result = execFileSync('which', ['claude'], { encoding: 'utf-8' }).trim()
        if (result) return result
      } catch {
        // Not found in PATH
      }
      return null
    }

    if (backend === 'codex') {
      if (this.codexPath && existsSync(this.codexPath)) return this.codexPath
      try {
        const result = execFileSync('which', ['codex'], { encoding: 'utf-8' }).trim()
        if (result) return result
      } catch {
        // Not found
      }
      return null
    }

    return null
  }

  // ─── Event Normalization ─────────────────────

  private handleParsedEvent(session: CliAgentSessionInternal, event: ParsedEvent): void {
    const { type } = event

    if (type === 'system') {
      this.handleSystemEvent(session, event)
    } else if (type === 'assistant') {
      this.handleAssistantEvent(session, event)
    } else if (type === 'stream_event') {
      this.handleStreamEvent(session, event)
    } else if (type === 'tool_progress') {
      this.handleToolProgress(session, event)
    } else if (type === 'tool_use_summary') {
      this.handleToolUseSummary(session, event)
    } else if (type === 'result') {
      this.handleResultEvent(session, event)
    } else if (type === 'rate_limit_event') {
      this.handleRateLimitEvent(session, event)
    }
  }

  private handleSystemEvent(session: CliAgentSessionInternal, event: ParsedEvent): void {
    const subtype = event.subtype as string | undefined

    if (subtype === 'init') {
      // Capture Claude Code's session ID for --resume
      const sdkSessionId = event.session_id as string | undefined
      if (sdkSessionId) {
        session.claudeSessionId = sdkSessionId
        // Persist to store for future resume
        this.conversationStore?.updateMeta(session.id, { claudeSessionId: sdkSessionId }).catch(() => {})
      }

      session.model = (event.model as string) ?? undefined
      const tools = event.tools as Array<{ name: string }> | undefined
      session.sessionToolNames = tools?.map(t => t.name)

      this.setStatus(session, 'running')

      const msg: CliAgentMessage = {
        id: (event.uuid as string) ?? randomUUID(),
        type: 'system',
        content: `Session initialized — model: ${session.model ?? 'unknown'}`,
        timestamp: Date.now(),
        raw: event,
      }
      session.messages.push(msg)
      this.emitMessage(session, msg)
    } else if (subtype === 'status') {
      const msg: CliAgentMessage = {
        id: (event.uuid as string) ?? randomUUID(),
        type: 'status',
        content: String(event.status ?? event.message ?? 'status update'),
        timestamp: Date.now(),
      }
      session.messages.push(msg)
      this.emitMessage(session, msg)
    }
  }

  private handleAssistantEvent(session: CliAgentSessionInternal, event: ParsedEvent): void {
    const message = event.message as Record<string, unknown> | undefined
    let text = ''

    if (message && Array.isArray(message.content)) {
      for (const block of message.content) {
        if ((block as Record<string, unknown>).type === 'text') {
          text += (block as Record<string, unknown>).text ?? ''
        }
      }
    }

    const msg: CliAgentMessage = {
      id: (event.uuid as string) ?? randomUUID(),
      type: 'assistant',
      content: text,
      timestamp: Date.now(),
      raw: event,
    }
    session.messages.push(msg)
    this.emitMessage(session, msg)
  }

  private handleStreamEvent(session: CliAgentSessionInternal, event: ParsedEvent): void {
    const sdkEvent = event.event as Record<string, unknown> | undefined
    if (!sdkEvent) return

    const eventType = sdkEvent.type as string | undefined

    if (eventType === 'content_block_delta') {
      const delta = sdkEvent.delta as Record<string, unknown> | undefined
      if (delta?.type === 'text_delta') {
        const text = (delta.text as string) ?? ''
        if (text) {
          const streamDelta: CliAgentStreamDelta = {
            sessionId: session.id,
            messageId: (event.uuid as string) ?? session.id,
            delta: text,
          }
          this.getWebContents()?.send(IpcChannels.CLI_AGENT_STREAM_DELTA, streamDelta)
        }
      }
    }
  }

  private handleToolProgress(session: CliAgentSessionInternal, event: ParsedEvent): void {
    const msg: CliAgentMessage = {
      id: (event.uuid as string) ?? randomUUID(),
      type: 'tool_use',
      content: `Running ${event.tool_name ?? 'tool'}...`,
      timestamp: Date.now(),
      toolName: (event.tool_name as string) ?? undefined,
      toolUseId: (event.tool_use_id as string) ?? undefined,
    }
    session.messages.push(msg)
    this.emitMessage(session, msg)
  }

  private handleToolUseSummary(session: CliAgentSessionInternal, event: ParsedEvent): void {
    const msg: CliAgentMessage = {
      id: (event.uuid as string) ?? randomUUID(),
      type: 'tool_result',
      content: (event.summary as string) ?? 'Tool completed',
      timestamp: Date.now(),
    }
    session.messages.push(msg)
    this.emitMessage(session, msg)
  }

  private handleResultEvent(session: CliAgentSessionInternal, event: ParsedEvent): void {
    const subtype = event.subtype as string | undefined
    const isSuccess = subtype === 'success'
    const durationMs = (event.duration_ms as number) ?? 0
    const totalCostUsd = (event.total_cost_usd as number) ?? 0

    session.totalCostUsd += totalCostUsd

    const msg: CliAgentMessage = {
      id: (event.uuid as string) ?? randomUUID(),
      type: isSuccess ? 'result' : 'error',
      content: isSuccess
        ? `Completed in ${(durationMs / 1000).toFixed(1)}s`
        : `Failed: ${subtype ?? 'unknown error'}`,
      timestamp: Date.now(),
      durationMs,
      totalCostUsd,
      isSuccess,
      raw: event,
    }
    session.messages.push(msg)
    this.emitMessage(session, msg)

    const resultPayload: CliAgentResultPayload = {
      sessionId: session.id,
      durationMs,
      totalCostUsd: session.totalCostUsd,
      isSuccess,
    }
    this.getWebContents()?.send(IpcChannels.CLI_AGENT_RESULT, resultPayload)
  }

  private handleRateLimitEvent(session: CliAgentSessionInternal, _event: ParsedEvent): void {
    this.setStatus(session, 'rate_limited')
  }

  // ─── IPC Emission Helpers ────────────────────

  private setStatus(session: CliAgentSessionInternal, status: CliAgentProcessStatus): void {
    session.processStatus = status
    this.emitStatus(session)
  }

  private emitStatus(session: CliAgentSessionInternal): void {
    const payload: CliAgentStatusPayload = {
      sessionId: session.id,
      processStatus: session.processStatus,
      error: session.lastError,
    }
    this.getWebContents()?.send(IpcChannels.CLI_AGENT_STATUS, payload)
  }

  private emitMessage(session: CliAgentSessionInternal, msg: CliAgentMessage): void {
    this.getWebContents()?.send(IpcChannels.CLI_AGENT_MESSAGE, { ...msg, sessionId: session.id })

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
