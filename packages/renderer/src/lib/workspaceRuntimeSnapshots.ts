import type { DockviewApi } from 'dockview-react'
import type { AideLocalState, AideLocalTerminals } from '@aide/shared'
import { serializeTerminalState } from './terminalState'
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
    state: serializeWorkspaceState(dockviewApi, sidebarWidth, sidebarCollapsed),
    terminals: serializeTerminalState(dockviewApi),
    activePanelId: dockviewApi.activePanel?.id ?? null,
    panelParams,
  }
}

export function saveWorkspaceRuntimeSnapshot(snapshot: WorkspaceRuntimeSnapshot): WorkspaceRuntimeSnapshot {
  snapshots.set(snapshot.workspaceId, snapshot)
  return snapshot
}

export function getWorkspaceRuntimeSnapshot(workspaceId: string): WorkspaceRuntimeSnapshot | null {
  return snapshots.get(workspaceId) ?? null
}

export function clearWorkspaceRuntimeSnapshot(workspaceId: string): void {
  snapshots.delete(workspaceId)
}
