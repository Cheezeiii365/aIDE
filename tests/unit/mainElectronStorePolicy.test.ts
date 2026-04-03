import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'

function walkTsFiles(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walkTsFiles(p, out)
    else if (st.isFile() && name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(p)
  }
}

/**
 * Phase 8: workspace folder paths must not be read/written via the app-level electron-store.
 * Use WorkspaceRegistry and `packages/main/src/workspace/workspaceRootResolution.ts`.
 * Pair with `mainIpcWorkspaceFallbackPolicy.test.ts` for implicit-active IPC guardrails.
 */
describe('main electron-store policy', () => {
  it('does not use deprecated workspaceRoot / activeWorktree store keys', () => {
    const root = join(import.meta.dirname, '../../packages/main/src')
    const files: string[] = []
    walkTsFiles(root, files)

    const forbidden = [
      /store\.get\(\s*['"]workspaceRoot['"]\s*\)/,
      /store\.set\(\s*['"]workspaceRoot['"]\s*,/,
      /store\.get\(\s*['"]activeWorktree['"]\s*\)/,
      /store\.set\(\s*['"]activeWorktree['"]\s*,/,
    ]

    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      for (const pattern of forbidden) {
        expect(text, `${file} must not match ${pattern}`).not.toMatch(pattern)
      }
    }
  })
})
