/**
 * CLI Agent Wrappers — shared types.
 *
 * Types for wrapping external CLI agents (Claude Code, OpenCode, Codex) as monitored
 * sessions inside the IDE. These are consumed by both main and renderer.
 */

// ---------------------------------------------------------------------------
// Agent backend selection
// ---------------------------------------------------------------------------

export type AgentBackend = 'built-in' | 'claude-code' | 'opencode' | 'codex'
/** External (non-built-in) CLI agent backends. */
export type ExternalCliBackend = Exclude<AgentBackend, 'built-in'>

/**
 * Per-backend session state preserved across hot-swaps and turns.
 *
 * The base fields (`sessionId`, `model`) apply to every backend. The optional
 * `provider*`/`agent`/`mode`/`systemPromptOverride`/`toolToggles` fields are
 * primarily used by the OpenCode adapter to surface the SDK's prompt body
 * options, but are kept generic so other backends can opt-in.
 */
export interface CliAgentBackendState {
  sessionId?: string
  model?: string
  // OpenCode-relevant overrides (optional, additive — backwards compatible).
  providerID?: string
  modelID?: string
  agent?: string
  mode?: string
  systemPromptOverride?: string
  toolToggles?: Record<string, boolean>
}

export type CliAgentBackendStateMap = Partial<Record<ExternalCliBackend, CliAgentBackendState>>

// ---------------------------------------------------------------------------
// Process lifecycle
// ---------------------------------------------------------------------------

export type CliAgentProcessStatus =
  | 'stopped' // not running
  | 'starting' // spawn called, waiting for init event
  | 'running' // active and responsive
  | 'rate_limited' // temporarily throttled
  | 'error' // crashed or errored
  | 'stopping' // SIGTERM sent, waiting for exit

// ---------------------------------------------------------------------------
// Token / cost telemetry
// ---------------------------------------------------------------------------

/** Per-message or per-session token usage breakdown (matches OpenCode SDK). */
export interface CliAgentTokenUsage {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}

// ---------------------------------------------------------------------------
// Normalized messages
// ---------------------------------------------------------------------------

/**
 * Discriminant for the rich part types exposed by OpenCode and other backends.
 *
 * Existing values stay first for backwards-compatibility with persisted
 * conversations. New values are appended; the renderer falls back to plain text
 * rendering if it doesn't recognise a type.
 */
export type CliAgentMessageType =
  // Existing types
  | 'system'
  | 'assistant'
  | 'user'
  | 'tool_use'
  | 'tool_result'
  | 'status'
  | 'error'
  | 'result'
  // New rich part types (OpenCode SDK)
  | 'reasoning'
  | 'file_attachment'
  | 'patch'
  | 'step'
  | 'snapshot'
  | 'retry'
  | 'compaction'
  | 'agent_change'
  | 'subtask'

/** A normalized message from any CLI agent backend. */
export interface CliAgentMessage {
  id: string
  type: CliAgentMessageType
  content: string
  timestamp: number
  /** Which backend produced this message (set on external-agent messages). */
  backend?: ExternalCliBackend
  /** Original SDK event for debugging */
  raw?: unknown

  // Tool-specific (present when type is 'tool_use' or 'tool_result')
  toolName?: string
  toolUseId?: string
  /** Synthetic permission tool-call id used by ApprovalRouter for opencode permission events. */
  permissionId?: string

  // Cost / tokens (present on assistant + result + step messages)
  durationMs?: number
  totalCostUsd?: number
  costUsd?: number
  tokens?: CliAgentTokenUsage
  isSuccess?: boolean

  // Rich part type fields (all optional, present per type)
  /** Patch part: file edit hash + paths. */
  patchHash?: string
  patchFiles?: string[]
  /** Step part: 'start' or 'finish'. */
  stepPhase?: 'start' | 'finish'
  stepReason?: string
  stepSnapshot?: string
  /** Snapshot part: opaque snapshot identifier. */
  snapshotHash?: string
  /** Retry part: attempt number. */
  retryAttempt?: number
  /** Compaction part: was the compaction automatic? */
  compactionAuto?: boolean
  /** Agent-change part: agent name. */
  agentName?: string
  /** Subtask part: prompt/description/agent. */
  subtaskPrompt?: string
  subtaskDescription?: string
  subtaskAgent?: string
  /** File attachment part: mime + url + optional filename. */
  fileMime?: string
  fileUrl?: string
  fileName?: string
  /** Reasoning part: kept in `content`; this flag controls collapsed-by-default rendering. */
  reasoningCollapsed?: boolean
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

/** Partial text delta streamed from an assistant response. */
export interface CliAgentStreamDelta {
  workspaceId: string
  sessionId: string
  messageId: string
  delta: string
}

// ---------------------------------------------------------------------------
// Permission requests (OpenCode permission events bridged to CHAT_TOOL_CALL)
// ---------------------------------------------------------------------------

/**
 * Permission request raised by an external CLI backend when it needs user
 * consent for a tool call. Routed through the existing built-in agent
 * approval surface (CHAT_TOOL_CALL / CHAT_TOOL_APPROVE / CHAT_TOOL_REJECT)
 * via the ApprovalRouter so there is one approval UI for both built-in and
 * external agents.
 */
export interface CliAgentPermissionRequest {
  workspaceId: string
  sessionId: string
  /** Synthetic toolCall id, generated by the manager for routing. */
  toolCallId: string
  /** Backend that raised the request (currently always 'opencode'). */
  backend: ExternalCliBackend
  /** Human-readable title (from OpenCode's Permission.title). */
  title: string
  /** OpenCode permission category, e.g. 'edit' | 'bash' | 'webfetch' | … */
  category: string
  /** Optional pattern (e.g. shell command, file path) the request applies to. */
  pattern?: string | string[]
  /** Free-form metadata from the SDK. */
  metadata?: Record<string, unknown>
  /** When the permission was raised. */
  timestamp: number
}

// ---------------------------------------------------------------------------
// Session state (visible to renderer)
// ---------------------------------------------------------------------------

export interface CliAgentSession {
  id: string
  workspaceId: string
  backend: AgentBackend
  /** Currently active backend for this session. Source of truth for the pane header
   *  once hot-swap is wired up; falls back to `backend` for legacy sessions. */
  activeBackend?: AgentBackend
  processStatus: CliAgentProcessStatus
  messages: CliAgentMessage[]
  model?: string
  sessionToolNames?: string[]
  lastError?: string
  totalCostUsd?: number
  totalTokens?: CliAgentTokenUsage
  /** Worktree path this session operates in (if any). */
  worktreePath?: string
  /** Per-backend resumption + override state. */
  backendStates?: CliAgentBackendStateMap
}

// ---------------------------------------------------------------------------
// Workspace-level cost summary (sum of all session totals in a workspace)
// ---------------------------------------------------------------------------

export interface CliAgentWorkspaceCostSummary {
  workspaceId: string
  totalCostUsd: number
  totalTokens: CliAgentTokenUsage
  sessionCount: number
}

// ---------------------------------------------------------------------------
// IPC payloads
// ---------------------------------------------------------------------------

export interface CliAgentStatusPayload {
  workspaceId: string
  sessionId: string
  processStatus: CliAgentProcessStatus
  error?: string
}

export interface CliAgentResultPayload {
  workspaceId: string
  sessionId: string
  durationMs: number
  totalCostUsd: number
  totalTokens?: CliAgentTokenUsage
  isSuccess: boolean
}

/** IPC envelope for `CLI_AGENT_MESSAGE` (message body plus routing ids). */
export interface CliAgentMessagePayload extends CliAgentMessage {
  workspaceId: string
  sessionId: string
}

// ---------------------------------------------------------------------------
// OpenCode SDK surface (light DTOs returned by listProviders/Agents/Modes/Tools)
// ---------------------------------------------------------------------------

export interface OpenCodeProviderSummary {
  id: string
  name: string
  models: Array<{
    id: string
    name: string
    reasoning?: boolean
    attachment?: boolean
    toolCall?: boolean
    cost?: { input: number; output: number; cacheRead?: number; cacheWrite?: number }
  }>
}

export interface OpenCodeAgentSummary {
  name: string
  description?: string
  mode?: string
}

export interface OpenCodeToolSummary {
  id: string
  description?: string
  schema?: unknown
}

export interface OpenCodeFileEntry {
  path: string
  name: string
  isDirectory: boolean
  size?: number
  modified?: number
}

export interface OpenCodeFindResult {
  path: string
  line?: number
  column?: number
  preview?: string
  matchText?: string
}

export interface OpenCodeSymbolResult {
  name: string
  kind: string
  path: string
  line?: number
  column?: number
}

export interface OpenCodeShellResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface OpenCodeServerInfo {
  url: string
  mode: 'bundled' | 'external'
  pid?: number
  startedAt: number
}

export interface OpenCodePathInfo {
  config?: string
  data?: string
  cache?: string
  state?: string
  log?: string
  cwd?: string
  root?: string
}

export interface OpenCodeTodoItem {
  id: string
  text: string
  done?: boolean
}

export interface OpenCodeAuthMethod {
  id: string
  label?: string
  type: 'oauth' | 'apiKey' | 'env' | 'unknown'
}
