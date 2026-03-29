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
  type ChatSession,
  type ChatMessage,
  type ChatMode,
  type ChatSessionStatus,
  type ToolCall,
  type ToolResult,
  type LlmProviderConfig,
  type ChatStreamChunk,
  type ChatStreamEnd,
  type ChatToolCallPayload,
  type PermissionTier,
  type ToolPermissionConfig,
} from '@aide/shared'
import type { LlmMessage, LlmContentBlock, LlmStreamEvent } from '@aide/shared'
import { LlmClient } from './llmClient'
import { ToolRegistry } from './toolRegistry'
import type { BrowserPaneManager } from './browserPaneManager'

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
}

interface PendingApproval {
  resolve: (approved: boolean) => void
}

// ─── Manager ───────────────────────────────────────────────────────

export class AgentManager {
  private sessions = new Map<string, ChatSession>()
  private workspaceSessions = new Map<string, string>()
  private llmClient: LlmClient
  private toolRegistry: ToolRegistry
  private workspaceRoot: string
  private config: LlmProviderConfig
  private getWebContents: () => WebContents | null
  private permissionTier: PermissionTier
  private autoApprove: Record<string, boolean | ToolPermissionConfig>

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

    this.llmClient = new LlmClient(opts.config)
    this.toolRegistry = new ToolRegistry({
      workspaceRoot: opts.workspaceRoot,
      browserPaneManager: opts.browserPaneManager,
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

  /** Get or create the chat session for a workspace. Loads from disk if available. */
  async getHistory(workspaceId: string): Promise<ChatSession> {
    // Check if we already have a session for this workspace
    const existingId = this.workspaceSessions.get(workspaceId)
    if (existingId && this.sessions.has(existingId)) {
      return this.sessions.get(existingId)!
    }

    // Try to load from disk
    const loaded = await this.loadSession()
    if (loaded && loaded.workspaceId === workspaceId) {
      this.sessions.set(loaded.id, loaded)
      this.workspaceSessions.set(workspaceId, loaded.id)
      return loaded
    }

    // Create a new session
    const session: ChatSession = {
      id: randomUUID(),
      workspaceId,
      mode: 'agent',
      messages: [],
      workingSet: [],
      status: 'idle',
    }
    this.sessions.set(session.id, session)
    this.workspaceSessions.set(workspaceId, session.id)
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
    }
  }

  rejectToolCall(_sessionId: string, toolCallId: string): void {
    const pending = this.pendingApprovals.get(toolCallId)
    if (pending) {
      this.pendingApprovals.delete(toolCallId)
      pending.resolve(false)
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
    for (const [toolCallId, pending] of this.pendingApprovals) {
      pending.resolve(false)
      this.pendingApprovals.delete(toolCallId)
    }

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

  destroy(): void {
    // Abort all active loops
    for (const [sessionId] of this.activeLoops) {
      this.stop(sessionId)
    }
    this.llmClient.abortAll()
    this.sessions.clear()
    this.workspaceSessions.clear()
  }

  // ─── Core Agent Loop ──────────────────────────────────────────

  private async runAgentLoop(
    session: ChatSession,
    assistantMessageId: string,
    signal: AbortSignal,
  ): Promise<void> {
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
          sessionId: session.id,
          toolCall: tc,
        } satisfies ChatToolCallPayload)
      } else {
        // Needs manual approval
        session.status = 'awaiting_approval'
        this.send(IpcChannels.CHAT_TOOL_CALL, {
          sessionId: session.id,
          toolCall: tc,
        } satisfies ChatToolCallPayload)

        const approved = await this.waitForApproval(tc)

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

  private waitForApproval(toolCall: ToolCall): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.pendingApprovals.set(toolCall.id, { resolve })
    })
  }

  // ─── Permission Checks ─────────���────────────────────────────

  private static readonly READ_ONLY_TOOLS = new Set([
    'file_read', 'file_list', 'search_files', 'git_status', 'git_diff', 'browser_read',
  ])

  private shouldAutoApprove(toolName: string, input: Record<string, unknown>): boolean {
    // Per-tool overrides take precedence over tier
    const override = this.autoApprove[toolName]
    if (override === true) return true
    if (override === false) return false
    if (typeof override === 'object') {
      return this.matchesPatternConfig(override, toolName, input)
    }

    // Fall back to tier logic
    switch (this.permissionTier) {
      case 'autopilot':
        return true
      case 'auto-approve':
        return AgentManager.READ_ONLY_TOOLS.has(toolName)
      case 'confirm':
      default:
        return false
    }
  }

  private matchesPatternConfig(
    config: ToolPermissionConfig,
    toolName: string,
    input: Record<string, unknown>,
  ): boolean {
    // For terminal_exec, match against the command string; otherwise match stringified input
    const matchTarget = toolName === 'terminal_exec'
      ? String(input.command ?? '')
      : JSON.stringify(input)

    // Deny patterns take precedence
    if (config.denyPatterns?.some((p) => this.globMatch(matchTarget, p))) {
      return false
    }
    // Must match at least one allow pattern
    if (config.allowPatterns && config.allowPatterns.length > 0) {
      return config.allowPatterns.some((p) => this.globMatch(matchTarget, p))
    }
    return false
  }

  private globMatch(text: string, pattern: string): boolean {
    // Simple glob: * matches any sequence of characters
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp('^' + escaped.replace(/\*/g, '.*') + '$')
    return regex.test(text)
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
    const filePath = join(this.workspaceRoot, CHAT_STATE_FILE)
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }
    const tmpPath = join(dir, `.tmp-${randomUUID()}.json`)
    await writeFile(tmpPath, JSON.stringify(session, null, 2), 'utf-8')
    await rename(tmpPath, filePath)
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

  // ─── Helpers ─────────────────────────────────────────────────

  private send(channel: string, data: unknown): void {
    this.getWebContents()?.send(channel, data)
  }
}
