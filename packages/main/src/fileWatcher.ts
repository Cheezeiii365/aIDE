import { watch, type FSWatcher } from 'fs'
import { stat } from 'fs/promises'
import { join } from 'path'
import { ipcMain, type WebContents } from 'electron'
import { IpcChannels } from '@aide/shared'
import type { FsWatchEvent, FsEventType } from '@aide/shared'

let activeWatcher: FSWatcher | null = null
let watchedRoot: string | null = null
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

async function handleFsEvent(eventType: string, filename: string | null) {
  if (!filename || !watchedRoot) return
  if (shouldIgnore(filename)) return

  const fullPath = join(watchedRoot, filename)

  // Deduplicate: fs.watch can fire multiple events for the same file change
  if (pendingPaths.has(fullPath)) return
  pendingPaths.add(fullPath)
  // Clear dedup after a short window
  setTimeout(() => pendingPaths.delete(fullPath), 50)

  const { type, isDirectory } = await resolveEvent(fullPath)
  eventBuffer.push({ type, path: fullPath, isDirectory })
  scheduleFlush()
}

function startSubscription(rootPath: string): void {
  try {
    activeWatcher = watch(rootPath, { recursive: true }, (eventType, filename) => {
      handleFsEvent(eventType, filename)
    })

    activeWatcher.on('error', (err) => {
      console.error('[fileWatcher] Watcher error:', err)
    })

    watchedRoot = rootPath
    console.log(`[fileWatcher] Watching: ${rootPath}`)
  } catch (err) {
    console.error('[fileWatcher] Failed to start:', err)
  }
}

export async function startWatcher(rootPath: string): Promise<void> {
  await stopWatcher()
  startSubscription(rootPath)
}

export async function stopWatcher(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  eventBuffer = []
  pendingPaths.clear()

  if (activeWatcher) {
    activeWatcher.close()
    activeWatcher = null
  }

  watchedRoot = null
  knownDirectories.clear()
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

export function getWatchedRoot(): string | null {
  return watchedRoot
}
