/**
 * Shared types and constants between main and renderer processes.
 * IPC channel definitions go here for type-safe communication.
 */

// IPC channel names — both main and renderer import these
// to ensure channel strings stay in sync.
export const IpcChannels = {
  // Window controls
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',

  // Theme
  THEME_GET: 'theme:get',
  THEME_SET: 'theme:set',
  THEME_CHANGED: 'theme:changed',

  // Fullscreen
  FULLSCREEN_CHANGED: 'fullscreen:changed',

  // Sidebar width persistence
  SIDEBAR_WIDTH_GET: 'sidebar-width:get',
  SIDEBAR_WIDTH_SET: 'sidebar-width:set',

  // Workspace
  FS_OPEN_WORKSPACE: 'fs:open-workspace',
  WORKSPACE_ROOT_GET: 'workspace-root:get',

  // Filesystem
  FS_READ_DIR: 'fs:read-dir',
  FS_READ_FILE: 'fs:read-file',
  FS_WRITE_FILE: 'fs:write-file',
  FS_CREATE_FILE: 'fs:create-file',
  FS_CREATE_DIR: 'fs:create-dir',
  FS_DELETE: 'fs:delete',
  FS_RENAME: 'fs:rename',
  FS_REVEAL_IN_FINDER: 'fs:reveal-in-finder',

  // File watcher
  FS_WATCH_EVENT: 'fs:watch-event',

  // Git
  GIT_STATUS: 'git:status',
  GIT_STATUS_CHANGED: 'git:status-changed',
  GIT_BRANCH_CHANGED: 'git:branch-changed',

  // Terminal / PTY
  PTY_CREATE: 'pty:create',
  PTY_DATA_IN: 'pty:data-in',
  PTY_DATA_OUT: 'pty:data-out',
  PTY_RESIZE: 'pty:resize',
  PTY_KILL: 'pty:kill',
  PTY_EXIT: 'pty:exit',
} as const

export type ThemeName = 'one-dark' | 'one-light'

export interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
}

export type FsEventType = 'create' | 'update' | 'delete'

export interface FsWatchEvent {
  type: FsEventType
  path: string
  isDirectory: boolean
}

export type GitFileStatus = 'M' | 'A' | '?' | 'D'

export interface GitStatusResult {
  files: Record<string, GitFileStatus>
  branch: string
}

export interface AppSettings {
  theme: ThemeName
  sidebarWidth: number
  workspaceRoot: string | null
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'one-dark',
  sidebarWidth: 220,
  workspaceRoot: null,
}

/** Single source of truth for the preload bridge API shape. */
export interface WindowApi {
  // Window controls
  minimizeWindow: () => void
  maximizeWindow: () => void
  closeWindow: () => void

  // Theme
  getTheme: () => Promise<ThemeName>
  setTheme: (theme: ThemeName) => Promise<void>
  onThemeChanged: (callback: (theme: ThemeName) => void) => () => void

  // Fullscreen
  onFullscreenChanged: (callback: (isFullscreen: boolean) => void) => () => void

  // Sidebar width
  getSidebarWidth: () => Promise<number>
  setSidebarWidth: (width: number) => Promise<void>

  // Workspace
  openWorkspaceDialog: () => Promise<string | null>
  getWorkspaceRoot: () => Promise<string | null>

  // Filesystem
  readDir: (dirPath: string) => Promise<DirEntry[]>
  readFile: (filePath: string) => Promise<{ content: string } | { error: string }>
  writeFile: (filePath: string, content: string) => Promise<{ success: true } | { error: string }>
  createFile: (filePath: string) => Promise<{ success: true } | { error: string }>
  createDir: (dirPath: string) => Promise<{ success: true } | { error: string }>
  deleteEntry: (entryPath: string) => Promise<{ success: true } | { error: string }>
  renameEntry: (oldPath: string, newPath: string) => Promise<{ success: true } | { error: string }>
  revealInFinder: (filePath: string) => void

  // File watcher
  onFsWatchEvent: (callback: (events: FsWatchEvent[]) => void) => () => void

  // Git
  getGitStatus: () => Promise<GitStatusResult | null>
  onGitStatusChanged: (callback: (status: GitStatusResult) => void) => () => void
  onGitBranchChanged: (callback: (branch: string) => void) => () => void

  // Terminal
  ptyCreate: (opts?: { cwd?: string; shell?: string }) => Promise<{ id: string }>
  ptyWrite: (id: string, data: string) => void
  ptyResize: (id: string, cols: number, rows: number) => void
  ptyKill: (id: string) => void
  onPtyData: (callback: (id: string, data: string) => void) => () => void
  onPtyExit: (callback: (id: string, exitCode: number) => void) => () => void

  // Platform info
  platform: NodeJS.Platform
}
