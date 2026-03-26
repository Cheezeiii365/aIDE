import { watch, type FSWatcher } from 'fs'
import { stat } from 'fs/promises'
import { join } from 'path'
import { ipcMain, type WebContents } from 'electron'
import { IpcChannels } from '@aide/shared'
import type { FsWatchEvent, FsEventType } from '@aide/shared'

// Scoped watcher state — keyed by scopeId (e.g. 'default', or a workspace UUID in future)
const activeScopes = new Map<string, { roots: string[]; watchers: FSWatcher[] }>()

let eventBuffer: FsWatchEvent[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
const knownDirectories = new Set<string>()

const IGNORE_SEGMENTS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'out',
  '__pycache__',
  '.pytest_cache',
])

const IGNORE_NAMES = new Set(['.DS_Store', 'Thumbs.db'])

const DEBOUNCE_MS = 150
const BULK_DEBOUNCE_MS = 500
const BULK_THRESHOLD = 50

let getWebContents: (() => WebContents | null) | null = null

function shouldIgnore(relativePath: string): boolean {
  const segments = relativePath.split('/')
  const fileName = segments[segments.length - 1]
  if (IGNORE_NAMES.has(fileName)) return true
  return segments.some((seg) => IGNORE_SEGMENTS.has(seg))
}

function flushEvents() {
  flushTimer = null
  if (eventBuffer.length === 0) return

  const events = eventBuffer
  eventBuffer = []
  getWebContents?.()?.send(IpcChannels.FS_WATCH_EVENT, events)
}

function scheduleFlush() {
  const delay = eventBuffer.length > BULK_THRESHOLD ? BULK_DEBOUNCE_MS : DEBOUNCE_MS
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(flushEvents, delay)
}

async function resolveEvent(
  fullPath: string,
): Promise<{ type: FsEventType; isDirectory: boolean }> {
  try {
    const info = await stat(fullPath)
    const isDir = info.isDirectory()
    if (isDir) {
      knownDirectories.add(fullPath)
    } else {
      knownDirectories.delete(fullPath)
    }
    // fs.watch gives 'rename' for create/delete — if stat succeeds, it exists
    const wasKnown = knownDirectories.has(fullPath) || isDir
    return { type: wasKnown ? 'update' : 'create', isDirectory: isDir }
  } catch {
    // stat failed — file was deleted
    const wasDir = knownDirectories.has(fullPath)
    knownDirectories.delete(fullPath)
    return { type: 'delete', isDirectory: wasDir }
  }
}

// Deduplicate rapid events for the same path within a flush window
const pendingPaths = new Set<string>()

function createFsEventHandler(rootPath: string, scopeId: string) {
  return async function handleFsEvent(eventType: string, filename: string | null) {
    if (!filename) return
    if (shouldIgnore(filename)) return

    const fullPath = join(rootPath, filename)

    // Deduplicate: fs.watch can fire multiple events for the same file change
    if (pendingPaths.has(fullPath)) return
    pendingPaths.add(fullPath)
    // Clear dedup after a short window
    setTimeout(() => pendingPaths.delete(fullPath), 50)

    const { type, isDirectory } = await resolveEvent(fullPath)
    eventBuffer.push({ type, path: fullPath, isDirectory, scopeId })
    scheduleFlush()
  }
}

/**
 * Check if `candidate` is nested inside any of the `roots`.
 * Used to skip redundant watchers when one root is a subdirectory of another.
 */
function isNestedRoot(candidate: string, roots: string[]): boolean {
  const normalized = candidate.endsWith('/') ? candidate : candidate + '/'
  for (const root of roots) {
    if (root === candidate) continue
    const normalizedRoot = root.endsWith('/') ? root : root + '/'
    if (normalized.startsWith(normalizedRoot)) return true
  }
  return false
}

function startSubscription(rootPath: string, scopeId: string): FSWatcher | null {
  try {
    const handler = createFsEventHandler(rootPath, scopeId)
    const watcher = watch(rootPath, { recursive: true }, (eventType, filename) => {
      handler(eventType, filename)
    })

    watcher.on('error', (err) => {
      console.error(`[fileWatcher] Watcher error on ${rootPath}:`, err)
    })

    console.log(`[fileWatcher] Watching [${scopeId}]: ${rootPath}`)
    return watcher
  } catch (err) {
    console.error(`[fileWatcher] Failed to start watcher on ${rootPath}:`, err)
    return null
  }
}

/**
 * Start watching multiple roots under a given scope.
 * Diffs current vs desired roots — closes removed, starts new, leaves existing untouched.
 * Skips nested roots (if root A is a prefix of root B, B is skipped).
 */
export async function startWatchers(scopeId: string, roots: string[]): Promise<void> {
  // Filter out nested roots to avoid duplicate events
  const effectiveRoots = roots.filter((r) => !isNestedRoot(r, roots))

  const existing = activeScopes.get(scopeId)
  const existingRoots = new Set(existing?.roots ?? [])
  const desiredRoots = new Set(effectiveRoots)

  // Close watchers for roots that are no longer needed
  if (existing) {
    const keepWatchers: FSWatcher[] = []
    const keepRoots: string[] = []

    for (let i = 0; i < existing.roots.length; i++) {
      if (desiredRoots.has(existing.roots[i])) {
        keepWatchers.push(existing.watchers[i])
        keepRoots.push(existing.roots[i])
      } else {
        existing.watchers[i].close()
        console.log(`[fileWatcher] Stopped [${scopeId}]: ${existing.roots[i]}`)
      }
    }

    existing.roots = keepRoots
    existing.watchers = keepWatchers
  }

  // Start watchers for new roots
  const scope = existing ?? { roots: [], watchers: [] }
  for (const root of effectiveRoots) {
    if (!existingRoots.has(root)) {
      const watcher = startSubscription(root, scopeId)
      if (watcher) {
        scope.roots.push(root)
        scope.watchers.push(watcher)
      }
    }
  }

  activeScopes.set(scopeId, scope)
}

/**
 * Convenience wrapper — watch a single root under the 'default' scope.
 * Replaces the old single-root startWatcher API.
 */
export async function startWatcher(rootPath: string): Promise<void> {
  await startWatchers('default', [rootPath])
}

/**
 * Stop watchers. No arg = stop all scopes. With arg = stop just that scope.
 */
export async function stopWatchers(scopeId?: string): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  eventBuffer = []
  pendingPaths.clear()

  if (scopeId) {
    const scope = activeScopes.get(scopeId)
    if (scope) {
      for (const w of scope.watchers) w.close()
      activeScopes.delete(scopeId)
      console.log(`[fileWatcher] Stopped all watchers for scope [${scopeId}]`)
    }
  } else {
    for (const [id, scope] of activeScopes) {
      for (const w of scope.watchers) w.close()
      console.log(`[fileWatcher] Stopped all watchers for scope [${id}]`)
    }
    activeScopes.clear()
  }

  knownDirectories.clear()
}

/**
 * Stop all watchers (backward-compatible alias).
 */
export async function stopWatcher(): Promise<void> {
  await stopWatchers()
}

export function registerFileWatcherHandlers(
  webContentsFn: () => WebContents | null,
): void {
  getWebContents = webContentsFn

  ipcMain.handle('fs:watch-start', async (_event, rootPath: string) => {
    await startWatcher(rootPath)
  })

  ipcMain.handle('fs:watch-stop', async () => {
    await stopWatcher()
  })
}

/**
 * Get watched roots. No arg = all roots across all scopes. With arg = roots for that scope.
 */
export function getWatchedRoots(scopeId?: string): string[] {
  if (scopeId) {
    return activeScopes.get(scopeId)?.roots ?? []
  }
  const allRoots: string[] = []
  for (const scope of activeScopes.values()) {
    allRoots.push(...scope.roots)
  }
  return allRoots
}
