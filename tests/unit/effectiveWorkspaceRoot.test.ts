import { describe, expect, it, beforeEach } from 'vitest'
import { getEffectiveWorkspaceRoot } from '@main/workspace/effectiveWorkspaceRoot'
import {
  setActiveWorktreeForWorkspace,
  clearWorktreeStateForWorkspace,
} from '@main/workspace/worktreeManager'

describe('getEffectiveWorkspaceRoot', () => {
  const wid = 'ws-eff-test'

  beforeEach(() => {
    clearWorktreeStateForWorkspace(wid)
  })

  it('returns null when repo root is null', () => {
    expect(getEffectiveWorkspaceRoot(wid, null)).toBeNull()
  })

  it('returns repo root when no worktree is active', () => {
    expect(getEffectiveWorkspaceRoot(wid, '/repo')).toBe('/repo')
  })

  it('returns active worktree when set', () => {
    setActiveWorktreeForWorkspace(wid, '/repo/../wt')
    expect(getEffectiveWorkspaceRoot(wid, '/repo')).toBe('/repo/../wt')
  })
})
