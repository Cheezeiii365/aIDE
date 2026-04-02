import type { WorkspaceRegistry } from './workspaceRegistry'
import { getEffectiveWorkspaceRoot } from './effectiveWorkspaceRoot'

/**
 * Workspace id resolution for IPC handlers whose optional `workspaceId` means
 * “the UI-active workspace.” See `docs/multiwork.md` → Phase 8 policy (implicit active workspace).
 *
 * Do not use this for routing when the event or session already identifies a workspace
 * (e.g. task execution id, agent session id); use that id directly.
 */
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
