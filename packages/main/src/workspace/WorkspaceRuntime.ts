import type {
  WorkspaceEntry,
  WorkspaceRuntimeWorkloadFlags,
} from '@aide/shared'
import type {
  RuntimeLifecycle,
  RuntimeSnapshot,
  RuntimeState,
  RuntimeStatus,
  WorkspaceId,
  WorkspaceRuntimeServiceSlots,
} from './runtimeTypes'

interface WorkspaceRuntimeHooks {
  startServices: (runtime: WorkspaceRuntime) => Promise<void>
  stopServices: (runtime: WorkspaceRuntime) => Promise<void>
  onSnapshotChanged?: (runtime: WorkspaceRuntime) => void
}

export class WorkspaceRuntime {
  readonly workspaceId: WorkspaceId
  rootPath: string | null
  readonly services: WorkspaceRuntimeServiceSlots
  private readonly hooks: WorkspaceRuntimeHooks
  private lifecycle: RuntimeLifecycle
  private metadata: Pick<WorkspaceEntry, 'name' | 'icon' | 'color'>
  private initialized = false
  private workspaceOpenScheduled = false
  private workload: WorkspaceRuntimeWorkloadFlags = {
    agentsRunning: false,
    tasksRunning: false,
    pendingApproval: false,
    pendingUserInput: false,
  }

  constructor(entry: WorkspaceEntry, hooks: WorkspaceRuntimeHooks) {
    this.workspaceId = entry.id
    this.rootPath = entry.rootPath
    this.hooks = hooks
    this.metadata = {
      name: entry.name,
      icon: entry.icon,
      color: entry.color,
    }
    this.services = {
      taskRunner: null,
      agentManager: null,
      cliAgentManager: null,
      conversationStore: null,
      nativeSessionWatcher: null,
      nativeSessionCache: null,
      fileWatcher: null,
      gitStatus: null,
      worktreeManager: null,
    }
    this.lifecycle = {
      status: 'stopped',
      state: 'asleep',
      activationSeq: 0,
      lastForegroundedAt: null,
      lastBackgroundedAt: null,
      lastStoppedAt: null,
    }
  }

  syncEntry(entry: WorkspaceEntry): void {
    this.rootPath = entry.rootPath
    this.metadata = {
      name: entry.name,
      icon: entry.icon,
      color: entry.color,
    }
    this.emitSnapshotChanged()
  }

  async start(): Promise<void> {
    if (this.lifecycle.status === 'running' || this.lifecycle.status === 'starting') {
      return
    }

    this.initialized = true
    this.workspaceOpenScheduled = false
    this.lifecycle.status = 'starting'
    this.emitSnapshotChanged()

    if (!this.rootPath) {
      this.lifecycle.status = 'running'
      this.emitSnapshotChanged()
      return
    }

    try {
      await this.hooks.startServices(this)
      this.lifecycle.status = 'running'
    } catch (error) {
      this.lifecycle.status = 'error'
      throw error
    } finally {
      this.emitSnapshotChanged()
    }
  }

  acceptsActivation(seq: number): boolean {
    return this.lifecycle.status !== 'stopped' && this.lifecycle.activationSeq === seq
  }

  enterForeground(): void {
    this.lifecycle.activationSeq += 1
    if (this.lifecycle.status === 'stopped') {
      this.lifecycle.status = 'running'
    }
    this.lifecycle.state = 'foreground'
    this.lifecycle.lastForegroundedAt = Date.now()
    this.emitSnapshotChanged()
  }

  enterBackground(nextState: RuntimeState = 'backgrounded'): void {
    if (this.lifecycle.status === 'stopped') return
    this.lifecycle.status = 'running'
    this.lifecycle.state = nextState
    this.lifecycle.lastBackgroundedAt = Date.now()
    this.emitSnapshotChanged()
  }

  async dispose(): Promise<void> {
    this.workspaceOpenScheduled = false
    this.lifecycle.status = 'stopping'
    this.emitSnapshotChanged()

    try {
      await this.hooks.stopServices(this)
    } finally {
      this.clearServices()
      this.workload = {
        agentsRunning: false,
        tasksRunning: false,
        pendingApproval: false,
        pendingUserInput: false,
      }
      this.lifecycle.status = 'stopped'
      this.lifecycle.state = 'asleep'
      this.lifecycle.lastStoppedAt = Date.now()
      this.emitSnapshotChanged()
    }
  }

  isWorkspaceOpenScheduled(): boolean {
    return this.workspaceOpenScheduled
  }

  markWorkspaceOpenScheduled(): void {
    this.workspaceOpenScheduled = true
  }

  resetWorkspaceOpenScheduled(): void {
    this.workspaceOpenScheduled = false
  }

  getState(): RuntimeState {
    return this.lifecycle.state
  }

  getStatus(): RuntimeStatus {
    return this.lifecycle.status
  }

  getLifecycle(): RuntimeLifecycle {
    return { ...this.lifecycle }
  }

  getSnapshot(): RuntimeSnapshot {
    return {
      workspaceId: this.workspaceId,
      rootPath: this.rootPath,
      name: this.metadata.name,
      icon: this.metadata.icon,
      color: this.metadata.color,
      status: this.lifecycle.status,
      state: this.lifecycle.state,
      initialized: this.initialized,
      servicesAttached: this.hasAttachedServices(),
      workload: { ...this.workload },
      activationSeq: this.lifecycle.activationSeq,
      lastForegroundedAt: this.lifecycle.lastForegroundedAt,
      lastBackgroundedAt: this.lifecycle.lastBackgroundedAt,
      lastStoppedAt: this.lifecycle.lastStoppedAt,
    }
  }

  setServices(services: Partial<WorkspaceRuntimeServiceSlots>): void {
    Object.assign(this.services, services)
    this.emitSnapshotChanged()
  }

  clearServices(): void {
    for (const key of Object.keys(this.services) as Array<keyof WorkspaceRuntimeServiceSlots>) {
      this.services[key] = null
    }
    this.emitSnapshotChanged()
  }

  updateWorkload(workload: Partial<WorkspaceRuntimeWorkloadFlags>): void {
    this.workload = { ...this.workload, ...workload }
    this.emitSnapshotChanged()
  }

  refreshWorkload(): void {
    const taskRunner = this.services.taskRunner as { getRunning?: () => unknown[]; getPendingInputCount?: () => number } | null
    const agentManager = this.services.agentManager as {
      getActiveSessionCount?: () => number
      getPendingApprovalCount?: () => number
    } | null
    const cliAgentManager = this.services.cliAgentManager as {
      getRunningSessionCount?: () => number
    } | null

    this.workload = {
      tasksRunning: Boolean(taskRunner?.getRunning?.().length),
      pendingUserInput: Boolean(taskRunner?.getPendingInputCount?.()),
      agentsRunning: Boolean(agentManager?.getActiveSessionCount?.() || cliAgentManager?.getRunningSessionCount?.()),
      pendingApproval: Boolean(agentManager?.getPendingApprovalCount?.()),
    }
    this.emitSnapshotChanged()
  }

  private hasAttachedServices(): boolean {
    return Object.values(this.services).some((service) => service !== null)
  }

  private emitSnapshotChanged(): void {
    this.hooks.onSnapshotChanged?.(this)
  }
}
