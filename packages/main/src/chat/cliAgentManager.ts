/**
 * CLI Agent Manager — manages external CLI agent sessions.
 *
 * Owns the generic session lifecycle for all external backends (claude-code,
 * opencode, codex), delegates per-turn transport details to backend adapters,
 * and bridges OpenCode's full SDK surface (sessions / config / providers /
 * file / find / shell / lsp / etc.) into IPC-callable manager methods.
 *
 * Multi-workspace lifecycle: one CliAgentManager per WorkspaceRuntime, each
 * owning its own per-workspace OpenCodeServerHost. The manager implements
 * `ToolApprovalOwner` so its OpenCode permission prompts can flow through the
 * single ApprovalRouter / CHAT_TOOL_CALL approval surface shared with the
 * built-in agent.
 */

import { randomUUID } from 'crypto'
import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { app, type WebContents } from 'electron'
import { IpcChannels, deriveTitle } from '@aide/shared'
import type {
  AgentBackend,
  CliAgentBackendState,
  CliAgentBackendStateMap,
  CliAgentMessage,
  CliAgentMessagePayload,
  CliAgentPermissionRequest,
  CliAgentProcessStatus,
  CliAgentResultPayload,
  CliAgentSession,
  CliAgentStatusPayload,
  CliAgentStreamDelta,
  CliAgentTokenUsage,
  CliAgentWorkspaceCostSummary,
  ConversationListChangedPayload,
  ExternalCliBackend,
  OpenCodeAgentSummary,
  OpenCodeAuthMethod,
  OpenCodeFileEntry,
  OpenCodeFindResult,
  OpenCodePathInfo,
  OpenCodeProviderSummary,
  OpenCodeServerInfo,
  OpenCodeShellResult,
  OpenCodeSymbolResult,
  OpenCodeToolSummary,
  OpenCodeTodoItem,
  PermissionTier,
  ToolPermissionConfig,
} from '@aide/shared'
import type { ConversationStore } from './conversationStore'
import { createClaudeCodeAdapter } from './cliAdapters/claudeCodeAdapter'
import { createCodexAdapter } from './cliAdapters/codexAdapter'
import { createOpenCodeAdapter } from './cliAdapters/openCodeAdapter'
import type { CliBackendAdapter, CliBackendEvent, CliBackendRun } from './cliAdapters/types'
import { OpenCodeServerHost } from './openCodeServerHost'
import type { ToolApprovalOwner } from './approvalRouter'
import type { ChatToolCallPayload, ToolCall } from '@aide/shared'

interface PersistedCliConversation {
  messages?: CliAgentMessage[]
  activeBackend?: ExternalCliBackend
  backendStates?: CliAgentBackendStateMap
  claudeSessionId?: string
  totalCostUsd?: number
  totalTokens?: CliAgentTokenUsage
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
  totalTokens?: CliAgentTokenUsage
  worktreePath?: string
  backendStates: CliAgentBackendStateMap
}

interface PendingPermission {
  sessionId: string
  resolve: (response: 'always' | 'once' | 'reject') => void
}

/**
 * User-scoped defaults applied as the *initial* `backendStates['opencode']`
 * for new sessions. Resolved once at construction (and refreshed via
 * `updateOpencodeDefaults` when settings change). Per-session edits made
 * from the chat pane never write back to these.
 */
export interface OpencodeSessionDefaults {
  providerID?: string
  modelID?: string
  agent?: string
  mode?: string
  systemPromptOverride?: string
  toolToggles?: Record<string, boolean>
}

export interface CliAgentManagerOpts {
  workspaceRoot: string
  workspaceId?: string
  getWebContents: () => WebContents | null
  claudeCodePath?: string
  opencodePath?: string
  codexPath?: string
  conversationStore?: ConversationStore
  loadClaudeHistory?: (claudeSessionId: string) => Promise<CliAgentMessage[]>
  permissionTier?: PermissionTier
  autoApprove?: Record<string, boolean | ToolPermissionConfig>
  opencodeDefaults?: OpencodeSessionDefaults
  /** Called when pending approvals / running session counts change. */
  onWorkloadChanged?: () => void
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
    totalCostUsd: persisted.totalCostUsd,
    totalTokens: persisted.totalTokens,
  }
}

function sumTokenUsage(
  a: CliAgentTokenUsage | undefined,
  b: CliAgentTokenUsage | undefined,
): CliAgentTokenUsage | undefined {
  if (!a) return b
  if (!b) return a
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  }
}

export class CliAgentManager implements ToolApprovalOwner {
  private sessions = new Map<string, CliAgentSessionInternal>()
  private readonly workspaceRoot: string
  private readonly workspaceId: string
  private readonly getWebContents: () => WebContents | null
  private claudeCodePath: string
  private opencodePath: string
  private codexPath: string
  private readonly conversationStore: ConversationStore | null
  private readonly loadClaudeHistory:
    | ((claudeSessionId: string) => Promise<CliAgentMessage[]>)
    | null
  private resolvedClaudeCodePath: string | null = null
  private resolvedCodexPath: string | null = null

  private permissionTier: PermissionTier
  private autoApprove: Record<string, boolean | ToolPermissionConfig>
  private opencodeDefaults: OpencodeSessionDefaults
  private readonly onWorkloadChanged?: () => void

  private openCodeHost: OpenCodeServerHost | null = null
  private pendingPermissions = new Map<string, PendingPermission>()

  constructor(opts: CliAgentManagerOpts) {
    this.workspaceRoot = opts.workspaceRoot
    this.workspaceId = opts.workspaceId ?? ''
    this.getWebContents = opts.getWebContents
    this.claudeCodePath = opts.claudeCodePath ?? ''
    this.opencodePath = opts.opencodePath ?? ''
    this.codexPath = opts.codexPath ?? ''
    this.conversationStore = opts.conversationStore ?? null
    this.loadClaudeHistory = opts.loadClaudeHistory ?? null
    this.permissionTier = opts.permissionTier ?? 'confirm'
    this.autoApprove = opts.autoApprove ?? {}
    this.opencodeDefaults = opts.opencodeDefaults ?? {}
    this.onWorkloadChanged = opts.onWorkloadChanged
  }

  // ─── Lifecycle ──────────────────────────────────────────────

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

    // Seed opencode state from user defaults *only* on the first time we
    // touch this conversation as opencode (no persisted opencode block).
    // We never overwrite existing per-session overrides.
    if (backend === 'opencode' && !backendStates['opencode']) {
      const seed = this.buildOpencodeSeed()
      if (seed) backendStates['opencode'] = seed
    }

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
      totalCostUsd: persisted.totalCostUsd ?? 0,
      totalTokens: persisted.totalTokens,
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

    // First time this conversation switches to opencode → seed defaults.
    if (backend === 'opencode' && !session.backendStates['opencode']) {
      const seed = this.buildOpencodeSeed()
      if (seed) session.backendStates['opencode'] = seed
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

  /**
   * Build a fresh `CliAgentBackendState` for an opencode session from the
   * user's defaults. Returns `null` when no defaults are set so we don't
   * pollute the persisted state with empty objects.
   */
  private buildOpencodeSeed(): CliAgentBackendState | null {
    const d = this.opencodeDefaults
    const hasAny =
      !!d.providerID ||
      !!d.modelID ||
      !!d.agent ||
      !!d.mode ||
      !!d.systemPromptOverride ||
      (d.toolToggles && Object.keys(d.toolToggles).length > 0)
    if (!hasAny) return null
    const seed: CliAgentBackendState = {}
    if (d.providerID && d.modelID) {
      seed.providerID = d.providerID
      seed.modelID = d.modelID
      seed.model = `${d.providerID}/${d.modelID}`
    }
    if (d.agent) seed.agent = d.agent
    if (d.mode) seed.mode = d.mode
    if (d.systemPromptOverride) seed.systemPromptOverride = d.systemPromptOverride
    if (d.toolToggles && Object.keys(d.toolToggles).length > 0) {
      seed.toolToggles = { ...d.toolToggles }
    }
    return seed
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
    this.notifyWorkloadChanged()

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
        // Clear any unresolved permissions for this session.
        for (const [id, pending] of this.pendingPermissions) {
          if (pending.sessionId === session.id) {
            pending.resolve('reject')
            this.pendingPermissions.delete(id)
          }
        }
        await this.persistSession(session)
        this.notifyWorkloadChanged()
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
    this.resolvedCodexPath = null
    if (this.openCodeHost) {
      this.openCodeHost.setPath(opencodePath)
    }
  }

  /** Update permission tier / autoApprove map (called from settings-changed handler). */
  updatePermissions(
    tier: PermissionTier,
    autoApprove: Record<string, boolean | ToolPermissionConfig>,
  ): void {
    this.permissionTier = tier
    this.autoApprove = autoApprove
  }

  /**
   * Replace the opencode session-default seed (called from the settings-
   * changed handler when any `agent.opencode.default*` key is touched).
   * Existing sessions keep their per-session overrides; the new defaults
   * only apply to sessions created/switched-into-opencode after this call.
   */
  updateOpencodeDefaults(defaults: OpencodeSessionDefaults): void {
    this.opencodeDefaults = defaults
  }

  getRunningSessionCount(): number {
    let count = 0
    for (const session of this.sessions.values()) {
      if (session.activeRun) count += 1
    }
    return count
  }

  /** Workspace-wide cost / token rollup across this manager's sessions. */
  getWorkspaceCostSummary(): CliAgentWorkspaceCostSummary {
    let totalCostUsd = 0
    let totalTokens: CliAgentTokenUsage | undefined = undefined
    let sessionCount = 0
    for (const session of this.sessions.values()) {
      sessionCount += 1
      totalCostUsd += session.totalCostUsd
      totalTokens = sumTokenUsage(totalTokens, session.totalTokens)
    }
    return {
      workspaceId: this.workspaceId,
      totalCostUsd,
      totalTokens: totalTokens ?? {
        input: 0,
        output: 0,
        reasoning: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
      sessionCount,
    }
  }

  async destroy(): Promise<void> {
    for (const session of this.sessions.values()) {
      session.activeRun?.close()
      await this.persistSession(session).catch(() => {})
    }
    this.sessions.clear()
    if (this.openCodeHost) {
      try {
        await this.openCodeHost.dispose()
      } catch {
        /* ignore */
      }
      this.openCodeHost = null
    }
    // Resolve any outstanding permissions as rejected.
    for (const pending of this.pendingPermissions.values()) {
      pending.resolve('reject')
    }
    this.pendingPermissions.clear()
  }

  // ─── ToolApprovalOwner (for ApprovalRouter) ────────────────────

  ownsToolCall(toolCallId: string): boolean {
    return this.pendingPermissions.has(toolCallId)
  }

  approveToolCall(_sessionId: string, toolCallId: string): void {
    const pending = this.pendingPermissions.get(toolCallId)
    if (!pending) return
    this.pendingPermissions.delete(toolCallId)
    pending.resolve('always')
    this.notifyWorkloadChanged()
  }

  rejectToolCall(_sessionId: string, toolCallId: string): void {
    const pending = this.pendingPermissions.get(toolCallId)
    if (!pending) return
    this.pendingPermissions.delete(toolCallId)
    pending.resolve('reject')
    this.notifyWorkloadChanged()
  }

  getPendingApprovalCount(): number {
    return this.pendingPermissions.size
  }

  // ─── Per-session config (Phase 2 wiring) ───────────────────────

  async updateSessionConfig(
    sessionId: string,
    patch: Partial<CliAgentBackendState>,
  ): Promise<{ success: true } | { error: string }> {
    const session = this.sessions.get(sessionId)
    if (!session) return { error: 'Session not found' }
    const prior = session.backendStates[session.backend] ?? {}
    session.backendStates[session.backend] = { ...prior, ...patch }
    if (patch.model) session.model = patch.model
    await this.persistSession(session)
    this.emitStatus(session)
    return { success: true }
  }

  // ─── OpenCode SDK passthroughs (Phase 2 / 6 / 7 / 8) ───────────

  private async getOpenCodeClient(sessionId: string) {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('Session not found')
    if (session.backend !== 'opencode') {
      throw new Error('This operation is only available for OpenCode sessions.')
    }
    const host = this.ensureOpenCodeHost()
    return host.getClient()
  }

  async listOpenCodeProviders(sessionId: string): Promise<OpenCodeProviderSummary[]> {
    const client = await this.getOpenCodeClient(sessionId)
    // Shape: { providers: Provider[], default: Record<string,string> }
    // Provider.models is Record<modelID, Model> where Model has nested
    // capabilities + cost.cache subfields (NOT flat tool_call / cache_read).
    const result = await callSdk<{
      providers?: Array<{
        id?: string
        name?: string
        models?: Record<
          string,
          {
            id?: string
            name?: string
            capabilities?: {
              reasoning?: boolean
              attachment?: boolean
              toolcall?: boolean
            }
            cost?: {
              input: number
              output: number
              cache?: { read: number; write: number }
            }
          }
        >
      }>
    }>(() => (client as any).config.providers())
    return (result?.providers ?? []).map((p) => ({
      id: p.id ?? '',
      name: p.name ?? p.id ?? '',
      models: Object.entries(p.models ?? {}).map(([modelId, m]) => ({
        id: m.id ?? modelId,
        name: m.name ?? m.id ?? modelId,
        reasoning: m.capabilities?.reasoning,
        attachment: m.capabilities?.attachment,
        toolCall: m.capabilities?.toolcall,
        cost: m.cost
          ? {
              input: m.cost.input,
              output: m.cost.output,
              cacheRead: m.cost.cache?.read,
              cacheWrite: m.cost.cache?.write,
            }
          : undefined,
      })),
    }))
  }

  async listOpenCodeAgents(sessionId: string): Promise<OpenCodeAgentSummary[]> {
    const client = await this.getOpenCodeClient(sessionId)
    const result = await callSdk<
      Array<{ name?: string; description?: string; mode?: string }>
    >(() => (client as any).app.agents())
    if (!Array.isArray(result)) return []
    return result.map((a) => ({
      name: a.name ?? '',
      description: a.description,
      mode: a.mode,
    }))
  }

  async listOpenCodeModes(sessionId: string): Promise<string[]> {
    const client = await this.getOpenCodeClient(sessionId)
    const result = await callSdk<{ agents?: Record<string, { mode?: string }> }>(() =>
      (client as any).config.get(),
    )
    const modes = new Set<string>(['primary', 'subagent', 'all'])
    for (const agent of Object.values(result?.agents ?? {})) {
      if (agent?.mode) modes.add(agent.mode)
    }
    return Array.from(modes)
  }

  async listOpenCodeTools(
    sessionId: string,
    providerID: string,
    modelID: string,
  ): Promise<OpenCodeToolSummary[]> {
    const client = await this.getOpenCodeClient(sessionId)
    try {
      // SDK query expects { provider, model } (not providerID/modelID).
      const result = await callSdk<
        Array<{ id?: string; description?: string; parameters?: unknown }>
      >(() => (client as any).tool.list({ query: { provider: providerID, model: modelID } }))
      if (Array.isArray(result)) {
        return result.map((t) => ({
          id: t.id ?? '',
          description: t.description,
          schema: t.parameters,
        }))
      }
    } catch {
      // Fallback to ids() if list() rejects
    }
    const ids = await callSdk<string[]>(() => (client as any).tool.ids())
    return (ids ?? []).map((id) => ({ id }))
  }

  // ─── Session ops ─────────────────────────────────────────────

  async sessionShare(sessionId: string): Promise<{ url?: string; error?: string }> {
    try {
      const client = await this.getOpenCodeClient(sessionId)
      const session = this.sessions.get(sessionId)
      const remoteId = session?.backendStates['opencode']?.sessionId
      if (!remoteId) return { error: 'No active OpenCode session id' }
      const result = await callSdk<{ url?: string; share?: { url?: string } }>(() =>
        (client as any).session.share({ path: { id: remoteId } }),
      )
      return { url: result?.url ?? result?.share?.url }
    } catch (error) {
      return { error: errMsg(error) }
    }
  }

  async sessionUnshare(sessionId: string): Promise<{ success?: true; error?: string }> {
    try {
      const client = await this.getOpenCodeClient(sessionId)
      const remoteId = this.requireRemoteId(sessionId)
      await callSdk(() => (client as any).session.unshare({ path: { id: remoteId } }))
      return { success: true }
    } catch (error) {
      return { error: errMsg(error) }
    }
  }

  async sessionSummarize(sessionId: string): Promise<{ success?: true; error?: string }> {
    try {
      const client = await this.getOpenCodeClient(sessionId)
      const remoteId = this.requireRemoteId(sessionId)
      await callSdk(() => (client as any).session.summarize({ path: { id: remoteId } }))
      return { success: true }
    } catch (error) {
      return { error: errMsg(error) }
    }
  }

  async sessionRevert(
    sessionId: string,
    messageId: string,
  ): Promise<{ success?: true; error?: string }> {
    try {
      const client = await this.getOpenCodeClient(sessionId)
      const remoteId = this.requireRemoteId(sessionId)
      await callSdk(() =>
        (client as any).session.revert({
          path: { id: remoteId },
          body: { messageID: messageId },
        }),
      )
      return { success: true }
    } catch (error) {
      return { error: errMsg(error) }
    }
  }

  async sessionUnrevert(sessionId: string): Promise<{ success?: true; error?: string }> {
    try {
      const client = await this.getOpenCodeClient(sessionId)
      const remoteId = this.requireRemoteId(sessionId)
      await callSdk(() => (client as any).session.unrevert({ path: { id: remoteId } }))
      return { success: true }
    } catch (error) {
      return { error: errMsg(error) }
    }
  }

  async sessionFork(
    sessionId: string,
    messageId: string,
  ): Promise<{ newSessionId?: string; error?: string }> {
    try {
      const client = await this.getOpenCodeClient(sessionId)
      const remoteId = this.requireRemoteId(sessionId)
      const result = await callSdk<{ id?: string }>(() =>
        (client as any).session.fork({
          path: { id: remoteId },
          body: { messageID: messageId },
        }),
      )
      return { newSessionId: result?.id }
    } catch (error) {
      return { error: errMsg(error) }
    }
  }

  async sessionAbort(sessionId: string): Promise<{ success?: true; error?: string }> {
    try {
      const client = await this.getOpenCodeClient(sessionId)
      const remoteId = this.requireRemoteId(sessionId)
      await callSdk(() => (client as any).session.abort({ path: { id: remoteId } }))
      return { success: true }
    } catch (error) {
      return { error: errMsg(error) }
    }
  }

  async sessionDiff(
    sessionId: string,
  ): Promise<{ diff?: unknown; error?: string }> {
    try {
      const client = await this.getOpenCodeClient(sessionId)
      const remoteId = this.requireRemoteId(sessionId)
      const result = await callSdk<unknown>(() =>
        (client as any).session.diff({ path: { id: remoteId } }),
      )
      return { diff: result }
    } catch (error) {
      return { error: errMsg(error) }
    }
  }

  async sessionTodo(
    sessionId: string,
  ): Promise<{ todos?: OpenCodeTodoItem[]; error?: string }> {
    try {
      const client = await this.getOpenCodeClient(sessionId)
      const remoteId = this.requireRemoteId(sessionId)
      const result = await callSdk<Array<{ id?: string; text?: string; done?: boolean }>>(() =>
        (client as any).session.todo({ path: { id: remoteId } }),
      )
      const todos = (Array.isArray(result) ? result : []).map((t) => ({
        id: t.id ?? '',
        text: t.text ?? '',
        done: t.done,
      }))
      return { todos }
    } catch (error) {
      return { error: errMsg(error) }
    }
  }

  async sessionInit(sessionId: string): Promise<{ success?: true; error?: string }> {
    try {
      const client = await this.getOpenCodeClient(sessionId)
      const remoteId = this.requireRemoteId(sessionId)
      await callSdk(() => (client as any).session.init({ path: { id: remoteId } }))
      return { success: true }
    } catch (error) {
      return { error: errMsg(error) }
    }
  }

  async sessionDeleteRemote(sessionId: string): Promise<{ success?: true; error?: string }> {
    try {
      const client = await this.getOpenCodeClient(sessionId)
      const remoteId = this.requireRemoteId(sessionId)
      await callSdk(() => (client as any).session.delete({ path: { id: remoteId } }))
      // Clear local backend state since the remote session is gone.
      const session = this.sessions.get(sessionId)
      if (session) {
        delete session.backendStates['opencode']
        await this.persistSession(session)
      }
      return { success: true }
    } catch (error) {
      return { error: errMsg(error) }
    }
  }

  // ─── Workspace ops (Phase 7) ───────────────────────────────────

  async fileList(
    sessionId: string,
    path: string,
  ): Promise<{ entries?: OpenCodeFileEntry[]; error?: string }> {
    try {
      const client = await this.getOpenCodeClient(sessionId)
      const result = await callSdk<
        Array<{
          path?: string
          name?: string
          type?: string
          size?: number
          modified?: number
        }>
      >(() => (client as any).file.list({ query: { path, directory: this.workspaceRoot } }))
      const entries = (Array.isArray(result) ? result : []).map((e) => ({
        path: e.path ?? '',
        name: e.name ?? '',
        isDirectory: e.type === 'directory' || e.type === 'dir',
        size: e.size,
        modified: e.modified,
      }))
      return { entries }
    } catch (error) {
      return { error: errMsg(error) }
    }
  }

  async fileRead(
    sessionId: string,
    path: string,
  ): Promise<{ content?: string; error?: string }> {
    try {
      const client = await this.getOpenCodeClient(sessionId)
      const result = await callSdk<{ content?: string } | string>(() =>
        (client as any).file.read({ query: { path, directory: this.workspaceRoot } }),
      )
      if (typeof result === 'string') return { content: result }
      return { content: result?.content }
    } catch (error) {
      return { error: errMsg(error) }
    }
  }

  async fileStatus(sessionId: string): Promise<{ status?: unknown; error?: string }> {
    try {
      const client = await this.getOpenCodeClient(sessionId)
      const result = await callSdk<unknown>(() =>
        (client as any).file.status({ query: { directory: this.workspaceRoot } }),
      )
      return { status: result }
    } catch (error) {
      return { error: errMsg(error) }
    }
  }

  async findText(
    sessionId: string,
    query: string,
  ): Promise<{ results?: OpenCodeFindResult[]; error?: string }> {
    try {
      const client = await this.getOpenCodeClient(sessionId)
      const result = await callSdk<
        Array<{ path?: string; line?: number; column?: number; text?: string; preview?: string }>
      >(() => (client as any).find.text({ query: { query, directory: this.workspaceRoot } }))
      const results = (Array.isArray(result) ? result : []).map((r) => ({
        path: r.path ?? '',
        line: r.line,
        column: r.column,
        preview: r.preview ?? r.text,
        matchText: r.text,
      }))
      return { results }
    } catch (error) {
      return { error: errMsg(error) }
    }
  }

  async findFiles(
    sessionId: string,
    pattern: string,
  ): Promise<{ paths?: string[]; error?: string }> {
    try {
      const client = await this.getOpenCodeClient(sessionId)
      const result = await callSdk<string[] | Array<{ path?: string }>>(() =>
        (client as any).find.files({ query: { pattern, directory: this.workspaceRoot } }),
      )
      const arr = Array.isArray(result) ? result : []
      const paths = arr.map((p) => (typeof p === 'string' ? p : (p.path ?? '')))
      return { paths }
    } catch (error) {
      return { error: errMsg(error) }
    }
  }

  async findSymbols(
    sessionId: string,
    query: string,
  ): Promise<{ symbols?: OpenCodeSymbolResult[]; error?: string }> {
    try {
      const client = await this.getOpenCodeClient(sessionId)
      const result = await callSdk<
        Array<{
          name?: string
          kind?: string | number
          path?: string
          line?: number
          column?: number
        }>
      >(() => (client as any).find.symbols({ query: { query, directory: this.workspaceRoot } }))
      const symbols = (Array.isArray(result) ? result : []).map((s) => ({
        name: s.name ?? '',
        kind: typeof s.kind === 'string' ? s.kind : String(s.kind ?? ''),
        path: s.path ?? '',
        line: s.line,
        column: s.column,
      }))
      return { symbols }
    } catch (error) {
      return { error: errMsg(error) }
    }
  }

  async shellRun(
    sessionId: string,
    command: string,
  ): Promise<{ result?: OpenCodeShellResult; error?: string }> {
    try {
      const client = await this.getOpenCodeClient(sessionId)
      const remoteId = this.requireRemoteId(sessionId)
      const result = await callSdk<{
        exitCode?: number
        stdout?: string
        stderr?: string
      }>(() =>
        (client as any).session.shell({
          path: { id: remoteId },
          body: { command },
        }),
      )
      return {
        result: {
          exitCode: result?.exitCode ?? 0,
          stdout: result?.stdout ?? '',
          stderr: result?.stderr ?? '',
        },
      }
    } catch (error) {
      return { error: errMsg(error) }
    }
  }

  async lspStatus(sessionId: string): Promise<{ status?: unknown; error?: string }> {
    try {
      const client = await this.getOpenCodeClient(sessionId)
      const result = await callSdk<unknown>(() => (client as any).lsp.status())
      return { status: result }
    } catch (error) {
      return { error: errMsg(error) }
    }
  }

  async formatterStatus(sessionId: string): Promise<{ status?: unknown; error?: string }> {
    try {
      const client = await this.getOpenCodeClient(sessionId)
      const result = await callSdk<unknown>(() => (client as any).formatter.status())
      return { status: result }
    } catch (error) {
      return { error: errMsg(error) }
    }
  }

  // ─── Config / auth / providers (Phase 8) ───────────────────────

  async configGet(sessionId: string): Promise<{ config?: unknown; error?: string }> {
    try {
      const client = await this.getOpenCodeClient(sessionId)
      const result = await callSdk<unknown>(() => (client as any).config.get())
      return { config: result }
    } catch (error) {
      return { error: errMsg(error) }
    }
  }

  async configUpdate(
    sessionId: string,
    patch: Record<string, unknown>,
  ): Promise<{ success?: true; error?: string }> {
    try {
      const client = await this.getOpenCodeClient(sessionId)
      await callSdk(() => (client as any).config.update({ body: patch }))
      return { success: true }
    } catch (error) {
      return { error: errMsg(error) }
    }
  }

  async configProviders(sessionId: string): Promise<{ providers?: unknown; error?: string }> {
    try {
      const client = await this.getOpenCodeClient(sessionId)
      const result = await callSdk<unknown>(() => (client as any).config.providers())
      return { providers: result }
    } catch (error) {
      return { error: errMsg(error) }
    }
  }

  async authSet(
    sessionId: string,
    key: string,
    value: string,
  ): Promise<{ success?: true; error?: string }> {
    try {
      const client = await this.getOpenCodeClient(sessionId)
      await callSdk(() => (client as any).auth.set({ body: { key, value } }))
      return { success: true }
    } catch (error) {
      return { error: errMsg(error) }
    }
  }

  async providerList(sessionId: string): Promise<{ providers?: unknown; error?: string }> {
    try {
      const client = await this.getOpenCodeClient(sessionId)
      const result = await callSdk<unknown>(() => (client as any).provider.list())
      return { providers: result }
    } catch (error) {
      return { error: errMsg(error) }
    }
  }

  async providerAuth(
    sessionId: string,
    providerId: string,
  ): Promise<{ methods?: OpenCodeAuthMethod[]; error?: string }> {
    try {
      const client = await this.getOpenCodeClient(sessionId)
      const result = await callSdk<
        Array<{ id?: string; label?: string; type?: string }>
      >(() => (client as any).provider.auth({ query: { providerID: providerId } }))
      const methods = (Array.isArray(result) ? result : []).map((m) => ({
        id: m.id ?? '',
        label: m.label,
        type: (m.type === 'oauth' || m.type === 'apiKey' || m.type === 'env'
          ? m.type
          : 'unknown') as OpenCodeAuthMethod['type'],
      }))
      return { methods }
    } catch (error) {
      return { error: errMsg(error) }
    }
  }

  async providerOauthAuthorize(
    sessionId: string,
    providerId: string,
  ): Promise<{ url?: string; error?: string }> {
    try {
      const client = await this.getOpenCodeClient(sessionId)
      const result = await callSdk<{ url?: string }>(() =>
        (client as any).provider.oauth.authorize({ query: { providerID: providerId } }),
      )
      return { url: result?.url }
    } catch (error) {
      return { error: errMsg(error) }
    }
  }

  async providerOauthCallback(
    sessionId: string,
    code: string,
  ): Promise<{ success?: true; error?: string }> {
    try {
      const client = await this.getOpenCodeClient(sessionId)
      await callSdk(() => (client as any).provider.oauth.callback({ query: { code } }))
      return { success: true }
    } catch (error) {
      return { error: errMsg(error) }
    }
  }

  async pathGet(sessionId: string): Promise<{ paths?: OpenCodePathInfo; error?: string }> {
    try {
      const client = await this.getOpenCodeClient(sessionId)
      const result = await callSdk<OpenCodePathInfo>(() => (client as any).path.get())
      return { paths: result ?? {} }
    } catch (error) {
      return { error: errMsg(error) }
    }
  }

  async logWrite(
    sessionId: string,
    message: string,
    level?: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR',
  ): Promise<{ success?: true; error?: string }> {
    try {
      const client = await this.getOpenCodeClient(sessionId)
      await callSdk(() =>
        (client as any).app.log({ body: { message, level: level ?? 'INFO' } }),
      )
      return { success: true }
    } catch (error) {
      return { error: errMsg(error) }
    }
  }

  serverInfo(): OpenCodeServerInfo | null {
    return this.openCodeHost?.getInfo() ?? null
  }

  // ─── TUI control (Phase 8) ─────────────────────────────────────

  async tui(
    sessionId: string,
    method:
      | 'appendPrompt'
      | 'submitPrompt'
      | 'clearPrompt'
      | 'openHelp'
      | 'openSessions'
      | 'openThemes'
      | 'openModels'
      | 'executeCommand'
      | 'showToast',
    args?: Record<string, unknown>,
  ): Promise<{ success?: true; error?: string }> {
    try {
      const client = await this.getOpenCodeClient(sessionId)
      const tui = (client as any).tui
      const opts = args ? { body: args } : undefined
      switch (method) {
        case 'appendPrompt':
          await callSdk(() => tui.appendPrompt(opts))
          break
        case 'submitPrompt':
          await callSdk(() => tui.submitPrompt())
          break
        case 'clearPrompt':
          await callSdk(() => tui.clearPrompt())
          break
        case 'openHelp':
          await callSdk(() => tui.openHelp())
          break
        case 'openSessions':
          await callSdk(() => tui.openSessions())
          break
        case 'openThemes':
          await callSdk(() => tui.openThemes())
          break
        case 'openModels':
          await callSdk(() => tui.openModels())
          break
        case 'executeCommand':
          await callSdk(() => tui.executeCommand(opts))
          break
        case 'showToast':
          await callSdk(() => tui.showToast(opts))
          break
      }
      return { success: true }
    } catch (error) {
      return { error: errMsg(error) }
    }
  }

  // ─── Internals ─────────────────────────────────────────────────

  private toPublicSession(session: CliAgentSessionInternal): CliAgentSession {
    return {
      id: session.id,
      workspaceId: session.workspaceId,
      backend: session.backend,
      activeBackend: session.backend,
      processStatus: session.processStatus,
      messages: session.messages,
      model: session.model,
      sessionToolNames: session.sessionToolNames,
      lastError: session.lastError,
      totalCostUsd: session.totalCostUsd,
      totalTokens: session.totalTokens,
      worktreePath: session.worktreePath,
      backendStates: session.backendStates,
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
      const host = this.ensureOpenCodeHost()
      return createOpenCodeAdapter({
        host,
        getPermissionSettings: () => ({
          tier: this.permissionTier,
          autoApprove: this.autoApprove,
        }),
      })
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

  private ensureOpenCodeHost(): OpenCodeServerHost {
    if (!this.openCodeHost) {
      this.openCodeHost = new OpenCodeServerHost({
        workspaceRoot: this.workspaceRoot,
        explicitPath: this.opencodePath,
      })
    }
    return this.openCodeHost
  }

  private requireRemoteId(localSessionId: string): string {
    const session = this.sessions.get(localSessionId)
    const remote = session?.backendStates['opencode']?.sessionId
    if (!remote) throw new Error('No remote OpenCode session id; send a message first.')
    return remote
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
      if (event.tokens) {
        session.totalTokens = sumTokenUsage(session.totalTokens, event.tokens)
      }
      const payload: CliAgentResultPayload = {
        workspaceId: session.workspaceId,
        sessionId: session.id,
        durationMs: event.durationMs,
        totalCostUsd: session.totalCostUsd,
        totalTokens: session.totalTokens,
        isSuccess: event.isSuccess,
      }
      this.getWebContents()?.send(IpcChannels.CLI_AGENT_RESULT, payload)
      this.broadcastWorkspaceCost(session.workspaceId)
      return
    }

    if (event.type === 'permission-request') {
      this.handlePermissionRequest(session, event.request, event.resolve)
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

  /**
   * Bridge an OpenCode permission event into the existing CHAT_TOOL_CALL
   * approval surface so the IDE has one approval UI for both backends.
   */
  private handlePermissionRequest(
    session: CliAgentSessionInternal,
    request: import('./cliAdapters/types').CliBackendPermissionRequest,
    resolve: (response: 'always' | 'once' | 'reject') => void,
  ): void {
    const toolCallId = randomUUID()
    this.pendingPermissions.set(toolCallId, {
      sessionId: session.id,
      resolve,
    })

    const toolCall: ToolCall = {
      id: toolCallId,
      name: `opencode:${request.category}`,
      input: {
        title: request.title,
        pattern: request.pattern,
        ...(request.metadata ?? {}),
      },
      status: 'pending',
    }

    const payload: ChatToolCallPayload = {
      workspaceId: session.workspaceId,
      sessionId: session.id,
      toolCall,
    }
    this.getWebContents()?.send(IpcChannels.CHAT_TOOL_CALL, payload)

    // Also emit a structured CLI agent permission request payload for any
    // surface that wants the rich form (badges, metadata).
    const richPayload: CliAgentPermissionRequest = {
      workspaceId: session.workspaceId,
      sessionId: session.id,
      toolCallId,
      backend: 'opencode',
      title: request.title,
      category: request.category,
      pattern: request.pattern,
      metadata: request.metadata,
      timestamp: Date.now(),
    }
    void richPayload // (channel reserved for future granular UI; CHAT_TOOL_CALL is the active surface)
    this.notifyWorkloadChanged()
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

  private broadcastWorkspaceCost(workspaceId: string): void {
    const summary = this.getWorkspaceCostSummary()
    if (workspaceId) summary.workspaceId = workspaceId
    this.getWebContents()?.send(IpcChannels.CLI_AGENT_WORKSPACE_COST, summary)
  }

  private notifyWorkloadChanged(): void {
    try {
      this.onWorkloadChanged?.()
    } catch {
      /* ignore */
    }
  }

  private async persistSession(session: CliAgentSessionInternal): Promise<void> {
    if (!this.conversationStore || session.id.startsWith('claude-native:')) return

    const claudeSessionId = session.backendStates['claude-code']?.sessionId
    await this.conversationStore.saveMessages(session.id, {
      messages: session.messages,
      activeBackend: session.backend,
      backendStates: session.backendStates,
      claudeSessionId,
      totalCostUsd: session.totalCostUsd,
      totalTokens: session.totalTokens,
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

// ─── SDK call helpers ──────────────────────────────────────────

/**
 * Wraps an SDK promise so we can deal with both `responseStyle: 'data'`
 * (returns the unwrapped data) and the older `{ data, error }` shape.
 * If `error` is set, throws.
 */
async function callSdk<T>(fn: () => Promise<unknown>): Promise<T | undefined> {
  const result = await fn()
  if (result && typeof result === 'object' && 'error' in (result as Record<string, unknown>)) {
    const wrapper = result as { data?: unknown; error?: unknown }
    if (wrapper.error) {
      const err = wrapper.error as { message?: string } | string
      throw new Error(typeof err === 'string' ? err : (err.message ?? 'OpenCode SDK error'))
    }
    return wrapper.data as T | undefined
  }
  return result as T | undefined
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
