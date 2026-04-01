import type { WorkspaceEntry } from '@aide/shared'
import { WorkspaceRuntime } from './WorkspaceRuntime'
import type { RuntimeSnapshot, WorkspaceId } from './runtimeTypes'

interface WorkspaceRuntimeRegistryOpts {
  createRuntime: (entry: WorkspaceEntry) => WorkspaceRuntime
}

export class WorkspaceRuntimeRegistry {
  private readonly createRuntime: WorkspaceRuntimeRegistryOpts['createRuntime']
  private runtimes = new Map<WorkspaceId, WorkspaceRuntime>()
  private focusedWorkspaceId: WorkspaceId | null = null

  constructor(opts: WorkspaceRuntimeRegistryOpts) {
    this.createRuntime = opts.createRuntime
  }

  get(id: WorkspaceId): WorkspaceRuntime | null {
    return this.runtimes.get(id) ?? null
  }

  getOrCreate(entry: WorkspaceEntry): WorkspaceRuntime {
    const existing = this.runtimes.get(entry.id)
    if (existing) {
      existing.syncEntry(entry)
      return existing
    }

    const runtime = this.createRuntime(entry)
    this.runtimes.set(entry.id, runtime)
    return runtime
  }

  focus(id: WorkspaceId): WorkspaceRuntime | null {
    const runtime = this.runtimes.get(id) ?? null
    if (!runtime) return null

    if (this.focusedWorkspaceId && this.focusedWorkspaceId !== id) {
      this.runtimes.get(this.focusedWorkspaceId)?.enterBackground()
    }

    this.focusedWorkspaceId = id
    runtime.enterForeground()
    return runtime
  }

  background(id: WorkspaceId): WorkspaceRuntime | null {
    const runtime = this.runtimes.get(id) ?? null
    runtime?.enterBackground()
    if (this.focusedWorkspaceId === id) {
      this.focusedWorkspaceId = null
    }
    return runtime
  }

  getFocused(): WorkspaceRuntime | null {
    if (!this.focusedWorkspaceId) return null
    return this.runtimes.get(this.focusedWorkspaceId) ?? null
  }

  getFocusedId(): WorkspaceId | null {
    return this.focusedWorkspaceId
  }

  clearFocus(): void {
    if (!this.focusedWorkspaceId) return
    this.runtimes.get(this.focusedWorkspaceId)?.enterBackground()
    this.focusedWorkspaceId = null
  }

  list(): WorkspaceRuntime[] {
    return Array.from(this.runtimes.values())
  }

  snapshotAll(): RuntimeSnapshot[] {
    return this.list().map((runtime) => runtime.getSnapshot())
  }

  findByFilePath(filePath: string): WorkspaceRuntime | null {
    let bestMatch: WorkspaceRuntime | null = null
    let bestLength = -1
    for (const runtime of this.runtimes.values()) {
      if (!runtime.rootPath) continue
      if (filePath === runtime.rootPath || filePath.startsWith(runtime.rootPath + '/')) {
        if (runtime.rootPath.length > bestLength) {
          bestMatch = runtime
          bestLength = runtime.rootPath.length
        }
      }
    }
    return bestMatch
  }

  async delete(id: WorkspaceId): Promise<void> {
    const runtime = this.runtimes.get(id)
    await runtime?.dispose()
    this.runtimes.delete(id)
    if (this.focusedWorkspaceId === id) {
      this.focusedWorkspaceId = null
    }
  }

  async disposeAll(): Promise<void> {
    for (const runtime of this.runtimes.values()) {
      await runtime.dispose()
    }
    this.runtimes.clear()
    this.focusedWorkspaceId = null
  }
}
