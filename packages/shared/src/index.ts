/**
 * Shared types and constants between main and renderer processes.
 * IPC channel definitions go here for type-safe communication.
 */

export type { CommandDefinition } from './commands'
export {
  adjustZoomFactor,
  clampZoomFactor,
  resetZoomFactor,
  roundZoomFactor,
  stepZoomFactor,
  zoomFactorToCssValue,
  zoomFactorToPercent,
  zoomLimits,
} from './zoom'

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

  // Zoom
  BROWSER_ZOOM_GET: 'browser-zoom:get',
  BROWSER_ZOOM_SET: 'browser-zoom:set',
  BROWSER_ZOOM_ADJUST: 'browser-zoom:adjust',
  APP_ZOOM_COMMAND: 'app:zoom-command',

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
  PTY_KILL_WORKSPACE: 'pty:kill-workspace',
  PTY_EXIT: 'pty:exit',

  // Worktrees
  WORKTREE_LIST: 'worktree:list',
  WORKTREE_CREATE: 'worktree:create',
  WORKTREE_REMOVE: 'worktree:remove',
  WORKTREE_SET_ACTIVE: 'worktree:set-active',
  WORKTREE_GET_ACTIVE: 'worktree:get-active',
  WORKTREE_LIST_CHANGED: 'worktree:list-changed',
  WORKTREE_LIST_BRANCHES: 'worktree:list-branches',

  // File listing (quick open)
  FS_LIST_ALL_FILES: 'fs:list-all-files',

  // Search (find in files)
  SEARCH_START: 'search:start',
  SEARCH_RESULTS: 'search:results',
  SEARCH_COMPLETE: 'search:complete',
  SEARCH_CANCEL: 'search:cancel',
  SEARCH_REPLACE: 'search:replace',

  // .aide project folder
  AIDE_INIT: 'aide:init',
  AIDE_INIT_RESULT: 'aide:init-result',
  AIDE_GET_RESOLVED_SETTINGS: 'aide:get-resolved-settings',

  // Gitignore security audit
  GITIGNORE_AUDIT: 'gitignore:audit',
  GITIGNORE_AUDIT_RESULT: 'gitignore:audit-result',
  GITIGNORE_APPEND: 'gitignore:append',
  GITIGNORE_DISMISS: 'gitignore:dismiss',

  // Task system
  TASK_LIST: 'task:list',
  TASK_RUN: 'task:run',
  TASK_KILL: 'task:kill',
  TASK_STATUS_CHANGED: 'task:status-changed',
  TASK_REQUEST_INPUT: 'task:request-input',
  TASK_PROVIDE_INPUT: 'task:provide-input',
  TASK_DIAGNOSTICS: 'task:diagnostics',
  TASK_RELOAD: 'task:reload',
  TASK_AUTO_DETECT: 'task:auto-detect',
  TASK_GENERATE: 'task:generate',

  // Workspace registry
  WORKSPACE_LIST: 'workspace:list',
  WORKSPACE_CREATE: 'workspace:create',
  WORKSPACE_REMOVE: 'workspace:remove',
  WORKSPACE_CLOSE: 'workspace:close',
  WORKSPACE_SWITCH: 'workspace:switch',
  WORKSPACE_UPDATE: 'workspace:update',
  WORKSPACE_REORDER: 'workspace:reorder',
  WORKSPACE_REGISTRY_CHANGED: 'workspace:registry-changed',
  WORKSPACE_GET_ACTIVE: 'workspace:get-active',
  WORKSPACE_CREATE_BLANK: 'workspace:create-blank',
  WORKSPACE_SET_ROOT: 'workspace:set-root',

  // State persistence
  STATE_SAVE: 'state:save',
  STATE_LOAD: 'state:load',
  STATE_SAVE_TERMINALS: 'state:save-terminals',
  STATE_LOAD_TERMINALS: 'state:load-terminals',

  // Browser panes
  BROWSER_CREATE: 'browser:create',
  BROWSER_DESTROY: 'browser:destroy',
  BROWSER_DESTROY_WORKSPACE: 'browser:destroy-workspace',
  BROWSER_NAVIGATE: 'browser:navigate',
  BROWSER_GO_BACK: 'browser:go-back',
  BROWSER_GO_FORWARD: 'browser:go-forward',
  BROWSER_RELOAD: 'browser:reload',
  BROWSER_HOST_UPDATE: 'browser:host-update',
  BROWSER_SUPPRESS_OVERLAYS: 'browser:suppress-overlays',
  BROWSER_UNSUPPRESS_OVERLAYS: 'browser:unsuppress-overlays',
  BROWSER_DID_NAVIGATE: 'browser:did-navigate',
  BROWSER_PAGE_TITLE_UPDATED: 'browser:page-title-updated',
  BROWSER_LOADING_CHANGED: 'browser:loading-changed',
  BROWSER_CAN_NAVIGATE_CHANGED: 'browser:can-navigate-changed',
  BROWSER_FOCUS_CHANGED: 'browser:focus-changed',

  // App lifecycle
  LIFECYCLE_REQUEST_SAVE: 'lifecycle:request-save',
  LIFECYCLE_SAVE_COMPLETE: 'lifecycle:save-complete',
  LIFECYCLE_CRASH_DETECTED: 'lifecycle:crash-detected',
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
  scopeId: string
}

export type GitFileStatus = 'M' | 'A' | '?' | 'D' | 'C'

export interface GitStatusResult {
  files: Record<string, GitFileStatus>
  branch: string
  ignoredPaths?: string[]
}

export interface WorktreeInfo {
  path: string
  branch: string
  isMain: boolean
  isDirty: boolean
  isCurrent: boolean
}

export interface WorktreeCreateOpts {
  branch: string
  createBranch: boolean
  baseBranch?: string
}

export interface AppSettings {
  theme: ThemeName
  sidebarWidth: number
  workspaceRoot: string | null
  activeWorktree: string | null
  editorDefaults?: Partial<AideProjectSettings>
  cleanShutdown?: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'one-dark',
  sidebarWidth: 220,
  workspaceRoot: null,
  activeWorktree: null,
}

// Search types (find in files)
export interface SearchOpts {
  query: string
  rootPath: string
  isRegex: boolean
  caseSensitive: boolean
  wholeWord: boolean
  fileGlob?: string
}

export interface SearchMatch {
  line: number
  column: number
  lineText: string
  matchText: string
}

export interface SearchFileResult {
  filePath: string
  matches: SearchMatch[]
}

export interface ReplaceOpts {
  filePath: string
  replacements: { line: number; column: number; matchText: string; replaceText: string }[]
}

// .aide project settings (committable)
export interface AideProjectSettings {
  tabSize?: number
  insertSpaces?: boolean
  wordWrap?: 'off' | 'on' | 'bounded'
  rulers?: number[]
  fontSize?: number
  fontFamily?: string
  formatOnSave?: boolean
  filesExclude?: Record<string, boolean>
  searchExclude?: Record<string, boolean>
  languageOverrides?: Record<string, Partial<AideProjectSettings>>
}

// Fully resolved settings (no optional fields)
export interface ResolvedSettings {
  tabSize: number
  insertSpaces: boolean
  wordWrap: 'off' | 'on' | 'bounded'
  rulers: number[]
  fontSize: number
  fontFamily: string
  formatOnSave: boolean
  filesExclude: Record<string, boolean>
  searchExclude: Record<string, boolean>
}

// .aide/local/workspace.json
export interface AideLocalWorkspace {
  id: string
  ribbonPosition: number
  icon?: string
  color?: string
  lastOpenedAt: number
  gitignoreAuditDismissed?: boolean
}

export type ProjectType = 'node' | 'typescript' | 'python' | 'rust' | 'go' | 'ruby' | 'unknown'

export interface AideInitResult {
  projectType: ProjectType
  created: boolean
  rootPath: string
}

// Gitignore audit
export interface GitignoreAuditResult {
  missing: { pattern: string; category: string }[]
  total: number
}

// ─── Workspace Registry ──────────────────────────
export interface WorkspaceEntry {
  id: string
  name: string
  rootPath: string | null
  icon?: string
  color?: string
  createdAt: number
  lastOpenedAt: number
}

export interface AppWorkspaceRegistry {
  workspaces: Record<string, WorkspaceEntry>
  workspaceOrder: string[]
  activeWorkspaceId: string | null
  lastSessionWorkspaces: string[]
}

// ─── State Persistence ───────────────────────────
export interface TabState {
  filePath: string
  scrollTop: number
  cursorLine: number
  cursorColumn: number
  foldedRanges: [number, number][]
  isDirty: boolean
  dirtyContent?: string
}

export interface AideLocalState {
  layout: unknown | null
  openTabs: TabState[]
  activeTabPath: string | null
  sidebarWidth: number
  sidebarCollapsed: boolean
  sidebarSections: Record<string, boolean>
  browserPanes?: BrowserPaneState[]
}

export interface TerminalState {
  id: string
  workspaceId: string
  cwd: string
  shell?: string
  title?: string
}

export interface AideLocalTerminals {
  terminals: TerminalState[]
  activeTerminalId: string | null
}

export type BrowserSessionMode = 'shared-auth' | 'workspace' | 'temporary'

export interface BrowserPaneState {
  paneId: string
  workspaceId: string
  sessionMode: BrowserSessionMode
  url: string
  hasLoadedOnce: boolean
  zoomFactor?: number
}

export interface BrowserHostUpdate {
  paneId: string
  workspaceId: string
  bounds: { x: number; y: number; width: number; height: number }
  visible: boolean
  chromeHeight: number
}

export interface BrowserDidNavigatePayload {
  paneId: string
  url: string
}

export interface BrowserPageTitlePayload {
  paneId: string
  title: string
}

export interface BrowserLoadingPayload {
  paneId: string
  loading: boolean
}

export interface BrowserCanNavigatePayload {
  paneId: string
  canGoBack: boolean
  canGoForward: boolean
}

export interface BrowserFocusPayload {
  paneId: string
  focused: boolean
}

export type ZoomCommandAction = 'in' | 'out' | 'reset'

export interface ZoomCommandPayload {
  target: 'panel'
  action: ZoomCommandAction
}

// ─── Task System ─────────────────────────────────
export type TaskGroup = 'build' | 'test' | 'dev' | 'deploy' | 'lint' | 'clean' | 'custom'

export interface TaskPresentation {
  reveal?: 'always' | 'silent' | 'never'
  panel?: 'shared' | 'dedicated' | 'new'
  clear?: boolean
  close?: boolean
  echo?: boolean
  group?: string
}

export interface TaskTrigger {
  event: 'workspaceOpen' | 'fileSave' | 'preCommit'
  filePattern?: string
  delay?: number
}

export interface TaskInput {
  id: string
  type: 'text' | 'pick' | 'confirm'
  description: string
  default?: string
  options?: string[]
}

export interface AideTask {
  id: string
  label: string
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  envFile?: string
  shell?: string
  group?: TaskGroup
  keybinding?: string
  dependsOn?: string[]
  runOn?: TaskTrigger
  problemMatcher?: string | string[]
  isBackground?: boolean
  autoRestart?: boolean
  presentation?: TaskPresentation
  promptBefore?: string
  timeout?: number
  os?: {
    darwin?: Partial<AideTask>
    linux?: Partial<AideTask>
    win32?: Partial<AideTask>
  }
}

export interface CompoundTask {
  id: string
  label: string
  tasks: string[]
  mode: 'parallel' | 'sequence'
  keybinding?: string
  presentation?: {
    reveal?: 'always' | 'silent'
    group?: string
  }
}

export interface AideTasksFile {
  version: 1
  tasks: AideTask[]
  compounds?: CompoundTask[]
  inputs?: TaskInput[]
  defaults?: {
    shell?: string
    env?: Record<string, string>
    presentation?: Partial<TaskPresentation>
  }
}

export type TaskExecutionStatus = 'running' | 'succeeded' | 'failed' | 'killed'

export interface TaskExecution {
  executionId: string
  taskId: string
  taskLabel: string
  status: TaskExecutionStatus
  startedAt: number
  exitCode?: number
  ptyId: string
}

export interface TaskInputRequest {
  requestId: string
  input: TaskInput
  resolvedDescription: string
}

export interface TaskDiagnostic {
  file: string
  line?: number
  column?: number
  severity: 'error' | 'warning' | 'info'
  message: string
  source: string
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

  // Zoom
  getBrowserZoom: (paneId: string) => Promise<number>
  setBrowserZoom: (paneId: string, zoomFactor: number) => Promise<number>
  adjustBrowserZoom: (paneId: string, delta: number) => Promise<number>
  onZoomCommand: (callback: (payload: ZoomCommandPayload) => void) => () => void

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
  ptyCreate: (opts?: { id?: string; workspaceId?: string; cwd?: string; shell?: string; title?: string }) => Promise<{ id: string; scrollback: string }>
  ptyWrite: (id: string, data: string) => void
  ptyResize: (id: string, cols: number, rows: number) => void
  ptyKill: (id: string) => void
  ptyKillWorkspace: (workspaceId: string) => void
  onPtyData: (callback: (id: string, data: string) => void) => () => void
  onPtyExit: (callback: (id: string, exitCode: number) => void) => () => void

  // Worktrees
  listWorktrees: () => Promise<WorktreeInfo[]>
  createWorktree: (opts: WorktreeCreateOpts) => Promise<{ path: string } | { error: string }>
  removeWorktree: (worktreePath: string) => Promise<{ success: true } | { error: string }>
  setActiveWorktree: (worktreePath: string | null) => Promise<void>
  getActiveWorktree: () => Promise<string | null>
  onWorktreeListChanged: (callback: (worktrees: WorktreeInfo[]) => void) => () => void
  listBranches: () => Promise<string[]>

  // File listing (quick open)
  listAllFiles: (rootPath: string) => Promise<string[]>

  // Search (find in files)
  searchStart: (opts: SearchOpts) => Promise<void>
  onSearchResults: (callback: (results: SearchFileResult[]) => void) => () => void
  onSearchComplete: (callback: (summary: { totalMatches: number; totalFiles: number }) => void) => () => void
  searchCancel: () => void
  searchReplace: (opts: ReplaceOpts) => Promise<{ success: true; skipped: number } | { error: string }>

  // .aide project folder
  aideInit: () => Promise<AideInitResult | { error: string }>
  getResolvedSettings: () => Promise<ResolvedSettings>
  onAideInitResult: (callback: (result: AideInitResult) => void) => () => void

  // Gitignore security audit
  auditGitignore: () => Promise<GitignoreAuditResult>
  appendToGitignore: (patterns: string[]) => Promise<void>
  dismissGitignoreAudit: () => Promise<void>
  onGitignoreAuditResult: (callback: (result: GitignoreAuditResult) => void) => () => void

  // Task system
  listTasks: () => Promise<{ tasks: AideTask[]; compounds: CompoundTask[] }>
  runTask: (taskId: string) => Promise<{ executionId: string } | { error: string }>
  killTask: (executionId: string) => void
  reloadTasks: () => Promise<void>
  generateTasks: () => Promise<{ success: true } | { error: string }>
  provideTaskInput: (requestId: string, value: string | null) => void
  onTaskStatusChanged: (callback: (execution: TaskExecution) => void) => () => void
  onTaskRequestInput: (callback: (request: TaskInputRequest) => void) => () => void
  onTaskDiagnostics: (callback: (diagnostics: TaskDiagnostic[]) => void) => () => void
  onTaskAutoDetect: (callback: (tasks: AideTask[]) => void) => () => void

  // Workspace registry
  listWorkspaces: () => Promise<WorkspaceEntry[]>
  createWorkspace: (rootPath: string) => Promise<WorkspaceEntry>
  createBlankWorkspace: () => Promise<WorkspaceEntry>
  removeWorkspace: (id: string) => Promise<void>
  closeWorkspace: (id: string) => Promise<void>
  switchWorkspace: (id: string) => Promise<void>
  updateWorkspace: (id: string, patch: Partial<Pick<WorkspaceEntry, 'name' | 'icon' | 'color'>>) => Promise<void>
  reorderWorkspaces: (ids: string[]) => Promise<void>
  setWorkspaceRoot: (id: string, rootPath: string) => Promise<void>
  getActiveWorkspaceId: () => Promise<string | null>
  onWorkspaceRegistryChanged: (callback: (workspaces: WorkspaceEntry[]) => void) => () => void

  // State persistence
  saveWorkspaceState: (rootPath: string, state: AideLocalState) => Promise<void>
  loadWorkspaceState: (rootPath: string) => Promise<AideLocalState | null>
  saveTerminalState: (rootPath: string, state: AideLocalTerminals) => Promise<void>
  loadTerminalState: (rootPath: string) => Promise<AideLocalTerminals | null>

  // Browser panes
  browserCreate: (paneId: string, workspaceId: string, sessionMode: BrowserSessionMode) => Promise<{ success: true } | { error: string }>
  browserDestroy: (paneId: string) => void
  browserDestroyWorkspace: (workspaceId: string) => void
  browserNavigate: (paneId: string, url: string) => Promise<{ success: true; url: string } | { error: string }>
  browserGoBack: (paneId: string) => void
  browserGoForward: (paneId: string) => void
  browserReload: (paneId: string) => void
  browserHostUpdate: (update: BrowserHostUpdate) => void
  browserSuppressOverlays: () => void
  browserUnsuppressOverlays: () => void
  onBrowserDidNavigate: (callback: (payload: BrowserDidNavigatePayload) => void) => () => void
  onBrowserTitleUpdated: (callback: (payload: BrowserPageTitlePayload) => void) => () => void
  onBrowserLoadingChanged: (callback: (payload: BrowserLoadingPayload) => void) => () => void
  onBrowserCanNavigateChanged: (callback: (payload: BrowserCanNavigatePayload) => void) => () => void
  onBrowserFocusChanged: (callback: (payload: BrowserFocusPayload) => void) => () => void

  // App lifecycle
  onLifecycleRequestSave: (callback: () => void) => () => void
  lifecycleSaveComplete: () => void
  onCrashDetected: (callback: () => void) => () => void

  // Platform info
  platform: NodeJS.Platform
}
