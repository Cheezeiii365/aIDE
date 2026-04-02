/**
 * Agent system types shared between main and renderer processes.
 * Covers chat, tools, MCP, permissions, and LLM provider configuration.
 */

// ─── Chat Mode ──────────────────────────────────────────────────────

export type ChatMode = 'ask' | 'edit' | 'agent'

export type ChatSessionStatus = 'idle' | 'thinking' | 'tool_running' | 'awaiting_approval'

export type ToolCallStatus = 'pending' | 'approved' | 'rejected' | 'completed'

// ─── Core Chat Types ────────────────────────────────────────────────

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
  status: ToolCallStatus
  autoApproved?: boolean
}

export interface ToolResult {
  toolCallId: string
  output: string
  isError: boolean
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool_result'
  content: string
  timestamp: number
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
}

export interface ChatSession {
  id: string
  workspaceId: string
  mode: ChatMode
  messages: ChatMessage[]
  workingSet: string[]
  status: ChatSessionStatus
  /** Worktree path this session operates in (if any). */
  worktreePath?: string
}

// ─── Streaming Payloads ─────────────────────────────────────────────

export interface ChatStreamChunk {
  workspaceId: string
  sessionId: string
  messageId: string
  delta: string
}

export interface ChatStreamEnd {
  workspaceId: string
  sessionId: string
  messageId: string
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop' | 'error'
  error?: string
}

export interface ChatToolCallPayload {
  workspaceId: string
  sessionId: string
  toolCall: ToolCall
}

// ─── Tool Definitions ───────────────────────────────────────────────

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  source: 'builtin' | string
}

// ─── MCP Types ──────────────────────────────────────────────────────

export interface McpServerConfig {
  type: 'stdio'
  command: string
  args?: string[]
  env?: Record<string, string>
}

export type McpServerConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface McpServerStatus {
  name: string
  status: McpServerConnectionStatus
  toolCount: number
  error?: string
}

// ─── Permission Types ───────────────────────────────────────────────

export type PermissionTier = 'confirm' | 'auto-approve' | 'autopilot'

export interface ToolPermissionConfig {
  allowPatterns?: string[]
  denyPatterns?: string[]
}

export interface AgentPermissionSettings {
  permissionTier: PermissionTier
  autoApprove: Record<string, boolean | ToolPermissionConfig>
}

// ─── LLM Provider Config ────────────────────────────────────────────

export interface LlmProviderConfig {
  /** Known values: 'anthropic', 'openai-compatible'. Extensible for custom providers. */
  provider: string
  model: string
  apiKey: string
  baseUrl?: string
  maxTurns: number
  maxTokens: number
}
