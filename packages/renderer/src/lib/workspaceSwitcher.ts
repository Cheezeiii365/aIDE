/**
 * Workspace switcher (renderer side).
 *
 * Orchestrates the full save → clear → load → restore → focus cycle
 * when switching between workspaces. Includes debouncing for rapid switching.
 */

import type { DockviewApi } from 'dockview-react'
import type { AgentBackend, AideLocalState, AideLocalTerminals } from '@aide/shared'
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
 * Orchestrates a complete workspace switch: save current workspace state, clear UI, restore the target layout/panels and sidebar, and focus the last active tab or terminal.
 *
 * @param ctx - Context for the switch, including current and target workspace identifiers, dockview API, sidebar values, and lifecycle callbacks
 * @returns `true` if the switch completed without being superseded by a newer switch request, `false` otherwise.
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
      await createDefaultLayout(ctx.dockviewApi, ctx.targetWorkspaceId, ctx.targetRootPath, savedTerminals, () => gen === switchGeneration)
    }
  } else {
    await createDefaultLayout(ctx.dockviewApi, ctx.targetWorkspaceId, ctx.targetRootPath, savedTerminals, () => gen === switchGeneration)
  }
  if (gen !== switchGeneration) return false
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
 * Creates a fallback three-pane Dockview layout when no saved workspace layout is available.
 *
 * Adds an editor placeholder, one or more terminal panels stacked below the editor (restored from `savedTerminals` when available, otherwise a single terminal), and an agent placeholder to the right of the editor.
 *
 * @param workspaceRoot - Workspace filesystem root used as the default working directory for restored terminals when a terminal's cwd is not present.
 * @param savedTerminals - Persisted terminal metadata; terminals whose `workspaceId` matches `workspaceId` are restored as individual terminal panels.
 */
async function createDefaultLayout(
  api: DockviewApi,
  workspaceId: string,
  workspaceRoot: string | null,
  savedTerminals: AideLocalTerminals | null,
  isCurrent: () => boolean = () => true,
): Promise<void> {
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

  // Choose agent pane based on backend setting
  const resolvedSettings = await window.api.getResolvedSettings().catch(() => null)
  if (!isCurrent()) return

  const backend: AgentBackend = resolvedSettings?.['agent.backend'] ?? 'built-in'

  if (backend === 'claude-code' || backend === 'codex') {
    api.addPanel({
      id: 'agent',
      component: 'cliAgentPane',
      tabComponent: 'agentTab',
      title: backend === 'claude-code' ? 'Claude Code' : 'Codex',
      params: {
        workspaceId,
        workspaceRoot: workspaceRoot ?? undefined,
        backend,
        conversationId: crypto.randomUUID(),
      },
      position: { referencePanel: editorPanel, direction: 'right' },
      initialWidth: 400,
    })
  } else {
    const conversationId = await window.api.conversationCreate({
      workspaceId,
      backend: 'built-in',
    }).then((meta) => meta.id).catch(() => undefined)
    if (!isCurrent()) return

    api.addPanel({
      id: 'agent',
      component: 'chatPane',
      tabComponent: 'agentTab',
      title: 'Agent',
      params: { workspaceId, workspaceRoot: workspaceRoot ?? undefined, conversationId },
      position: { referencePanel: editorPanel, direction: 'right' },
      initialWidth: 350,
    })
  }
}

/**
 * Persist the current workspace and terminal runtime snapshot to persistent storage.
 *
 * Captures a runtime snapshot from the provided Dockview API and, if the snapshot contains a root path, saves workspace layout/state and terminal state via the renderer's `window.api`.
 *
 * @param dockviewApi - The Dockview API instance used to capture current panels and layout
 * @param workspaceId - The identifier of the workspace to capture
 * @param rootPath - The workspace root path used for persisted storage; if null the snapshot will not be saved
 * @param sidebarWidth - Current sidebar width to include in the snapshot
 * @param sidebarCollapsed - Current sidebar collapsed state to include in the snapshot
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
