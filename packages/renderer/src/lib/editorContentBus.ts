/**
 * Pub/sub bus for live editor document content.
 * Mirrors the pattern in editorDirtyState.ts.
 * EditorPane publishes on every doc change; MarkdownPreviewPane subscribes.
 */

const contentMap = new Map<string, string>()
const listeners = new Map<string, Set<(content: string) => void>>()

/**
 * Publish updated editor content for a given file path and notify subscribers.
 *
 * Stores the provided `content` as the latest value for `filePath` and invokes every subscriber registered for that path with the new content.
 *
 * @param filePath - The file path whose content is being published
 * @param content - The latest content to store and broadcast to subscribers
 */
export function publishContent(filePath: string, content: string): void {
  contentMap.set(filePath, content)
  const subs = listeners.get(filePath)
  if (subs) for (const cb of subs) cb(content)
}

/**
 * Retrieve the latest published content for the given file path.
 *
 * @param filePath - The path of the file whose content to retrieve
 * @returns The most recent content for `filePath`, or `undefined` if none exists
 */
export function getContent(filePath: string): string | undefined {
  return contentMap.get(filePath)
}

/**
 * Subscribe to content updates for a specific file path.
 *
 * @param filePath - The file path to receive updates for
 * @param callback - Function invoked with the new file content when updates occur
 * @returns An unsubscribe function that removes this subscription; calling it stops future callbacks to `callback`
 */
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

/**
 * Removes the stored content and all subscriber callbacks for the specified file path.
 *
 * @param filePath - The file path whose cached content and subscriptions should be cleared
 */
export function clearContent(filePath: string): void {
  contentMap.delete(filePath)
}
