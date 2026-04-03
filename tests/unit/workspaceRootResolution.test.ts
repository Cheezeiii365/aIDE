import { describe, it, expect } from 'vitest'
import type { WorkspaceRegistry } from '@main/workspace/workspaceRegistry'
import {
  resolveRepoRootForWorkspace,
  resolveWorkspaceIdForIpc,
} from '@main/workspace/workspaceRootResolution'

function mockRegistry(): Pick<WorkspaceRegistry, 'get' | 'getActiveId'> {
  return {
    getActiveId: () => 'active-ws',
    get: (id: string) => {
      if (id === 'active-ws') return { rootPath: '/repo/a' } as ReturnType<WorkspaceRegistry['get']>
      if (id === 'other') return { rootPath: '/repo/b' } as ReturnType<WorkspaceRegistry['get']>
      return undefined
    },
  }
}

describe('workspaceRootResolution', () => {
  const registry = mockRegistry() as unknown as WorkspaceRegistry

  it('resolveWorkspaceIdForIpc prefers explicit id', () => {
    expect(resolveWorkspaceIdForIpc(registry, 'other')).toBe('other')
  })

  it('resolveWorkspaceIdForIpc uses active id when omitted', () => {
    expect(resolveWorkspaceIdForIpc(registry, undefined)).toBe('active-ws')
    expect(resolveWorkspaceIdForIpc(registry, null)).toBe('active-ws')
  })

  it('resolveRepoRootForWorkspace reads entry for resolved id', () => {
    expect(resolveRepoRootForWorkspace(registry, 'other')).toBe('/repo/b')
    expect(resolveRepoRootForWorkspace(registry, undefined)).toBe('/repo/a')
  })

  it('resolveRepoRootForWorkspace returns null when entry missing', () => {
    const empty = {
      getActiveId: () => null as string | null,
      get: () => undefined,
    } as unknown as WorkspaceRegistry
    expect(resolveRepoRootForWorkspace(empty, 'x')).toBeNull()
  })
})
