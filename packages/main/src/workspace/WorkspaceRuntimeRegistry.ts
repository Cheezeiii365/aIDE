import type { WorkspaceEntry } from '@aide/shared'
import { WorkspaceRuntime } from './WorkspaceRuntime'
import type { RuntimeSnapshot, RuntimeState, WorkspaceId } from './runtimeTypes'

function backgroundStateFor(runtime: WorkspaceRuntime): RuntimeState {
  const w = runtime.getSnapshot().workload
  return w.pendingApproval || w.pendingUserInput ? 'blocked' : 'backgrounded'
}

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
      const prev = this.runtimes.get(this.focusedWorkspaceId)
      if (prev) prev.enterBackground(backgroundStateFor(prev))
    }

    this.focusedWorkspaceId = id
    runtime.enterForeground()
    return runtime
  }

  background(id: WorkspaceId): WorkspaceRuntime | null {
    const runtime = this.runtimes.get(id) ?? null
    if (runtime) runtime.enterBackground(backgroundStateFor(runtime))
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
    const prev = this.runtimes.get(this.focusedWorkspaceId)
    if (prev) prev.enterBackground(backgroundStateFor(prev))
    this.focusedWorkspaceId = null
  }

  list(): WorkspaceRuntime[] {
    return Array.from(this.runtimes.values())
  }

  snapshotAll(): RuntimeSnapshot[] {
    return this.list().map((runtime) => runtime.getSnapshot())
  }

  findByFilePath(filePath: string): WorkspaceRuntime | null {
    const normalizedFile = filePath.replace(/\\/g, '/')
    let bestMatch: WorkspaceRuntime | null = null
    let bestLength = -1
    for (const runtime of this.runtimes.values()) {
      if (!runtime.rootPath) continue
      const bases = new Set<string>([runtime.rootPath])
      const eff = runtime.getEffectiveRoot()
      if (eff && eff !== runtime.rootPath) bases.add(eff)
      for (const base of bases) {
        const r = base.replace(/\\/g, '/').replace(/\/+$/, '')
        const under =
          normalizedFile === r || normalizedFile.startsWith(`${r}/`)
        if (under && r.length > bestLength) {
          bestMatch = runtime
          bestLength = r.length
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
