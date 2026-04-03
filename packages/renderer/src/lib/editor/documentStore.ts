/**
 * Workspace-scoped document sessions: editor truth survives pane unmounts and workspace switches.
 */

import type { TabState } from '@aide/shared'

export interface DocumentSelection {
  anchor: number
  head: number
}

export interface DocumentSession {
  cleanBaseline: string
  workingCopy: string
  isDirty: boolean
  selection: DocumentSelection
  diskChangedWhileDirty: boolean
}

const sessions = new Map<string, Map<string, DocumentSession>>()

function workspaceKey(workspaceId: string | null | undefined): string {
  return workspaceId ?? ''
}

function getBucket(workspaceId: string | null | undefined): Map<string, DocumentSession> {
  const wk = workspaceKey(workspaceId)
  let b = sessions.get(wk)
  if (!b) {
    b = new Map()
    sessions.set(wk, b)
  }
  return b
}

export function getDocumentSession(
  workspaceId: string | null | undefined,
  filePath: string,
): DocumentSession | undefined {
  return getBucket(workspaceId).get(filePath)
}

export function setDocumentSession(
  workspaceId: string | null | undefined,
  filePath: string,
  session: DocumentSession,
): void {
  getBucket(workspaceId).set(filePath, { ...session })
}

export function patchDocumentSession(
  workspaceId: string | null | undefined,
  filePath: string,
  patch: Partial<DocumentSession>,
): DocumentSession | undefined {
  const bucket = getBucket(workspaceId)
  const prev = bucket.get(filePath)
  if (!prev) return undefined
  const next = { ...prev, ...patch }
  bucket.set(filePath, next)
  notify(workspaceId, filePath)
  return next
}

/**
 * Create or replace a session (e.g. initial open or hydration).
 */
export function putDocumentSession(
  workspaceId: string | null | undefined,
  filePath: string,
  partial: Partial<DocumentSession> & Pick<DocumentSession, 'cleanBaseline' | 'workingCopy'>,
): DocumentSession {
  const bucket = getBucket(workspaceId)
  const prev = bucket.get(filePath)
  const next: DocumentSession = {
    cleanBaseline: partial.cleanBaseline,
    workingCopy: partial.workingCopy,
    isDirty: partial.isDirty ?? (partial.workingCopy !== partial.cleanBaseline),
    selection: partial.selection ?? prev?.selection ?? { anchor: 0, head: 0 },
    diskChangedWhileDirty: partial.diskChangedWhileDirty ?? prev?.diskChangedWhileDirty ?? false,
  }
  bucket.set(filePath, next)
  notify(workspaceId, filePath)
  return next
}

export function removeDocumentSession(workspaceId: string | null | undefined, filePath: string): void {
  const bucket = getBucket(workspaceId)
  if (!bucket.has(filePath)) return
  bucket.delete(filePath)
  notify(workspaceId, filePath)
}

export function clearDocumentSessionsForWorkspace(workspaceId: string | null | undefined): void {
  sessions.delete(workspaceKey(workspaceId))
}

const listeners = new Set<(workspaceId: string, filePath: string) => void>()

export function onDocumentSessionChanged(
  cb: (workspaceId: string, filePath: string) => void,
): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

function notify(workspaceId: string | null | undefined, filePath: string): void {
  const wk = workspaceKey(workspaceId)
  for (const cb of listeners) cb(wk, filePath)
}

export function updateDocumentFromEditor(
  workspaceId: string | null | undefined,
  filePath: string,
  workingCopy: string,
  selection: DocumentSelection,
): void {
  const bucket = getBucket(workspaceId)
  const prev = bucket.get(filePath)
  const cleanBaseline = prev?.cleanBaseline ?? workingCopy
  const isDirty = workingCopy !== cleanBaseline
  const next: DocumentSession = {
    cleanBaseline,
    workingCopy,
    isDirty,
    selection,
    diskChangedWhileDirty: isDirty && (prev?.diskChangedWhileDirty ?? false),
  }
  bucket.set(filePath, next)
  notify(workspaceId, filePath)
}

export function markSaved(
  workspaceId: string | null | undefined,
  filePath: string,
  savedContent: string,
): void {
  const bucket = getBucket(workspaceId)
  const prev = bucket.get(filePath)
  const next: DocumentSession = {
    cleanBaseline: savedContent,
    workingCopy: savedContent,
    isDirty: false,
    selection: prev?.selection ?? { anchor: 0, head: 0 },
    diskChangedWhileDirty: false,
  }
  bucket.set(filePath, next)
  notify(workspaceId, filePath)
}

export function isDocumentDirty(
  workspaceId: string | null | undefined,
  filePath: string,
): boolean {
  return getDocumentSession(workspaceId, filePath)?.isDirty ?? false
}

export function markDiskChangedWhileDirty(
  workspaceId: string | null | undefined,
  filePath: string,
): void {
  patchDocumentSession(workspaceId, filePath, { diskChangedWhileDirty: true })
}

/**
 * Approximate 1-based line/column to a document offset (UTF-16 aligned with JS strings).
 */
export function approximatePosFromLineCol(doc: string, line: number, column: number): number {
  if (doc.length === 0) return 0
  const lines = doc.split('\n')
  const idx = Math.min(Math.max(1, line), lines.length) - 1
  const lineText = lines[idx] ?? ''
  const col0 = Math.max(1, column) - 1
  let offset = 0
  for (let i = 0; i < idx; i++) {
    offset += lines[i].length + 1
  }
  return Math.min(offset + Math.min(col0, lineText.length), doc.length)
}

/**
 * Apply persisted tab rows to the store before editor panels mount (workspace switch / restore).
 */
export function hydrateDocumentStoreFromOpenTabs(
  workspaceId: string | null | undefined,
  tabs: TabState[],
): void {
  for (const tab of tabs) {
    if (tab.isDirty && tab.dirtyContent !== undefined) {
      const head = tab.selection
        ? tab.selection.head
        : approximatePosFromLineCol(tab.dirtyContent, tab.cursorLine, tab.cursorColumn)
      const anchor = tab.selection?.anchor ?? head
      putDocumentSession(workspaceId, tab.filePath, {
        cleanBaseline: tab.cleanBaseline ?? '',
        workingCopy: tab.dirtyContent,
        isDirty: true,
        selection: { anchor, head },
        diskChangedWhileDirty: tab.diskChangedWhileDirty ?? false,
      })
    } else {
      removeDocumentSession(workspaceId, tab.filePath)
    }
  }
}
