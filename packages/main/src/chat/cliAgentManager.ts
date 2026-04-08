/**
 * CLI Agent Manager — manages external CLI agent sessions.
 *
 * Unlike the original Claude-only implementation, this manager now owns the
 * generic session lifecycle for all external backends and delegates transport
 * details to backend adapters.
 */

import { randomUUID } from 'crypto'
import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { app, type WebContents } from 'electron'
import { IpcChannels, deriveTitle } from '@aide/shared'
import type {
  AgentBackend,
  CliAgentBackendStateMap,
  CliAgentMessage,
  CliAgentMessagePayload,
  CliAgentProcessStatus,
  CliAgentResultPayload,
  CliAgentSession,
  CliAgentStatusPayload,
  CliAgentStreamDelta,
  ConversationListChangedPayload,
  ExternalCliBackend,
} from '@aide/shared'
import type { ConversationStore } from './conversationStore'
import { createClaudeCodeAdapter } from './cliAdapters/claudeCodeAdapter'
import { createCodexAdapter } from './cliAdapters/codexAdapter'
import { createOpenCodeAdapter } from './cliAdapters/openCodeAdapter'
import type { CliBackendAdapter, CliBackendEvent, CliBackendRun } from './cliAdapters/types'

interface PersistedCliConversation {
  messages?: CliAgentMessage[]
  activeBackend?: ExternalCliBackend
  backendStates?: CliAgentBackendStateMap
  claudeSessionId?: string
}

interface CliAgentSessionInternal {
  id: string
  workspaceId: string
  backend: ExternalCliBackend
  activeRun: CliBackendRun | null
  processStatus: CliAgentProcessStatus
  messages: CliAgentMessage[]
  model?: string
  sessionToolNames?: string[]
  lastError?: string
  totalCostUsd: number
  worktreePath?: string
  backendStates: CliAgentBackendStateMap
}

export interface CliAgentManagerOpts {
  workspaceRoot: string
  getWebContents: () => WebContents | null
  claudeCodePath?: string
  opencodePath?: string
  codexPath?: string
  conversationStore?: ConversationStore
  loadClaudeHistory?: (claudeSessionId: string) => Promise<CliAgentMessage[]>
}

function comparableHistoryCount(messages: CliAgentMessage[]): number {
  return messages.filter(
    (message) =>
      message.type === 'user' ||
      message.type === 'assistant' ||
      message.type === 'tool_use' ||
      message.type === 'tool_result',
  ).length
}

function isExternalBackend(backend: AgentBackend): backend is ExternalCliBackend {
  return backend === 'claude-code' || backend === 'opencode' || backend === 'codex'
}

function parsePersistedConversation(raw: unknown): PersistedCliConversation {
  if (!raw || typeof raw !== 'object') return {}
  const persisted = raw as PersistedCliConversation
  const backendStates: CliAgentBackendStateMap = { ...(persisted.backendStates ?? {}) }
  if (!backendStates['claude-code']?.sessionId && typeof persisted.claudeSessionId === 'string') {
    backendStates['claude-code'] = {
      ...(backendStates['claude-code'] ?? {}),
      sessionId: persisted.claudeSessionId,
    }
  }
  return {
    messages: Array.isArray(persisted.messages) ? persisted.messages : [],
    activeBackend: persisted.activeBackend,
    backendStates,
    claudeSessionId: persisted.claudeSessionId,
  }
}

export class CliAgentManager {
  private sessions = new Map<string, CliAgentSessionInternal>()
  private readonly workspaceRoot: string
  private readonly getWebContents: () => WebContents | null
  private claudeCodePath: string
  private opencodePath: string
  private codexPath: string
  private readonly conversationStore: ConversationStore | null
  private readonly loadClaudeHistory:
    | ((claudeSessionId: string) => Promise<CliAgentMessage[]>)
    | null
  private resolvedClaudeCodePath: string | null = null
  private resolvedOpenCodePath: string | null = null
  private resolvedCodexPath: string | null = null

  constructor(opts: CliAgentManagerOpts) {
    this.workspaceRoot = opts.workspaceRoot
    this.getWebContents = opts.getWebContents
    this.claudeCodePath = opts.claudeCodePath ?? ''
    this.opencodePath = opts.opencodePath ?? ''
    this.codexPath = opts.codexPath ?? ''
    this.conversationStore = opts.conversationStore ?? null
    this.loadClaudeHistory = opts.loadClaudeHistory ?? null
  }

  async start(
    workspaceId: string,
    backend: AgentBackend,
    conversationId?: string,
    worktreePath?: string,
  ): Promise<{ sessionId: string } | { error: string }> {
    if (backend === 'built-in') {
      return { error: 'Use the built-in agent chat panel instead.' }
    }

    if (conversationId?.startsWith('claude-native:') && backend !== 'claude-code') {
      return { error: 'Native Claude conversations cannot switch to a different backend.' }
    }

    const sessionId = conversationId ?? randomUUID()
    const persisted =
      conversationId && this.conversationStore
        ? parsePersistedConversation(await this.conversationStore.loadMessages(conversationId))
        : parsePersistedConversation(null)

    let existingMessages = persisted.messages ?? []
    const backendStates = persisted.backendStates ?? {}

    if (!backendStates['claude-code']?.sessionId && conversationId?.startsWith('claude-native:')) {
      const raw = conversationId.slice('claude-native:'.length)
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
        backendStates['claude-code'] = {
          ...(backendStates['claude-code'] ?? {}),
          sessionId: raw,
        }
      }
    }

    const existingClaudeSessionId = backendStates['claude-code']?.sessionId
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
        // Fall back to the shadow copy when native Claude history is unavailable.
      }
    }

    if (this.conversationStore && !sessionId.startsWith('claude-native:')) {
      await this.conversationStore.ensure(sessionId, {
        workspaceId,
        backend,
        worktreePath,
      })
    }

    const existing = this.sessions.get(sessionId)
    if (existing) {
      if (existing.activeRun) {
        return { error: 'Agent is already processing a request. Stop it first or wait.' }
      }
      existing.backend = backend
      existing.model = existing.backendStates[backend]?.model
      existing.sessionToolNames = undefined
      existing.worktreePath = worktreePath ?? existing.worktreePath
      await this.persistSession(existing)
      await this.broadcastConversationList(existing.workspaceId)
      this.emitStatus(existing)
      return { sessionId }
    }

    const session: CliAgentSessionInternal = {
      id: sessionId,
      workspaceId,
      backend,
      activeRun: null,
      processStatus: 'stopped',
      messages: existingMessages,
      totalCostUsd: 0,
      model: backendStates[backend]?.model,
      worktreePath,
      backendStates,
    }

    this.sessions.set(sessionId, session)
    this.emitStatus(session)
    return { sessionId }
  }

  async switchBackend(
    sessionId: string,
    backend: AgentBackend,
  ): Promise<{ success: true } | { error: string }> {
    if (!isExternalBackend(backend)) {
      return { error: 'Only external CLI backends can be selected here.' }
    }

    const session = this.sessions.get(sessionId)
    if (!session) return { error: 'Session not found' }
    if (session.activeRun) {
      return { error: 'Stop the active run before switching backends.' }
    }
    if (session.id.startsWith('claude-native:') && backend !== 'claude-code') {
      return { error: 'Native Claude conversations cannot switch to a different backend.' }
    }

    session.backend = backend
    session.model = session.backendStates[backend]?.model
    session.sessionToolNames = undefined
    session.lastError = undefined
    await this.persistSession(session)
    await this.broadcastConversationList(session.workspaceId)
    this.emitStatus(session)
    return { success: true }
  }

  async send(sessionId: string, content: string): Promise<{ success: true } | { error: string }> {
    const session = this.sessions.get(sessionId)
    if (!session) return { error: 'Session not found' }
    if (session.activeRun) {
      return { error: 'Agent is already processing a request. Stop it first or wait.' }
    }

    const userMsg: CliAgentMessage = {
      id: randomUUID(),
      type: 'user',
      content,
      timestamp: Date.now(),
    }
    session.messages.push(userMsg)
    this.emitMessage(session, userMsg)
    await this.maybeAutoTitle(session, content)

    session.lastError = undefined
    const prompt = this.buildTurnPrompt(session, content)

    let adapter: CliBackendAdapter
    try {
      adapter = this.createAdapter(session.backend)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.handleRunError(session, message)
      return { error: message }
    }

    const run = adapter.startTurn(
      {
        conversationId: session.id,
        cwd: session.worktreePath ?? this.workspaceRoot,
        prompt,
        backendState: { ...(session.backendStates[session.backend] ?? {}) },
      },
      (event) => this.applyBackendEvent(session, event),
    )

    session.activeRun = run
    this.setStatus(session, 'running')

    run.completed
      .catch((error) => {
        if (session.processStatus === 'stopping') return
        const message = error instanceof Error ? error.message : String(error)
        this.handleRunError(session, message)
      })
      .finally(async () => {
        if (session.activeRun === run) {
          session.activeRun = null
        }
        if (session.processStatus === 'stopping' || session.processStatus === 'running') {
          this.setStatus(session, 'stopped')
        }
        await this.persistSession(session)
      })

    return { success: true }
  }

  stop(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session || !session.activeRun) return
    this.setStatus(session, 'stopping')
    session.activeRun.close()
  }

  getSession(workspaceId: string): CliAgentSession | null {
    for (const session of this.sessions.values()) {
      if (session.workspaceId === workspaceId) return this.toPublicSession(session)
    }
    return null
  }

  hasActiveSessionsForWorktree(worktreePath: string): boolean {
    for (const session of this.sessions.values()) {
      if (session.worktreePath === worktreePath && session.activeRun) {
        return true
      }
    }
    return false
  }

  getSessionById(sessionId: string): CliAgentSession | null {
    const session = this.sessions.get(sessionId)
    return session ? this.toPublicSession(session) : null
  }

  ownsSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  updatePaths(claudeCodePath: string, opencodePath: string, codexPath: string): void {
    this.claudeCodePath = claudeCodePath
    this.opencodePath = opencodePath
    this.codexPath = codexPath
    this.resolvedClaudeCodePath = null
    this.resolvedOpenCodePath = null
    this.resolvedCodexPath = null
  }

  getRunningSessionCount(): number {
    let count = 0
    for (const session of this.sessions.values()) {
      if (session.activeRun) count += 1
    }
    return count
  }

  async destroy(): Promise<void> {
    for (const session of this.sessions.values()) {
      session.activeRun?.close()
      await this.persistSession(session).catch(() => {})
    }
    this.sessions.clear()
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

  private createAdapter(backend: ExternalCliBackend): CliBackendAdapter {
    if (backend === 'claude-code') {
      const executablePath = this.resolveClaudeCodeExecutable()
      if (!executablePath) {
        throw new Error(
          'Claude Code CLI not found. Install @anthropic-ai/claude-code globally or set agent.claudeCodePath in settings.',
        )
      }
      return createClaudeCodeAdapter({ executablePath })
    }

    if (backend === 'opencode') {
      const executablePath = this.resolveGenericExecutable(
        'opencode',
        this.opencodePath,
        this.resolvedOpenCodePath,
      )
      if (!executablePath) {
        throw new Error(
          'OpenCode CLI not found. Install opencode or set agent.opencodePath in settings.',
        )
      }
      this.resolvedOpenCodePath = executablePath
      return createOpenCodeAdapter({ executablePath })
    }

    const executablePath = this.resolveGenericExecutable(
      'codex',
      this.codexPath,
      this.resolvedCodexPath,
    )
    if (!executablePath) {
      throw new Error(
        'Codex CLI not found. Install @openai/codex or set agent.codexPath in settings.',
      )
    }
    this.resolvedCodexPath = executablePath
    return createCodexAdapter({ executablePath })
  }

  private resolveClaudeCodeExecutable(): string | null {
    if (this.resolvedClaudeCodePath) return this.resolvedClaudeCodePath

    if (this.claudeCodePath && existsSync(this.claudeCodePath)) {
      this.resolvedClaudeCodePath = this.claudeCodePath
      return this.claudeCodePath
    }

    const bundledCandidates: string[] = []
    if (app.isPackaged) {
      bundledCandidates.push(
        join(
          process.resourcesPath,
          'app.asar.unpacked',
          'node_modules',
          '@anthropic-ai',
          'claude-agent-sdk',
          'cli.js',
        ),
        join(
          process.resourcesPath,
          'app.asar.unpacked',
          'node_modules',
          '@anthropic-ai',
          'claude-code',
          'cli.js',
        ),
      )
    }
    bundledCandidates.push(
      join(app.getAppPath(), 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js'),
      join(app.getAppPath(), 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
      join(this.workspaceRoot, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js'),
      join(this.workspaceRoot, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
    )

    for (const candidate of bundledCandidates) {
      if (existsSync(candidate)) {
        this.resolvedClaudeCodePath = candidate
        return candidate
      }
    }

    try {
      const result = execFileSync('which', ['claude'], { encoding: 'utf-8' }).trim()
      if (result) {
        this.resolvedClaudeCodePath = result
        return result
      }
    } catch {
      // Not found in PATH.
    }

    return null
  }

  private resolveGenericExecutable(
    command: string,
    explicitPath: string,
    cachedPath: string | null,
  ): string | null {
    if (cachedPath) return cachedPath
    if (explicitPath && existsSync(explicitPath)) return explicitPath

    const candidates: string[] = []
    if (app.isPackaged) {
      candidates.push(
        join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '.bin', command),
      )
    }
    candidates.push(
      join(app.getAppPath(), 'node_modules', '.bin', command),
      join(this.workspaceRoot, 'node_modules', '.bin', command),
    )

    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate
    }

    try {
      const result = execFileSync('which', [command], { encoding: 'utf-8' }).trim()
      if (result) return result
    } catch {
      // Not found in PATH.
    }

    return null
  }

  private applyBackendEvent(session: CliAgentSessionInternal, event: CliBackendEvent): void {
    if (event.type === 'stream-delta') {
      const payload: CliAgentStreamDelta = {
        workspaceId: session.workspaceId,
        sessionId: session.id,
        messageId: event.messageId,
        delta: event.delta,
      }
      this.getWebContents()?.send(IpcChannels.CLI_AGENT_STREAM_DELTA, payload)
      return
    }

    if (event.type === 'backend-state') {
      const current = session.backendStates[session.backend] ?? {}
      session.backendStates[session.backend] = { ...current, ...event.patch }
      if (event.patch.model) session.model = event.patch.model
      return
    }

    if (event.type === 'session-meta') {
      if (event.model) {
        session.model = event.model
        session.backendStates[session.backend] = {
          ...(session.backendStates[session.backend] ?? {}),
          model: event.model,
        }
      }
      if (event.tools) session.sessionToolNames = event.tools
      return
    }

    if (event.type === 'result') {
      session.totalCostUsd += event.totalCostUsd
      const payload: CliAgentResultPayload = {
        workspaceId: session.workspaceId,
        sessionId: session.id,
        durationMs: event.durationMs,
        totalCostUsd: session.totalCostUsd,
        isSuccess: event.isSuccess,
      }
      this.getWebContents()?.send(IpcChannels.CLI_AGENT_RESULT, payload)
      return
    }

    const message: CliAgentMessage = {
      ...event.message,
      backend: event.message.type === 'user' ? undefined : session.backend,
    }
    session.messages.push(message)
    this.emitMessage(session, message)

    if (message.type === 'status' && message.content.toLowerCase().includes('rate limited')) {
      this.setStatus(session, 'rate_limited')
    } else if (session.processStatus === 'rate_limited' && message.type !== 'status') {
      this.setStatus(session, 'running')
    }
  }

  private buildTurnPrompt(session: CliAgentSessionInternal, content: string): string {
    const backendState = session.backendStates[session.backend]
    if (backendState?.sessionId) {
      return content
    }

    const priorMessages = session.messages
      .slice(0, -1)
      .filter(
        (message) =>
          message.type === 'user' ||
          message.type === 'assistant' ||
          message.type === 'tool_use' ||
          message.type === 'tool_result',
      )

    if (priorMessages.length === 0) {
      return content
    }

    const transcript = priorMessages
      .slice(-40)
      .map((message) => {
        const source = message.backend ? ` ${message.backend}` : ''
        return `[${message.type}${source}]\n${message.content}`
      })
      .join('\n\n')

    return [
      `You are taking over an existing IDE agent conversation using the ${session.backend} backend.`,
      'Continue from the prior transcript below and answer the latest user request directly.',
      '',
      'Conversation transcript:',
      transcript,
      '',
      'Latest user request:',
      content,
    ].join('\n')
  }

  private handleRunError(session: CliAgentSessionInternal, error: string): void {
    session.lastError = error
    const message: CliAgentMessage = {
      id: randomUUID(),
      type: 'error',
      content: error,
      timestamp: Date.now(),
      backend: session.backend,
    }
    session.messages.push(message)
    this.emitMessage(session, message)
    this.setStatus(session, 'error')
  }

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

  private emitMessage(session: CliAgentSessionInternal, message: CliAgentMessage): void {
    const payload: CliAgentMessagePayload = {
      ...message,
      workspaceId: session.workspaceId,
      sessionId: session.id,
    }
    this.getWebContents()?.send(IpcChannels.CLI_AGENT_MESSAGE, payload)
  }

  private async persistSession(session: CliAgentSessionInternal): Promise<void> {
    if (!this.conversationStore || session.id.startsWith('claude-native:')) return

    const claudeSessionId = session.backendStates['claude-code']?.sessionId
    await this.conversationStore.saveMessages(session.id, {
      messages: session.messages,
      activeBackend: session.backend,
      backendStates: session.backendStates,
      claudeSessionId,
    } satisfies PersistedCliConversation)

    await this.conversationStore.updateMeta(session.id, {
      backend: session.backend,
      updatedAt: Date.now(),
      messageCount: session.messages.length,
      firstMessage: session.messages
        .find((message) => message.type === 'user')
        ?.content.slice(0, 100),
      claudeSessionId,
      worktreePath: session.worktreePath,
    })
  }

  private async maybeAutoTitle(session: CliAgentSessionInternal, content: string): Promise<void> {
    if (!this.conversationStore || session.id.startsWith('claude-native:')) return

    const userMessages = session.messages.filter((message) => message.type === 'user')
    if (userMessages.length !== 1) return

    const meta = await this.conversationStore.get(session.id)
    if (!meta || !meta.autoTitled) return

    await this.conversationStore.updateMeta(session.id, {
      title: deriveTitle(content),
      updatedAt: Date.now(),
    })

    await this.broadcastConversationList(session.workspaceId)
  }

  private async broadcastConversationList(workspaceId: string): Promise<void> {
    if (!this.conversationStore) return
    const index = await this.conversationStore.loadIndex()
    this.getWebContents()?.send(IpcChannels.CONVERSATION_LIST_CHANGED, {
      workspaceId,
      conversations: index,
    } satisfies ConversationListChangedPayload)
  }
}
