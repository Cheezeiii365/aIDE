import { describe, it, expect } from 'vitest'
import { IpcChannels, adjustZoomFactor, clampZoomFactor, stepZoomFactor, zoomFactorToPercent } from './index'

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

  it('defines zoom channels', () => {
    expect(IpcChannels.BROWSER_ZOOM_SET).toBe('browser-zoom:set')
    expect(IpcChannels.APP_ZOOM_COMMAND).toBe('app:zoom-command')
  })
})

describe('zoom helpers', () => {
  it('clamps zoom factors into the supported range', () => {
    expect(clampZoomFactor(0.1)).toBe(0.5)
    expect(clampZoomFactor(3)).toBe(2)
  })

  it('adjusts zoom factors in 10 percent increments', () => {
    expect(adjustZoomFactor(1, 0.1)).toBe(1.1)
    expect(stepZoomFactor(1.1, -1)).toBe(1)
  })

  it('formats zoom factors as percentages', () => {
    expect(zoomFactorToPercent(1)).toBe(100)
    expect(zoomFactorToPercent(1.25)).toBe(125)
  })
})
