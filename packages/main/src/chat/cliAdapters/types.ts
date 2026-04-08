import type { CliAgentBackendState, CliAgentMessage, ExternalCliBackend } from '@aide/shared'

export interface CliBackendTurnContext {
  conversationId: string
  cwd: string
  prompt: string
  backendState: CliAgentBackendState
}

export type CliBackendEvent =
  | { type: 'stream-delta'; messageId: string; delta: string }
  | { type: 'message'; message: Omit<CliAgentMessage, 'backend'> }
  | { type: 'backend-state'; patch: Partial<CliAgentBackendState> }
  | { type: 'session-meta'; model?: string; tools?: string[] }
  | { type: 'result'; durationMs: number; totalCostUsd: number; isSuccess: boolean }

export interface CliBackendRun {
  close(): void
  completed: Promise<void>
}

export interface CliBackendAdapter {
  backend: ExternalCliBackend
  startTurn(context: CliBackendTurnContext, emit: (event: CliBackendEvent) => void): CliBackendRun
}
