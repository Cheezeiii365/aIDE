import { describe, expect, it, beforeEach } from 'vitest'
import { WorkspaceRuntimeRegistry } from '@main/workspace/WorkspaceRuntimeRegistry'
import { WorkspaceRuntime } from '@main/workspace/WorkspaceRuntime'
import {
  clearWorktreeStateForWorkspace,
  setActiveWorktreeForWorkspace,
} from '@main/workspace/worktreeManager'

describe('WorkspaceRuntimeRegistry.findByFilePath', () => {
  const id = 'w-reg'
  let registry: WorkspaceRuntimeRegistry

  beforeEach(() => {
    clearWorktreeStateForWorkspace(id)
    registry = new WorkspaceRuntimeRegistry({
      createRuntime: (entry) =>
        new WorkspaceRuntime(entry, {
          startServices: async () => {},
          stopServices: async () => {},
        }),
    })
  })

  it('matches paths under repo root', () => {
    const runtime = registry.getOrCreate({
      id,
      name: 'x',
      rootPath: '/projects/foo',
      createdAt: 0,
      lastOpenedAt: 0,
    })
    expect(registry.findByFilePath('/projects/foo/src/a.ts')).toBe(runtime)
  })

  it('matches paths under active worktree outside repo prefix', () => {
    const runtime = registry.getOrCreate({
      id,
      name: 'x',
      rootPath: '/projects/foo',
      createdAt: 0,
      lastOpenedAt: 0,
    })
    setActiveWorktreeForWorkspace(id, '/other/worktrees/bar')
    expect(registry.findByFilePath('/other/worktrees/bar/baz.ts')).toBe(runtime)
    expect(registry.findByFilePath('/projects/foo/legacy.ts')).toBe(runtime)
  })
})
