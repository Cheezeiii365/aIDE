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

export function onDirtyChange(callback: (filePath: string, dirty: boolean) => void): () => void {
  listeners.add(callback)
  return () => { listeners.delete(callback) }
}
