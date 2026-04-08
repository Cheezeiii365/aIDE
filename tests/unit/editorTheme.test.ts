import { describe, expect, it } from 'vitest'
import { getEditorMetrics } from '@renderer/lib/editor/editorTheme'

describe('editorTheme metrics', () => {
  it('derives vscode-like editor metrics from font size', () => {
    expect(getEditorMetrics(13)).toEqual({
      fontSize: 13,
      lineHeight: '21px',
    })

    expect(getEditorMetrics(16)).toEqual({
      fontSize: 16,
      lineHeight: '26px',
    })
  })
})
