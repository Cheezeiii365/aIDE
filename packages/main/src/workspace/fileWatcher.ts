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

/**
 * Creates an async filesystem event handler bound to a root path and scope.
 *
 * @param rootPath - Base directory used to resolve incoming `filename` values into full paths
 * @param scopeId - Identifier that will be included on emitted events to attribute them to a watcher scope
 * @returns An async callback `(eventType, filename)` that ignores null or excluded filenames, deduplicates rapid events for the same full path, resolves the event type and directory flag, enqueues an event object `{ type, path, isDirectory, scopeId }` into the shared event buffer, and triggers the debounced flush of buffered events
 */
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
    eventBuffer.push({ type, path: fullPath, isDirectory, scopeId, workspaceId: scopeId })
    scheduleFlush()
  }
}

/**
 * Determines whether `candidate` is nested inside any of the provided `roots`.
 *
 * @returns `true` if `candidate` is a subpath of any entry in `roots`, `false` otherwise.
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

/**
 * Starts a filesystem watcher for the given root and scope.
 *
 * @param rootPath - The filesystem path to watch
 * @param scopeId - Scope identifier to associate with emitted events
 * @returns The created `FSWatcher`, or `null` if the watcher could not be started
 */
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
 * Legacy single-root helper using scope id `default`.
 * Prefer {@link startWatchers} with a workspace id as scope for multi-workspace runs.
 */
export async function startWatcher(rootPath: string): Promise<void> {
  await startWatchers('default', [rootPath])
}

/**
 * Stops file system watchers and clears related internal state.
 *
 * When `scopeId` is provided, stops and removes watchers for that scope only.
 * When `scopeId` is omitted, stops and removes watchers for all scopes.
 *
 * This also clears buffered events, pending path deduplication state, any scheduled flush timer, and the known-directories set.
 *
 * @param scopeId - Optional identifier of the watcher scope to stop; if omitted, all scopes are stopped
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
 * Stop every watcher scope. Prefer {@link stopWatchers} with a workspace scope id when tearing down one runtime.
 */
export async function stopWatcher(): Promise<void> {
  await stopWatchers()
}

/**
 * Legacy `fs:watch-start` / `fs:watch-stop` IPC using the `default` scope only.
 * Workspace file watching uses {@link startWatchers}(workspaceId, roots) from the main runtime path; these handlers remain for external/tests.
 */
export function registerFileWatcherHandlers(
  webContentsFn: () => WebContents | null,
): void {
  getWebContents = webContentsFn

  ipcMain.handle('fs:watch-start', async (_event, rootPath: string) => {
    console.warn('[fileWatcher] fs:watch-start is legacy; prefer workspace-scoped watchers')
    await startWatcher(rootPath)
  })

  ipcMain.handle('fs:watch-stop', async () => {
    console.warn('[fileWatcher] fs:watch-stop is legacy; stops all scopes')
    await stopWatchers()
  })
}

/**
 * Retrieve watched filesystem root paths.
 *
 * @param scopeId - Optional scope identifier; when provided, returns roots registered for that scope
 * @returns An array of watched root paths: the roots for `scopeId` if given, otherwise all roots across all scopes
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
