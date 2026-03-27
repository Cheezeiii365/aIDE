/**
 * Workspace state serializer (renderer side).
 *
 * Collects state from Dockview, editor caches, and sidebar to build
 * an AideLocalState object for persistence. Also handles restoring
 * state into the Dockview layout.
 */

import type { DockviewApi } from 'dockview-react'
import type { AideLocalState, TabState } from '@aide/shared'
import { getCachedState, getAllCachedPaths } from './editorStateCache'
import { isDirty } from './editorDirtyState'
import { serializeBrowserPaneState } from './browserState'

/**
 * Create an AideLocalState snapshot of the current workspace, including Dockview layout, open editor tabs, active tab, sidebar settings, and serialized browser pane state.
 *
 * @param dockviewApi - The Dockview API instance to read panels and layout from, or `null` if unavailable
 * @param workspaceId - Workspace identifier passed to browser pane serialization, or `null` to omit workspace-specific data
 * @returns The serialized AideLocalState containing:
 * - `layout`: serialized Dockview layout or `null` if unavailable or serialization failed
 * - `openTabs`: list of open editor TabState entries (file path, cursor position, folded ranges, dirty flag, etc.)
 * - `activeTabPath`: file path of the active editor tab or `null`
 * - `sidebarWidth` and `sidebarCollapsed`: current sidebar settings
 * - `sidebarSections`: persisted sidebar sections (empty object here)
 * - `browserPanes`: browser pane state produced by `serializeBrowserPaneState(dockviewApi, workspaceId)`
 */
export function serializeWorkspaceState(
  dockviewApi: DockviewApi | null,
  workspaceId: string | null,
  sidebarWidth: number,
  sidebarCollapsed: boolean,
): AideLocalState {
  let layout: unknown = null
  const openTabs: TabState[] = []
  let activeTabPath: string | null = null

  if (dockviewApi) {
    // Serialize Dockview layout
    try {
      layout = dockviewApi.toJSON()
    } catch {
      layout = null
    }

    // Find active editor panel
    const activePanel = dockviewApi.activePanel
    if (activePanel) {
      const fp = (activePanel.params as Record<string, unknown>)?.filePath as string | undefined
      if (fp) activeTabPath = fp
    }

    // Collect tab states from all editor panels
    for (const panel of dockviewApi.panels) {
      const filePath = (panel.params as Record<string, unknown>)?.filePath as string | undefined
      if (!filePath) continue

      const cachedState = getCachedState(filePath)
      const cursorPos = cachedState?.selection?.main
      const cursorLine = cursorPos && cachedState ? cachedState.doc.lineAt(cursorPos.head) : null
      const dirty = isDirty(filePath)

      const tabState: TabState = {
        filePath,
        scrollTop: 0, // EditorView scroll not accessible from EditorState
        cursorLine: cursorLine?.number ?? 1,
        cursorColumn: cursorPos && cursorLine ? (cursorPos.head - cursorLine.from + 1) : 1,
        foldedRanges: [],
        isDirty: dirty,
        // Note: dirtyContent would need the EditorView's current doc text
        // For now, dirty files will re-read from disk on restore
      }
      openTabs.push(tabState)
    }
  }

  return {
    layout,
    openTabs,
    activeTabPath,
    sidebarWidth,
    sidebarCollapsed,
    sidebarSections: {},
    browserPanes: serializeBrowserPaneState(dockviewApi, workspaceId),
  }
}

/**
 * Get all file paths that have cached editor state.
 */
export function getCachedFilePaths(): string[] {
  return getAllCachedPaths()
}
