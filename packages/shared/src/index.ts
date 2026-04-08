/**
 * Shared types and constants between main and renderer processes.
 * IPC channel definitions go here for type-safe communication.
 */

export type { CommandDefinition, KeybindingRule } from './commands'
export type {
  ThemeAppearance,
  ThemeDefinition,
  ThemeId,
  ThemeManifest,
  ThemeStateSnapshot,
} from './themes'
export type {
  ChatMode,
  ChatSessionStatus,
  ToolCallStatus,
  ToolCall,
  ToolResult,
  ChatComposerSubmission,
  ChatMessage,
  ChatSession,
  ChatStreamChunk,
  ChatStreamEnd,
  ChatToolCallPayload,
  PendingToolApprovalInfo,
  ToolDefinition,
  McpServerConfig,
  McpServerConnectionStatus,
  McpServerStatus,
  PermissionTier,
  ToolPermissionConfig,
  AgentPermissionSettings,
  LlmProviderConfig,
} from './agentTypes'
export type {
  AgentBackend,
  ExternalCliBackend,
  CliAgentBackendState,
  CliAgentBackendStateMap,
  CliAgentProcessStatus,
  CliAgentTokenUsage,
  CliAgentMessageType,
  CliAgentMessage,
  CliAgentPermissionRequest,
  CliAgentStreamDelta,
  CliAgentSession,
  CliAgentWorkspaceCostSummary,
  CliAgentStatusPayload,
  CliAgentResultPayload,
  CliAgentMessagePayload,
  OpenCodeProviderSummary,
  OpenCodeAgentSummary,
  OpenCodeToolSummary,
  OpenCodeFileEntry,
  OpenCodeFindResult,
  OpenCodeSymbolResult,
  OpenCodeShellResult,
  OpenCodeServerInfo,
  OpenCodePathInfo,
  OpenCodeTodoItem,
  OpenCodeAuthMethod,
} from './cliAgentTypes'
export type {
  ConversationMeta,
  ConversationCreateOpts,
  ConversationListChangedPayload,
} from './conversationTypes'
export { deriveTitle } from './conversationTypes'
export type {
  LlmMessage,
  LlmContentBlock,
  LlmToolDefinition,
  LlmUsage,
  LlmStreamEvent,
  StreamParams,
  LlmProvider,
  SseEvent,
  AnthropicRequest,
  AnthropicMessage,
  AnthropicContentBlock,
  AnthropicTool,
  AnthropicStreamEvent,
  OpenAiRequest,
  OpenAiMessage,
  OpenAiToolCall,
  OpenAiTool,
  OpenAiStreamChunk,
  OpenAiStreamToolCall,
} from './llmTypes'
import type {
  ChatMode,
  ChatComposerSubmission,
  ChatSession,
  ChatStreamChunk,
  ChatStreamEnd,
  ChatToolCallPayload,
  PendingToolApprovalInfo,
  McpServerStatus,
  ToolDefinition,
  PermissionTier,
  ToolPermissionConfig,
} from './agentTypes'
import type {
  AgentBackend,
  CliAgentStreamDelta,
  CliAgentMessage,
  CliAgentSession,
  CliAgentStatusPayload,
  CliAgentResultPayload,
  CliAgentMessagePayload,
} from './cliAgentTypes'
import type {
  ConversationMeta,
  ConversationCreateOpts,
  ConversationListChangedPayload,
} from './conversationTypes'
import type { ThemeId, ThemeStateSnapshot } from './themes'
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
  THEME_LIST: 'theme:list',
  THEME_SET_DEFAULT_DARK: 'theme:set-default-dark',
  THEME_SET_DEFAULT_LIGHT: 'theme:set-default-light',
  THEME_RELOAD: 'theme:reload',
  THEME_OPEN_DIRECTORY: 'theme:open-directory',

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

  // VS Code Integration
  OPEN_IN_VSCODE: 'vscode:open',

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

  // Git diff
  GIT_DIFF_ORIGINAL: 'git:diff-original',

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
  TASK_LIST_RUNNING: 'task:list-running',
  TASK_RUN: 'task:run',
  TASK_KILL: 'task:kill',
  TASK_STATUS_CHANGED: 'task:status-changed',
  TASK_REQUEST_INPUT: 'task:request-input',
  TASK_PROVIDE_INPUT: 'task:provide-input',
  TASK_DIAGNOSTICS: 'task:diagnostics',
  TASK_RELOAD: 'task:reload',
  TASK_AUTO_DETECT: 'task:auto-detect',
  TASK_GENERATE: 'task:generate',
  TASK_FILE_SAVED: 'task:file-saved',
  TASK_TRIGGER_RESULT: 'task:trigger-result',

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
  WORKSPACE_RUNTIME_SNAPSHOTS_GET: 'workspace-runtime:snapshots-get',
  WORKSPACE_RUNTIME_SNAPSHOTS_CHANGED: 'workspace-runtime:snapshots-changed',

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

  // Settings
  SETTINGS_GET_USER: 'settings:get-user',
  SETTINGS_SET_USER: 'settings:set-user',
  SETTINGS_GET_WORKSPACE: 'settings:get-workspace',
  SETTINGS_SET_WORKSPACE: 'settings:set-workspace',
  SETTINGS_GET_DEFAULTS: 'settings:get-defaults',
  SETTINGS_CHANGED: 'settings:changed',

  // Keybinding overrides
  KEYBINDINGS_GET: 'keybindings:get',
  KEYBINDINGS_SET: 'keybindings:set',
  KEYBINDINGS_CHANGED: 'keybindings:changed',

  // App lifecycle
  LIFECYCLE_REQUEST_SAVE: 'lifecycle:request-save',
  LIFECYCLE_SAVE_COMPLETE: 'lifecycle:save-complete',
  LIFECYCLE_CRASH_DETECTED: 'lifecycle:crash-detected',

  // ─── Agent Chat ───────────────────────────────
  CHAT_SEND_MESSAGE: 'chat:send-message',
  CHAT_STREAM_CHUNK: 'chat:stream-chunk',
  CHAT_STREAM_END: 'chat:stream-end',
  CHAT_TOOL_CALL: 'chat:tool-call',
  CHAT_TOOL_APPROVE: 'chat:tool-approve',
  CHAT_TOOL_REJECT: 'chat:tool-reject',
  CHAT_STOP: 'chat:stop',
  CHAT_SET_MODE: 'chat:set-mode',
  CHAT_SET_WORKING_SET: 'chat:set-working-set',
  CHAT_GET_HISTORY: 'chat:get-history',
  CHAT_PENDING_TOOL_APPROVALS_LIST: 'chat:pending-tool-approvals-list',

  // ─── MCP ──────────────────────────────────────
  MCP_LIST_SERVERS: 'mcp:list-servers',
  MCP_SERVER_STATUS: 'mcp:server-status',
  MCP_RESTART_SERVER: 'mcp:restart-server',
  MCP_LIST_TOOLS: 'mcp:list-tools',

  // ─── CLI Agent ───────────────────────────────
  CLI_AGENT_START: 'cli-agent:start',
  CLI_AGENT_SWITCH_BACKEND: 'cli-agent:switch-backend',
  CLI_AGENT_STOP: 'cli-agent:stop',
  CLI_AGENT_SEND: 'cli-agent:send',
  CLI_AGENT_GET_SESSION: 'cli-agent:get-session',
  CLI_AGENT_LOAD_MESSAGES: 'cli-agent:load-messages',
  CLI_AGENT_STREAM_DELTA: 'cli-agent:stream-delta',
  CLI_AGENT_MESSAGE: 'cli-agent:message',
  CLI_AGENT_STATUS: 'cli-agent:status',
  CLI_AGENT_RESULT: 'cli-agent:result',
  CLI_AGENT_WORKSPACE_COST: 'cli-agent:workspace-cost',

  // ─── CLI Agent: per-session config ───────────
  CLI_AGENT_UPDATE_SESSION_CONFIG: 'cli-agent:update-session-config',
  CLI_AGENT_LIST_PROVIDERS: 'cli-agent:list-providers',
  CLI_AGENT_LIST_AGENTS: 'cli-agent:list-agents',
  CLI_AGENT_LIST_MODES: 'cli-agent:list-modes',
  CLI_AGENT_LIST_TOOLS: 'cli-agent:list-tools',

  // ─── CLI Agent: session ops (OpenCode) ───────
  CLI_AGENT_SESSION_SHARE: 'cli-agent:session-share',
  CLI_AGENT_SESSION_UNSHARE: 'cli-agent:session-unshare',
  CLI_AGENT_SESSION_SUMMARIZE: 'cli-agent:session-summarize',
  CLI_AGENT_SESSION_REVERT: 'cli-agent:session-revert',
  CLI_AGENT_SESSION_UNREVERT: 'cli-agent:session-unrevert',
  CLI_AGENT_SESSION_FORK: 'cli-agent:session-fork',
  CLI_AGENT_SESSION_ABORT: 'cli-agent:session-abort',
  CLI_AGENT_SESSION_DIFF: 'cli-agent:session-diff',
  CLI_AGENT_SESSION_TODO: 'cli-agent:session-todo',
  CLI_AGENT_SESSION_INIT: 'cli-agent:session-init',
  CLI_AGENT_SESSION_DELETE_REMOTE: 'cli-agent:session-delete-remote',

  // ─── CLI Agent: workspace ops (OpenCode) ─────
  CLI_AGENT_FILE_LIST: 'cli-agent:file-list',
  CLI_AGENT_FILE_READ: 'cli-agent:file-read',
  CLI_AGENT_FILE_STATUS: 'cli-agent:file-status',
  CLI_AGENT_FIND_TEXT: 'cli-agent:find-text',
  CLI_AGENT_FIND_FILES: 'cli-agent:find-files',
  CLI_AGENT_FIND_SYMBOLS: 'cli-agent:find-symbols',
  CLI_AGENT_SHELL_RUN: 'cli-agent:shell-run',
  CLI_AGENT_LSP_STATUS: 'cli-agent:lsp-status',
  CLI_AGENT_FORMATTER_STATUS: 'cli-agent:formatter-status',

  // ─── CLI Agent: config / auth / providers ────
  CLI_AGENT_CONFIG_GET: 'cli-agent:config-get',
  CLI_AGENT_CONFIG_UPDATE: 'cli-agent:config-update',
  CLI_AGENT_CONFIG_PROVIDERS: 'cli-agent:config-providers',
  CLI_AGENT_AUTH_SET: 'cli-agent:auth-set',
  CLI_AGENT_PROVIDER_LIST: 'cli-agent:provider-list',
  CLI_AGENT_PROVIDER_AUTH: 'cli-agent:provider-auth',
  CLI_AGENT_PROVIDER_OAUTH_AUTHORIZE: 'cli-agent:provider-oauth-authorize',
  CLI_AGENT_PROVIDER_OAUTH_CALLBACK: 'cli-agent:provider-oauth-callback',
  CLI_AGENT_PATH_GET: 'cli-agent:path-get',
  CLI_AGENT_LOG_WRITE: 'cli-agent:log-write',
  CLI_AGENT_SERVER_INFO: 'cli-agent:server-info',

  // ─── CLI Agent: TUI control (OpenCode) ───────
  CLI_AGENT_TUI_APPEND_PROMPT: 'cli-agent:tui-append-prompt',
  CLI_AGENT_TUI_SUBMIT_PROMPT: 'cli-agent:tui-submit-prompt',
  CLI_AGENT_TUI_CLEAR_PROMPT: 'cli-agent:tui-clear-prompt',
  CLI_AGENT_TUI_OPEN_HELP: 'cli-agent:tui-open-help',
  CLI_AGENT_TUI_OPEN_SESSIONS: 'cli-agent:tui-open-sessions',
  CLI_AGENT_TUI_OPEN_THEMES: 'cli-agent:tui-open-themes',
  CLI_AGENT_TUI_OPEN_MODELS: 'cli-agent:tui-open-models',
  CLI_AGENT_TUI_EXECUTE_COMMAND: 'cli-agent:tui-execute-command',
  CLI_AGENT_TUI_SHOW_TOAST: 'cli-agent:tui-show-toast',

  // ─── Conversation History ────────────────────
  CONVERSATION_LIST: 'conversation:list',
  CONVERSATION_CREATE: 'conversation:create',
  CONVERSATION_DELETE: 'conversation:delete',
  CONVERSATION_RENAME: 'conversation:rename',
  CONVERSATION_GET: 'conversation:get',
  CONVERSATION_LIST_CHANGED: 'conversation:list-changed',
} as const

export type ThemeName = ThemeId

export type SettingsScope = 'user' | 'workspace'

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
  /** Watcher scope key (same as `workspaceId` when watching a workspace root). */
  scopeId: string
  /** Workspace that owns this watch scope; equals `scopeId` for per-workspace watchers. */
  workspaceId: string
}

export type GitFileStatus = 'M' | 'A' | '?' | 'D' | 'C'

export interface GitStatusResult {
  files: Record<string, GitFileStatus>
  branch: string
  ignoredPaths?: string[]
}

/** Main → renderer: file status / ignored paths changed for a repository. */
export interface GitStatusChangedPayload {
  workspaceId: string
  status: GitStatusResult
}

/** Main → renderer: current branch changed for a repository. */
export interface GitBranchChangedPayload {
  workspaceId: string
  branch: string
}

export interface WorktreeInfo {
  path: string
  branch: string
  isMain: boolean
  isDirty: boolean
  isCurrent: boolean
}

/** Main → renderer: worktree list updated for one workspace runtime. */
export interface WorktreeListChangedPayload {
  workspaceId: string
  worktrees: WorktreeInfo[]
}

export interface WorktreeCreateOpts {
  branch: string
  createBranch: boolean
  baseBranch?: string
}

export interface AppSettings {
  activeThemeId: ThemeId
  defaultDarkThemeId: ThemeId
  defaultLightThemeId: ThemeId
  sidebarWidth: number
  editorDefaults?: Partial<AideProjectSettings>
  cleanShutdown?: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  activeThemeId: 'one-dark',
  defaultDarkThemeId: 'one-dark',
  defaultLightThemeId: 'one-light',
  sidebarWidth: 220,
}

// Search types (find in files)
export interface SearchOpts {
  /** Workspace that initiated the search (included on result batches). */
  workspaceId: string
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

/** Main → renderer: incremental search hits. */
export interface SearchResultsPayload {
  workspaceId: string
  results: SearchFileResult[]
}

/** Main → renderer: search finished. */
export interface SearchCompletePayload {
  workspaceId: string
  totalMatches: number
  totalFiles: number
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

  // Agent / LLM settings
  'agent.provider'?: string
  'agent.model'?: string
  'agent.apiKey'?: string
  'agent.baseUrl'?: string
  'agent.maxTurns'?: number
  'agent.maxTokens'?: number

  // Agent / Permission settings
  'agent.permissionTier'?: PermissionTier
  'agent.autoApprove'?: Record<string, boolean | ToolPermissionConfig>

  // Agent / Backend settings
  'agent.backend'?: AgentBackend
  'agent.claudeCodePath'?: string
  'agent.opencodePath'?: string
  'agent.codexPath'?: string

  // OpenCode-specific defaults (seed values for new opencode sessions).
  // Per-session overrides happen via the chat pane gear menu and never
  // mutate these defaults.
  'agent.opencode.defaultProvider'?: string
  'agent.opencode.defaultModel'?: string
  'agent.opencode.defaultAgent'?: string
  'agent.opencode.defaultMode'?: string
  'agent.opencode.defaultSystemPrompt'?: string
  'agent.opencode.defaultToolToggles'?: Record<string, boolean>
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

  // Agent / LLM settings
  'agent.provider': string
  'agent.model': string
  'agent.apiKey': string
  'agent.baseUrl': string
  'agent.maxTurns': number
  'agent.maxTokens': number

  // Agent / Permission settings
  'agent.permissionTier': PermissionTier
  'agent.autoApprove': Record<string, boolean | ToolPermissionConfig>

  // Agent / Backend settings
  'agent.backend': AgentBackend
  'agent.claudeCodePath': string
  'agent.opencodePath': string
  'agent.codexPath': string

  // OpenCode-specific defaults
  'agent.opencode.defaultProvider': string
  'agent.opencode.defaultModel': string
  'agent.opencode.defaultAgent': string
  'agent.opencode.defaultMode': string
  'agent.opencode.defaultSystemPrompt': string
  'agent.opencode.defaultToolToggles': Record<string, boolean>
}

/**
 * Agent settings that must never be overridden by project-level
 * `.aide/settings.json`.  These control trust-boundary decisions
 * (credentials, executable paths, permission policy) and must only
 * come from user-scoped (app-level) settings.
 */
export const SENSITIVE_AGENT_KEYS: ReadonlySet<string> = new Set([
  'agent.apiKey',
  'agent.baseUrl',
  'agent.backend',
  'agent.claudeCodePath',
  'agent.opencodePath',
  'agent.codexPath',
  'agent.permissionTier',
  'agent.autoApprove',
  // OpenCode defaults are user preferences (model choice, system prompt) that
  // shouldn't be silently overridden by a checked-in workspace settings file.
  'agent.opencode.defaultProvider',
  'agent.opencode.defaultModel',
  'agent.opencode.defaultAgent',
  'agent.opencode.defaultMode',
  'agent.opencode.defaultSystemPrompt',
  'agent.opencode.defaultToolToggles',
])

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

/** Main → renderer: gitignore audit for a workspace folder. */
export interface GitignoreAuditIpcPayload {
  workspaceId: string
  result: GitignoreAuditResult
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

export type WorkspaceRuntimeState = 'foreground' | 'backgrounded' | 'asleep' | 'blocked'

export type WorkspaceRuntimeStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'error'

export interface WorkspaceRuntimeWorkloadFlags {
  agentsRunning: boolean
  tasksRunning: boolean
  pendingApproval: boolean
  pendingUserInput: boolean
}

export interface WorkspaceRuntimeSnapshot {
  workspaceId: string
  rootPath: string | null
  name: string
  icon?: string
  color?: string
  status: WorkspaceRuntimeStatus
  state: WorkspaceRuntimeState
  initialized: boolean
  servicesAttached: boolean
  workload: WorkspaceRuntimeWorkloadFlags
  activationSeq: number
  lastForegroundedAt: number | null
  lastBackgroundedAt: number | null
  lastStoppedAt: number | null
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
  /** Last known on-disk content when the tab was dirty (for restore without re-read). */
  cleanBaseline?: string
  selection?: { anchor: number; head: number }
  diskChangedWhileDirty?: boolean
}

export interface AideLocalState {
  layout: unknown | null
  openTabs: TabState[]
  activeTabPath: string | null
  sidebarWidth: number
  sidebarCollapsed: boolean
  sidebarSections: Record<string, boolean>
  browserPanes?: BrowserPaneState[]
  /** Persisted active git worktree path for this workspace, or null for main tree. Omitted in older state files. */
  activeWorktreePath?: string | null
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
  viewport: { width: number; height: number }
}

export interface BrowserDidNavigatePayload {
  paneId: string
  workspaceId: string
  url: string
}

export interface BrowserPageTitlePayload {
  paneId: string
  workspaceId: string
  title: string
}

export interface BrowserLoadingPayload {
  paneId: string
  workspaceId: string
  loading: boolean
}

export interface BrowserCanNavigatePayload {
  paneId: string
  workspaceId: string
  canGoBack: boolean
  canGoForward: boolean
}

export interface BrowserFocusPayload {
  paneId: string
  workspaceId: string
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

/** Main → renderer: task auto-detect suggested tasks for a workspace. */
export interface TaskAutoDetectPayload {
  workspaceId: string
  tasks: AideTask[]
}

export type TaskExecutionStatus = 'running' | 'succeeded' | 'failed' | 'killed'

export interface TaskExecution {
  workspaceId: string
  executionId: string
  taskId: string
  taskLabel: string
  status: TaskExecutionStatus
  startedAt: number
  exitCode?: number
  ptyId: string
  panelPolicy?: 'shared' | 'dedicated' | 'new'
  closeOnExit?: boolean
}

export interface TaskInputRequest {
  workspaceId: string
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

/** Main → renderer: batched problem matcher output for a workspace. */
export interface TaskDiagnosticsPayload {
  workspaceId: string
  diagnostics: TaskDiagnostic[]
}

export interface TaskRunContext {
  activeFile?: string
  selectedText?: string
  lineNumber?: number
}

export type TaskTriggerSource = 'workspaceOpen' | 'fileSave' | 'manual'

export interface TaskTriggerResult {
  workspaceId: string
  taskId: string
  taskLabel: string
  source: TaskTriggerSource
  outcome: 'started' | 'skipped' | 'failed'
  message?: string
}

/** Main → renderer: PTY output (user or task terminal). */
export interface PtyDataOutPayload {
  workspaceId: string | null
  ptyId: string
  data: string
}

/** Main → renderer: PTY process exited. */
export interface PtyExitPayload {
  workspaceId: string | null
  ptyId: string
  exitCode: number
}

/** Single source of truth for the preload bridge API shape. */
export interface WindowApi {
  // Window controls
  minimizeWindow: () => void
  maximizeWindow: () => void
  closeWindow: () => void

  // Theme
  getThemeState: () => Promise<ThemeStateSnapshot>
  listThemes: () => Promise<import('./themes').ThemeDefinition[]>
  setTheme: (themeId: ThemeId) => Promise<void>
  setDefaultDarkTheme: (themeId: ThemeId) => Promise<void>
  setDefaultLightTheme: (themeId: ThemeId) => Promise<void>
  reloadThemes: () => Promise<ThemeStateSnapshot>
  openThemesDirectory: () => Promise<void>
  onThemeChanged: (callback: (state: ThemeStateSnapshot) => void) => () => void

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
  /** Effective root (active worktree or repo) for `workspaceId`, or the UI-active workspace when omitted. */
  getWorkspaceRoot: (workspaceId?: string) => Promise<string | null>

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
  getGitStatus: (workspaceId: string) => Promise<GitStatusResult | null>
  onGitStatusChanged: (callback: (payload: GitStatusChangedPayload) => void) => () => void
  onGitBranchChanged: (callback: (payload: GitBranchChangedPayload) => void) => () => void

  // Git diff
  getGitFileOriginal: (
    rootPath: string | null,
    filePath: string,
  ) => Promise<{ content: string | null }>

  // Terminal
  ptyCreate: (opts?: {
    id?: string
    workspaceId?: string
    cwd?: string
    shell?: string
    title?: string
  }) => Promise<{ id: string; scrollback: string }>
  ptyWrite: (id: string, data: string) => void
  ptyResize: (id: string, cols: number, rows: number) => void
  ptyKill: (id: string) => void
  ptyKillWorkspace: (workspaceId: string) => void
  onPtyData: (callback: (payload: PtyDataOutPayload) => void) => () => void
  onPtyExit: (callback: (payload: PtyExitPayload) => void) => () => void

  // Worktrees
  listWorktrees: (workspaceId: string) => Promise<WorktreeInfo[]>
  createWorktree: (
    workspaceId: string,
    opts: WorktreeCreateOpts,
  ) => Promise<{ path: string } | { error: string }>
  removeWorktree: (
    workspaceId: string,
    worktreePath: string,
  ) => Promise<{ success: true } | { error: string }>
  setActiveWorktree: (workspaceId: string, worktreePath: string | null) => Promise<void>
  getActiveWorktree: (workspaceId: string) => Promise<string | null>
  onWorktreeListChanged: (callback: (payload: WorktreeListChangedPayload) => void) => () => void
  listBranches: (workspaceId: string) => Promise<string[]>

  // File listing (quick open)
  listAllFiles: (rootPath: string) => Promise<string[]>

  // Search (find in files)
  searchStart: (opts: SearchOpts) => Promise<void>
  onSearchResults: (callback: (payload: SearchResultsPayload) => void) => () => void
  onSearchComplete: (callback: (payload: SearchCompletePayload) => void) => () => void
  searchCancel: () => void
  searchReplace: (
    opts: ReplaceOpts,
  ) => Promise<{ success: true; skipped: number } | { error: string }>

  // .aide project folder
  aideInit: (workspaceId?: string | null) => Promise<AideInitResult | { error: string }>
  getResolvedSettings: (workspaceId?: string | null) => Promise<ResolvedSettings>
  onAideInitResult: (callback: (result: AideInitResult) => void) => () => void

  // Settings
  getUserSettings: () => Promise<Partial<AideProjectSettings>>
  setUserSetting: (key: string, value: unknown | undefined) => Promise<void>
  getWorkspaceSettings: (workspaceId?: string | null) => Promise<AideProjectSettings>
  setWorkspaceSetting: (
    key: string,
    value: unknown | undefined,
    workspaceId?: string | null,
  ) => Promise<void>
  getBuiltInDefaults: () => Promise<ResolvedSettings>
  onSettingsChanged: (callback: (resolved: ResolvedSettings) => void) => () => void

  // Keybinding overrides
  getKeybindingOverrides: () => Promise<import('./commands').KeybindingRule[]>
  setKeybindingOverrides: (rules: import('./commands').KeybindingRule[]) => Promise<void>
  onKeybindingsChanged: (
    callback: (rules: import('./commands').KeybindingRule[]) => void,
  ) => () => void

  // Gitignore security audit
  auditGitignore: (workspaceId?: string | null) => Promise<GitignoreAuditResult>
  appendToGitignore: (patterns: string[], workspaceId?: string | null) => Promise<void>
  dismissGitignoreAudit: (workspaceId?: string | null) => Promise<void>
  onGitignoreAuditResult: (callback: (payload: GitignoreAuditIpcPayload) => void) => () => void

  // Task system
  listTasks: (workspaceId: string) => Promise<{ tasks: AideTask[]; compounds: CompoundTask[] }>
  listRunningTasks: (workspaceId: string) => Promise<TaskExecution[]>
  runTask: (
    workspaceId: string,
    taskId: string,
    context?: TaskRunContext,
  ) => Promise<{ executionId: string } | { error: string }>
  killTask: (workspaceId: string, executionId: string) => void
  reloadTasks: (workspaceId: string) => Promise<void>
  generateTasks: (workspaceId: string) => Promise<{ success: true } | { error: string }>
  provideTaskInput: (workspaceId: string, requestId: string, value: string | null) => void
  notifyFileSaved: (filePath: string) => void
  onTaskStatusChanged: (callback: (execution: TaskExecution) => void) => () => void
  onTaskRequestInput: (callback: (request: TaskInputRequest) => void) => () => void
  onTaskDiagnostics: (callback: (payload: TaskDiagnosticsPayload) => void) => () => void
  onTaskAutoDetect: (callback: (payload: TaskAutoDetectPayload) => void) => () => void
  onTaskTriggerResult: (callback: (result: TaskTriggerResult) => void) => () => void

  // Workspace registry
  listWorkspaces: () => Promise<WorkspaceEntry[]>
  createWorkspace: (rootPath: string) => Promise<WorkspaceEntry>
  createBlankWorkspace: () => Promise<WorkspaceEntry>
  removeWorkspace: (id: string) => Promise<void>
  closeWorkspace: (id: string) => Promise<void>
  switchWorkspace: (id: string) => Promise<void>
  updateWorkspace: (
    id: string,
    patch: Partial<Pick<WorkspaceEntry, 'name' | 'icon' | 'color'>>,
  ) => Promise<void>
  reorderWorkspaces: (ids: string[]) => Promise<void>
  setWorkspaceRoot: (id: string, rootPath: string) => Promise<void>
  getActiveWorkspaceId: () => Promise<string | null>
  onWorkspaceRegistryChanged: (callback: (workspaces: WorkspaceEntry[]) => void) => () => void
  getWorkspaceRuntimeSnapshots: () => Promise<WorkspaceRuntimeSnapshot[]>
  onWorkspaceRuntimeSnapshotsChanged: (
    callback: (snapshots: WorkspaceRuntimeSnapshot[]) => void,
  ) => () => void

  // State persistence
  saveWorkspaceState: (rootPath: string, state: AideLocalState) => Promise<void>
  loadWorkspaceState: (rootPath: string) => Promise<AideLocalState | null>
  saveTerminalState: (rootPath: string, state: AideLocalTerminals) => Promise<void>
  loadTerminalState: (rootPath: string) => Promise<AideLocalTerminals | null>

  // Browser panes
  browserCreate: (
    paneId: string,
    workspaceId: string,
    sessionMode: BrowserSessionMode,
  ) => Promise<{ success: true } | { error: string }>
  browserDestroy: (paneId: string) => void
  browserDestroyWorkspace: (workspaceId: string) => void
  browserNavigate: (
    paneId: string,
    url: string,
  ) => Promise<{ success: true; url: string } | { error: string }>
  browserGoBack: (paneId: string) => void
  browserGoForward: (paneId: string) => void
  browserReload: (paneId: string) => void
  browserHostUpdate: (update: BrowserHostUpdate) => void
  browserSuppressOverlays: () => void
  browserUnsuppressOverlays: () => void
  onBrowserDidNavigate: (callback: (payload: BrowserDidNavigatePayload) => void) => () => void
  onBrowserTitleUpdated: (callback: (payload: BrowserPageTitlePayload) => void) => () => void
  onBrowserLoadingChanged: (callback: (payload: BrowserLoadingPayload) => void) => () => void
  onBrowserCanNavigateChanged: (
    callback: (payload: BrowserCanNavigatePayload) => void,
  ) => () => void
  onBrowserFocusChanged: (callback: (payload: BrowserFocusPayload) => void) => () => void

  // App lifecycle
  onLifecycleRequestSave: (callback: () => void) => () => void
  lifecycleSaveComplete: () => void
  onCrashDetected: (callback: () => void) => () => void

  // ─── Agent Chat ───────────────────────────────
  chatSendMessage: (
    sessionId: string,
    payload: ChatComposerSubmission,
  ) => Promise<{ messageId: string } | { error: string }>
  chatGetHistory: (workspaceId: string, conversationId?: string) => Promise<ChatSession | null>
  chatSetMode: (sessionId: string, mode: ChatMode) => Promise<void>
  chatSetWorkingSet: (sessionId: string, paths: string[]) => Promise<void>
  chatToolApprove: (sessionId: string, toolCallId: string) => Promise<void>
  chatToolReject: (sessionId: string, toolCallId: string) => Promise<void>
  chatStop: (sessionId: string) => void
  onChatStreamChunk: (callback: (chunk: ChatStreamChunk) => void) => () => void
  onChatStreamEnd: (callback: (end: ChatStreamEnd) => void) => () => void
  onChatToolCall: (callback: (payload: ChatToolCallPayload) => void) => () => void
  chatListPendingToolApprovals: () => Promise<PendingToolApprovalInfo[]>

  // ─── MCP ���───────────────────────────────���─────
  mcpListServers: () => Promise<McpServerStatus[]>
  mcpRestartServer: (serverName: string) => Promise<{ success: true } | { error: string }>
  mcpListTools: () => Promise<ToolDefinition[]>
  onMcpServerStatus: (callback: (status: McpServerStatus) => void) => () => void

  // ─── CLI Agent ───────────────────────────────
  cliAgentStart: (
    workspaceId: string,
    backend: AgentBackend,
    conversationId?: string,
    worktreePath?: string,
  ) => Promise<{ sessionId: string } | { error: string }>
  cliAgentSwitchBackend: (
    sessionId: string,
    backend: AgentBackend,
  ) => Promise<{ success: true } | { error: string }>
  cliAgentStop: (sessionId: string) => void
  cliAgentSend: (
    sessionId: string,
    payload: ChatComposerSubmission,
  ) => Promise<{ success: true } | { error: string }>
  cliAgentGetSession: (workspaceId: string, sessionId?: string) => Promise<CliAgentSession | null>
  cliAgentLoadMessages: (workspaceId: string, conversationId: string) => Promise<CliAgentMessage[]>
  onCliAgentStreamDelta: (callback: (delta: CliAgentStreamDelta) => void) => () => void
  onCliAgentMessage: (callback: (msg: CliAgentMessagePayload) => void) => () => void
  onCliAgentStatus: (callback: (status: CliAgentStatusPayload) => void) => () => void
  onCliAgentResult: (callback: (result: CliAgentResultPayload) => void) => () => void
  onCliAgentWorkspaceCost: (callback: (summary: unknown) => void) => () => void

  // ─── CLI Agent: per-session config + listings ──
  cliAgentUpdateSessionConfig: (
    sessionId: string,
    patch: Record<string, unknown>,
  ) => Promise<{ success?: true; error?: string }>
  cliAgentListProviders: (sessionId: string) => Promise<unknown>
  cliAgentListAgents: (sessionId: string) => Promise<unknown>
  cliAgentListModes: (sessionId: string) => Promise<unknown>
  cliAgentListTools: (sessionId: string, providerID: string, modelID: string) => Promise<unknown>

  // ─── CLI Agent: session ops ────────────────────
  cliAgentSessionShare: (sessionId: string) => Promise<{ url?: string; error?: string }>
  cliAgentSessionUnshare: (sessionId: string) => Promise<{ success?: true; error?: string }>
  cliAgentSessionSummarize: (sessionId: string) => Promise<{ success?: true; error?: string }>
  cliAgentSessionRevert: (
    sessionId: string,
    messageId: string,
  ) => Promise<{ success?: true; error?: string }>
  cliAgentSessionUnrevert: (sessionId: string) => Promise<{ success?: true; error?: string }>
  cliAgentSessionFork: (
    sessionId: string,
    messageId: string,
  ) => Promise<{ newSessionId?: string; error?: string }>
  cliAgentSessionAbort: (sessionId: string) => Promise<{ success?: true; error?: string }>
  cliAgentSessionDiff: (sessionId: string) => Promise<{ diff?: unknown; error?: string }>
  cliAgentSessionTodo: (sessionId: string) => Promise<{ todos?: unknown; error?: string }>
  cliAgentSessionInit: (sessionId: string) => Promise<{ success?: true; error?: string }>
  cliAgentSessionDeleteRemote: (sessionId: string) => Promise<{ success?: true; error?: string }>

  // ─── CLI Agent: workspace ops ──────────────────
  cliAgentFileList: (
    sessionId: string,
    path: string,
  ) => Promise<{ entries?: unknown; error?: string }>
  cliAgentFileRead: (
    sessionId: string,
    path: string,
  ) => Promise<{ content?: string; error?: string }>
  cliAgentFileStatus: (sessionId: string) => Promise<{ status?: unknown; error?: string }>
  cliAgentFindText: (
    sessionId: string,
    query: string,
  ) => Promise<{ results?: unknown; error?: string }>
  cliAgentFindFiles: (
    sessionId: string,
    pattern: string,
  ) => Promise<{ paths?: unknown; error?: string }>
  cliAgentFindSymbols: (
    sessionId: string,
    query: string,
  ) => Promise<{ symbols?: unknown; error?: string }>
  cliAgentShellRun: (
    sessionId: string,
    command: string,
  ) => Promise<{ result?: unknown; error?: string }>
  cliAgentLspStatus: (sessionId: string) => Promise<{ status?: unknown; error?: string }>
  cliAgentFormatterStatus: (sessionId: string) => Promise<{ status?: unknown; error?: string }>

  // ─── CLI Agent: config / auth / providers ──────
  cliAgentConfigGet: (sessionId: string) => Promise<{ config?: unknown; error?: string }>
  cliAgentConfigUpdate: (
    sessionId: string,
    patch: Record<string, unknown>,
  ) => Promise<{ success?: true; error?: string }>
  cliAgentConfigProviders: (sessionId: string) => Promise<{ providers?: unknown; error?: string }>
  cliAgentAuthSet: (
    sessionId: string,
    key: string,
    value: string,
  ) => Promise<{ success?: true; error?: string }>
  cliAgentProviderList: (sessionId: string) => Promise<{ providers?: unknown; error?: string }>
  cliAgentProviderAuth: (
    sessionId: string,
    providerId: string,
  ) => Promise<{ methods?: unknown; error?: string }>
  cliAgentProviderOauthAuthorize: (
    sessionId: string,
    providerId: string,
  ) => Promise<{ url?: string; error?: string }>
  cliAgentProviderOauthCallback: (
    sessionId: string,
    code: string,
  ) => Promise<{ success?: true; error?: string }>
  cliAgentPathGet: (sessionId: string) => Promise<{ paths?: unknown; error?: string }>
  cliAgentLogWrite: (
    sessionId: string,
    message: string,
    level?: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR',
  ) => Promise<{ success?: true; error?: string }>
  cliAgentServerInfo: (workspaceId: string) => Promise<unknown>

  // ─── CLI Agent: TUI control ────────────────────
  cliAgentTuiAppendPrompt: (
    sessionId: string,
    text: string,
  ) => Promise<{ success?: true; error?: string }>
  cliAgentTuiSubmitPrompt: (sessionId: string) => Promise<{ success?: true; error?: string }>
  cliAgentTuiClearPrompt: (sessionId: string) => Promise<{ success?: true; error?: string }>
  cliAgentTuiOpenHelp: (sessionId: string) => Promise<{ success?: true; error?: string }>
  cliAgentTuiOpenSessions: (sessionId: string) => Promise<{ success?: true; error?: string }>
  cliAgentTuiOpenThemes: (sessionId: string) => Promise<{ success?: true; error?: string }>
  cliAgentTuiOpenModels: (sessionId: string) => Promise<{ success?: true; error?: string }>
  cliAgentTuiExecuteCommand: (
    sessionId: string,
    command: string,
  ) => Promise<{ success?: true; error?: string }>
  cliAgentTuiShowToast: (
    sessionId: string,
    args: { title?: string; message: string; variant: string },
  ) => Promise<{ success?: true; error?: string }>

  // ─── Conversation History ────────────────────
  conversationList: (workspaceId: string) => Promise<ConversationMeta[]>
  conversationCreate: (opts: ConversationCreateOpts) => Promise<ConversationMeta>
  conversationDelete: (workspaceId: string, conversationId: string) => Promise<void>
  conversationRename: (workspaceId: string, conversationId: string, title: string) => Promise<void>
  conversationGet: (workspaceId: string, conversationId: string) => Promise<ConversationMeta | null>
  onConversationListChanged: (
    callback: (payload: ConversationListChangedPayload) => void,
  ) => () => void

  // VS Code Integration
  openInVSCode: (
    rootPath: string,
    files?: Array<{ path: string; line: number; col: number }>,
  ) => Promise<{ ok: true } | { error: string }>

  // Platform info
  platform: NodeJS.Platform
}
