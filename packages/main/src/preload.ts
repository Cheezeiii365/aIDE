import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels } from '@aide/shared'
import type { ThemeName, FsWatchEvent, GitStatusResult, WorktreeInfo, WorktreeCreateOpts, WindowApi } from '@aide/shared'

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
  createFile: (filePath: string) => ipcRenderer.invoke(IpcChannels.FS_CREATE_FILE, filePath),
  createDir: (dirPath: string) => ipcRenderer.invoke(IpcChannels.FS_CREATE_DIR, dirPath),
  deleteEntry: (entryPath: string) => ipcRenderer.invoke(IpcChannels.FS_DELETE, entryPath),
  renameEntry: (oldPath: string, newPath: string) => ipcRenderer.invoke(IpcChannels.FS_RENAME, oldPath, newPath),
  revealInFinder: (filePath: string) => ipcRenderer.send(IpcChannels.FS_REVEAL_IN_FINDER, filePath),

  // File watcher
  onFsWatchEvent: (callback: (events: FsWatchEvent[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, events: FsWatchEvent[]) => callback(events)
    ipcRenderer.on(IpcChannels.FS_WATCH_EVENT, handler)
    return () => ipcRenderer.removeListener(IpcChannels.FS_WATCH_EVENT, handler)
  },

  // Git
  getGitStatus: () => ipcRenderer.invoke(IpcChannels.GIT_STATUS),
  onGitStatusChanged: (callback: (status: GitStatusResult) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: GitStatusResult) => callback(status)
    ipcRenderer.on(IpcChannels.GIT_STATUS_CHANGED, handler)
    return () => ipcRenderer.removeListener(IpcChannels.GIT_STATUS_CHANGED, handler)
  },
  onGitBranchChanged: (callback: (branch: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, branch: string) => callback(branch)
    ipcRenderer.on(IpcChannels.GIT_BRANCH_CHANGED, handler)
    return () => ipcRenderer.removeListener(IpcChannels.GIT_BRANCH_CHANGED, handler)
  },

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

  // Worktrees
  listWorktrees: () => ipcRenderer.invoke(IpcChannels.WORKTREE_LIST),
  createWorktree: (opts: WorktreeCreateOpts) =>
    ipcRenderer.invoke(IpcChannels.WORKTREE_CREATE, opts),
  removeWorktree: (worktreePath: string) =>
    ipcRenderer.invoke(IpcChannels.WORKTREE_REMOVE, worktreePath),
  setActiveWorktree: (worktreePath: string | null) =>
    ipcRenderer.invoke(IpcChannels.WORKTREE_SET_ACTIVE, worktreePath),
  getActiveWorktree: () => ipcRenderer.invoke(IpcChannels.WORKTREE_GET_ACTIVE),
  onWorktreeListChanged: (callback: (worktrees: WorktreeInfo[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, worktrees: WorktreeInfo[]) =>
      callback(worktrees)
    ipcRenderer.on(IpcChannels.WORKTREE_LIST_CHANGED, handler)
    return () => ipcRenderer.removeListener(IpcChannels.WORKTREE_LIST_CHANGED, handler)
  },
  listBranches: () => ipcRenderer.invoke(IpcChannels.WORKTREE_LIST_BRANCHES),

  // Platform info (for conditional UI like traffic lights)
  platform: process.platform,
}

contextBridge.exposeInMainWorld('api', api)
