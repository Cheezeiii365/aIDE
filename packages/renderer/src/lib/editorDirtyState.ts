const dirtyMap = new Map<string, boolean>()
const listeners = new Set<(filePath: string, dirty: boolean) => void>()

export function isDirty(filePath: string): boolean {
  return dirtyMap.get(filePath) ?? false
}

export function setDirty(filePath: string, dirty: boolean): void {
  const prev = dirtyMap.get(filePath) ?? false
  if (prev === dirty) return
  if (dirty) {
    dirtyMap.set(filePath, true)
  } else {
    dirtyMap.delete(filePath)
  }
  for (const cb of listeners) cb(filePath, dirty)
}

/**
 * Registers a listener to be notified when a file's dirty state changes.
 *
 * @param callback - Function invoked with the changed `filePath` and its new `dirty` state.
 * @returns A function that unsubscribes the listener; calling the returned function removes the callback and has no effect if called multiple times.
 */
export function onDirtyChange(callback: (filePath: string, dirty: boolean) => void): () => void {
  listeners.add(callback)
  return () => { listeners.delete(callback) }
}

/**
 * Provide a shallow copy of the current per-file dirty-state map.
 *
 * @returns A new Map whose keys are file paths and whose values are `true` for files currently marked dirty; a missing key implies the file is not dirty.
 */
export function getAllDirty(): Map<string, boolean> {
  return new Map(dirtyMap)
}

/**
 * Remove all tracked dirty-file entries from the module's internal state.
 *
 * This clears the internal `dirtyMap` so subsequent `isDirty` checks return `false` for all files. This operation does not notify registered listeners.
 */
export function clearAllDirty(): void {
  dirtyMap.clear()
}
