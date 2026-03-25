/**
 * Pub/sub bus for live editor document content.
 * Mirrors the pattern in editorDirtyState.ts.
 * EditorPane publishes on every doc change; MarkdownPreviewPane subscribes.
 */

const contentMap = new Map<string, string>()
const listeners = new Map<string, Set<(content: string) => void>>()

export function publishContent(filePath: string, content: string): void {
  contentMap.set(filePath, content)
  const subs = listeners.get(filePath)
  if (subs) for (const cb of subs) cb(content)
}

export function getContent(filePath: string): string | undefined {
  return contentMap.get(filePath)
}

export function subscribeContent(
  filePath: string,
  callback: (content: string) => void,
): () => void {
  let subs = listeners.get(filePath)
  if (!subs) {
    subs = new Set()
    listeners.set(filePath, subs)
  }
  subs.add(callback)
  return () => {
    subs!.delete(callback)
    if (subs!.size === 0) listeners.delete(filePath)
  }
}

export function clearContent(filePath: string): void {
  contentMap.delete(filePath)
  listeners.delete(filePath)
}
