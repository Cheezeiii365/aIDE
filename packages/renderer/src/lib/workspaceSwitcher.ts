/**
 * Workspace switcher (renderer side).
 *
 * Orchestrates the full save → clear → load → restore → focus cycle
 * when switching between workspaces. Includes debouncing for rapid switching.
 */

import type { DockviewApi } from 'dockview-react'
import type { AideLocalState, AideLocalTerminals } from '@aide/shared'
import { clearCache } from './editorStateCache'
import { clearAllDirty } from './editorDirtyState'
import { createRestoredTerminalPanelParams, createTerminalPanelParams } from './terminalState'
import {
  captureWorkspaceRuntimeSnapshot,
  getWorkspaceRuntimeSnapshot,
  saveWorkspaceRuntimeSnapshot,
} from './workspaceRuntimeSnapshots'

let switchGeneration = 0

interface SwitchContext {
  dockviewApi: DockviewApi
  currentWorkspaceId: string | null
  currentRootPath: string | null
  targetWorkspaceId: string
  targetRootPath: string | null
  sidebarWidth: number
  sidebarCollapsed: boolean
  onSidebarRestore: (width: number, collapsed: boolean) => void
  onBeforeClearPanels?: () => void
  onAfterRestorePanels?: () => void
  skipCurrentSave?: boolean
}

/**
 * Perform a full workspace switch.
 *
 * Returns false if the switch was superseded by a newer switch request
 * (rapid switching debounce).
 */
export async function switchWorkspace(ctx: SwitchContext): Promise<boolean> {
  const gen = ++switchGeneration

  // 1. SAVE current workspace state
  if (ctx.currentWorkspaceId && !ctx.skipCurrentSave) {
    const snapshot = saveWorkspaceRuntimeSnapshot(captureWorkspaceRuntimeSnapshot(
      ctx.dockviewApi,
      ctx.currentWorkspaceId,
      ctx.currentRootPath,
      ctx.sidebarWidth,
      ctx.sidebarCollapsed,
    ))
    if (snapshot.rootPath) {
      window.api.saveWorkspaceState(snapshot.rootPath, snapshot.state).catch(() => {})
      window.api.saveTerminalState(snapshot.rootPath, snapshot.terminals).catch(() => {})
    }
  }

  // Check if superseded
  if (gen !== switchGeneration) return false

  // 2. CLEAR current UI
  clearCache()
  clearAllDirty()
  ctx.onBeforeClearPanels?.()

  // Remove all panels from Dockview
  const panels = [...ctx.dockviewApi.panels]
  for (const panel of panels) {
    try {
      panel.api.close()
    } catch {
      // Panel may already be disposed
    }
  }

  if (gen !== switchGeneration) return false

  // 3. LOAD target workspace state
  let savedState: AideLocalState | null = null
  let savedTerminals: AideLocalTerminals | null = null
  let activePanelId: string | null = null

  const runtimeSnapshot = getWorkspaceRuntimeSnapshot(ctx.targetWorkspaceId)
  if (runtimeSnapshot) {
    savedState = runtimeSnapshot.state
    savedTerminals = runtimeSnapshot.terminals
    activePanelId = runtimeSnapshot.activePanelId
  } else if (ctx.targetRootPath) {
    [savedState, savedTerminals] = await Promise.all([
      window.api.loadWorkspaceState(ctx.targetRootPath),
      window.api.loadTerminalState(ctx.targetRootPath),
    ])
  }

  if (gen !== switchGeneration) return false

  // 4. RESTORE layout
  if (savedState?.layout) {
    try {
      ctx.dockviewApi.fromJSON(savedState.layout as Parameters<DockviewApi['fromJSON']>[0])
    } catch {
      // Layout restore failed — use default
      createDefaultLayout(ctx.dockviewApi, ctx.targetWorkspaceId, ctx.targetRootPath, savedTerminals)
    }
  } else {
    createDefaultLayout(ctx.dockviewApi, ctx.targetWorkspaceId, ctx.targetRootPath, savedTerminals)
  }
  ctx.onAfterRestorePanels?.()

  // 5. RESTORE sidebar
  const restoredSidebarWidth = savedState?.sidebarWidth ?? ctx.sidebarWidth
  const restoredSidebarCollapsed = savedState?.sidebarCollapsed ?? ctx.sidebarCollapsed
  if (savedState) {
    ctx.onSidebarRestore(restoredSidebarWidth, restoredSidebarCollapsed)
  }

  // 6. FOCUS last active tab
  if (savedState?.activeTabPath) {
    const panel = ctx.dockviewApi.panels.find(
      (p) => (p.params as Record<string, unknown>)?.filePath === savedState.activeTabPath,
    )
    if (panel) {
      panel.api.setActive()
    }
  } else if (activePanelId) {
    ctx.dockviewApi.panels.find((panel) => panel.id === activePanelId)?.api.setActive()
  } else if (savedTerminals?.activeTerminalId) {
    ctx.dockviewApi.panels.find((panel) => {
      const params = (panel.params as Record<string, unknown> | undefined) ?? {}
      return params.terminalId === savedTerminals?.activeTerminalId
    })?.api.setActive()
  }

  saveWorkspaceRuntimeSnapshot(captureWorkspaceRuntimeSnapshot(
    ctx.dockviewApi,
    ctx.targetWorkspaceId,
    ctx.targetRootPath,
    restoredSidebarWidth,
    restoredSidebarCollapsed,
  ))

  return true
}

/**
 * Create the default 3-pane layout when no saved state exists.
 */
function createDefaultLayout(
  api: DockviewApi,
  workspaceId: string,
  workspaceRoot: string | null,
  savedTerminals: AideLocalTerminals | null,
): void {
  const editorPanel = api.addPanel({
    id: 'editor',
    component: 'placeholder',
    title: 'Workspace',
  })

  const terminals = savedTerminals?.terminals.filter((terminal) => terminal.workspaceId === workspaceId) ?? []

  if (terminals.length > 0) {
    terminals.forEach((terminal, index) => {
      api.addPanel({
        id: index === 0 ? 'terminal' : `terminal-${terminal.id}`,
        component: 'terminalPane',
        title: terminal.title || 'Terminal',
        params: createRestoredTerminalPanelParams(
          terminal.id,
          workspaceId,
          terminal.cwd || workspaceRoot || undefined,
          terminal.title || 'Terminal',
          terminal.shell,
        ),
        position: { referencePanel: editorPanel, direction: 'below' },
        initialHeight: 200,
      })
    })
  } else {
    api.addPanel({
      id: 'terminal',
      component: 'terminalPane',
      title: 'Terminal',
      params: createTerminalPanelParams(workspaceId, workspaceRoot || undefined, 'Terminal'),
      position: { referencePanel: editorPanel, direction: 'below' },
      initialHeight: 200,
    })
  }

  api.addPanel({
    id: 'agent',
    component: 'placeholder',
    params: { title: 'Agent' },
    position: { referencePanel: editorPanel, direction: 'right' },
    initialWidth: 350,
  })
}

/**
 * Save the current workspace state (for auto-save interval).
 */
export function autoSave(
  dockviewApi: DockviewApi | null,
  workspaceId: string | null,
  rootPath: string | null,
  sidebarWidth: number,
  sidebarCollapsed: boolean,
): void {
  if (!dockviewApi || !workspaceId) return

  const snapshot = saveWorkspaceRuntimeSnapshot(captureWorkspaceRuntimeSnapshot(
    dockviewApi,
    workspaceId,
    rootPath,
    sidebarWidth,
    sidebarCollapsed,
  ))

  if (snapshot.rootPath) {
    window.api.saveWorkspaceState(snapshot.rootPath, snapshot.state).catch(() => {})
    window.api.saveTerminalState(snapshot.rootPath, snapshot.terminals).catch(() => {})
  }
}
