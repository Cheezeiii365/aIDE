import { subscribe, type AsyncSubscription } from '@parcel/watcher'
import { ipcMain, type WebContents } from 'electron'
import { stat } from 'fs/promises'
import { IpcChannels } from '@aide/shared'
import type { FsWatchEvent, FsEventType } from '@aide/shared'

let activeSubscription: AsyncSubscription | null = null
let watchedRoot: string | null = null
let eventBuffer: FsWatchEvent[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
const knownDirectories = new Set<string>()

const IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'out',
  '__pycache__',
  '.pytest_cache',
  '**/.DS_Store',
  '**/Thumbs.db',
]

const DEBOUNCE_MS = 150
const BULK_DEBOUNCE_MS = 500
const BULK_THRESHOLD = 50
const MAX_RETRIES = 3

let getWebContents: (() => WebContents | null) | null = null

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

async function resolveIsDirectory(
  filePath: string,
  eventType: FsEventType,
): Promise<boolean> {
  if (eventType === 'delete') {
    // Path no longer exists — check our cache
    const wasDir = knownDirectories.has(filePath)
    knownDirectories.delete(filePath)
    return wasDir
  }

  try {
    const info = await stat(filePath)
    const isDir = info.isDirectory()
    if (isDir) {
      knownDirectories.add(filePath)
    } else {
      knownDirectories.delete(filePath)
    }
    return isDir
  } catch {
    // File may have been deleted between event and stat
    return false
  }
}

async function startSubscription(rootPath: string, retryCount = 0): Promise<void> {
  try {
    activeSubscription = await subscribe(
      rootPath,
      async (err, events) => {
        if (err) {
          console.error('[fileWatcher] Watcher error:', err)
          return
        }

        for (const event of events) {
          const type = event.type as FsEventType
          const isDirectory = await resolveIsDirectory(event.path, type)
          eventBuffer.push({ type, path: event.path, isDirectory })
        }

        scheduleFlush()
      },
      { ignore: IGNORE_PATTERNS },
    )

    watchedRoot = rootPath
    console.log(`[fileWatcher] Watching: ${rootPath}`)
  } catch (err) {
    console.error(`[fileWatcher] Failed to start (attempt ${retryCount + 1}):`, err)
    if (retryCount < MAX_RETRIES) {
      const delay = Math.pow(2, retryCount + 1) * 1000
      setTimeout(() => startSubscription(rootPath, retryCount + 1), delay)
    } else {
      console.error('[fileWatcher] Max retries reached, giving up')
    }
  }
}

export async function startWatcher(rootPath: string): Promise<void> {
  await stopWatcher()
  await startSubscription(rootPath)
}

export async function stopWatcher(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  eventBuffer = []

  if (activeSubscription) {
    try {
      await activeSubscription.unsubscribe()
    } catch (err) {
      console.error('[fileWatcher] Error unsubscribing:', err)
    }
    activeSubscription = null
  }

  watchedRoot = null
  knownDirectories.clear()
}

export function registerFileWatcherHandlers(
  webContentsFn: () => WebContents | null,
): void {
  getWebContents = webContentsFn

  // Auto-start watcher if a workspace root is provided
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
