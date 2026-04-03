import { getActiveWorktreeForWorkspace } from './worktreeManager'

/**
 * Repo checkout root for the workspace entry (`.aide` lives here) vs optional
 * linked worktree the user selected as the working tree.
 */
export function getEffectiveWorkspaceRoot(workspaceId: string, repoRoot: string | null): string | null {
  if (!repoRoot) return null
  const wt = getActiveWorktreeForWorkspace(workspaceId)
  return wt ?? repoRoot
}
