import { useState, useEffect, useCallback } from 'react'
import type { WorkspaceEntry, WorkspaceRuntimeSnapshot } from '@aide/shared'

export interface WorkspacesState {
  workspaces: WorkspaceEntry[]
  runtimeSnapshots: Record<string, WorkspaceRuntimeSnapshot>
  activeWorkspaceId: string | null
  activeWorkspace: WorkspaceEntry | null
  switchWorkspace: (id: string) => Promise<void>
  createWorkspace: (rootPath?: string) => Promise<void>
  closeWorkspace: (id: string) => Promise<void>
  removeWorkspace: (id: string) => Promise<void>
  updateWorkspace: (id: string, patch: Partial<Pick<WorkspaceEntry, 'name' | 'icon' | 'color'>>) => Promise<void>
  reorderWorkspaces: (ids: string[]) => Promise<void>
}

/**
 * Manages the list of workspaces and the active workspace, and provides actions to create, switch, close, remove, update, and reorder workspaces.
 *
 * @returns The current workspaces state and action callbacks:
 * - `workspaces`: the array of workspace entries
 * - `activeWorkspaceId`: the id of the active workspace or `null`
 * - `activeWorkspace`: the active workspace entry or `null`
 * - `switchWorkspace(id)`, `createWorkspace(rootPath?)`, `closeWorkspace(id)`, `removeWorkspace(id)`, `updateWorkspace(id, patch)`, `reorderWorkspaces(ids)`: functions that perform the named workspace operations
 */
export function useWorkspaces(): WorkspacesState {
  const [workspaces, setWorkspaces] = useState<WorkspaceEntry[]>([])
  const [runtimeSnapshots, setRuntimeSnapshots] = useState<Record<string, WorkspaceRuntimeSnapshot>>({})
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)

  // Load on mount
  useEffect(() => {
    Promise.all([
      window.api.listWorkspaces(),
      window.api.getActiveWorkspaceId(),
      window.api.getWorkspaceRuntimeSnapshots(),
    ]).then(([ws, activeId, snapshots]) => {
      setWorkspaces(ws)
      setActiveWorkspaceId(activeId)
      setRuntimeSnapshots(Object.fromEntries(snapshots.map((snapshot) => [snapshot.workspaceId, snapshot])))
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

  useEffect(() => {
    return window.api.onWorkspaceRuntimeSnapshotsChanged((snapshots) => {
      setRuntimeSnapshots(Object.fromEntries(snapshots.map((snapshot) => [snapshot.workspaceId, snapshot])))
    })
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
    runtimeSnapshots,
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
