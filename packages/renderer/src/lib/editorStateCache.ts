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

export function setCachedState(filePath: string, state: EditorState): void {
  cache.delete(filePath) // ensure re-insert moves to end
  cache.set(filePath, state)
  if (cache.size > MAX_CACHE_SIZE) {
    // Evict least-recently-used (first entry)
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
}
