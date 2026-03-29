import type { DockviewApi } from 'dockview-react'
import type { AideLocalState, AideLocalTerminals } from '@aide/shared'
import { serializeTerminalState } from '../terminal/terminalState'
import { serializeWorkspaceState } from './workspaceStateSerializer'

export interface WorkspaceRuntimeSnapshot {
  workspaceId: string
  rootPath: string | null
  state: AideLocalState
  terminals: AideLocalTerminals
  activePanelId: string | null
  panelParams: Record<string, Record<string, unknown>>
}

const snapshots = new Map<string, WorkspaceRuntimeSnapshot>()

/**
 * Creates a runtime snapshot of the current workspace state.
 *
 * @param dockviewApi - Dockview API providing panels, active panel, and other UI state
 * @param workspaceId - Identifier used as the snapshot key
 * @param rootPath - Root filesystem path for the workspace, or `null` if none
 * @param sidebarWidth - Current sidebar width in pixels
 * @param sidebarCollapsed - Whether the sidebar is collapsed
 * @returns A `WorkspaceRuntimeSnapshot` containing the workspace ID and root path, serialized workspace `state` and `terminals`, the `activePanelId` (or `null`), and `panelParams` mapping panel IDs to shallow-copied parameter objects
 */
export function captureWorkspaceRuntimeSnapshot(
  dockviewApi: DockviewApi,
  workspaceId: string,
  rootPath: string | null,
  sidebarWidth: number,
  sidebarCollapsed: boolean,
): WorkspaceRuntimeSnapshot {
  const panelParams: Record<string, Record<string, unknown>> = {}

  for (const panel of dockviewApi.panels) {
    panelParams[panel.id] = { ...((panel.params as Record<string, unknown> | undefined) ?? {}) }
  }

  return {
    workspaceId,
    rootPath,
    state: serializeWorkspaceState(dockviewApi, workspaceId, sidebarWidth, sidebarCollapsed),
    terminals: serializeTerminalState(dockviewApi),
    activePanelId: dockviewApi.activePanel?.id ?? null,
    panelParams,
  }
}

/**
 * Stores a workspace runtime snapshot in the in-memory snapshot store.
 *
 * @param snapshot - The runtime snapshot to save; its `workspaceId` is used as the key.
 * @returns The same `snapshot` that was saved.
 */
export function saveWorkspaceRuntimeSnapshot(snapshot: WorkspaceRuntimeSnapshot): WorkspaceRuntimeSnapshot {
  snapshots.set(snapshot.workspaceId, snapshot)
  return snapshot
}

/**
 * Retrieve the stored runtime snapshot for a workspace.
 *
 * @param workspaceId - The workspace identifier whose snapshot to retrieve
 * @returns The `WorkspaceRuntimeSnapshot` for `workspaceId`, or `null` if none is stored
 */
export function getWorkspaceRuntimeSnapshot(workspaceId: string): WorkspaceRuntimeSnapshot | null {
  return snapshots.get(workspaceId) ?? null
}

/**
 * Remove the in-memory runtime snapshot for a workspace.
 *
 * @param workspaceId - The workspace identifier whose stored snapshot will be removed
 */
export function clearWorkspaceRuntimeSnapshot(workspaceId: string): void {
  snapshots.delete(workspaceId)
}
