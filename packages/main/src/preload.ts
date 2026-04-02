import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels } from '@aide/shared'
import type {
  ThemeName, FsWatchEvent, GitStatusResult, GitignoreAuditResult, WorktreeInfo, WorktreeCreateOpts, SearchOpts,
  ReplaceOpts, ResolvedSettings,
  AideProjectSettings, AideInitResult, AideTask, CompoundTask, TaskExecution, TaskInputRequest, TaskRunContext,
  TaskTriggerResult, WorkspaceEntry, AideLocalState, AideLocalTerminals, WindowApi, BrowserSessionMode,
  BrowserHostUpdate, BrowserDidNavigatePayload, BrowserPageTitlePayload, BrowserLoadingPayload, BrowserCanNavigatePayload,
  BrowserFocusPayload, ZoomCommandPayload, KeybindingRule, ChatMode, ChatSession, ChatStreamChunk, ChatStreamEnd,
  ChatToolCallPayload, PendingToolApprovalInfo, McpServerStatus, ToolDefinition, AgentBackend, CliAgentStreamDelta, CliAgentMessage, CliAgentSession,
  CliAgentStatusPayload, CliAgentResultPayload, CliAgentMessagePayload, ConversationMeta, ConversationCreateOpts,
  ConversationListChangedPayload, GitStatusChangedPayload, GitBranchChangedPayload, WorktreeListChangedPayload,
  SearchResultsPayload, SearchCompletePayload, GitignoreAuditIpcPayload, TaskDiagnosticsPayload, TaskAutoDetectPayload,
  PtyDataOutPayload, PtyExitPayload,
} from '@aide/shared'

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

  // Zoom
  getBrowserZoom: (paneId: string) => ipcRenderer.invoke(IpcChannels.BROWSER_ZOOM_GET, paneId),
  setBrowserZoom: (paneId: string, zoomFactor: number) => ipcRenderer.invoke(IpcChannels.BROWSER_ZOOM_SET, paneId, zoomFactor),
  adjustBrowserZoom: (paneId: string, delta: number) => ipcRenderer.invoke(IpcChannels.BROWSER_ZOOM_ADJUST, paneId, delta),
  onZoomCommand: (callback: (payload: ZoomCommandPayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ZoomCommandPayload) => callback(payload)
    ipcRenderer.on(IpcChannels.APP_ZOOM_COMMAND, handler)
    return () => ipcRenderer.removeListener(IpcChannels.APP_ZOOM_COMMAND, handler)
  },

  // Sidebar width
  getSidebarWidth: () => ipcRenderer.invoke(IpcChannels.SIDEBAR_WIDTH_GET),
  setSidebarWidth: (width: number) => ipcRenderer.invoke(IpcChannels.SIDEBAR_WIDTH_SET, width),

  // Workspace
  openWorkspaceDialog: () => ipcRenderer.invoke(IpcChannels.FS_OPEN_WORKSPACE),
  getWorkspaceRoot: (workspaceId?: string) =>
    ipcRenderer.invoke(IpcChannels.WORKSPACE_ROOT_GET, workspaceId),

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
  getGitStatus: (workspaceId: string) => ipcRenderer.invoke(IpcChannels.GIT_STATUS, workspaceId),
  onGitStatusChanged: (callback: (payload: GitStatusChangedPayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: GitStatusChangedPayload) => callback(payload)
    ipcRenderer.on(IpcChannels.GIT_STATUS_CHANGED, handler)
    return () => ipcRenderer.removeListener(IpcChannels.GIT_STATUS_CHANGED, handler)
  },
  onGitBranchChanged: (callback: (payload: GitBranchChangedPayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: GitBranchChangedPayload) => callback(payload)
    ipcRenderer.on(IpcChannels.GIT_BRANCH_CHANGED, handler)
    return () => ipcRenderer.removeListener(IpcChannels.GIT_BRANCH_CHANGED, handler)
  },

  // Git diff
  getGitFileOriginal: (rootPath: string | null, filePath: string): Promise<{ content: string | null }> =>
    ipcRenderer.invoke(IpcChannels.GIT_DIFF_ORIGINAL, rootPath, filePath),

  // Terminal
  ptyCreate: (opts?: { id?: string; workspaceId?: string; cwd?: string; shell?: string; title?: string }) =>
    ipcRenderer.invoke(IpcChannels.PTY_CREATE, opts),
  ptyWrite: (id: string, data: string) =>
    ipcRenderer.send(IpcChannels.PTY_DATA_IN, id, data),
  ptyResize: (id: string, cols: number, rows: number) =>
    ipcRenderer.send(IpcChannels.PTY_RESIZE, id, cols, rows),
  ptyKill: (id: string) =>
    ipcRenderer.send(IpcChannels.PTY_KILL, id),
  ptyKillWorkspace: (workspaceId: string) =>
    ipcRenderer.send(IpcChannels.PTY_KILL_WORKSPACE, workspaceId),
  onPtyData: (callback: (payload: PtyDataOutPayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: PtyDataOutPayload) => callback(payload)
    ipcRenderer.on(IpcChannels.PTY_DATA_OUT, handler)
    return () => ipcRenderer.removeListener(IpcChannels.PTY_DATA_OUT, handler)
  },
  onPtyExit: (callback: (payload: PtyExitPayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: PtyExitPayload) => callback(payload)
    ipcRenderer.on(IpcChannels.PTY_EXIT, handler)
    return () => ipcRenderer.removeListener(IpcChannels.PTY_EXIT, handler)
  },

  // Worktrees
  listWorktrees: (workspaceId: string) => ipcRenderer.invoke(IpcChannels.WORKTREE_LIST, workspaceId),
  createWorktree: (workspaceId: string, opts: WorktreeCreateOpts) =>
    ipcRenderer.invoke(IpcChannels.WORKTREE_CREATE, workspaceId, opts),
  removeWorktree: (workspaceId: string, worktreePath: string) =>
    ipcRenderer.invoke(IpcChannels.WORKTREE_REMOVE, workspaceId, worktreePath),
  setActiveWorktree: (workspaceId: string, worktreePath: string | null) =>
    ipcRenderer.invoke(IpcChannels.WORKTREE_SET_ACTIVE, workspaceId, worktreePath),
  getActiveWorktree: (workspaceId: string) => ipcRenderer.invoke(IpcChannels.WORKTREE_GET_ACTIVE, workspaceId),
  onWorktreeListChanged: (callback: (payload: WorktreeListChangedPayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: WorktreeListChangedPayload) => callback(payload)
    ipcRenderer.on(IpcChannels.WORKTREE_LIST_CHANGED, handler)
    return () => ipcRenderer.removeListener(IpcChannels.WORKTREE_LIST_CHANGED, handler)
  },
  listBranches: (workspaceId: string) => ipcRenderer.invoke(IpcChannels.WORKTREE_LIST_BRANCHES, workspaceId),

  // File listing (quick open)
  listAllFiles: (rootPath: string) => ipcRenderer.invoke(IpcChannels.FS_LIST_ALL_FILES, rootPath),

  // Search (find in files)
  searchStart: (opts: SearchOpts) => ipcRenderer.invoke(IpcChannels.SEARCH_START, opts),
  onSearchResults: (callback: (payload: SearchResultsPayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: SearchResultsPayload) => callback(payload)
    ipcRenderer.on(IpcChannels.SEARCH_RESULTS, handler)
    return () => ipcRenderer.removeListener(IpcChannels.SEARCH_RESULTS, handler)
  },
  onSearchComplete: (callback: (payload: SearchCompletePayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: SearchCompletePayload) => callback(payload)
    ipcRenderer.on(IpcChannels.SEARCH_COMPLETE, handler)
    return () => ipcRenderer.removeListener(IpcChannels.SEARCH_COMPLETE, handler)
  },
  searchCancel: () => ipcRenderer.send(IpcChannels.SEARCH_CANCEL),
  searchReplace: (opts: ReplaceOpts) => ipcRenderer.invoke(IpcChannels.SEARCH_REPLACE, opts),

  // .aide project folder
  aideInit: (workspaceId?: string | null) => ipcRenderer.invoke(IpcChannels.AIDE_INIT, workspaceId),
  getResolvedSettings: (workspaceId?: string | null): Promise<ResolvedSettings> =>
    ipcRenderer.invoke(IpcChannels.AIDE_GET_RESOLVED_SETTINGS, workspaceId),
  onAideInitResult: (callback: (result: AideInitResult) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, result: AideInitResult) => callback(result)
    ipcRenderer.on(IpcChannels.AIDE_INIT_RESULT, handler)
    return () => ipcRenderer.removeListener(IpcChannels.AIDE_INIT_RESULT, handler)
  },

  // Settings
  getUserSettings: (): Promise<Partial<AideProjectSettings>> =>
    ipcRenderer.invoke(IpcChannels.SETTINGS_GET_USER),
  setUserSetting: (key: string, value: unknown | undefined): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.SETTINGS_SET_USER, key, value),
  getWorkspaceSettings: (workspaceId?: string | null): Promise<AideProjectSettings> =>
    ipcRenderer.invoke(IpcChannels.SETTINGS_GET_WORKSPACE, workspaceId),
  setWorkspaceSetting: (key: string, value: unknown | undefined, workspaceId?: string | null): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.SETTINGS_SET_WORKSPACE, key, value, workspaceId),
  getBuiltInDefaults: (): Promise<ResolvedSettings> =>
    ipcRenderer.invoke(IpcChannels.SETTINGS_GET_DEFAULTS),
  onSettingsChanged: (callback: (resolved: ResolvedSettings) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, resolved: ResolvedSettings) => callback(resolved)
    ipcRenderer.on(IpcChannels.SETTINGS_CHANGED, handler)
    return () => ipcRenderer.removeListener(IpcChannels.SETTINGS_CHANGED, handler)
  },

  // Keybinding overrides
  getKeybindingOverrides: (): Promise<KeybindingRule[]> =>
    ipcRenderer.invoke(IpcChannels.KEYBINDINGS_GET),
  setKeybindingOverrides: (rules: KeybindingRule[]): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.KEYBINDINGS_SET, rules),
  onKeybindingsChanged: (callback: (rules: KeybindingRule[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, rules: KeybindingRule[]) => callback(rules)
    ipcRenderer.on(IpcChannels.KEYBINDINGS_CHANGED, handler)
    return () => ipcRenderer.removeListener(IpcChannels.KEYBINDINGS_CHANGED, handler)
  },

  // Gitignore security audit
  auditGitignore: (workspaceId?: string | null): Promise<GitignoreAuditResult> =>
    ipcRenderer.invoke(IpcChannels.GITIGNORE_AUDIT, workspaceId),
  appendToGitignore: (patterns: string[], workspaceId?: string | null): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.GITIGNORE_APPEND, patterns, workspaceId),
  dismissGitignoreAudit: (workspaceId?: string | null): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.GITIGNORE_DISMISS, workspaceId),
  onGitignoreAuditResult: (callback: (payload: GitignoreAuditIpcPayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: GitignoreAuditIpcPayload) => callback(payload)
    ipcRenderer.on(IpcChannels.GITIGNORE_AUDIT_RESULT, handler)
    return () => ipcRenderer.removeListener(IpcChannels.GITIGNORE_AUDIT_RESULT, handler)
  },

  // Task system
  listTasks: (workspaceId: string): Promise<{ tasks: AideTask[]; compounds: CompoundTask[] }> =>
    ipcRenderer.invoke(IpcChannels.TASK_LIST, workspaceId),
  listRunningTasks: (workspaceId: string): Promise<TaskExecution[]> =>
    ipcRenderer.invoke(IpcChannels.TASK_LIST_RUNNING, workspaceId),
  runTask: (workspaceId: string, taskId: string, context?: TaskRunContext): Promise<{ executionId: string } | { error: string }> =>
    ipcRenderer.invoke(IpcChannels.TASK_RUN, workspaceId, taskId, context),
  killTask: (workspaceId: string, executionId: string) =>
    ipcRenderer.send(IpcChannels.TASK_KILL, workspaceId, executionId),
  reloadTasks: (workspaceId: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.TASK_RELOAD, workspaceId),
  generateTasks: (workspaceId: string): Promise<{ success: true } | { error: string }> =>
    ipcRenderer.invoke(IpcChannels.TASK_GENERATE, workspaceId),
  provideTaskInput: (workspaceId: string, requestId: string, value: string | null) =>
    ipcRenderer.send(IpcChannels.TASK_PROVIDE_INPUT, workspaceId, requestId, value),
  notifyFileSaved: (filePath: string) =>
    ipcRenderer.send(IpcChannels.TASK_FILE_SAVED, filePath),
  onTaskStatusChanged: (callback: (execution: TaskExecution) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, execution: TaskExecution) => callback(execution)
    ipcRenderer.on(IpcChannels.TASK_STATUS_CHANGED, handler)
    return () => ipcRenderer.removeListener(IpcChannels.TASK_STATUS_CHANGED, handler)
  },
  onTaskRequestInput: (callback: (request: TaskInputRequest) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, request: TaskInputRequest) => callback(request)
    ipcRenderer.on(IpcChannels.TASK_REQUEST_INPUT, handler)
    return () => ipcRenderer.removeListener(IpcChannels.TASK_REQUEST_INPUT, handler)
  },
  onTaskDiagnostics: (callback: (payload: TaskDiagnosticsPayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: TaskDiagnosticsPayload) => callback(payload)
    ipcRenderer.on(IpcChannels.TASK_DIAGNOSTICS, handler)
    return () => ipcRenderer.removeListener(IpcChannels.TASK_DIAGNOSTICS, handler)
  },
  onTaskAutoDetect: (callback: (payload: TaskAutoDetectPayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: TaskAutoDetectPayload) => callback(payload)
    ipcRenderer.on(IpcChannels.TASK_AUTO_DETECT, handler)
    return () => ipcRenderer.removeListener(IpcChannels.TASK_AUTO_DETECT, handler)
  },
  onTaskTriggerResult: (callback: (result: TaskTriggerResult) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, result: TaskTriggerResult) => callback(result)
    ipcRenderer.on(IpcChannels.TASK_TRIGGER_RESULT, handler)
    return () => ipcRenderer.removeListener(IpcChannels.TASK_TRIGGER_RESULT, handler)
  },

  // Workspace registry
  listWorkspaces: (): Promise<WorkspaceEntry[]> =>
    ipcRenderer.invoke(IpcChannels.WORKSPACE_LIST),
  createWorkspace: (rootPath: string): Promise<WorkspaceEntry> =>
    ipcRenderer.invoke(IpcChannels.WORKSPACE_CREATE, rootPath),
  createBlankWorkspace: (): Promise<WorkspaceEntry> =>
    ipcRenderer.invoke(IpcChannels.WORKSPACE_CREATE_BLANK),
  removeWorkspace: (id: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.WORKSPACE_REMOVE, id),
  closeWorkspace: (id: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.WORKSPACE_CLOSE, id),
  switchWorkspace: (id: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.WORKSPACE_SWITCH, id),
  updateWorkspace: (id: string, patch: Partial<Pick<WorkspaceEntry, 'name' | 'icon' | 'color'>>): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.WORKSPACE_UPDATE, id, patch),
  reorderWorkspaces: (ids: string[]): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.WORKSPACE_REORDER, ids),
  setWorkspaceRoot: (id: string, rootPath: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.WORKSPACE_SET_ROOT, id, rootPath),
  getActiveWorkspaceId: (): Promise<string | null> =>
    ipcRenderer.invoke(IpcChannels.WORKSPACE_GET_ACTIVE),
  onWorkspaceRegistryChanged: (callback: (workspaces: WorkspaceEntry[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, workspaces: WorkspaceEntry[]) => callback(workspaces)
    ipcRenderer.on(IpcChannels.WORKSPACE_REGISTRY_CHANGED, handler)
    return () => ipcRenderer.removeListener(IpcChannels.WORKSPACE_REGISTRY_CHANGED, handler)
  },
  getWorkspaceRuntimeSnapshots: () =>
    ipcRenderer.invoke(IpcChannels.WORKSPACE_RUNTIME_SNAPSHOTS_GET),
  onWorkspaceRuntimeSnapshotsChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshots: import('@aide/shared').WorkspaceRuntimeSnapshot[]) => callback(snapshots)
    ipcRenderer.on(IpcChannels.WORKSPACE_RUNTIME_SNAPSHOTS_CHANGED, handler)
    return () => ipcRenderer.removeListener(IpcChannels.WORKSPACE_RUNTIME_SNAPSHOTS_CHANGED, handler)
  },

  // State persistence
  saveWorkspaceState: (rootPath: string, state: AideLocalState): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.STATE_SAVE, rootPath, state),
  loadWorkspaceState: (rootPath: string): Promise<AideLocalState | null> =>
    ipcRenderer.invoke(IpcChannels.STATE_LOAD, rootPath),
  saveTerminalState: (rootPath: string, state: AideLocalTerminals): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.STATE_SAVE_TERMINALS, rootPath, state),
  loadTerminalState: (rootPath: string): Promise<AideLocalTerminals | null> =>
    ipcRenderer.invoke(IpcChannels.STATE_LOAD_TERMINALS, rootPath),

  // Browser panes
  browserCreate: (paneId: string, workspaceId: string, sessionMode: BrowserSessionMode) =>
    ipcRenderer.invoke(IpcChannels.BROWSER_CREATE, paneId, workspaceId, sessionMode),
  browserDestroy: (paneId: string) =>
    ipcRenderer.send(IpcChannels.BROWSER_DESTROY, paneId),
  browserDestroyWorkspace: (workspaceId: string) =>
    ipcRenderer.send(IpcChannels.BROWSER_DESTROY_WORKSPACE, workspaceId),
  browserNavigate: (paneId: string, url: string) =>
    ipcRenderer.invoke(IpcChannels.BROWSER_NAVIGATE, paneId, url),
  browserGoBack: (paneId: string) =>
    ipcRenderer.send(IpcChannels.BROWSER_GO_BACK, paneId),
  browserGoForward: (paneId: string) =>
    ipcRenderer.send(IpcChannels.BROWSER_GO_FORWARD, paneId),
  browserReload: (paneId: string) =>
    ipcRenderer.send(IpcChannels.BROWSER_RELOAD, paneId),
  browserHostUpdate: (update: BrowserHostUpdate) =>
    ipcRenderer.send(IpcChannels.BROWSER_HOST_UPDATE, update),
  browserSuppressOverlays: () =>
    ipcRenderer.send(IpcChannels.BROWSER_SUPPRESS_OVERLAYS),
  browserUnsuppressOverlays: () =>
    ipcRenderer.send(IpcChannels.BROWSER_UNSUPPRESS_OVERLAYS),
  onBrowserDidNavigate: (callback: (payload: BrowserDidNavigatePayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: BrowserDidNavigatePayload) => callback(payload)
    ipcRenderer.on(IpcChannels.BROWSER_DID_NAVIGATE, handler)
    return () => ipcRenderer.removeListener(IpcChannels.BROWSER_DID_NAVIGATE, handler)
  },
  onBrowserTitleUpdated: (callback: (payload: BrowserPageTitlePayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: BrowserPageTitlePayload) => callback(payload)
    ipcRenderer.on(IpcChannels.BROWSER_PAGE_TITLE_UPDATED, handler)
    return () => ipcRenderer.removeListener(IpcChannels.BROWSER_PAGE_TITLE_UPDATED, handler)
  },
  onBrowserLoadingChanged: (callback: (payload: BrowserLoadingPayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: BrowserLoadingPayload) => callback(payload)
    ipcRenderer.on(IpcChannels.BROWSER_LOADING_CHANGED, handler)
    return () => ipcRenderer.removeListener(IpcChannels.BROWSER_LOADING_CHANGED, handler)
  },
  onBrowserCanNavigateChanged: (callback: (payload: BrowserCanNavigatePayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: BrowserCanNavigatePayload) => callback(payload)
    ipcRenderer.on(IpcChannels.BROWSER_CAN_NAVIGATE_CHANGED, handler)
    return () => ipcRenderer.removeListener(IpcChannels.BROWSER_CAN_NAVIGATE_CHANGED, handler)
  },
  onBrowserFocusChanged: (callback: (payload: BrowserFocusPayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: BrowserFocusPayload) => callback(payload)
    ipcRenderer.on(IpcChannels.BROWSER_FOCUS_CHANGED, handler)
    return () => ipcRenderer.removeListener(IpcChannels.BROWSER_FOCUS_CHANGED, handler)
  },

  // App lifecycle
  onLifecycleRequestSave: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(IpcChannels.LIFECYCLE_REQUEST_SAVE, handler)
    return () => ipcRenderer.removeListener(IpcChannels.LIFECYCLE_REQUEST_SAVE, handler)
  },
  lifecycleSaveComplete: () =>
    ipcRenderer.send(IpcChannels.LIFECYCLE_SAVE_COMPLETE),
  onCrashDetected: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(IpcChannels.LIFECYCLE_CRASH_DETECTED, handler)
    return () => ipcRenderer.removeListener(IpcChannels.LIFECYCLE_CRASH_DETECTED, handler)
  },

  // ─── Agent Chat ───────────────────────────────
  chatSendMessage: (sessionId: string, content: string) =>
    ipcRenderer.invoke(IpcChannels.CHAT_SEND_MESSAGE, sessionId, content),
  chatGetHistory: (workspaceId: string, conversationId?: string): Promise<ChatSession | null> =>
    ipcRenderer.invoke(IpcChannels.CHAT_GET_HISTORY, workspaceId, conversationId),
  chatSetMode: (sessionId: string, mode: ChatMode): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.CHAT_SET_MODE, sessionId, mode),
  chatSetWorkingSet: (sessionId: string, paths: string[]): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.CHAT_SET_WORKING_SET, sessionId, paths),
  chatToolApprove: (sessionId: string, toolCallId: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.CHAT_TOOL_APPROVE, sessionId, toolCallId),
  chatToolReject: (sessionId: string, toolCallId: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.CHAT_TOOL_REJECT, sessionId, toolCallId),
  chatStop: (sessionId: string) =>
    ipcRenderer.send(IpcChannels.CHAT_STOP, sessionId),
  onChatStreamChunk: (callback: (chunk: ChatStreamChunk) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: ChatStreamChunk) => callback(chunk)
    ipcRenderer.on(IpcChannels.CHAT_STREAM_CHUNK, handler)
    return () => ipcRenderer.removeListener(IpcChannels.CHAT_STREAM_CHUNK, handler)
  },
  onChatStreamEnd: (callback: (end: ChatStreamEnd) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, end: ChatStreamEnd) => callback(end)
    ipcRenderer.on(IpcChannels.CHAT_STREAM_END, handler)
    return () => ipcRenderer.removeListener(IpcChannels.CHAT_STREAM_END, handler)
  },
  onChatToolCall: (callback: (payload: ChatToolCallPayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ChatToolCallPayload) => callback(payload)
    ipcRenderer.on(IpcChannels.CHAT_TOOL_CALL, handler)
    return () => ipcRenderer.removeListener(IpcChannels.CHAT_TOOL_CALL, handler)
  },
  chatListPendingToolApprovals: (): Promise<PendingToolApprovalInfo[]> =>
    ipcRenderer.invoke(IpcChannels.CHAT_PENDING_TOOL_APPROVALS_LIST),

  // ─── MCP ──────────────────────────────────────
  mcpListServers: (): Promise<McpServerStatus[]> =>
    ipcRenderer.invoke(IpcChannels.MCP_LIST_SERVERS),
  mcpRestartServer: (serverName: string) =>
    ipcRenderer.invoke(IpcChannels.MCP_RESTART_SERVER, serverName),
  mcpListTools: (): Promise<ToolDefinition[]> =>
    ipcRenderer.invoke(IpcChannels.MCP_LIST_TOOLS),
  onMcpServerStatus: (callback: (status: McpServerStatus) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: McpServerStatus) => callback(status)
    ipcRenderer.on(IpcChannels.MCP_SERVER_STATUS, handler)
    return () => ipcRenderer.removeListener(IpcChannels.MCP_SERVER_STATUS, handler)
  },

  // ─── CLI Agent ───────────────────────────────
  cliAgentStart: (workspaceId: string, backend: AgentBackend, conversationId?: string, worktreePath?: string) =>
    ipcRenderer.invoke(IpcChannels.CLI_AGENT_START, workspaceId, backend, conversationId, worktreePath),
  cliAgentStop: (sessionId: string) =>
    ipcRenderer.send(IpcChannels.CLI_AGENT_STOP, sessionId),
  cliAgentSend: (sessionId: string, content: string) =>
    ipcRenderer.invoke(IpcChannels.CLI_AGENT_SEND, sessionId, content),
  cliAgentGetSession: (workspaceId: string, sessionId?: string): Promise<CliAgentSession | null> =>
    ipcRenderer.invoke(IpcChannels.CLI_AGENT_GET_SESSION, workspaceId, sessionId),
  cliAgentLoadMessages: (workspaceId: string, conversationId: string): Promise<CliAgentMessage[]> =>
    ipcRenderer.invoke(IpcChannels.CLI_AGENT_LOAD_MESSAGES, workspaceId, conversationId),
  onCliAgentStreamDelta: (callback: (delta: CliAgentStreamDelta) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, delta: CliAgentStreamDelta) => callback(delta)
    ipcRenderer.on(IpcChannels.CLI_AGENT_STREAM_DELTA, handler)
    return () => ipcRenderer.removeListener(IpcChannels.CLI_AGENT_STREAM_DELTA, handler)
  },
  onCliAgentMessage: (callback: (msg: CliAgentMessagePayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, msg: CliAgentMessagePayload) => callback(msg)
    ipcRenderer.on(IpcChannels.CLI_AGENT_MESSAGE, handler)
    return () => ipcRenderer.removeListener(IpcChannels.CLI_AGENT_MESSAGE, handler)
  },
  onCliAgentStatus: (callback: (status: CliAgentStatusPayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: CliAgentStatusPayload) => callback(status)
    ipcRenderer.on(IpcChannels.CLI_AGENT_STATUS, handler)
    return () => ipcRenderer.removeListener(IpcChannels.CLI_AGENT_STATUS, handler)
  },
  onCliAgentResult: (callback: (result: CliAgentResultPayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, result: CliAgentResultPayload) => callback(result)
    ipcRenderer.on(IpcChannels.CLI_AGENT_RESULT, handler)
    return () => ipcRenderer.removeListener(IpcChannels.CLI_AGENT_RESULT, handler)
  },

  // ─── Conversation History ─────────────────────
  conversationList: (workspaceId: string): Promise<ConversationMeta[]> =>
    ipcRenderer.invoke(IpcChannels.CONVERSATION_LIST, workspaceId),
  conversationCreate: (opts: ConversationCreateOpts): Promise<ConversationMeta> =>
    ipcRenderer.invoke(IpcChannels.CONVERSATION_CREATE, opts),
  conversationDelete: (workspaceId: string, conversationId: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.CONVERSATION_DELETE, workspaceId, conversationId),
  conversationRename: (workspaceId: string, conversationId: string, title: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.CONVERSATION_RENAME, workspaceId, conversationId, title),
  conversationGet: (workspaceId: string, conversationId: string): Promise<ConversationMeta | null> =>
    ipcRenderer.invoke(IpcChannels.CONVERSATION_GET, workspaceId, conversationId),
  onConversationListChanged: (callback: (payload: ConversationListChangedPayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ConversationListChangedPayload) => callback(payload)
    ipcRenderer.on(IpcChannels.CONVERSATION_LIST_CHANGED, handler)
    return () => ipcRenderer.removeListener(IpcChannels.CONVERSATION_LIST_CHANGED, handler)
  },

  // Open in VS Code
  openInVSCode: (
    rootPath: string,
    files?: Array<{ path: string; line: number; col: number }>,
  ) =>
    ipcRenderer.invoke(IpcChannels.OPEN_IN_VSCODE, rootPath, files),

  // Platform info (for conditional UI like traffic lights)
  platform: process.platform,
}

contextBridge.exposeInMainWorld('api', api)
