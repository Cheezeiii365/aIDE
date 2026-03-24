import { app, BaseWindow, WebContentsView, ipcMain, Menu, dialog } from 'electron'
import { join, basename } from 'path'
import { readdir } from 'fs/promises'
import Store from 'electron-store'
import { IpcChannels, DEFAULT_SETTINGS } from '@aide/shared'
import type { AppSettings, ThemeName, DirEntry } from '@aide/shared'

const store = new Store<AppSettings>({ defaults: DEFAULT_SETTINGS })

let mainWindow: BaseWindow | null = null
let contentView: WebContentsView | null = null

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
        { role: 'toggleDevTools' },
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

app.whenReady().then(() => {
  buildAppMenu()
  createWindow()
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
