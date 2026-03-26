/**
 * Workspace switcher (renderer side).
 *
 * Orchestrates the full save → clear → load → restore → focus cycle
 * when switching between workspaces. Includes debouncing for rapid switching.
 */

import type { DockviewApi } from 'dockview-react'
import type { AideLocalState } from '@aide/shared'
import { clearCache } from './editorStateCache'
import { clearAllDirty } from './editorDirtyState'
import { createTerminalPanelParams, serializeTerminalState } from './terminalState'
import { serializeWorkspaceState } from './workspaceStateSerializer'

let switchGeneration = 0

interface SwitchContext {
  dockviewApi: DockviewApi
  currentWorkspaceId: string | null
  currentRootPath: string | null
  targetWorkspaceId: string
  targetRootPath: string
  sidebarWidth: number
  sidebarCollapsed: boolean
  onSidebarRestore: (width: number, collapsed: boolean) => void
  onBeforeClearPanels?: () => void
  onAfterRestorePanels?: () => void
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
  if (ctx.currentRootPath) {
    const state = serializeWorkspaceState(
      ctx.dockviewApi,
      ctx.sidebarWidth,
      ctx.sidebarCollapsed,
    )
    // Fire-and-forget — don't block the switch
    window.api.saveWorkspaceState(ctx.currentRootPath, state).catch(() => {})
    window.api.saveTerminalState(ctx.currentRootPath, serializeTerminalState(ctx.dockviewApi)).catch(() => {})
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
  const savedState = await window.api.loadWorkspaceState(ctx.targetRootPath)

  if (gen !== switchGeneration) return false

  // 4. RESTORE layout
  if (savedState?.layout) {
    try {
      ctx.dockviewApi.fromJSON(savedState.layout as Parameters<DockviewApi['fromJSON']>[0])
    } catch {
      // Layout restore failed — use default
      createDefaultLayout(ctx.dockviewApi, ctx.targetWorkspaceId, ctx.targetRootPath)
    }
  } else {
    createDefaultLayout(ctx.dockviewApi, ctx.targetWorkspaceId, ctx.targetRootPath)
  }
  ctx.onAfterRestorePanels?.()
  window.api.saveTerminalState(ctx.targetRootPath, serializeTerminalState(ctx.dockviewApi)).catch(() => {})

  // 5. RESTORE sidebar
  if (savedState) {
    ctx.onSidebarRestore(savedState.sidebarWidth, savedState.sidebarCollapsed)
  }

  // 6. FOCUS last active tab
  if (savedState?.activeTabPath) {
    const panel = ctx.dockviewApi.panels.find(
      (p) => (p.params as Record<string, unknown>)?.filePath === savedState.activeTabPath,
    )
    if (panel) {
      panel.api.setActive()
    }
  }

  return true
}

/**
 * Create the default 3-pane layout when no saved state exists.
 */
function createDefaultLayout(api: DockviewApi, workspaceId: string, workspaceRoot: string): void {
  api.addPanel({
    id: 'editor',
    component: 'placeholder',
    title: 'Welcome',
  })

  api.addPanel({
    id: 'terminal',
    component: 'terminalPane',
    title: 'Terminal',
    params: createTerminalPanelParams(workspaceId, workspaceRoot, 'Terminal'),
    position: { referencePanel: 'editor', direction: 'below' },
    initialHeight: 200,
  })
}

/**
 * Save the current workspace state (for auto-save interval).
 */
export function autoSave(
  dockviewApi: DockviewApi | null,
  rootPath: string | null,
  sidebarWidth: number,
  sidebarCollapsed: boolean,
): void {
  if (!dockviewApi || !rootPath) return

  const state = serializeWorkspaceState(dockviewApi, sidebarWidth, sidebarCollapsed)
  window.api.saveWorkspaceState(rootPath, state).catch(() => {})
  window.api.saveTerminalState(rootPath, serializeTerminalState(dockviewApi)).catch(() => {})
}
