import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels } from '@aide/shared'

/**
 * Exposes a typed API to the renderer process via contextBridge.
 * The renderer accesses these through `window.api`.
 */
contextBridge.exposeInMainWorld('api', {
  // Window controls (frameless window needs these)
  minimizeWindow: () => ipcRenderer.send(IpcChannels.WINDOW_MINIMIZE),
  maximizeWindow: () => ipcRenderer.send(IpcChannels.WINDOW_MAXIMIZE),
  closeWindow: () => ipcRenderer.send(IpcChannels.WINDOW_CLOSE),

  // Platform info (for conditional UI like traffic lights)
  platform: process.platform,
})
