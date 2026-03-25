import { useState, useEffect, useCallback } from 'react'
import type { WorktreeInfo } from '@aide/shared'

export function useWorktrees(workspaceRoot: string | null) {
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([])
  const [activeWorktree, setActiveWorktreeState] = useState<string | null>(null)

  // The effective root: active worktree path or workspace root
  const activeRoot = activeWorktree ?? workspaceRoot

  // Load initial state
  useEffect(() => {
    if (!workspaceRoot) {
      setWorktrees([])
      setActiveWorktreeState(null)
      return
    }

    window.api.listWorktrees().then(setWorktrees)
    window.api.getActiveWorktree().then(setActiveWorktreeState)
  }, [workspaceRoot])

  // Subscribe to worktree list changes
  useEffect(() => {
    const cleanup = window.api.onWorktreeListChanged((list) => {
      setWorktrees(list)
      // Update active state from the list's isCurrent flags
      const current = list.find((w) => w.isCurrent)
      setActiveWorktreeState(current?.path ?? null)
    })
    return cleanup
  }, [])

  const switchWorktree = useCallback(async (worktreePath: string | null) => {
    await window.api.setActiveWorktree(worktreePath)
    setActiveWorktreeState(worktreePath)
  }, [])

  return { worktrees, activeWorktree, activeRoot, switchWorktree }
}
