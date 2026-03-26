import { describe, expect, it } from 'vitest'
import { getPanelZoomFactor, updatePanelZoomParams } from '@renderer/lib/panelZoom'

describe('panelZoom', () => {
  it('defaults panel zoom to 1', () => {
    expect(getPanelZoomFactor(undefined)).toBe(1)
    expect(getPanelZoomFactor({})).toBe(1)
  })

  it('updates params with the next zoom factor', () => {
    expect(updatePanelZoomParams({ filePath: '/tmp/test.ts' }, 1.3)).toEqual({
      filePath: '/tmp/test.ts',
      zoomFactor: 1.3,
    })
  })
})
