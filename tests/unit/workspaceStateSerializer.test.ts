import { describe, expect, it, vi, beforeEach } from 'vitest'
import { serializeWorkspaceState } from '@renderer/lib/workspace/workspaceStateSerializer'
import {
  putDocumentSession,
  clearDocumentSessionsForWorkspace,
} from '@renderer/lib/editor/documentStore'

vi.mock('@renderer/lib/editor/editorStateCache', () => ({
  peekCachedState: () => null,
  getAllCachedPaths: () => [],
}))

vi.mock('@renderer/lib/browserState', () => ({
  serializeBrowserPaneState: () => [],
}))

describe('workspaceStateSerializer', () => {
  beforeEach(() => {
    clearDocumentSessionsForWorkspace('ws-1')
    clearDocumentSessionsForWorkspace('')
  })

  it('serializes sidebar state into local snapshots', () => {
    const dockviewApi = {
      toJSON: () => ({ grid: 'layout' }),
      activePanel: null,
      panels: [],
    } as never

    expect(serializeWorkspaceState(dockviewApi, 'ws-1', 220, false, null)).toMatchObject({
      sidebarWidth: 220,
      sidebarCollapsed: false,
      activeWorktreePath: null,
    })
  })

  it('includes dirtyContent and metadata from document store', () => {
    putDocumentSession('ws-1', '/p/f', {
      cleanBaseline: 'a',
      workingCopy: 'ab',
      isDirty: true,
      selection: { anchor: 2, head: 2 },
      diskChangedWhileDirty: true,
    })

    const dockviewApi = {
      toJSON: () => ({ grid: 'layout' }),
      activePanel: { params: { filePath: '/p/f', workspaceId: 'ws-1' } },
      panels: [{ params: { filePath: '/p/f', workspaceId: 'ws-1' } }],
    } as never

    const state = serializeWorkspaceState(dockviewApi, 'ws-1', 200, true, '/wt/feature')
    expect(state.activeWorktreePath).toBe('/wt/feature')
    expect(state.openTabs[0]).toMatchObject({
      filePath: '/p/f',
      isDirty: true,
      dirtyContent: 'ab',
      cleanBaseline: 'a',
      diskChangedWhileDirty: true,
      selection: { anchor: 2, head: 2 },
    })
  })
})
