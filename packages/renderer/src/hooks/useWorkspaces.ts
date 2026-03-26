import { useState, useEffect, useCallback } from 'react'
import type { WorkspaceEntry } from '@aide/shared'

export interface WorkspacesState {
  workspaces: WorkspaceEntry[]
  activeWorkspaceId: string | null
  activeWorkspace: WorkspaceEntry | null
  switchWorkspace: (id: string) => Promise<void>
  createWorkspace: (rootPath?: string) => Promise<void>
  closeWorkspace: (id: string) => Promise<void>
  removeWorkspace: (id: string) => Promise<void>
  updateWorkspace: (id: string, patch: Partial<Pick<WorkspaceEntry, 'name' | 'icon' | 'color'>>) => Promise<void>
  reorderWorkspaces: (ids: string[]) => Promise<void>
}

export function useWorkspaces(): WorkspacesState {
  const [workspaces, setWorkspaces] = useState<WorkspaceEntry[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)

  // Load on mount
  useEffect(() => {
    Promise.all([
      window.api.listWorkspaces(),
      window.api.getActiveWorkspaceId(),
    ]).then(([ws, activeId]) => {
      setWorkspaces(ws)
      setActiveWorkspaceId(activeId)
    })
  }, [])

  // Subscribe to registry changes
  useEffect(() => {
    const unsub = window.api.onWorkspaceRegistryChanged((ws) => {
      setWorkspaces(ws)
      // Refresh active ID since it may have changed
      window.api.getActiveWorkspaceId().then(setActiveWorkspaceId)
    })
    return unsub
  }, [])

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? null

  const switchWorkspace = useCallback(async (id: string) => {
    setActiveWorkspaceId(id)
    await window.api.switchWorkspace(id)
  }, [])

  const createWorkspace = useCallback(async (rootPath?: string) => {
    if (rootPath) {
      const entry = await window.api.createWorkspace(rootPath)
      setActiveWorkspaceId(entry.id)
    } else {
      // Use the existing open-folder dialog flow
      const selected = await window.api.openWorkspaceDialog()
      if (selected) {
        const entry = await window.api.createWorkspace(selected)
        setActiveWorkspaceId(entry.id)
      }
    }
  }, [])

  const closeWorkspace = useCallback(async (id: string) => {
    await window.api.closeWorkspace(id)
  }, [])

  const removeWorkspace = useCallback(async (id: string) => {
    await window.api.removeWorkspace(id)
  }, [])

  const updateWorkspace = useCallback(async (
    id: string,
    patch: Partial<Pick<WorkspaceEntry, 'name' | 'icon' | 'color'>>,
  ) => {
    await window.api.updateWorkspace(id, patch)
  }, [])

  const reorderWorkspaces = useCallback(async (ids: string[]) => {
    await window.api.reorderWorkspaces(ids)
  }, [])

  return {
    workspaces,
    activeWorkspaceId,
    activeWorkspace,
    switchWorkspace,
    createWorkspace,
    closeWorkspace,
    removeWorkspace,
    updateWorkspace,
    reorderWorkspaces,
  }
}
