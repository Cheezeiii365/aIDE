import { describe, expect, it, vi } from 'vitest'
import { serializeWorkspaceState } from '@renderer/lib/workspaceStateSerializer'

vi.mock('@renderer/lib/editorStateCache', () => ({
  peekCachedState: () => null,
  getAllCachedPaths: () => [],
}))

vi.mock('@renderer/lib/editorDirtyState', () => ({
  isDirty: () => false,
}))

describe('workspaceStateSerializer', () => {
  it('serializes sidebar state into local snapshots', () => {
    const dockviewApi = {
      toJSON: () => ({ grid: 'layout' }),
      activePanel: null,
      panels: [],
    } as never

    expect(serializeWorkspaceState(dockviewApi, 'ws-1', 220, false)).toMatchObject({
      sidebarWidth: 220,
      sidebarCollapsed: false,
    })
  })
})
