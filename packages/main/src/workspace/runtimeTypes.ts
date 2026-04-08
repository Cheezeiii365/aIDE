import type { WorkspaceEntry } from '@aide/shared'
import type {
  WorkspaceRuntimeSnapshot,
  WorkspaceRuntimeState,
  WorkspaceRuntimeStatus,
  WorkspaceRuntimeWorkloadFlags,
} from '@aide/shared'

export type WorkspaceId = WorkspaceEntry['id']

export type RuntimeState = WorkspaceRuntimeState

export type RuntimeStatus = WorkspaceRuntimeStatus

export interface RuntimeLifecycle {
  status: RuntimeStatus
  state: RuntimeState
  activationSeq: number
  lastForegroundedAt: number | null
  lastBackgroundedAt: number | null
  lastStoppedAt: number | null
}

export type RuntimeSnapshot = WorkspaceRuntimeSnapshot

export interface RuntimeServicePresence {
  initialized: boolean
  servicesAttached: boolean
}

export interface WorkspaceRuntimeServiceSlots {
  taskRunner: unknown | null
  agentManager: unknown | null
  cliAgentManager: unknown | null
  conversationStore: unknown | null
  nativeSessionWatcher: unknown | null
  nativeSessionCache: unknown | null
  /** Single approval surface across built-in + CLI agent managers (CHAT_TOOL_APPROVE/REJECT). */
  approvalRouter: unknown | null
  /** Reserved — FS watchers use `fileWatcher.startWatchers(workspaceId)` keyed by runtime id */
  fileWatcher: unknown | null
  /** Reserved — git polling uses `gitStatus` module map keyed by workspaceId */
  gitStatus: unknown | null
  /** Reserved — worktree polling uses `worktreeManager` map keyed by workspaceId */
  worktreeManager: unknown | null
}

export interface RuntimeSnapshotParts extends RuntimeServicePresence {
  workload: WorkspaceRuntimeWorkloadFlags
}
