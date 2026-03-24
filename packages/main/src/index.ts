import { app, BaseWindow, WebContentsView, ipcMain } from 'electron'
import { join } from 'path'
import { IpcChannels } from '@aide/shared'

let mainWindow: BaseWindow | null = null
let contentView: WebContentsView | null = null

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

app.whenReady().then(createWindow)

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
