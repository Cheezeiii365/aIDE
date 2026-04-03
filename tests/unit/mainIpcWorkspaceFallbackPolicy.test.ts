import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'

/**
 * Phase 8: `resolveRepoRootForWorkspace(workspaceRegistry, undefined)` must not spread —
 * it implies IPC handlers that guess the active workspace. The single allowlisted call is
 * documented in `docs/multiwork.md` (SETTINGS_SET_USER broadcast).
 */
describe('main IPC implicit-active workspace policy', () => {
  it('has exactly one resolveRepoRootForWorkspace(..., undefined) in main index', () => {
    const indexPath = join(import.meta.dirname, '../../packages/main/src/index.ts')
    const text = readFileSync(indexPath, 'utf8')
    const matches = text.match(/resolveRepoRootForWorkspace\(\s*workspaceRegistry\s*,\s*undefined\s*\)/g)
    expect(matches?.length ?? 0, 'add new fallbacks only with docs/multiwork.md + this test').toBe(1)
  })

  it('does not pass undefined into resolveEffectiveRootForWorkspace for workspaceRegistry', () => {
    const indexPath = join(import.meta.dirname, '../../packages/main/src/index.ts')
    const text = readFileSync(indexPath, 'utf8')
    expect(text).not.toMatch(/resolveEffectiveRootForWorkspace\(\s*workspaceRegistry\s*,\s*undefined\s*\)/)
  })
})
