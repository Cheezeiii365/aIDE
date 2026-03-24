import type { EditorState } from '@codemirror/state'

const cache = new Map<string, EditorState>()

export function getCachedState(filePath: string): EditorState | undefined {
  return cache.get(filePath)
}

export function setCachedState(filePath: string, state: EditorState): void {
  cache.set(filePath, state)
}

export function removeCachedState(filePath: string): void {
  cache.delete(filePath)
}
