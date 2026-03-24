import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels } from '@aide/shared'
import type { ThemeName, WindowApi } from '@aide/shared'

const api: WindowApi = {
  // Window controls (frameless window needs these)
  minimizeWindow: () => ipcRenderer.send(IpcChannels.WINDOW_MINIMIZE),
  maximizeWindow: () => ipcRenderer.send(IpcChannels.WINDOW_MAXIMIZE),
  closeWindow: () => ipcRenderer.send(IpcChannels.WINDOW_CLOSE),

  // Theme
  getTheme: (): Promise<ThemeName> => ipcRenderer.invoke(IpcChannels.THEME_GET),
  setTheme: (theme: ThemeName): Promise<void> => ipcRenderer.invoke(IpcChannels.THEME_SET, theme),
  onThemeChanged: (callback: (theme: ThemeName) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, theme: ThemeName) => callback(theme)
    ipcRenderer.on(IpcChannels.THEME_CHANGED, handler)
    return () => ipcRenderer.removeListener(IpcChannels.THEME_CHANGED, handler)
  },

  // Fullscreen
  onFullscreenChanged: (callback: (isFullscreen: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, isFullscreen: boolean) => callback(isFullscreen)
    ipcRenderer.on(IpcChannels.FULLSCREEN_CHANGED, handler)
    return () => ipcRenderer.removeListener(IpcChannels.FULLSCREEN_CHANGED, handler)
  },

  // Sidebar width
  getSidebarWidth: () => ipcRenderer.invoke(IpcChannels.SIDEBAR_WIDTH_GET),
  setSidebarWidth: (width: number) => ipcRenderer.invoke(IpcChannels.SIDEBAR_WIDTH_SET, width),

  // Workspace
  openWorkspaceDialog: () => ipcRenderer.invoke(IpcChannels.FS_OPEN_WORKSPACE),
  getWorkspaceRoot: () => ipcRenderer.invoke(IpcChannels.WORKSPACE_ROOT_GET),

  // Filesystem
  readDir: (dirPath: string) => ipcRenderer.invoke(IpcChannels.FS_READ_DIR, dirPath),
  readFile: (filePath: string) => ipcRenderer.invoke(IpcChannels.FS_READ_FILE, filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke(IpcChannels.FS_WRITE_FILE, filePath, content),

  // Terminal
  ptyCreate: (opts?: { cwd?: string; shell?: string }) =>
    ipcRenderer.invoke(IpcChannels.PTY_CREATE, opts),
  ptyWrite: (id: string, data: string) =>
    ipcRenderer.send(IpcChannels.PTY_DATA_IN, id, data),
  ptyResize: (id: string, cols: number, rows: number) =>
    ipcRenderer.send(IpcChannels.PTY_RESIZE, id, cols, rows),
  ptyKill: (id: string) =>
    ipcRenderer.send(IpcChannels.PTY_KILL, id),
  onPtyData: (callback: (id: string, data: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, id: string, data: string) =>
      callback(id, data)
    ipcRenderer.on(IpcChannels.PTY_DATA_OUT, handler)
    return () => ipcRenderer.removeListener(IpcChannels.PTY_DATA_OUT, handler)
  },
  onPtyExit: (callback: (id: string, exitCode: number) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, id: string, exitCode: number) =>
      callback(id, exitCode)
    ipcRenderer.on(IpcChannels.PTY_EXIT, handler)
    return () => ipcRenderer.removeListener(IpcChannels.PTY_EXIT, handler)
  },

  // Platform info (for conditional UI like traffic lights)
  platform: process.platform,
}

contextBridge.exposeInMainWorld('api', api)
