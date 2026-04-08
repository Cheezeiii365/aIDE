import { describe, it, expect } from 'vitest'
import {
  buildOpenCodePermissionConfig,
  decideOpenCodePermission,
} from '@main/chat/cliAdapters/openCodePermissionBridge'

describe('buildOpenCodePermissionConfig', () => {
  it('autopilot tier allows everything', () => {
    const config = buildOpenCodePermissionConfig('autopilot', {})
    expect(config).toEqual({
      edit: 'allow',
      bash: 'allow',
      webfetch: 'allow',
      doom_loop: 'allow',
      external_directory: 'allow',
    })
  })

  it('confirm tier asks for everything', () => {
    const config = buildOpenCodePermissionConfig('confirm', {})
    expect(config).toEqual({
      edit: 'ask',
      bash: 'ask',
      webfetch: 'ask',
      doom_loop: 'ask',
      external_directory: 'ask',
    })
  })

  it('auto-approve tier allows webfetch but asks for edits / bash', () => {
    const config = buildOpenCodePermissionConfig('auto-approve', {})
    expect(config.webfetch).toBe('allow')
    expect(config.edit).toBe('ask')
    expect(config.bash).toBe('ask')
  })

  it('per-tool boolean overrides bypass the tier', () => {
    const config = buildOpenCodePermissionConfig('confirm', {
      file_write: true,
      terminal_exec: false,
    })
    expect(config.edit).toBe('allow')
    expect(config.bash).toBe('deny')
    expect(config.webfetch).toBe('ask')
  })

  it('pattern overrides defer to runtime ask', () => {
    const config = buildOpenCodePermissionConfig('confirm', {
      terminal_exec: { allowPatterns: ['ls *'], denyPatterns: ['rm *'] },
    })
    expect(config.bash).toBe('ask')
  })
})

describe('decideOpenCodePermission', () => {
  it('autopilot → always allow', () => {
    const result = decideOpenCodePermission(
      { category: 'edit', pattern: 'src/foo.ts' },
      'autopilot',
      {},
    )
    expect(result).toBe('always')
  })

  it('confirm → always prompt', () => {
    const result = decideOpenCodePermission(
      { category: 'bash', pattern: 'ls -la' },
      'confirm',
      {},
    )
    expect(result).toBe('prompt')
  })

  it('auto-approve allows webfetch (read-only) but prompts for edit', () => {
    expect(
      decideOpenCodePermission({ category: 'webfetch', pattern: 'https://x' }, 'auto-approve', {}),
    ).toBe('always')
    expect(
      decideOpenCodePermission(
        { category: 'edit', pattern: 'src/foo.ts' },
        'auto-approve',
        {},
      ),
    ).toBe('prompt')
  })

  it('per-tool boolean override forces allow / deny', () => {
    expect(
      decideOpenCodePermission(
        { category: 'edit', pattern: 'x' },
        'confirm',
        { file_write: true },
      ),
    ).toBe('always')
    expect(
      decideOpenCodePermission(
        { category: 'edit', pattern: 'x' },
        'autopilot',
        { file_write: false },
      ),
    ).toBe('reject')
  })

  it('pattern allow / deny on bash matches against the command pattern', () => {
    expect(
      decideOpenCodePermission(
        { category: 'bash', pattern: 'ls -la' },
        'confirm',
        { terminal_exec: { allowPatterns: ['ls *'] } },
      ),
    ).toBe('always')

    expect(
      decideOpenCodePermission(
        { category: 'bash', pattern: 'rm -rf /' },
        'autopilot',
        { terminal_exec: { denyPatterns: ['rm *'] } },
      ),
    ).toBe('reject')

    // Doesn't match allowPatterns → prompt
    expect(
      decideOpenCodePermission(
        { category: 'bash', pattern: 'cat file' },
        'confirm',
        { terminal_exec: { allowPatterns: ['ls *'] } },
      ),
    ).toBe('prompt')
  })
})
