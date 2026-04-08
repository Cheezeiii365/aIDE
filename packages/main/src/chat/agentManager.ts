/**
 * AgentManager — core agent loop for the aIDE chat system.
 *
 * Manages chat sessions, orchestrates LLM calls, handles tool execution
 * with user approval gates, streams responses to the renderer, and
 * persists chat history to disk.
 */

import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { readFile, writeFile, rename, mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import type { WebContents } from 'electron'
import {
  IpcChannels,
  deriveTitle,
  type ChatSession,
  type ChatMessage,
  type ChatMode,
  type ChatSessionStatus,
  type ToolCall,
  type ToolResult,
  type TaskExecution,
  type LlmProviderConfig,
  type ChatStreamChunk,
  type ChatStreamEnd,
  type ChatToolCallPayload,
  type PermissionTier,
  type ToolPermissionConfig,
  type ConversationListChangedPayload,
} from '@aide/shared'
import type { LlmMessage, LlmContentBlock, LlmStreamEvent } from '@aide/shared'
import { LlmClient } from './llmClient'
import { ToolRegistry } from './toolRegistry'
import type { BrowserPaneManager } from '../browserPaneManager'
import type { ConversationStore } from './conversationStore'
import type { TaskVariableContext } from '../tasks/taskVariableResolver'
import { shouldAutoApprove as evalShouldAutoApprove } from './permissionMatching'
import type { ToolApprovalOwner } from './approvalRouter'

// ─── Constants ─────────────────────────────────────────────────────

const MAX_RETRIES_PER_TOOL = 5
const CHAT_STATE_FILE = '.aide/local/chat.json'

// ─── Types ─────────────────────────────────────────────────────────

interface AgentManagerOpts {
  config: LlmProviderConfig
  workspaceRoot: string
  getWebContents: () => WebContents | null
  browserPaneManager?: BrowserPaneManager
  permissionTier?: PermissionTier
  autoApprove?: Record<string, boolean | ToolPermissionConfig>
  conversationStore?: ConversationStore
  /** Called when pending tool approvals or related workload change (for runtime snapshot refresh). */
  onWorkloadChanged?: () => void
  /** Run a .aide/tasks.json task in this workspace (run_workspace_task builtin). */
  runWorkspaceTask?: (
    taskId: string,
    ctx: TaskVariableContext,
  ) => Promise<TaskExecution | { error: string }>
}

interface PendingApproval {
  sessionId: string
  resolve: (approved: boolean) => void
}

// ─── Manager ───────────────────────────────────────────────────────

export class AgentManager implements ToolApprovalOwner {
  private sessions = new Map<string, ChatSession>()
  private llmClient: LlmClient
  private toolRegistry: ToolRegistry
  private workspaceRoot: string
  private config: LlmProviderConfig
  private getWebContents: () => WebContents | null
  private permissionTier: PermissionTier
  private autoApprove: Record<string, boolean | ToolPermissionConfig>
  private conversationStore: ConversationStore | null
  private onWorkloadChanged?: () => void

  // Per-session loop state
  private activeLoops = new Map<string, AbortController>()
  private activeRequestIds = new Map<string, string>()
  private pendingApprovals = new Map<string, PendingApproval>()
  private toolRetryCounters = new Map<string, Map<string, number>>()

  constructor(opts: AgentManagerOpts) {
    this.config = opts.config
    this.workspaceRoot = opts.workspaceRoot
    this.getWebContents = opts.getWebContents
    this.permissionTier = opts.permissionTier ?? 'confirm'
    this.autoApprove = opts.autoApprove ?? {}
    this.conversationStore = opts.conversationStore ?? null
    this.onWorkloadChanged = opts.onWorkloadChanged

    this.llmClient = new LlmClient(opts.config)
    this.toolRegistry = new ToolRegistry({
      workspaceRoot: opts.workspaceRoot,
      browserPaneManager: opts.browserPaneManager,
      runWorkspaceTask: opts.runWorkspaceTask,
    })
    this.toolRegistry.registerBuiltins()
  }

  // ─── Public API (IPC-facing) ───────────────────────────────────

  /**
   * Handle a user message. Creates/finds the session, appends the
   * message, and kicks off the agent loop asynchronously.
   * Returns the assistant messageId so the renderer can track the response.
   */
  async sendMessage(
    sessionId: string,
    content: string,
  ): Promise<{ messageId: string } | { error: string }> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return { error: `Session not found: ${sessionId}` }
    }

    // Don't allow sending while a loop is running
    if (this.activeLoops.has(sessionId)) {
      return { error: 'Agent is already processing a message' }
    }

    // Append user message
    const userMsg: ChatMessage = {
      id: randomUUID(),
      role: 'user',
      content,
      timestamp: Date.now(),
    }
    session.messages.push(userMsg)

    // Auto-title on first user message
    await this.maybeAutoTitle(session, content)

    // Prepare assistant message id
    const assistantMessageId = randomUUID()

    // Set status and kick off loop
    session.status = 'thinking'
    const controller = new AbortController()
    this.activeLoops.set(sessionId, controller)
    this.toolRetryCounters.set(sessionId, new Map())

    // Fire-and-forget: the loop streams events to renderer
    this.runAgentLoop(session, assistantMessageId, controller.signal).catch(
      (err) => {
        console.error('[AgentManager] Unhandled error in agent loop:', err)
      },
    )

    return { messageId: assistantMessageId }
  }

  /**
   * Get or create a chat session.
   * - With `conversationId`: loads that specific conversation
   * - Without: loads the most recent built-in conversation for the workspace, or creates one
   */
  async getHistory(workspaceId: string, conversationId?: string): Promise<ChatSession> {
    // If conversationId is given, check memory first
    if (conversationId && this.sessions.has(conversationId)) {
      return this.sessions.get(conversationId)!
    }

    // Try to load from ConversationStore
    if (this.conversationStore) {
      const targetId = conversationId
        ?? (await this.conversationStore.getMostRecent(workspaceId, 'built-in'))?.id

      if (targetId) {
        // Check memory
        if (this.sessions.has(targetId)) {
          return this.sessions.get(targetId)!
        }
        // Load worktreePath from conversation metadata
        const meta = await this.conversationStore.get(targetId)
        // Load from disk
        const loaded = await this.conversationStore.loadMessages(targetId) as ChatSession | null
        if (loaded) {
          loaded.status = 'idle' // Reset status on load
          if (meta?.worktreePath) loaded.worktreePath = meta.worktreePath
          this.sessions.set(loaded.id, loaded)
          return loaded
        }
      }
    } else {
      // Legacy: try to load from the old single-file path
      const loaded = await this.loadSession()
      if (loaded && loaded.workspaceId === workspaceId) {
        this.sessions.set(loaded.id, loaded)
        return loaded
      }
    }

    // Create a new session — also register in ConversationStore if available
    const sessionId = conversationId ?? randomUUID()

    // Check if the conversation already exists with worktree metadata
    let existingWorktreePath: string | undefined
    if (conversationId && this.conversationStore) {
      const existingMeta = await this.conversationStore.get(conversationId)
      existingWorktreePath = existingMeta?.worktreePath
    }

    const session: ChatSession = {
      id: sessionId,
      workspaceId,
      mode: 'agent',
      messages: [],
      workingSet: [],
      status: 'idle',
      worktreePath: existingWorktreePath,
    }
    this.sessions.set(session.id, session)

    // Register in store if this is a genuinely new session (no conversationId given)
    if (!conversationId && this.conversationStore) {
      await this.conversationStore.create({
        workspaceId,
        backend: 'built-in',
      }).then(meta => {
        // Re-key the session with the store-generated ID
        this.sessions.delete(session.id)
        session.id = meta.id
        if (meta.worktreePath) session.worktreePath = meta.worktreePath
        this.sessions.set(meta.id, session)
      })
    }

    return session
  }

  async setMode(sessionId: string, mode: ChatMode): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.mode = mode
  }

  async setWorkingSet(sessionId: string, paths: string[]): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.workingSet = paths
    this.toolRegistry.updateContext({ workingSet: paths })
  }

  approveToolCall(_sessionId: string, toolCallId: string): void {
    const pending = this.pendingApprovals.get(toolCallId)
    if (pending) {
      this.pendingApprovals.delete(toolCallId)
      pending.resolve(true)
      this.notifyWorkloadChanged()
    }
  }

  rejectToolCall(_sessionId: string, toolCallId: string): void {
    const pending = this.pendingApprovals.get(toolCallId)
    if (pending) {
      this.pendingApprovals.delete(toolCallId)
      pending.resolve(false)
      this.notifyWorkloadChanged()
    }
  }

  stop(sessionId: string): void {
    // Abort the LLM request
    const requestId = this.activeRequestIds.get(sessionId)
    if (requestId) {
      this.llmClient.abort(requestId)
      this.activeRequestIds.delete(sessionId)
    }

    // Abort the loop
    const controller = this.activeLoops.get(sessionId)
    if (controller) {
      controller.abort()
      this.activeLoops.delete(sessionId)
    }

    // Reject all pending approvals for this session
    let clearedPending = false
    for (const [toolCallId, pending] of this.pendingApprovals) {
      if (pending.sessionId === sessionId) {
        pending.resolve(false)
        this.pendingApprovals.delete(toolCallId)
        clearedPending = true
      }
    }
    if (clearedPending) this.notifyWorkloadChanged()

    // Reset session status
    const session = this.sessions.get(sessionId)
    if (session) {
      session.status = 'idle'
    }
  }

  updateConfig(config: LlmProviderConfig): void {
    this.config = config
    this.llmClient.updateConfig(config)
  }

  updatePermissions(tier: PermissionTier, autoApprove: Record<string, boolean | ToolPermissionConfig>): void {
    this.permissionTier = tier
    this.autoApprove = autoApprove
  }

  getActiveSessionCount(): number {
    return this.activeLoops.size
  }

  /** True if this manager holds an in-memory built-in chat session for the id. */
  ownsSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  getPendingApprovalCount(): number {
    return this.pendingApprovals.size
  }

  /**
   * Pending built-in tool calls waiting for user approval (for global inbox hydration).
   */
  listPendingToolApprovals(): Array<{ workspaceId: string; sessionId: string; toolCall: ToolCall }> {
    const out: Array<{ workspaceId: string; sessionId: string; toolCall: ToolCall }> = []
    for (const [toolCallId, pending] of this.pendingApprovals) {
      const session = this.sessions.get(pending.sessionId)
      if (!session) continue
      const toolCall = this.findToolCallInSession(session, toolCallId)
      if (toolCall) {
        out.push({
          workspaceId: session.workspaceId,
          sessionId: pending.sessionId,
          toolCall: { ...toolCall },
        })
      }
    }
    return out
  }

  private findToolCallInSession(session: ChatSession, toolCallId: string): ToolCall | null {
    for (const msg of session.messages) {
      if (msg.role !== 'assistant' || !msg.toolCalls?.length) continue
      const found = msg.toolCalls.find((t) => t.id === toolCallId)
      if (found) return found
    }
    return null
  }

  private notifyWorkloadChanged(): void {
    this.onWorkloadChanged?.()
  }

  async destroy(): Promise<void> {
    // Abort all active loops
    for (const [sessionId] of this.activeLoops) {
      this.stop(sessionId)
    }
    this.llmClient.abortAll()

    // Persist all sessions before clearing
    for (const session of this.sessions.values()) {
      await this.persistSession(session).catch(() => {})
    }
    this.sessions.clear()
  }

  // ─── Core Agent Loop ──────────────────────────────────────────

  private async runAgentLoop(
    session: ChatSession,
    assistantMessageId: string,
    signal: AbortSignal,
  ): Promise<void> {
    // Set per-session effective root for worktree-scoped tools
    if (session.worktreePath) {
      this.toolRegistry.updateContext({ effectiveRoot: session.worktreePath })
    }
    this.toolRegistry.updateContext({ workspaceId: session.workspaceId })

    let turnCount = 0
    let currentMessageId = assistantMessageId

    console.log('[AgentManager] Starting agent loop', {
      sessionId: session.id,
      mode: session.mode,
      maxTurns: this.config.maxTurns,
      provider: this.config.provider,
      model: this.config.model,
      hasApiKey: !!this.config.apiKey,
      apiKeyPrefix: this.config.apiKey ? this.config.apiKey.slice(0, 8) + '...' : '(empty)',
    })

    try {
      while (turnCount < this.config.maxTurns && !signal.aborted) {
        turnCount++
        session.status = 'thinking'
        console.log(`[AgentManager] Turn ${turnCount}/${this.config.maxTurns}`)

        const { stopReason, toolCalls } = await this.processStream(
          session,
          currentMessageId,
          signal,
        )

        if (signal.aborted) break

        // If the LLM finished without requesting tools, we're done
        if (stopReason !== 'tool_use' || toolCalls.length === 0) {
          break
        }

        // Execute tool calls and feed results back
        session.status = 'awaiting_approval'
        const results = await this.executeToolCalls(
          session,
          toolCalls,
          signal,
        )

        if (signal.aborted) break

        // Append tool results as a tool_result message
        const toolResultMsg: ChatMessage = {
          id: randomUUID(),
          role: 'tool_result',
          content: '',
          timestamp: Date.now(),
          toolResults: results,
        }
        session.messages.push(toolResultMsg)

        // Next iteration will generate a new assistant message
        currentMessageId = randomUUID()
      }

      if (!signal.aborted && turnCount >= this.config.maxTurns) {
        this.send(IpcChannels.CHAT_STREAM_END, {
          workspaceId: session.workspaceId,
          sessionId: session.id,
          messageId: currentMessageId,
          stopReason: 'error',
          error: `Turn limit reached (${this.config.maxTurns})`,
        } satisfies ChatStreamEnd)
      }
    } catch (err) {
      console.error('[AgentManager] Agent loop error:', err)
      if (!signal.aborted) {
        const error = err instanceof Error ? err.message : 'Unknown error'
        this.send(IpcChannels.CHAT_STREAM_END, {
          workspaceId: session.workspaceId,
          sessionId: session.id,
          messageId: currentMessageId,
          stopReason: 'error',
          error,
        } satisfies ChatStreamEnd)
      }
    } finally {
      console.log('[AgentManager] Agent loop finished', { sessionId: session.id, turns: turnCount })
      session.status = 'idle'
      this.activeLoops.delete(session.id)
      this.activeRequestIds.delete(session.id)
      this.toolRetryCounters.delete(session.id)
      // Reset effective root after loop completes
      this.toolRegistry.updateContext({ effectiveRoot: undefined })
      await this.persistSession(session).catch(() => {})
    }
  }

  // ─── Stream Processing ────────────────────────────────────────

  private async processStream(
    session: ChatSession,
    messageId: string,
    signal: AbortSignal,
  ): Promise<{ stopReason: string; toolCalls: ToolCall[] }> {
    const requestId = randomUUID()
    this.activeRequestIds.set(session.id, requestId)

    const system = this.buildSystemPrompt(session)
    const messages = this.buildLlmMessages(session)
    const tools = this.toolRegistry.toLlmTools(session.mode)

    let textBuffer = ''
    let stopReason = 'end_turn'
    const toolCalls: ToolCall[] = []
    const toolJsonBuffers = new Map<string, string>() // toolUseId → partial JSON

    try {
      for await (const event of this.llmClient.stream({
        requestId,
        system,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        maxTokens: this.config.maxTokens,
      })) {
        if (signal.aborted) break

        switch (event.type) {
          case 'text_delta':
            textBuffer += event.text
            this.send(IpcChannels.CHAT_STREAM_CHUNK, {
              workspaceId: session.workspaceId,
              sessionId: session.id,
              messageId,
              delta: event.text,
            } satisfies ChatStreamChunk)
            break

          case 'tool_use_start':
            toolCalls.push({
              id: event.id,
              name: event.name,
              input: {},
              status: 'pending',
            })
            toolJsonBuffers.set(event.id, '')
            break

          case 'tool_use_delta':
            toolJsonBuffers.set(
              event.id,
              (toolJsonBuffers.get(event.id) ?? '') + event.partialJson,
            )
            break

          case 'tool_use_end': {
            const tc = toolCalls.find((t) => t.id === event.id)
            const jsonStr = toolJsonBuffers.get(event.id) ?? '{}'
            if (tc) {
              try {
                tc.input = JSON.parse(jsonStr)
              } catch {
                tc.input = { _raw: jsonStr }
              }
            }
            toolJsonBuffers.delete(event.id)
            break
          }

          case 'message_end':
            stopReason = event.stopReason
            break

          case 'error':
            throw new Error(event.error)
        }
      }
    } catch (err) {
      // Re-throw unless it's an abort
      if (signal.aborted) {
        stopReason = 'stop'
      } else {
        throw err
      }
    } finally {
      this.activeRequestIds.delete(session.id)
    }

    // Append the assistant message to session
    const assistantMsg: ChatMessage = {
      id: messageId,
      role: 'assistant',
      content: textBuffer,
      timestamp: Date.now(),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    }
    session.messages.push(assistantMsg)

    // Send stream end
    this.send(IpcChannels.CHAT_STREAM_END, {
      workspaceId: session.workspaceId,
      sessionId: session.id,
      messageId,
      stopReason: stopReason as ChatStreamEnd['stopReason'],
    } satisfies ChatStreamEnd)

    return { stopReason, toolCalls }
  }

  // ─── Tool Execution ──────────────────────────────────────────

  private async executeToolCalls(
    session: ChatSession,
    toolCalls: ToolCall[],
    signal: AbortSignal,
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = []
    const retryCounters =
      this.toolRetryCounters.get(session.id) ?? new Map<string, number>()

    for (const tc of toolCalls) {
      if (signal.aborted) {
        results.push({
          toolCallId: tc.id,
          output: 'Cancelled by user',
          isError: true,
        })
        tc.status = 'rejected'
        continue
      }

      // Check if this tool call can be auto-approved
      const canAutoApprove = this.shouldAutoApprove(tc.name, tc.input)

      if (canAutoApprove) {
        // Auto-approved: mark and notify renderer (no user interaction needed)
        tc.status = 'approved'
        tc.autoApproved = true
        session.status = 'tool_running'
        this.send(IpcChannels.CHAT_TOOL_CALL, {
          workspaceId: session.workspaceId,
          sessionId: session.id,
          toolCall: tc,
        } satisfies ChatToolCallPayload)
      } else {
        // Needs manual approval
        session.status = 'awaiting_approval'
        this.send(IpcChannels.CHAT_TOOL_CALL, {
          workspaceId: session.workspaceId,
          sessionId: session.id,
          toolCall: tc,
        } satisfies ChatToolCallPayload)

        const approved = await this.waitForApproval(session.id, tc)

        if (signal.aborted || !approved) {
          tc.status = 'rejected'
          results.push({
            toolCallId: tc.id,
            output: 'Tool call rejected by user',
            isError: true,
          })
          continue
        }

        tc.status = 'approved'
        session.status = 'tool_running'
      }

      const result = await this.toolRegistry.execute(tc.id, tc.name, tc.input)
      tc.status = 'completed'

      // Track retries for errored tools
      if (result.isError) {
        const count = (retryCounters.get(tc.name) ?? 0) + 1
        retryCounters.set(tc.name, count)
        if (count >= MAX_RETRIES_PER_TOOL) {
          result.output += `\n[Retry limit reached for ${tc.name}. Please try a different approach.]`
        }
      }

      results.push(result)
    }

    return results
  }

  private waitForApproval(sessionId: string, toolCall: ToolCall): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.pendingApprovals.set(toolCall.id, { sessionId, resolve })
      this.notifyWorkloadChanged()
    })
  }

  // ─── Permission Checks ────────────────────────────────────────

  private shouldAutoApprove(toolName: string, input: Record<string, unknown>): boolean {
    return evalShouldAutoApprove(toolName, input, this.permissionTier, this.autoApprove)
  }

  /** ToolApprovalOwner: does this manager own the given pending tool call? */
  ownsToolCall(toolCallId: string): boolean {
    return this.pendingApprovals.has(toolCallId)
  }

  // ���── Message Conversion ─────────���────────────────────────────

  /** Convert ChatMessage[] to the canonical LlmMessage[] format. */
  buildLlmMessages(session: ChatSession): LlmMessage[] {
    const result: LlmMessage[] = []

    for (const msg of session.messages) {
      switch (msg.role) {
        case 'user': {
          result.push({
            role: 'user',
            content: [{ type: 'text', text: msg.content }],
          })
          break
        }

        case 'assistant': {
          const blocks: LlmContentBlock[] = []
          if (msg.content) {
            blocks.push({ type: 'text', text: msg.content })
          }
          if (msg.toolCalls) {
            for (const tc of msg.toolCalls) {
              blocks.push({
                type: 'tool_use',
                id: tc.id,
                name: tc.name,
                input: tc.input,
              })
            }
          }
          if (blocks.length > 0) {
            result.push({ role: 'assistant', content: blocks })
          }
          break
        }

        case 'tool_result': {
          if (msg.toolResults && msg.toolResults.length > 0) {
            const blocks: LlmContentBlock[] = msg.toolResults.map((tr) => ({
              type: 'tool_result' as const,
              toolUseId: tr.toolCallId,
              content: tr.output,
              isError: tr.isError || undefined,
            }))
            result.push({ role: 'user', content: blocks })
          }
          break
        }
      }
    }

    return result
  }

  // ─── System Prompt ────────────────────────────────────────────

  buildSystemPrompt(session: ChatSession): string {
    const lines: string[] = [
      'You are aIDE, an AI coding assistant embedded in the aIDE IDE.',
      `Current workspace: ${this.workspaceRoot}`,
      `Current mode: ${session.mode}`,
      '',
    ]

    switch (session.mode) {
      case 'ask':
        lines.push(
          'You are in ASK mode. You can read files, search, and answer questions but cannot modify anything.',
        )
        break
      case 'edit':
        lines.push(
          'You are in EDIT mode. You can read and write files within the working set.',
        )
        if (session.workingSet.length > 0) {
          lines.push(
            'You may only modify files in the working set:',
            ...session.workingSet.map((p) => `- ${p}`),
          )
        }
        break
      case 'agent':
        lines.push(
          'You are in AGENT mode. You have full access to tools including terminal commands. Plan your work, use tools to read/write files, run commands, and iterate until the task is complete.',
        )
        break
    }

    if (session.workingSet.length > 0 && session.mode !== 'edit') {
      lines.push(
        '',
        'Files in the working set (user-selected context):',
        ...session.workingSet.map((p) => `- ${p}`),
      )
    }

    lines.push('', `Today is ${new Date().toISOString().split('T')[0]}.`)

    return lines.join('\n')
  }

  // ─── Persistence ─────────────────────────────────────────────

  private async persistSession(session: ChatSession): Promise<void> {
    if (!this.workspaceRoot) return

    if (this.conversationStore) {
      // Save messages to the conversation store
      await this.conversationStore.saveMessages(session.id, session)
      // Update metadata
      const userMsgCount = session.messages.filter(m => m.role === 'user').length
      await this.conversationStore.updateMeta(session.id, {
        updatedAt: Date.now(),
        messageCount: session.messages.length,
        firstMessage: session.messages.find(m => m.role === 'user')?.content.slice(0, 100),
      })
    } else {
      // Legacy: write to single file
      const filePath = join(this.workspaceRoot, CHAT_STATE_FILE)
      const dir = dirname(filePath)
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true })
      }
      const tmpPath = join(dir, `.tmp-${randomUUID()}.json`)
      await writeFile(tmpPath, JSON.stringify(session, null, 2), 'utf-8')
      await rename(tmpPath, filePath)
    }
  }

  private async loadSession(): Promise<ChatSession | null> {
    if (!this.workspaceRoot) return null
    const filePath = join(this.workspaceRoot, CHAT_STATE_FILE)
    if (!existsSync(filePath)) return null
    try {
      const raw = await readFile(filePath, 'utf-8')
      return JSON.parse(raw) as ChatSession
    } catch {
      return null
    }
  }

  /** Auto-title the conversation from the first user message. */
  private async maybeAutoTitle(session: ChatSession, content: string): Promise<void> {
    if (!this.conversationStore) return

    const userMessages = session.messages.filter(m => m.role === 'user')
    if (userMessages.length !== 1) return // Only auto-title on the very first user message

    const meta = await this.conversationStore.get(session.id)
    if (!meta || !meta.autoTitled) return

    const title = deriveTitle(content)
    await this.conversationStore.updateMeta(session.id, { title, updatedAt: Date.now() })

    // Notify renderer that conversation list changed
    const index = await this.conversationStore.loadIndex()
    this.send(IpcChannels.CONVERSATION_LIST_CHANGED, {
      workspaceId: session.workspaceId,
      conversations: index,
    } satisfies ConversationListChangedPayload)
  }

  // ─── Helpers ─────────────────────────────────────────────────

  private send(channel: string, data: unknown): void {
    this.getWebContents()?.send(channel, data)
  }
}
