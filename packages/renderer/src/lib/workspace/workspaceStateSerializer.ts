/**
 * Workspace state serializer (renderer side).
 *
 * Collects state from Dockview, document sessions, and sidebar to build
 * an AideLocalState object for persistence. Also handles restoring
 * state into the Dockview layout.
 */

import type { DockviewApi } from 'dockview-react'
import type { AideLocalState, TabState } from '@aide/shared'
import { peekCachedState, getAllCachedPaths } from '../editor/editorStateCache'
import { getDocumentSession } from '../editor/documentStore'
import { serializeBrowserPaneState } from '../browserState'

function offsetToLineColumn(doc: string, offset: number): { line: number; column: number } {
  const o = Math.max(0, Math.min(offset, doc.length))
  const before = doc.slice(0, o)
  const lines = before.split('\n')
  const line = lines.length
  const column = (lines[lines.length - 1]?.length ?? 0) + 1
  return { line, column }
}

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
 * - `activeWorktreePath`: persisted active git worktree path, or null for main worktree
 */
export function serializeWorkspaceState(
  dockviewApi: DockviewApi | null,
  workspaceId: string | null,
  sidebarWidth: number,
  sidebarCollapsed: boolean,
  activeWorktreePath: string | null,
): AideLocalState {
  let layout: unknown = null
  const openTabs: TabState[] = []
  let activeTabPath: string | null = null

  if (dockviewApi) {
    try {
      layout = dockviewApi.toJSON()
    } catch {
      layout = null
    }

    const activePanel = dockviewApi.activePanel
    if (activePanel) {
      const fp = (activePanel.params as Record<string, unknown>)?.filePath as string | undefined
      if (fp) activeTabPath = fp
    }

    for (const panel of dockviewApi.panels) {
      const filePath = (panel.params as Record<string, unknown>)?.filePath as string | undefined
      if (!filePath) continue

      const panelWid = (panel.params as Record<string, unknown>)?.workspaceId as string | undefined
      const wid = panelWid ?? workspaceId ?? undefined
      const session = getDocumentSession(wid, filePath)
      const docText = session?.workingCopy ?? peekCachedState(filePath)?.doc.toString() ?? ''
      const cursorOffset = session?.selection?.head
        ?? peekCachedState(filePath)?.selection.main.head
        ?? 0
      const { line: cursorLine, column: cursorColumn } = offsetToLineColumn(docText, cursorOffset)

      const dirty = session?.isDirty ?? false

      const tabState: TabState = {
        filePath,
        scrollTop: 0,
        cursorLine,
        cursorColumn,
        foldedRanges: [],
        isDirty: dirty,
        dirtyContent: dirty ? session?.workingCopy : undefined,
        cleanBaseline: dirty ? session?.cleanBaseline : undefined,
        selection: dirty && session
          ? { anchor: session.selection.anchor, head: session.selection.head }
          : undefined,
        diskChangedWhileDirty:
          session?.diskChangedWhileDirty === true ? true : undefined,
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
    activeWorktreePath,
  }
}

/**
 * Get all file paths that have cached editor state.
 */
export function getCachedFilePaths(): string[] {
  return getAllCachedPaths()
}
