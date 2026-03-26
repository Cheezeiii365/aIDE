import type { EditorState } from '@codemirror/state'

const MAX_CACHE_SIZE = 64

const cache = new Map<string, EditorState>()

export function getCachedState(filePath: string): EditorState | undefined {
  const state = cache.get(filePath)
  if (state !== undefined) {
    // Move to end (most-recently-used) by re-inserting
    cache.delete(filePath)
    cache.set(filePath, state)
  }
  return state
}

/**
 * Store an EditorState for a file path and mark it as the most-recently-used entry.
 *
 * If an entry for `filePath` already exists it is replaced and its recency is updated.
 * When storing causes the cache to exceed its maximum size, the least-recently-used entry is evicted.
 *
 * @param filePath - The file path used as the cache key
 * @param state - The EditorState to store for `filePath`
 */
export function setCachedState(filePath: string, state: EditorState): void {
  cache.delete(filePath) // ensure re-insert moves to end
  cache.set(filePath, state)
  if (cache.size > MAX_CACHE_SIZE) {
    // Evict least-recently-used (first entry)
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
}

/**
 * Clears the in-memory editor state cache.
 *
 * Removes all stored editor state entries so subsequent lookups return `undefined` until new states are set.
 */
export function clearCache(): void {
  cache.clear()
}

/**
 * Retrieve all cached file paths in the cache's current iteration order.
 *
 * @returns An array of cached file paths in iteration order (from least-recently-used to most-recently-used)
 */
export function getAllCachedPaths(): string[] {
  return Array.from(cache.keys())
}
