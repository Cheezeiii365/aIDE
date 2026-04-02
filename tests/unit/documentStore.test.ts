import { describe, expect, it, beforeEach } from 'vitest'
import type { TabState } from '@aide/shared'
import {
  approximatePosFromLineCol,
  clearDocumentSessionsForWorkspace,
  getDocumentSession,
  hydrateDocumentStoreFromOpenTabs,
  putDocumentSession,
} from '@renderer/lib/editor/documentStore'

describe('documentStore', () => {
  beforeEach(() => {
    clearDocumentSessionsForWorkspace('w1')
  })

  it('approximatePosFromLineCol maps 1-based line/column', () => {
    const doc = 'a\nbc\ndef'
    expect(approximatePosFromLineCol(doc, 1, 1)).toBe(0)
    expect(approximatePosFromLineCol(doc, 2, 2)).toBe(3)
    expect(approximatePosFromLineCol(doc, 3, 1)).toBe(5)
  })

  it('hydrateDocumentStoreFromOpenTabs restores dirty buffers and selection', () => {
    const tabs: TabState[] = [
      {
        filePath: '/x/a.ts',
        scrollTop: 0,
        cursorLine: 2,
        cursorColumn: 2,
        foldedRanges: [],
        isDirty: true,
        dirtyContent: 'L1\nL2',
        cleanBaseline: 'L1\n',
        diskChangedWhileDirty: true,
      },
    ]
    hydrateDocumentStoreFromOpenTabs('w1', tabs)
    const s = getDocumentSession('w1', '/x/a.ts')
    expect(s?.workingCopy).toBe('L1\nL2')
    expect(s?.cleanBaseline).toBe('L1\n')
    expect(s?.isDirty).toBe(true)
    expect(s?.diskChangedWhileDirty).toBe(true)
    expect(s?.selection.head).toBe(approximatePosFromLineCol('L1\nL2', 2, 2))
  })

  it('hydrate clears sessions for clean tabs in the snapshot', () => {
    putDocumentSession('w1', '/x/b.ts', {
      cleanBaseline: 'x',
      workingCopy: 'x',
      isDirty: false,
      selection: { anchor: 0, head: 0 },
      diskChangedWhileDirty: false,
    })
    hydrateDocumentStoreFromOpenTabs('w1', [
      {
        filePath: '/x/b.ts',
        scrollTop: 0,
        cursorLine: 1,
        cursorColumn: 1,
        foldedRanges: [],
        isDirty: false,
      },
    ])
    expect(getDocumentSession('w1', '/x/b.ts')).toBeUndefined()
  })
})
