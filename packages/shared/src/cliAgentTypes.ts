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
export type ExternalCliBackend = Exclude<AgentBackend, 'built-in'>

export interface CliAgentBackendState {
  sessionId?: string
  model?: string
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
// Normalized messages
// ---------------------------------------------------------------------------

/** A normalized message from any CLI agent backend. */
export interface CliAgentMessage {
  id: string
  type: 'system' | 'assistant' | 'user' | 'tool_use' | 'tool_result' | 'status' | 'error' | 'result'
  content: string
  timestamp: number
  backend?: ExternalCliBackend
  /** Original SDK event for debugging */
  raw?: unknown

  // Tool-specific (present when type is 'tool_use' or 'tool_result')
  toolName?: string
  toolUseId?: string

  // Result-specific (present when type is 'result' or 'error')
  durationMs?: number
  totalCostUsd?: number
  isSuccess?: boolean
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
// Session state (visible to renderer)
// ---------------------------------------------------------------------------

export interface CliAgentSession {
  id: string
  workspaceId: string
  backend: AgentBackend
  processStatus: CliAgentProcessStatus
  messages: CliAgentMessage[]
  model?: string
  sessionToolNames?: string[]
  lastError?: string
  totalCostUsd?: number
  /** Worktree path this session operates in (if any). */
  worktreePath?: string
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
  isSuccess: boolean
}

/** IPC envelope for `CLI_AGENT_MESSAGE` (message body plus routing ids). */
export interface CliAgentMessagePayload extends CliAgentMessage {
  workspaceId: string
  sessionId: string
}
