import { describe, it, expect } from 'vitest'
import { IpcChannels } from './index'

describe('IpcChannels', () => {
  it('defines window control channels', () => {
    expect(IpcChannels.WINDOW_MINIMIZE).toBe('window:minimize')
    expect(IpcChannels.WINDOW_MAXIMIZE).toBe('window:maximize')
    expect(IpcChannels.WINDOW_CLOSE).toBe('window:close')
  })

  it('defines theme channels', () => {
    expect(IpcChannels.THEME_GET).toBe('theme:get')
    expect(IpcChannels.THEME_SET).toBe('theme:set')
    expect(IpcChannels.THEME_CHANGED).toBe('theme:changed')
  })

  it('has string literal values (no accidental undefined)', () => {
    const values = Object.values(IpcChannels)
    for (const v of values) {
      expect(typeof v).toBe('string')
      expect(v.length).toBeGreaterThan(0)
    }
  })
})
