import type { WorkspaceRegistry } from './workspaceRegistry'
import { getEffectiveWorkspaceRoot } from './effectiveWorkspaceRoot'

/** Resolve target workspace id: explicit argument, else UI-active workspace. */
export function resolveWorkspaceIdForIpc(
  registry: WorkspaceRegistry,
  workspaceId: string | null | undefined,
): string | null {
  if (workspaceId) return workspaceId
  return registry.getActiveId()
}

/** Repo root path for the workspace, or `null`. */
export function resolveRepoRootForWorkspace(
  registry: WorkspaceRegistry,
  workspaceId: string | null | undefined,
): string | null {
  const wid = resolveWorkspaceIdForIpc(registry, workspaceId)
  if (!wid) return null
  const entry = registry.get(wid)
  const root = entry?.rootPath ?? null
  return root || null
}

/** Effective root (active worktree if set, else repo root), or `null`. */
export function resolveEffectiveRootForWorkspace(
  registry: WorkspaceRegistry,
  workspaceId: string | null | undefined,
): string | null {
  const wid = resolveWorkspaceIdForIpc(registry, workspaceId)
  if (!wid) return null
  const root = registry.get(wid)?.rootPath ?? null
  if (!root) return null
  return getEffectiveWorkspaceRoot(wid, root) ?? root
}
