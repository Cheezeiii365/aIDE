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
  /** Populated in Phase 3 — currently a global singleton in fileWatcher.ts */
  fileWatcher: unknown | null
  /** Populated in Phase 3 — currently a global singleton in gitStatus.ts */
  gitStatus: unknown | null
  /** Populated in Phase 3 — currently a global singleton in worktreeManager.ts */
  worktreeManager: unknown | null
}

export interface RuntimeSnapshotParts extends RuntimeServicePresence {
  workload: WorkspaceRuntimeWorkloadFlags
}
