import type {
  CliAgentBackendState,
  CliAgentMessage,
  CliAgentTokenUsage,
  ExternalCliBackend,
} from '@aide/shared'

export interface CliBackendTurnContext {
  conversationId: string
  cwd: string
  prompt: string
  backendState: CliAgentBackendState
}

/**
 * Permission request raised by an adapter (currently OpenCode) when the
 * backend needs user approval for a tool/operation. The manager bridges these
 * to the existing CHAT_TOOL_CALL surface via ApprovalRouter.
 */
export interface CliBackendPermissionRequest {
  /** Stable id from the backend (e.g. OpenCode permission.id). */
  permissionId: string
  /** Backend session id. */
  sessionId: string
  /** Permission category (e.g. 'edit' | 'bash' | 'webfetch'). */
  category: string
  /** Human-readable title. */
  title: string
  /** Optional pattern (file path / shell command / URL). */
  pattern?: string | string[]
  metadata?: Record<string, unknown>
}

export type CliBackendEvent =
  | { type: 'stream-delta'; messageId: string; delta: string }
  | { type: 'message'; message: Omit<CliAgentMessage, 'backend'> }
  | { type: 'backend-state'; patch: Partial<CliAgentBackendState> }
  | { type: 'session-meta'; model?: string; tools?: string[] }
  | {
      type: 'result'
      durationMs: number
      totalCostUsd: number
      tokens?: CliAgentTokenUsage
      isSuccess: boolean
    }
  | {
      type: 'permission-request'
      request: CliBackendPermissionRequest
      /** Resolved by the manager once the user (or auto-approval) decides. */
      resolve: (response: 'once' | 'always' | 'reject') => void
    }

export interface CliBackendRun {
  close(): void
  completed: Promise<void>
}

export interface CliBackendAdapter {
  backend: ExternalCliBackend
  startTurn(context: CliBackendTurnContext, emit: (event: CliBackendEvent) => void): CliBackendRun
}
