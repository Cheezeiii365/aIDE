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

/**
 * Serialize the current workspace state from all sources.
 */
export function serializeWorkspaceState(
  dockviewApi: DockviewApi | null,
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
      const dirty = isDirty(filePath)

      const tabState: TabState = {
        filePath,
        scrollTop: 0, // EditorView scroll not accessible from EditorState
        cursorLine: cursorPos ? cachedState!.doc.lineAt(cursorPos.head).number : 1,
        cursorColumn: cursorPos ? (cursorPos.head - cachedState!.doc.lineAt(cursorPos.head).from + 1) : 1,
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
  }
}

/**
 * Get all file paths that have cached editor state.
 */
export function getCachedFilePaths(): string[] {
  return getAllCachedPaths()
}
