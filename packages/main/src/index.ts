import { app, BaseWindow, WebContentsView, ipcMain, Menu, dialog, shell, session } from 'electron'
import { join, dirname, relative } from 'path'
import { existsSync, readdirSync, statSync } from 'fs'
import { execFile } from 'child_process'
import { readdir, readFile, writeFile as fsWriteFile, stat, mkdir, rm, rename } from 'fs/promises'
import Store from 'electron-store'
import { IpcChannels, DEFAULT_SETTINGS } from '@aide/shared'
import type { AppSettings, ThemeName, DirEntry, SearchOpts, ReplaceOpts } from '@aide/shared'
import { registerPtyHandlers, killAllPtys } from './ptyManager'
import { registerFileWatcherHandlers, startWatcher, stopWatcher } from './fileWatcher'
import { registerGitStatusHandlers, startGitPolling, stopGitPolling } from './gitStatus'
import { registerWorktreeHandlers, startWorktreePolling, stopWorktreePolling } from './worktreeManager'
import { startSearch, cancelSearch } from './ripgrepSearch'

const store = new Store<AppSettings>({ defaults: DEFAULT_SETTINGS })

let mainWindow: BaseWindow | null = null
let contentView: WebContentsView | null = null

/**
 * Builds and installs the application's native menu with platform-appropriate entries.
 *
 * Includes standard Edit, View, and Window menus. On macOS an application menu with
 * About/Hide/Quit items is added. The View menu contains a "Toggle Developer Tools"
 * item that toggles the renderer devtools (accelerator: Cmd+Option+I on macOS, Ctrl+Shift+I otherwise).
 */
function buildAppMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: 'Toggle Developer Tools',
          accelerator: process.platform === 'darwin' ? 'Cmd+Option+I' : 'Ctrl+Shift+I',
          click: () => {
            contentView?.webContents.toggleDevTools()
          },
        },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [{ type: 'separator' as const }, { role: 'front' as const }]
          : [{ role: 'close' as const }]),
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): void {
  mainWindow = new BaseWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    show: false,
  })

  contentView = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, 'preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.contentView.addChildView(contentView)

  // Set CSP via session headers — works reliably for both http:// and file:// protocols
  const isDev = !!process.env.ELECTRON_RENDERER_URL
  const csp = isDev
    ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:*"
    : "default-src 'self' file:; script-src 'self' file:; style-src 'self' 'unsafe-inline' file:"
  contentView.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    })
  })

  // Fill the window with the content view
  const resizeContentView = () => {
    if (!mainWindow || !contentView) return
    const { width, height } = mainWindow.getContentBounds()
    contentView.setBounds({ x: 0, y: 0, width, height })
  }

  mainWindow.on('resize', resizeContentView)
  resizeContentView()

  // Load the renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    contentView.webContents.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    contentView.webContents.loadFile(
      join(__dirname, '../../renderer/dist/index.html'),
    )
  }

  // Forward fullscreen state to renderer
  mainWindow.on('enter-full-screen', () => {
    contentView?.webContents.send(IpcChannels.FULLSCREEN_CHANGED, true)
  })
  mainWindow.on('leave-full-screen', () => {
    contentView?.webContents.send(IpcChannels.FULLSCREEN_CHANGED, false)
  })

  // BaseWindow doesn't fire 'ready-to-show' — listen on the
  // WebContentsView's webContents instead.
  contentView.webContents.once('did-finish-load', () => {
    resizeContentView()
    mainWindow?.show()
  })
}

// Window control IPC handlers
ipcMain.on(IpcChannels.WINDOW_MINIMIZE, () => mainWindow?.minimize())
ipcMain.on(IpcChannels.WINDOW_MAXIMIZE, () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})
ipcMain.on(IpcChannels.WINDOW_CLOSE, () => mainWindow?.close())

// Theme IPC handlers
ipcMain.handle(IpcChannels.THEME_GET, () => store.get('theme'))
ipcMain.handle(IpcChannels.THEME_SET, (_event, theme: ThemeName) => {
  store.set('theme', theme)
  contentView?.webContents.send(IpcChannels.THEME_CHANGED, theme)
})

// Sidebar width IPC handlers
ipcMain.handle(IpcChannels.SIDEBAR_WIDTH_GET, () => store.get('sidebarWidth'))
ipcMain.handle(IpcChannels.SIDEBAR_WIDTH_SET, (_event, width: number) => {
  store.set('sidebarWidth', width)
})

// Workspace IPC handlers
ipcMain.handle(IpcChannels.FS_OPEN_WORKSPACE, async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const selected = result.filePaths[0]
  store.set('workspaceRoot', selected)
  store.set('activeWorktree', null)
  await startWatcher(selected)
  const getWc = () => contentView?.webContents ?? null
  await startGitPolling(selected, getWc)
  await startWorktreePolling(selected, getWc, store)
  return selected
})

ipcMain.handle(IpcChannels.WORKSPACE_ROOT_GET, () => store.get('workspaceRoot'))

// Filesystem IPC handlers
const HIDDEN_FILES = new Set(['.DS_Store', 'Thumbs.db'])

ipcMain.handle(IpcChannels.FS_READ_DIR, async (_event, dirPath: string): Promise<DirEntry[] | { error: string }> => {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    const mapped: DirEntry[] = entries
      .filter((e) => !HIDDEN_FILES.has(e.name))
      .map((e) => ({
        name: e.name,
        path: join(dirPath, e.name),
        isDirectory: e.isDirectory(),
      }))
    // Sort: directories first, then alphabetical (case-insensitive)
    mapped.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
    return mapped
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error reading directory'
    return { error: message }
  }
})

// Read file IPC handler — enforces 10 MB limit, rejects binary files
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

ipcMain.handle(IpcChannels.FS_READ_FILE, async (_event, filePath: string): Promise<{ content: string } | { error: string }> => {
  try {
    const info = await stat(filePath)
    if (!info.isFile()) return { error: 'Not a file' }
    if (info.size > MAX_FILE_SIZE) return { error: `File too large (${(info.size / 1024 / 1024).toFixed(1)} MB). Maximum is 10 MB.` }

    const content = await readFile(filePath, 'utf-8')

    // Check for binary content (null bytes in first 8 KB)
    const sample = content.slice(0, 8192)
    if (sample.includes('\0')) return { error: 'Binary file — cannot display' }

    return { content }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error reading file'
    return { error: message }
  }
})

// Write file IPC handler
ipcMain.handle(IpcChannels.FS_WRITE_FILE, async (_event, filePath: string, content: string): Promise<{ success: true } | { error: string }> => {
  try {
    await fsWriteFile(filePath, content, 'utf-8')
    return { success: true }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error writing file'
    return { error: message }
  }
})

// Create file IPC handler
ipcMain.handle(IpcChannels.FS_CREATE_FILE, async (_event, filePath: string): Promise<{ success: true } | { error: string }> => {
  try {
    // Check if already exists
    try {
      await stat(filePath)
      return { error: 'File already exists' }
    } catch {
      // Expected — file doesn't exist yet
    }
    // Ensure parent directory exists
    await mkdir(dirname(filePath), { recursive: true })
    await fsWriteFile(filePath, '', 'utf-8')
    return { success: true }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error creating file'
    return { error: message }
  }
})

// Create directory IPC handler
ipcMain.handle(IpcChannels.FS_CREATE_DIR, async (_event, dirPath: string): Promise<{ success: true } | { error: string }> => {
  try {
    await mkdir(dirPath)
    return { success: true }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error creating directory'
    return { error: message }
  }
})

// Delete file or directory IPC handler
ipcMain.handle(IpcChannels.FS_DELETE, async (_event, entryPath: string): Promise<{ success: true } | { error: string }> => {
  try {
    await rm(entryPath, { recursive: true })
    return { success: true }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error deleting'
    return { error: message }
  }
})

// Rename file or directory IPC handler
ipcMain.handle(IpcChannels.FS_RENAME, async (_event, oldPath: string, newPath: string): Promise<{ success: true } | { error: string }> => {
  try {
    // Check if target already exists
    try {
      await stat(newPath)
      return { error: 'A file or folder with that name already exists' }
    } catch {
      // Expected — target doesn't exist
    }
    await rename(oldPath, newPath)
    return { success: true }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error renaming'
    return { error: message }
  }
})

// Reveal in Finder / file manager
ipcMain.on(IpcChannels.FS_REVEAL_IN_FINDER, (_event, filePath: string) => {
  shell.showItemInFolder(filePath)
})

// List all files (quick open) — uses `git ls-files` for speed, falls back to recursive readdir
ipcMain.handle(IpcChannels.FS_LIST_ALL_FILES, async (_event, rootPath: string): Promise<string[]> => {
  // Try git ls-files first (fast, respects .gitignore)
  if (existsSync(join(rootPath, '.git'))) {
    try {
      const files = await new Promise<string[]>((resolve, reject) => {
        execFile('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: rootPath, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
          if (err) return reject(err)
          resolve(stdout.trim().split('\n').filter(Boolean))
        })
      })
      return files
    } catch {
      // fall through to readdir
    }
  }

  // Fallback: recursive readdir
  const SKIP = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'out', '__pycache__'])
  const results: string[] = []

  function walk(dir: string) {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (SKIP.has(entry.name) || entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else {
        results.push(relative(rootPath, full))
      }
    }
  }

  walk(rootPath)
  return results
})

// Search (find in files) — ripgrep-backed
ipcMain.handle(IpcChannels.SEARCH_START, (_event, opts: SearchOpts) => {
  startSearch(
    opts,
    (results) => contentView?.webContents.send(IpcChannels.SEARCH_RESULTS, results),
    (summary) => contentView?.webContents.send(IpcChannels.SEARCH_COMPLETE, summary),
  )
})

ipcMain.on(IpcChannels.SEARCH_CANCEL, () => {
  cancelSearch()
})

ipcMain.handle(IpcChannels.SEARCH_REPLACE, async (_event, opts: ReplaceOpts) => {
  try {
    const content = await readFile(opts.filePath, 'utf-8')
    const lines = content.split('\n')

    // Apply replacements in reverse order to preserve line/column positions
    const sorted = [...opts.replacements].sort((a, b) => {
      if (a.line !== b.line) return b.line - a.line
      return b.column - a.column
    })

    for (const rep of sorted) {
      const lineIdx = rep.line - 1
      if (lineIdx < 0 || lineIdx >= lines.length) continue
      const line = lines[lineIdx]
      const colIdx = rep.column - 1
      if (colIdx < 0 || colIdx > line.length) continue
      const before = line.slice(0, colIdx)
      const after = line.slice(colIdx + rep.matchText.length)
      lines[lineIdx] = before + rep.replaceText + after
    }

    await fsWriteFile(opts.filePath, lines.join('\n'))
    return { success: true as const }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { error: message }
  }
})

app.whenReady().then(async () => {
  buildAppMenu()
  createWindow()
  registerPtyHandlers(() => contentView?.webContents ?? null, store)
  registerFileWatcherHandlers(() => contentView?.webContents ?? null)

  const getWebContents = () => contentView?.webContents ?? null
  registerGitStatusHandlers(getWebContents)
  registerWorktreeHandlers(getWebContents, store)

  // Auto-start watcher if we have a persisted workspace
  const savedRoot = store.get('workspaceRoot')
  if (savedRoot && existsSync(savedRoot)) {
    // Use active worktree root for file watcher and git polling if set
    const activeWorktree = store.get('activeWorktree')
    const effectiveRoot = activeWorktree && existsSync(activeWorktree) ? activeWorktree : savedRoot
    await startWatcher(effectiveRoot)
    await startGitPolling(effectiveRoot, getWebContents)
    await startWorktreePolling(savedRoot, getWebContents, store)
  } else if (savedRoot) {
    console.warn(`[startup] Persisted workspace root no longer exists: ${savedRoot}`)
    store.set('workspaceRoot', '')
    store.set('activeWorktree', '')
  }
})

app.on('before-quit', async () => {
  killAllPtys()
  stopGitPolling()
  stopWorktreePolling()
  await stopWatcher()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (!mainWindow) {
    createWindow()
  }
})
