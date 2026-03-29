import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels } from '@aide/shared'
import type { ThemeName, FsWatchEvent, GitStatusResult, WorktreeInfo, WorktreeCreateOpts, SearchOpts, SearchFileResult, ReplaceOpts, ResolvedSettings, AideProjectSettings, AideInitResult, GitignoreAuditResult, AideTask, CompoundTask, TaskExecution, TaskInputRequest, TaskDiagnostic, WorkspaceEntry, AideLocalState, AideLocalTerminals, WindowApi, BrowserSessionMode, BrowserHostUpdate, BrowserDidNavigatePayload, BrowserPageTitlePayload, BrowserLoadingPayload, BrowserCanNavigatePayload, BrowserFocusPayload, ZoomCommandPayload, KeybindingRule, ChatMode, ChatSession, ChatStreamChunk, ChatStreamEnd, ChatToolCallPayload, McpServerStatus, ToolDefinition, AgentBackend, CliAgentStreamDelta, CliAgentMessage, CliAgentSession, CliAgentStatusPayload, CliAgentResultPayload, ConversationMeta, ConversationCreateOpts, ConversationListChangedPayload } from '@aide/shared'

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

  // File listing (quick open)
  listAllFiles: (rootPath: string) => ipcRenderer.invoke(IpcChannels.FS_LIST_ALL_FILES, rootPath),

  // Search (find in files)
  searchStart: (opts: SearchOpts) => ipcRenderer.invoke(IpcChannels.SEARCH_START, opts),
  onSearchResults: (callback: (results: SearchFileResult[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, results: SearchFileResult[]) => callback(results)
    ipcRenderer.on(IpcChannels.SEARCH_RESULTS, handler)
    return () => ipcRenderer.removeListener(IpcChannels.SEARCH_RESULTS, handler)
  },
  onSearchComplete: (callback: (summary: { totalMatches: number; totalFiles: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, summary: { totalMatches: number; totalFiles: number }) => callback(summary)
    ipcRenderer.on(IpcChannels.SEARCH_COMPLETE, handler)
    return () => ipcRenderer.removeListener(IpcChannels.SEARCH_COMPLETE, handler)
  },
  searchCancel: () => ipcRenderer.send(IpcChannels.SEARCH_CANCEL),
  searchReplace: (opts: ReplaceOpts) => ipcRenderer.invoke(IpcChannels.SEARCH_REPLACE, opts),

  // .aide project folder
  aideInit: () => ipcRenderer.invoke(IpcChannels.AIDE_INIT),
  getResolvedSettings: (): Promise<ResolvedSettings> =>
    ipcRenderer.invoke(IpcChannels.AIDE_GET_RESOLVED_SETTINGS),
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
  getWorkspaceSettings: (): Promise<AideProjectSettings> =>
    ipcRenderer.invoke(IpcChannels.SETTINGS_GET_WORKSPACE),
  setWorkspaceSetting: (key: string, value: unknown | undefined): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.SETTINGS_SET_WORKSPACE, key, value),
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
  auditGitignore: (): Promise<GitignoreAuditResult> =>
    ipcRenderer.invoke(IpcChannels.GITIGNORE_AUDIT),
  appendToGitignore: (patterns: string[]): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.GITIGNORE_APPEND, patterns),
  dismissGitignoreAudit: (): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.GITIGNORE_DISMISS),
  onGitignoreAuditResult: (callback: (result: GitignoreAuditResult) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, result: GitignoreAuditResult) => callback(result)
    ipcRenderer.on(IpcChannels.GITIGNORE_AUDIT_RESULT, handler)
    return () => ipcRenderer.removeListener(IpcChannels.GITIGNORE_AUDIT_RESULT, handler)
  },

  // Task system
  listTasks: (): Promise<{ tasks: AideTask[]; compounds: CompoundTask[] }> =>
    ipcRenderer.invoke(IpcChannels.TASK_LIST),
  runTask: (taskId: string): Promise<{ executionId: string } | { error: string }> =>
    ipcRenderer.invoke(IpcChannels.TASK_RUN, taskId),
  killTask: (executionId: string) =>
    ipcRenderer.send(IpcChannels.TASK_KILL, executionId),
  reloadTasks: (): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.TASK_RELOAD),
  generateTasks: (): Promise<{ success: true } | { error: string }> =>
    ipcRenderer.invoke(IpcChannels.TASK_GENERATE),
  provideTaskInput: (requestId: string, value: string | null) =>
    ipcRenderer.send(IpcChannels.TASK_PROVIDE_INPUT, requestId, value),
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
  onTaskDiagnostics: (callback: (diagnostics: TaskDiagnostic[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, diagnostics: TaskDiagnostic[]) => callback(diagnostics)
    ipcRenderer.on(IpcChannels.TASK_DIAGNOSTICS, handler)
    return () => ipcRenderer.removeListener(IpcChannels.TASK_DIAGNOSTICS, handler)
  },
  onTaskAutoDetect: (callback: (tasks: AideTask[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, tasks: AideTask[]) => callback(tasks)
    ipcRenderer.on(IpcChannels.TASK_AUTO_DETECT, handler)
    return () => ipcRenderer.removeListener(IpcChannels.TASK_AUTO_DETECT, handler)
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
  cliAgentStart: (workspaceId: string, backend: AgentBackend, conversationId?: string) =>
    ipcRenderer.invoke(IpcChannels.CLI_AGENT_START, workspaceId, backend, conversationId),
  cliAgentStop: (sessionId: string) =>
    ipcRenderer.send(IpcChannels.CLI_AGENT_STOP, sessionId),
  cliAgentSend: (sessionId: string, content: string) =>
    ipcRenderer.invoke(IpcChannels.CLI_AGENT_SEND, sessionId, content),
  cliAgentGetSession: (workspaceId: string): Promise<CliAgentSession | null> =>
    ipcRenderer.invoke(IpcChannels.CLI_AGENT_GET_SESSION, workspaceId),
  onCliAgentStreamDelta: (callback: (delta: CliAgentStreamDelta) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, delta: CliAgentStreamDelta) => callback(delta)
    ipcRenderer.on(IpcChannels.CLI_AGENT_STREAM_DELTA, handler)
    return () => ipcRenderer.removeListener(IpcChannels.CLI_AGENT_STREAM_DELTA, handler)
  },
  onCliAgentMessage: (callback: (msg: CliAgentMessage & { sessionId: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, msg: CliAgentMessage & { sessionId: string }) => callback(msg)
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
  conversationDelete: (conversationId: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.CONVERSATION_DELETE, conversationId),
  conversationRename: (conversationId: string, title: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.CONVERSATION_RENAME, conversationId, title),
  conversationGet: (conversationId: string): Promise<ConversationMeta | null> =>
    ipcRenderer.invoke(IpcChannels.CONVERSATION_GET, conversationId),
  onConversationListChanged: (callback: (payload: ConversationListChangedPayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ConversationListChangedPayload) => callback(payload)
    ipcRenderer.on(IpcChannels.CONVERSATION_LIST_CHANGED, handler)
    return () => ipcRenderer.removeListener(IpcChannels.CONVERSATION_LIST_CHANGED, handler)
  },

  // Platform info (for conditional UI like traffic lights)
  platform: process.platform,
}

contextBridge.exposeInMainWorld('api', api)
