import { app, BaseWindow, WebContentsView, ipcMain, Menu, dialog, shell } from 'electron'
import { join, dirname, relative } from 'path'
import { existsSync, readdirSync } from 'fs'
import { execFile, execSync } from 'child_process'
import { readdir, readFile, writeFile as fsWriteFile, stat, mkdir, rm, rename } from 'fs/promises'
import Store from 'electron-store'
import { IpcChannels, DEFAULT_SETTINGS, SENSITIVE_AGENT_KEYS } from '@aide/shared'
import type {
  AppSettings,
  ChatComposerSubmission,
  ThemeId,
  DirEntry,
  SearchOpts,
  ReplaceOpts,
  TaskRunContext,
  TaskTriggerResult,
  TaskDiagnosticsPayload,
  GitignoreAuditIpcPayload,
  TaskAutoDetectPayload,
  PtyDataOutPayload,
  PtyExitPayload,
  PendingToolApprovalInfo,
} from '@aide/shared'
import { registerPtyHandlers, killAllPtys } from './terminal/ptyManager'
import { registerFileWatcherHandlers, startWatchers, stopWatchers } from './workspace/fileWatcher'
import {
  registerGitStatusHandlers,
  startGitPollingForWorkspace,
  stopGitPollingForWorkspace,
  stopAllGitPolling,
} from './git/gitStatus'
import {
  registerWorktreeHandlers,
  startWorktreePollingForWorkspace,
  stopAllWorktreePolling,
  clearWorktreeStateForWorkspace,
  getActiveWorktreeForWorkspace,
  setActiveWorktreeForWorkspace,
} from './workspace/worktreeManager'
import { startSearch, cancelSearch } from './search/ripgrepSearch'
import { ensureAideFolder } from './workspace/aideInit'
import {
  resolveAppDefaults,
  resolveSettings,
  BUILT_IN_DEFAULTS,
} from './workspace/settingsResolver'
import {
  auditGitignore,
  appendToGitignore,
  isAuditDismissed,
  dismissAudit,
} from './git/gitignoreAudit'
import { TaskRunner } from './tasks/taskRunner'
import { detectTasks, generateTasksFile, hasTasksFile } from './tasks/taskAutoDetect'
import { WorkspaceRegistry } from './workspace/workspaceRegistry'
import { WorkspaceRuntime } from './workspace/WorkspaceRuntime'
import { WorkspaceRuntimeRegistry } from './workspace/WorkspaceRuntimeRegistry'
import { getEffectiveWorkspaceRoot } from './workspace/effectiveWorkspaceRoot'
import {
  resolveEffectiveRootForWorkspace,
  resolveRepoRootForWorkspace,
  resolveWorkspaceIdForIpc,
} from './workspace/workspaceRootResolution'
import {
  saveWorkspaceState,
  loadWorkspaceState,
  saveTerminalState,
  loadTerminalState,
} from './workspace/stateSerializer'
import { BrowserPaneManager } from './browserPaneManager'
import { registerGitDiffHandlers } from './git/gitDiff'
import { AgentManager } from './chat/agentManager'
import { CliAgentManager } from './chat/cliAgentManager'
import { ApprovalRouter } from './chat/approvalRouter'
import { ConversationStore } from './chat/conversationStore'
import { ClaudeNativeSessionWatcher } from './chat/claudeNativeSessionWatcher'
import { ThemeRegistry } from './themes/themeRegistry'
import type {
  ChatMode,
  LlmProviderConfig,
  PermissionTier,
  ToolPermissionConfig,
  AgentBackend,
  ConversationCreateOpts,
  ConversationMeta,
  CliAgentMessage,
} from '@aide/shared'

const store = new Store<AppSettings>({ defaults: DEFAULT_SETTINGS })
const workspaceRegistry = new WorkspaceRegistry()
const themeRegistry = new ThemeRegistry(store, (snapshot) => {
  contentView?.webContents.send(IpcChannels.THEME_CHANGED, snapshot)
})

let mainWindow: BaseWindow | null = null
let contentView: WebContentsView | null = null
const browserPaneManager = new BrowserPaneManager({
  getWindow: () => mainWindow,
  getRendererWebContents: () => contentView?.webContents ?? null,
})
const runtimeRegistry = new WorkspaceRuntimeRegistry({
  createRuntime: (entry) =>
    new WorkspaceRuntime(entry, {
      startServices: (runtime) => startRuntimeServices(runtime),
      stopServices: (runtime) => stopRuntimeServices(runtime),
      onSnapshotChanged: () => broadcastRuntimeSnapshots(),
    }),
})

/**
 * Builds and installs the application's native menu with platform-appropriate entries.
 *
 * Includes standard Edit, View, and Window menus. On macOS an application menu with
 * About/Hide/Quit items is added. The View menu contains a "Toggle Developer Tools"
 * item that toggles the renderer devtools (accelerator: Cmd+Option+I on macOS, Ctrl+Shift+I otherwise).
 */
function buildAppMenu(): void {
  const isMac = process.platform === 'darwin'
  const sendZoomCommand = (target: 'panel', action: 'in' | 'out' | 'reset') => {
    contentView?.webContents.send(IpcChannels.APP_ZOOM_COMMAND, { target, action })
  }
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
        {
          label: 'Zoom In',
          accelerator: process.platform === 'darwin' ? 'Cmd+=' : 'Ctrl+=',
          click: () => sendZoomCommand('panel', 'in'),
        },
        {
          label: 'Zoom Out',
          accelerator: process.platform === 'darwin' ? 'Cmd+-' : 'Ctrl+-',
          click: () => sendZoomCommand('panel', 'out'),
        },
        {
          label: 'Actual Size',
          accelerator: process.platform === 'darwin' ? 'Cmd+0' : 'Ctrl+0',
          click: () => sendZoomCommand('panel', 'reset'),
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: 'Toggle Developer Tools',
          accelerator: process.platform === 'darwin' ? 'Cmd+Option+I' : 'Ctrl+Shift+I',
          click: () => {
            contentView?.webContents.toggleDevTools()
          },
        },
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

  // Set CSP via session headers — works reliably for both http:// and file:// protocols
  const isDev = !!process.env.ELECTRON_RENDERER_URL
  const csp = isDev
    ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:*"
    : "default-src 'self' file:; script-src 'self' file:; style-src 'self' 'unsafe-inline' file:"
  contentView.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    })
  })

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
    contentView.webContents.loadFile(join(__dirname, '../../renderer/dist/index.html'))
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
ipcMain.handle(IpcChannels.THEME_GET, () => themeRegistry.getSnapshot())
ipcMain.handle(IpcChannels.THEME_LIST, () => themeRegistry.listThemes())
ipcMain.handle(IpcChannels.THEME_SET, (_event, themeId: ThemeId) =>
  themeRegistry.setActiveTheme(themeId),
)
ipcMain.handle(IpcChannels.THEME_SET_DEFAULT_DARK, (_event, themeId: ThemeId) =>
  themeRegistry.setDefaultTheme('dark', themeId),
)
ipcMain.handle(IpcChannels.THEME_SET_DEFAULT_LIGHT, (_event, themeId: ThemeId) =>
  themeRegistry.setDefaultTheme('light', themeId),
)
ipcMain.handle(IpcChannels.THEME_RELOAD, () => themeRegistry.reload())
ipcMain.handle(IpcChannels.THEME_OPEN_DIRECTORY, () => themeRegistry.openThemesDirectory())

// Sidebar width IPC handlers
ipcMain.handle(IpcChannels.SIDEBAR_WIDTH_GET, () => store.get('sidebarWidth'))
ipcMain.handle(IpcChannels.SIDEBAR_WIDTH_SET, (_event, width: number) => {
  store.set('sidebarWidth', width)
})

ipcMain.handle(IpcChannels.BROWSER_ZOOM_GET, (_event, paneId: string) =>
  browserPaneManager.getZoom(paneId),
)
ipcMain.handle(IpcChannels.BROWSER_ZOOM_SET, (_event, paneId: string, zoomFactor: number) =>
  browserPaneManager.setZoom(paneId, zoomFactor),
)
ipcMain.handle(IpcChannels.BROWSER_ZOOM_ADJUST, (_event, paneId: string, delta: number) =>
  browserPaneManager.adjustZoom(paneId, delta),
)

// Workspace IPC handlers
// Open folder dialog — now delegates to workspace registry
ipcMain.handle(IpcChannels.FS_OPEN_WORKSPACE, async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle(IpcChannels.WORKSPACE_ROOT_GET, (_event, workspaceId?: string) => {
  return resolveEffectiveRootForWorkspace(workspaceRegistry, workspaceId)
})

/**
 * Broadcasts the current workspace registry to the renderer process.
 *
 * Sends a WORKSPACE_REGISTRY_CHANGED message containing the registry snapshot to the renderer
 * webContents if a content view is available.
 */
function broadcastWorkspaceRegistry(): void {
  const workspaces = workspaceRegistry.getAll()
  contentView?.webContents.send(IpcChannels.WORKSPACE_REGISTRY_CHANGED, workspaces)
}

function broadcastRuntimeSnapshots(): void {
  contentView?.webContents.send(
    IpcChannels.WORKSPACE_RUNTIME_SNAPSHOTS_CHANGED,
    runtimeRegistry.snapshotAll(),
  )
}

function getTaskRunner(runtime: WorkspaceRuntime | null): TaskRunner | null {
  return (runtime?.services.taskRunner as TaskRunner | null) ?? null
}

function getAgentManager(runtime: WorkspaceRuntime | null): AgentManager | null {
  return (runtime?.services.agentManager as AgentManager | null) ?? null
}

function getCliAgentManager(runtime: WorkspaceRuntime | null): CliAgentManager | null {
  return (runtime?.services.cliAgentManager as CliAgentManager | null) ?? null
}

function getConversationStore(runtime: WorkspaceRuntime | null): ConversationStore | null {
  return (runtime?.services.conversationStore as ConversationStore | null) ?? null
}

function getNativeSessionWatcher(
  runtime: WorkspaceRuntime | null,
): ClaudeNativeSessionWatcher | null {
  return (runtime?.services.nativeSessionWatcher as ClaudeNativeSessionWatcher | null) ?? null
}

async function loadPreferredClaudeMessages(
  conversationStore: ConversationStore | null,
  nativeSessionWatcher: ClaudeNativeSessionWatcher | null,
  conversationId: string,
  storedData?: unknown,
): Promise<CliAgentMessage[]> {
  const stored = storedData ?? (await conversationStore?.loadMessages(conversationId))
  const storedMessagesRaw =
    stored && typeof stored === 'object' ? (stored as { messages?: unknown }).messages : undefined
  const storedMessages = Array.isArray(storedMessagesRaw)
    ? (storedMessagesRaw as CliAgentMessage[])
    : []
  const storedComparable = storedMessages.filter(
    (message) =>
      message.type === 'user' ||
      message.type === 'assistant' ||
      message.type === 'tool_use' ||
      message.type === 'tool_result',
  ).length

  const meta = await conversationStore?.get(conversationId)
  const claudeSessionId =
    meta?.claudeSessionId ||
    (stored && typeof stored === 'object'
      ? ((stored as { claudeSessionId?: unknown }).claudeSessionId ??
        (stored as { backendStates?: { 'claude-code'?: { sessionId?: unknown } } }).backendStates?.[
          'claude-code'
        ]?.sessionId)
      : undefined)

  if (typeof claudeSessionId === 'string' && nativeSessionWatcher) {
    try {
      const nativeMessages = await nativeSessionWatcher.loadMessages(claudeSessionId)
      const nativeComparable = nativeMessages.filter(
        (message) =>
          message.type === 'user' ||
          message.type === 'assistant' ||
          message.type === 'tool_use' ||
          message.type === 'tool_result',
      ).length
      if (nativeMessages.length > 0 && nativeComparable > storedComparable) {
        return nativeMessages
      }
    } catch {
      // Fall through to the persisted `.aide` copy when native history is unavailable.
    }
  }

  return storedMessages
}

function getNativeSessionCache(runtime: WorkspaceRuntime | null): ConversationMeta[] {
  return (runtime?.services.nativeSessionCache as ConversationMeta[] | null) ?? []
}

function findRuntimeWithBuiltInSession(sessionId: string): WorkspaceRuntime | null {
  for (const rt of runtimeRegistry.list()) {
    const am = getAgentManager(rt)
    if (am?.ownsSession(sessionId)) return rt
  }
  return null
}

function findRuntimeWithCliSession(sessionId: string): WorkspaceRuntime | null {
  for (const rt of runtimeRegistry.list()) {
    const cm = getCliAgentManager(rt)
    if (cm?.ownsSession(sessionId)) return rt
  }
  return null
}

async function activateWorkspace(id: string): Promise<void> {
  const entry = workspaceRegistry.get(id)
  if (!entry) return
  const runtime = runtimeRegistry.getOrCreate(entry)

  workspaceRegistry.setActive(id)
  await runtime.start()
  runtimeRegistry.focus(id)
  broadcastWorkspaceRegistry()
  broadcastRuntimeSnapshots()
}

/**
 * Load LLM configuration from the settings cascade.
 * API keys support ${env:VAR} interpolation (resolved by LlmClient).
 */
function loadLlmConfig(): LlmProviderConfig {
  const userDefaults = (store.get('editorDefaults') ?? {}) as Record<string, unknown>
  const config = {
    provider: (userDefaults['agent.provider'] as string) || 'anthropic',
    model: (userDefaults['agent.model'] as string) || 'claude-sonnet-4-20250514',
    apiKey: (userDefaults['agent.apiKey'] as string) || '',
    baseUrl: (userDefaults['agent.baseUrl'] as string) || undefined,
    maxTurns: (userDefaults['agent.maxTurns'] as number) || 25,
    maxTokens: (userDefaults['agent.maxTokens'] as number) || 8192,
  }
  console.log('[loadLlmConfig]', {
    provider: config.provider,
    model: config.model,
    hasApiKey: !!config.apiKey,
    apiKeyLength: config.apiKey.length,
    apiKeyIsEnvRef: config.apiKey.includes('${env:'),
    baseUrl: config.baseUrl || '(default)',
    storeHasEditorDefaults: !!userDefaults,
    storeKeys: Object.keys(userDefaults).filter((k) => k.startsWith('agent.')),
  })
  return config
}

function loadPermissionConfig(): {
  permissionTier: PermissionTier
  autoApprove: Record<string, boolean | ToolPermissionConfig>
} {
  const userDefaults = (store.get('editorDefaults') ?? {}) as Record<string, unknown>
  return {
    permissionTier: (userDefaults['agent.permissionTier'] as PermissionTier) || 'confirm',
    autoApprove:
      (userDefaults['agent.autoApprove'] as Record<string, boolean | ToolPermissionConfig>) || {},
  }
}

async function startRuntimeServices(runtime: WorkspaceRuntime): Promise<void> {
  const rootPath = runtime.rootPath
  runtime.clearServices()
  if (!rootPath) {
    runtime.refreshWorkload()
    return
  }

  await ensureAideFolder(rootPath)

  const persistedLayout = await loadWorkspaceState(rootPath)
  if (persistedLayout?.activeWorktreePath !== undefined) {
    setActiveWorktreeForWorkspace(runtime.workspaceId, persistedLayout.activeWorktreePath)
  }

  await initTaskRunner(runtime, rootPath)

  const conversationStore = new ConversationStore(rootPath)
  let nativeSessionCache: ConversationMeta[] = []
  const nativeSessionWatcher = new ClaudeNativeSessionWatcher({
    workspaceRoot: rootPath,
    workspaceId: runtime.workspaceId,
    emit: (sessions) => {
      nativeSessionCache = sessions
      runtime.setServices({ nativeSessionCache })
      runtime.refreshWorkload()
      void conversationStore
        .loadIndex()
        .then((index) => {
          const seen = new Set(index.map((c) => c.id))
          const uniqueSessions = sessions.filter((s) => !seen.has(s.id))
          contentView?.webContents.send(IpcChannels.CONVERSATION_LIST_CHANGED, {
            workspaceId: runtime.workspaceId,
            conversations: [...index, ...uniqueSessions],
            source: 'claude-native',
          })
        })
        .catch(() => {
          contentView?.webContents.send(IpcChannels.CONVERSATION_LIST_CHANGED, {
            workspaceId: runtime.workspaceId,
            conversations: sessions,
            source: 'claude-native',
          })
        })
    },
  })
  await nativeSessionWatcher.start()

  const permConfig = loadPermissionConfig()
  const agentManager = new AgentManager({
    config: loadLlmConfig(),
    workspaceRoot: rootPath,
    getWebContents: () => contentView?.webContents ?? null,
    browserPaneManager,
    permissionTier: permConfig.permissionTier,
    autoApprove: permConfig.autoApprove,
    conversationStore,
    onWorkloadChanged: () => {
      runtime.refreshWorkload()
    },
    runWorkspaceTask: async (taskId, ctx) => {
      const tr = getTaskRunner(runtime)
      if (!tr) return { error: 'Task runner not available' }
      return tr.run(taskId, ctx)
    },
  })
  const resolved = resolveAppDefaults(store)
  const cliAgentManager = new CliAgentManager({
    workspaceRoot: rootPath,
    workspaceId: runtime.workspaceId,
    getWebContents: () => contentView?.webContents ?? null,
    claudeCodePath: resolved['agent.claudeCodePath'],
    opencodePath: resolved['agent.opencodePath'],
    codexPath: resolved['agent.codexPath'],
    conversationStore,
    loadClaudeHistory: async (claudeSessionId: string) =>
      nativeSessionWatcher.loadMessages(claudeSessionId),
    permissionTier: permConfig.permissionTier,
    autoApprove: permConfig.autoApprove,
    opencodeDefaults: {
      providerID: resolved['agent.opencode.defaultProvider'] || undefined,
      modelID: resolved['agent.opencode.defaultModel'] || undefined,
      agent: resolved['agent.opencode.defaultAgent'] || undefined,
      mode: resolved['agent.opencode.defaultMode'] || undefined,
      systemPromptOverride: resolved['agent.opencode.defaultSystemPrompt'] || undefined,
      toolToggles: resolved['agent.opencode.defaultToolToggles'] ?? undefined,
    },
    onWorkloadChanged: () => {
      runtime.refreshWorkload()
    },
  })

  // ApprovalRouter dispatches CHAT_TOOL_APPROVE / CHAT_TOOL_REJECT to whichever
  // manager owns the toolCallId, so OpenCode permission prompts and built-in
  // chat approvals share a single approval surface.
  const approvalRouter = new ApprovalRouter()
  approvalRouter.register(agentManager)
  approvalRouter.register(cliAgentManager)

  runtime.setServices({
    conversationStore,
    nativeSessionWatcher,
    nativeSessionCache,
    agentManager,
    cliAgentManager,
    approvalRouter,
  })

  const getWc = () => contentView?.webContents ?? null
  const activeWt = getActiveWorktreeForWorkspace(runtime.workspaceId)
  const watchRoots = activeWt ? [rootPath, activeWt] : [rootPath]
  await startWatchers(runtime.workspaceId, watchRoots)
  const gitPollRoot = getEffectiveWorkspaceRoot(runtime.workspaceId, rootPath) ?? rootPath
  await startGitPollingForWorkspace(runtime.workspaceId, gitPollRoot, getWc)
  await startWorktreePollingForWorkspace(runtime.workspaceId, rootPath, getWc)

  runtime.refreshWorkload()
}

async function stopRuntimeServices(runtime: WorkspaceRuntime): Promise<void> {
  getTaskRunner(runtime)?.killAll()
  getNativeSessionWatcher(runtime)?.stop()
  await getAgentManager(runtime)?.destroy()
  await getCliAgentManager(runtime)?.destroy()
  const wid = runtime.workspaceId
  await stopWatchers(wid)
  stopGitPollingForWorkspace(wid)
  clearWorktreeStateForWorkspace(wid)
}

ipcMain.handle(IpcChannels.WORKSPACE_LIST, () => {
  return workspaceRegistry.getAll()
})

ipcMain.handle(IpcChannels.WORKSPACE_CREATE, async (_event, rootPath: string) => {
  const entry = workspaceRegistry.create(rootPath)
  await activateWorkspace(entry.id)

  // Auto-detect tasks (non-blocking)
  if (!hasTasksFile(rootPath)) {
    const wid = entry.id
    detectTasks(rootPath).then((tasks) => {
      if (tasks.length > 0) {
        const payload: TaskAutoDetectPayload = { workspaceId: wid, tasks }
        contentView?.webContents.send(IpcChannels.TASK_AUTO_DETECT, payload)
      }
    })
  }

  // Gitignore audit (non-blocking)
  isAuditDismissed(rootPath).then(async (dismissed) => {
    if (dismissed) return
    const auditResult = await auditGitignore(rootPath)
    if (auditResult.missing.length > 0) {
      const payload: GitignoreAuditIpcPayload = { workspaceId: entry.id, result: auditResult }
      contentView?.webContents.send(IpcChannels.GITIGNORE_AUDIT_RESULT, payload)
    }
  })

  return entry
})

ipcMain.handle(IpcChannels.WORKSPACE_CREATE_BLANK, async () => {
  const entry = workspaceRegistry.createBlank()
  await activateWorkspace(entry.id)
  return entry
})

ipcMain.handle(IpcChannels.WORKSPACE_SET_ROOT, async (_event, id: string, rootPath: string) => {
  workspaceRegistry.setRoot(id, rootPath)
  await activateWorkspace(id)

  if (!hasTasksFile(rootPath)) {
    detectTasks(rootPath).then((tasks) => {
      if (tasks.length > 0) {
        const payload: TaskAutoDetectPayload = { workspaceId: id, tasks }
        contentView?.webContents.send(IpcChannels.TASK_AUTO_DETECT, payload)
      }
    })
  }

  isAuditDismissed(rootPath).then(async (dismissed) => {
    if (dismissed) return
    const auditResult = await auditGitignore(rootPath)
    if (auditResult.missing.length > 0) {
      const payload: GitignoreAuditIpcPayload = { workspaceId: id, result: auditResult }
      contentView?.webContents.send(IpcChannels.GITIGNORE_AUDIT_RESULT, payload)
    }
  })
})

ipcMain.handle(IpcChannels.WORKSPACE_REMOVE, async (_event, id: string) => {
  const wasActive = workspaceRegistry.getActiveId() === id
  workspaceRegistry.remove(id)
  await runtimeRegistry.delete(id)

  if (wasActive) {
    const nextId = workspaceRegistry.getActiveId()
    if (nextId) {
      await activateWorkspace(nextId)
    } else {
      await stopWatchers()
      stopAllGitPolling()
      stopAllWorktreePolling()
      runtimeRegistry.clearFocus()
      broadcastWorkspaceRegistry()
      broadcastRuntimeSnapshots()
    }
    return
  }

  broadcastWorkspaceRegistry()
  broadcastRuntimeSnapshots()
})

ipcMain.handle(IpcChannels.WORKSPACE_CLOSE, async (_event, id: string) => {
  const wasActive = workspaceRegistry.getActiveId() === id
  workspaceRegistry.close(id)
  await runtimeRegistry.delete(id)

  if (wasActive) {
    const remaining = workspaceRegistry.getSessionWorkspaces()
    const nextId = remaining[0] ?? null
    if (nextId) {
      await activateWorkspace(nextId)
    } else {
      await stopWatchers()
      stopAllGitPolling()
      stopAllWorktreePolling()
      runtimeRegistry.clearFocus()
      broadcastWorkspaceRegistry()
      broadcastRuntimeSnapshots()
    }
  } else {
    broadcastWorkspaceRegistry()
    broadcastRuntimeSnapshots()
  }
})

ipcMain.handle(IpcChannels.WORKSPACE_SWITCH, async (_event, id: string) => {
  await activateWorkspace(id)
})

ipcMain.handle(
  IpcChannels.WORKSPACE_UPDATE,
  (_event, id: string, patch: Partial<{ name: string; icon: string; color: string }>) => {
    workspaceRegistry.update(id, patch)
    const entry = workspaceRegistry.get(id)
    if (entry) {
      runtimeRegistry.get(id)?.syncEntry(entry)
    }
    broadcastWorkspaceRegistry()
    broadcastRuntimeSnapshots()
  },
)

ipcMain.handle(IpcChannels.WORKSPACE_REORDER, (_event, ids: string[]) => {
  workspaceRegistry.reorder(ids)
  broadcastWorkspaceRegistry()
  broadcastRuntimeSnapshots()
})

ipcMain.handle(IpcChannels.WORKSPACE_GET_ACTIVE, () => {
  return workspaceRegistry.getActiveId()
})

ipcMain.handle(IpcChannels.WORKSPACE_RUNTIME_SNAPSHOTS_GET, () => {
  return runtimeRegistry.snapshotAll()
})

// ─── Chat / Agent IPC handlers ─────────────────────────────────────

ipcMain.handle(
  IpcChannels.CHAT_SEND_MESSAGE,
  async (_event, sessionId: string, payload: ChatComposerSubmission) => {
    const runtime = findRuntimeWithBuiltInSession(sessionId)
    const agentManager = getAgentManager(runtime)
    if (!agentManager) return { error: 'No workspace open' }
    const result = await agentManager.sendMessage(sessionId, payload)
    runtime?.refreshWorkload()
    return result
  },
)

ipcMain.handle(
  IpcChannels.CHAT_GET_HISTORY,
  async (_event, workspaceId: string, conversationId?: string) => {
    const agentManager = getAgentManager(runtimeRegistry.get(workspaceId))
    if (!agentManager) return null
    return agentManager.getHistory(workspaceId, conversationId)
  },
)

ipcMain.handle(IpcChannels.CHAT_PENDING_TOOL_APPROVALS_LIST, (): PendingToolApprovalInfo[] => {
  const out: PendingToolApprovalInfo[] = []
  for (const rt of runtimeRegistry.list()) {
    const agentManager = getAgentManager(rt)
    if (!agentManager) continue
    out.push(...agentManager.listPendingToolApprovals())
  }
  return out
})

ipcMain.handle(IpcChannels.CHAT_SET_MODE, async (_event, sessionId: string, mode: ChatMode) => {
  const runtime = findRuntimeWithBuiltInSession(sessionId)
  const agentManager = getAgentManager(runtime)
  agentManager?.setMode(sessionId, mode)
})

ipcMain.handle(
  IpcChannels.CHAT_SET_WORKING_SET,
  async (_event, sessionId: string, paths: string[]) => {
    const runtime = findRuntimeWithBuiltInSession(sessionId)
    const agentManager = getAgentManager(runtime)
    agentManager?.setWorkingSet(sessionId, paths)
  },
)

ipcMain.handle(
  IpcChannels.CHAT_TOOL_APPROVE,
  async (_event, sessionId: string, toolCallId: string) => {
    // Find the runtime that owns this toolCallId across both managers.
    for (const runtime of runtimeRegistry.list()) {
      const router = runtime.services.approvalRouter as ApprovalRouter | null
      if (router?.approve(sessionId, toolCallId)) {
        runtime.refreshWorkload()
        return
      }
    }
  },
)

ipcMain.handle(
  IpcChannels.CHAT_TOOL_REJECT,
  async (_event, sessionId: string, toolCallId: string) => {
    for (const runtime of runtimeRegistry.list()) {
      const router = runtime.services.approvalRouter as ApprovalRouter | null
      if (router?.reject(sessionId, toolCallId)) {
        runtime.refreshWorkload()
        return
      }
    }
  },
)

ipcMain.on(IpcChannels.CHAT_STOP, (_event, sessionId: string) => {
  const runtime = findRuntimeWithBuiltInSession(sessionId)
  const agentManager = getAgentManager(runtime)
  agentManager?.stop(sessionId)
  runtime?.refreshWorkload()
})

// ─── CLI Agent IPC handlers ─────────────────────────────────────

ipcMain.handle(
  IpcChannels.CLI_AGENT_START,
  async (
    _event,
    workspaceId: string,
    backend: AgentBackend,
    conversationId?: string,
    worktreePath?: string,
  ) => {
    const runtime = runtimeRegistry.get(workspaceId)
    const cliAgentManager = getCliAgentManager(runtime)
    if (!cliAgentManager) return { error: 'No workspace open' }
    const result = await cliAgentManager.start(workspaceId, backend, conversationId, worktreePath)
    runtime?.refreshWorkload()
    return result
  },
)

ipcMain.handle(
  IpcChannels.CLI_AGENT_SWITCH_BACKEND,
  async (_event, sessionId: string, backend: AgentBackend) => {
    const runtime = findRuntimeWithCliSession(sessionId)
    const cliAgentManager = getCliAgentManager(runtime)
    if (!cliAgentManager) return { error: 'No workspace open' }
    const result = await cliAgentManager.switchBackend(sessionId, backend)
    runtime?.refreshWorkload()
    return result
  },
)

ipcMain.handle(
  IpcChannels.CLI_AGENT_SEND,
  async (_event, sessionId: string, payload: ChatComposerSubmission) => {
    const runtime = findRuntimeWithCliSession(sessionId)
    const cliAgentManager = getCliAgentManager(runtime)
    if (!cliAgentManager) return { error: 'No workspace open' }
    const result = await cliAgentManager.send(sessionId, payload)
    runtime?.refreshWorkload()
    return result
  },
)

ipcMain.handle(
  IpcChannels.CLI_AGENT_GET_SESSION,
  async (_event, workspaceId: string, sessionId?: string) => {
    const cliAgentManager = getCliAgentManager(runtimeRegistry.get(workspaceId))
    if (!cliAgentManager) return null
    if (sessionId) {
      const s = cliAgentManager.getSessionById(sessionId)
      if (!s || s.workspaceId !== workspaceId) return null
      return s
    }
    return cliAgentManager.getSession(workspaceId) ?? null
  },
)

ipcMain.handle(
  IpcChannels.CLI_AGENT_LOAD_MESSAGES,
  async (_event, workspaceId: string, conversationId: string): Promise<CliAgentMessage[]> => {
    const runtime = runtimeRegistry.get(workspaceId)
    const nativeSessionCache = getNativeSessionCache(runtime)
    const nativeSessionWatcher = getNativeSessionWatcher(runtime)
    const conversationStore = getConversationStore(runtime)
    const nativeMeta =
      nativeSessionCache.find((c) => c.id === conversationId) ??
      nativeSessionCache.find((c) => c.claudeSessionId === conversationId)
    if (
      nativeMeta?.source === 'claude-native' &&
      nativeMeta.claudeSessionId &&
      nativeSessionWatcher
    ) {
      return nativeSessionWatcher.loadMessages(nativeMeta.claudeSessionId)
    }
    const nativePrefix = 'claude-native:'
    if (conversationId.startsWith(nativePrefix) && nativeSessionWatcher) {
      const rawId = conversationId.slice(nativePrefix.length)
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId)) {
        return nativeSessionWatcher.loadMessages(rawId)
      }
    }
    return loadPreferredClaudeMessages(conversationStore, nativeSessionWatcher, conversationId)
  },
)

ipcMain.on(IpcChannels.CLI_AGENT_STOP, (_event, sessionId: string) => {
  const runtime = findRuntimeWithCliSession(sessionId)
  const cliAgentManager = getCliAgentManager(runtime)
  cliAgentManager?.stop(sessionId)
  runtime?.refreshWorkload()
})

// ─── CLI Agent: per-session config + provider/agent/mode/tool listings ──

function withCliManager<T>(
  sessionId: string,
  fn: (mgr: CliAgentManager) => Promise<T>,
): Promise<T | { error: string }> {
  const runtime = findRuntimeWithCliSession(sessionId)
  const mgr = getCliAgentManager(runtime)
  if (!mgr) return Promise.resolve({ error: 'No workspace open' } as const)
  return fn(mgr).catch((error) => ({
    error: error instanceof Error ? error.message : String(error),
  }))
}

ipcMain.handle(
  IpcChannels.CLI_AGENT_UPDATE_SESSION_CONFIG,
  async (_event, sessionId: string, patch: Record<string, unknown>) => {
    return withCliManager(sessionId, (mgr) => mgr.updateSessionConfig(sessionId, patch))
  },
)

ipcMain.handle(IpcChannels.CLI_AGENT_LIST_PROVIDERS, async (_event, sessionId: string) => {
  return withCliManager(sessionId, (mgr) => mgr.listOpenCodeProviders(sessionId))
})

ipcMain.handle(IpcChannels.CLI_AGENT_LIST_AGENTS, async (_event, sessionId: string) => {
  return withCliManager(sessionId, (mgr) => mgr.listOpenCodeAgents(sessionId))
})

ipcMain.handle(IpcChannels.CLI_AGENT_LIST_MODES, async (_event, sessionId: string) => {
  return withCliManager(sessionId, (mgr) => mgr.listOpenCodeModes(sessionId))
})

ipcMain.handle(
  IpcChannels.CLI_AGENT_LIST_TOOLS,
  async (_event, sessionId: string, providerID: string, modelID: string) => {
    return withCliManager(sessionId, (mgr) => mgr.listOpenCodeTools(sessionId, providerID, modelID))
  },
)

// ─── CLI Agent: session ops ─────────────────────────────────────────────

ipcMain.handle(IpcChannels.CLI_AGENT_SESSION_SHARE, async (_event, sessionId: string) => {
  return withCliManager(sessionId, (mgr) => mgr.sessionShare(sessionId))
})

ipcMain.handle(IpcChannels.CLI_AGENT_SESSION_UNSHARE, async (_event, sessionId: string) => {
  return withCliManager(sessionId, (mgr) => mgr.sessionUnshare(sessionId))
})

ipcMain.handle(IpcChannels.CLI_AGENT_SESSION_SUMMARIZE, async (_event, sessionId: string) => {
  return withCliManager(sessionId, (mgr) => mgr.sessionSummarize(sessionId))
})

ipcMain.handle(
  IpcChannels.CLI_AGENT_SESSION_REVERT,
  async (_event, sessionId: string, messageId: string) => {
    return withCliManager(sessionId, (mgr) => mgr.sessionRevert(sessionId, messageId))
  },
)

ipcMain.handle(IpcChannels.CLI_AGENT_SESSION_UNREVERT, async (_event, sessionId: string) => {
  return withCliManager(sessionId, (mgr) => mgr.sessionUnrevert(sessionId))
})

ipcMain.handle(
  IpcChannels.CLI_AGENT_SESSION_FORK,
  async (_event, sessionId: string, messageId: string) => {
    return withCliManager(sessionId, (mgr) => mgr.sessionFork(sessionId, messageId))
  },
)

ipcMain.handle(IpcChannels.CLI_AGENT_SESSION_ABORT, async (_event, sessionId: string) => {
  return withCliManager(sessionId, (mgr) => mgr.sessionAbort(sessionId))
})

ipcMain.handle(IpcChannels.CLI_AGENT_SESSION_DIFF, async (_event, sessionId: string) => {
  return withCliManager(sessionId, (mgr) => mgr.sessionDiff(sessionId))
})

ipcMain.handle(IpcChannels.CLI_AGENT_SESSION_TODO, async (_event, sessionId: string) => {
  return withCliManager(sessionId, (mgr) => mgr.sessionTodo(sessionId))
})

ipcMain.handle(IpcChannels.CLI_AGENT_SESSION_INIT, async (_event, sessionId: string) => {
  return withCliManager(sessionId, (mgr) => mgr.sessionInit(sessionId))
})

ipcMain.handle(IpcChannels.CLI_AGENT_SESSION_DELETE_REMOTE, async (_event, sessionId: string) => {
  return withCliManager(sessionId, (mgr) => mgr.sessionDeleteRemote(sessionId))
})

// ─── CLI Agent: workspace ops ───────────────────────────────────────────

ipcMain.handle(IpcChannels.CLI_AGENT_FILE_LIST, async (_event, sessionId: string, path: string) => {
  return withCliManager(sessionId, (mgr) => mgr.fileList(sessionId, path))
})

ipcMain.handle(IpcChannels.CLI_AGENT_FILE_READ, async (_event, sessionId: string, path: string) => {
  return withCliManager(sessionId, (mgr) => mgr.fileRead(sessionId, path))
})

ipcMain.handle(IpcChannels.CLI_AGENT_FILE_STATUS, async (_event, sessionId: string) => {
  return withCliManager(sessionId, (mgr) => mgr.fileStatus(sessionId))
})

ipcMain.handle(
  IpcChannels.CLI_AGENT_FIND_TEXT,
  async (_event, sessionId: string, query: string) => {
    return withCliManager(sessionId, (mgr) => mgr.findText(sessionId, query))
  },
)

ipcMain.handle(
  IpcChannels.CLI_AGENT_FIND_FILES,
  async (_event, sessionId: string, pattern: string) => {
    return withCliManager(sessionId, (mgr) => mgr.findFiles(sessionId, pattern))
  },
)

ipcMain.handle(
  IpcChannels.CLI_AGENT_FIND_SYMBOLS,
  async (_event, sessionId: string, query: string) => {
    return withCliManager(sessionId, (mgr) => mgr.findSymbols(sessionId, query))
  },
)

ipcMain.handle(
  IpcChannels.CLI_AGENT_SHELL_RUN,
  async (_event, sessionId: string, command: string) => {
    return withCliManager(sessionId, (mgr) => mgr.shellRun(sessionId, command))
  },
)

ipcMain.handle(IpcChannels.CLI_AGENT_LSP_STATUS, async (_event, sessionId: string) => {
  return withCliManager(sessionId, (mgr) => mgr.lspStatus(sessionId))
})

ipcMain.handle(IpcChannels.CLI_AGENT_FORMATTER_STATUS, async (_event, sessionId: string) => {
  return withCliManager(sessionId, (mgr) => mgr.formatterStatus(sessionId))
})

// ─── CLI Agent: config / auth / providers ───────────────────────────────

ipcMain.handle(IpcChannels.CLI_AGENT_CONFIG_GET, async (_event, sessionId: string) => {
  return withCliManager(sessionId, (mgr) => mgr.configGet(sessionId))
})

ipcMain.handle(
  IpcChannels.CLI_AGENT_CONFIG_UPDATE,
  async (_event, sessionId: string, patch: Record<string, unknown>) => {
    return withCliManager(sessionId, (mgr) => mgr.configUpdate(sessionId, patch))
  },
)

ipcMain.handle(IpcChannels.CLI_AGENT_CONFIG_PROVIDERS, async (_event, sessionId: string) => {
  return withCliManager(sessionId, (mgr) => mgr.configProviders(sessionId))
})

ipcMain.handle(
  IpcChannels.CLI_AGENT_AUTH_SET,
  async (_event, sessionId: string, key: string, value: string) => {
    return withCliManager(sessionId, (mgr) => mgr.authSet(sessionId, key, value))
  },
)

ipcMain.handle(IpcChannels.CLI_AGENT_PROVIDER_LIST, async (_event, sessionId: string) => {
  return withCliManager(sessionId, (mgr) => mgr.providerList(sessionId))
})

ipcMain.handle(
  IpcChannels.CLI_AGENT_PROVIDER_AUTH,
  async (_event, sessionId: string, providerId: string) => {
    return withCliManager(sessionId, (mgr) => mgr.providerAuth(sessionId, providerId))
  },
)

ipcMain.handle(
  IpcChannels.CLI_AGENT_PROVIDER_OAUTH_AUTHORIZE,
  async (_event, sessionId: string, providerId: string) => {
    return withCliManager(sessionId, (mgr) => mgr.providerOauthAuthorize(sessionId, providerId))
  },
)

ipcMain.handle(
  IpcChannels.CLI_AGENT_PROVIDER_OAUTH_CALLBACK,
  async (_event, sessionId: string, code: string) => {
    return withCliManager(sessionId, (mgr) => mgr.providerOauthCallback(sessionId, code))
  },
)

ipcMain.handle(IpcChannels.CLI_AGENT_PATH_GET, async (_event, sessionId: string) => {
  return withCliManager(sessionId, (mgr) => mgr.pathGet(sessionId))
})

ipcMain.handle(
  IpcChannels.CLI_AGENT_LOG_WRITE,
  async (
    _event,
    sessionId: string,
    message: string,
    level?: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR',
  ) => {
    return withCliManager(sessionId, (mgr) => mgr.logWrite(sessionId, message, level))
  },
)

ipcMain.handle(IpcChannels.CLI_AGENT_SERVER_INFO, async (_event, workspaceId: string) => {
  const runtime = runtimeRegistry.get(workspaceId)
  const mgr = getCliAgentManager(runtime)
  return mgr?.serverInfo() ?? null
})

// ─── CLI Agent: TUI control ─────────────────────────────────────────────

const TUI_HANDLERS: Array<{
  channel: string
  method:
    | 'appendPrompt'
    | 'submitPrompt'
    | 'clearPrompt'
    | 'openHelp'
    | 'openSessions'
    | 'openThemes'
    | 'openModels'
    | 'executeCommand'
    | 'showToast'
}> = [
  { channel: IpcChannels.CLI_AGENT_TUI_APPEND_PROMPT, method: 'appendPrompt' },
  { channel: IpcChannels.CLI_AGENT_TUI_SUBMIT_PROMPT, method: 'submitPrompt' },
  { channel: IpcChannels.CLI_AGENT_TUI_CLEAR_PROMPT, method: 'clearPrompt' },
  { channel: IpcChannels.CLI_AGENT_TUI_OPEN_HELP, method: 'openHelp' },
  { channel: IpcChannels.CLI_AGENT_TUI_OPEN_SESSIONS, method: 'openSessions' },
  { channel: IpcChannels.CLI_AGENT_TUI_OPEN_THEMES, method: 'openThemes' },
  { channel: IpcChannels.CLI_AGENT_TUI_OPEN_MODELS, method: 'openModels' },
  { channel: IpcChannels.CLI_AGENT_TUI_EXECUTE_COMMAND, method: 'executeCommand' },
  { channel: IpcChannels.CLI_AGENT_TUI_SHOW_TOAST, method: 'showToast' },
]
for (const { channel, method } of TUI_HANDLERS) {
  ipcMain.handle(channel, async (_event, sessionId: string, args?: Record<string, unknown>) => {
    return withCliManager(sessionId, (mgr) => mgr.tui(sessionId, method, args))
  })
}

// ─── Conversation History IPC handlers ──────────────────────────

ipcMain.handle(IpcChannels.CONVERSATION_LIST, async (_event, workspaceId: string) => {
  const runtime = runtimeRegistry.get(workspaceId)
  const conversationStore = getConversationStore(runtime)
  const nativeSessionCache = getNativeSessionCache(runtime)
  const aideConvos = (await conversationStore?.loadIndex()) ?? []
  return [...aideConvos, ...nativeSessionCache]
})

ipcMain.handle(IpcChannels.CONVERSATION_CREATE, async (_event, opts: ConversationCreateOpts) => {
  const runtime = runtimeRegistry.get(opts.workspaceId)
  const conversationStore = getConversationStore(runtime)
  if (!conversationStore) return { error: 'No workspace open' }
  const meta = await conversationStore.create(opts)
  const index = await conversationStore.loadIndex()
  const nativeSessionCache = getNativeSessionCache(runtime)
  contentView?.webContents.send(IpcChannels.CONVERSATION_LIST_CHANGED, {
    workspaceId: opts.workspaceId,
    conversations: [...index, ...nativeSessionCache],
  })
  return meta
})

ipcMain.handle(
  IpcChannels.CONVERSATION_DELETE,
  async (_event, workspaceId: string, conversationId: string) => {
    const runtime = runtimeRegistry.get(workspaceId)
    const conversationStore = getConversationStore(runtime)
    const agentManager = getAgentManager(runtime)
    const cliAgentManager = getCliAgentManager(runtime)
    if (!conversationStore) return
    const meta = await conversationStore.get(conversationId)
    if (meta && meta.workspaceId !== workspaceId) return
    await conversationStore.delete(conversationId)
    agentManager?.stop(conversationId)
    cliAgentManager?.stop(conversationId)
    const nativeSessionCache = getNativeSessionCache(runtime)
    if (meta) {
      const index = await conversationStore.loadIndex()
      contentView?.webContents.send(IpcChannels.CONVERSATION_LIST_CHANGED, {
        workspaceId,
        conversations: [...index, ...nativeSessionCache],
      })
    }
  },
)

ipcMain.handle(
  IpcChannels.CONVERSATION_RENAME,
  async (_event, workspaceId: string, conversationId: string, title: string) => {
    const runtime = runtimeRegistry.get(workspaceId)
    const conversationStore = getConversationStore(runtime)
    if (!conversationStore) return
    const existing = await conversationStore.get(conversationId)
    if (!existing || existing.workspaceId !== workspaceId) return
    await conversationStore.updateMeta(conversationId, {
      title,
      autoTitled: false,
      updatedAt: Date.now(),
    })
    const meta = await conversationStore.get(conversationId)
    if (meta) {
      const index = await conversationStore.loadIndex()
      const nativeSessionCache = getNativeSessionCache(runtime)
      contentView?.webContents.send(IpcChannels.CONVERSATION_LIST_CHANGED, {
        workspaceId,
        conversations: [...index, ...nativeSessionCache],
      })
    }
  },
)

ipcMain.handle(
  IpcChannels.CONVERSATION_GET,
  async (_event, workspaceId: string, conversationId: string) => {
    const runtime = runtimeRegistry.get(workspaceId)
    const conversationStore = getConversationStore(runtime)
    const meta = await conversationStore?.get(conversationId)
    if (meta && meta.workspaceId !== workspaceId) return null
    return meta ?? null
  },
)

// State persistence IPC handlers
ipcMain.handle(
  IpcChannels.STATE_SAVE,
  async (_event, rootPath: string, state: import('@aide/shared').AideLocalState) => {
    await saveWorkspaceState(rootPath, state)
  },
)

ipcMain.handle(IpcChannels.STATE_LOAD, async (_event, rootPath: string) => {
  return loadWorkspaceState(rootPath)
})

ipcMain.handle(
  IpcChannels.STATE_SAVE_TERMINALS,
  async (_event, rootPath: string, state: import('@aide/shared').AideLocalTerminals) => {
    await saveTerminalState(rootPath, state)
  },
)

ipcMain.handle(IpcChannels.STATE_LOAD_TERMINALS, async (_event, rootPath: string) => {
  return loadTerminalState(rootPath)
})

// Browser pane IPC handlers
ipcMain.handle(
  IpcChannels.BROWSER_CREATE,
  (
    _event,
    paneId: string,
    workspaceId: string,
    sessionMode: import('@aide/shared').BrowserSessionMode,
  ) => {
    return browserPaneManager.create(paneId, workspaceId, sessionMode)
  },
)

ipcMain.on(IpcChannels.BROWSER_DESTROY, (_event, paneId: string) => {
  browserPaneManager.destroy(paneId)
})

ipcMain.on(IpcChannels.BROWSER_DESTROY_WORKSPACE, (_event, workspaceId: string) => {
  browserPaneManager.destroyWorkspace(workspaceId)
})

ipcMain.handle(IpcChannels.BROWSER_NAVIGATE, async (_event, paneId: string, url: string) => {
  return browserPaneManager.navigate(paneId, url)
})

ipcMain.on(IpcChannels.BROWSER_GO_BACK, (_event, paneId: string) => {
  browserPaneManager.goBack(paneId)
})

ipcMain.on(IpcChannels.BROWSER_GO_FORWARD, (_event, paneId: string) => {
  browserPaneManager.goForward(paneId)
})

ipcMain.on(IpcChannels.BROWSER_RELOAD, (_event, paneId: string) => {
  browserPaneManager.reload(paneId)
})

ipcMain.on(
  IpcChannels.BROWSER_HOST_UPDATE,
  (_event, update: import('@aide/shared').BrowserHostUpdate) => {
    browserPaneManager.handleHostUpdate(update)
  },
)

ipcMain.on(IpcChannels.BROWSER_SUPPRESS_OVERLAYS, () => {
  browserPaneManager.suppressOverlays()
})

ipcMain.on(IpcChannels.BROWSER_UNSUPPRESS_OVERLAYS, () => {
  browserPaneManager.unsuppressOverlays()
})

// Full .aide initialization (on-demand from command palette)
ipcMain.handle(IpcChannels.AIDE_INIT, async (_event, workspaceId?: string | null) => {
  const rootPath = resolveRepoRootForWorkspace(workspaceRegistry, workspaceId)
  if (!rootPath) return { error: 'No workspace folder open' }

  const wid = resolveWorkspaceIdForIpc(workspaceRegistry, workspaceId)
  const initResult = await ensureAideFolder(rootPath)

  // Generate tasks if none exist
  if (!hasTasksFile(rootPath)) {
    const tasks = await detectTasks(rootPath)
    if (tasks.length > 0) {
      await generateTasksFile(rootPath, tasks)
    }
  }

  // Run gitignore audit
  const dismissed = await isAuditDismissed(rootPath)
  if (!dismissed) {
    const auditResult = await auditGitignore(rootPath)
    if (auditResult.missing.length > 0 && wid) {
      const payload: GitignoreAuditIpcPayload = { workspaceId: wid, result: auditResult }
      contentView?.webContents.send(IpcChannels.GITIGNORE_AUDIT_RESULT, payload)
    }
  }

  return initResult
})

// .aide settings IPC handler
ipcMain.handle(
  IpcChannels.AIDE_GET_RESOLVED_SETTINGS,
  async (_event, workspaceId?: string | null) => {
    const rootPath = resolveRepoRootForWorkspace(workspaceRegistry, workspaceId)
    if (!rootPath) return resolveAppDefaults(store)
    return resolveSettings(rootPath, store)
  },
)

// Settings IPC handlers
ipcMain.handle(IpcChannels.SETTINGS_GET_DEFAULTS, () => BUILT_IN_DEFAULTS)

ipcMain.handle(IpcChannels.SETTINGS_GET_USER, () => {
  return store.get('editorDefaults') ?? {}
})

ipcMain.handle(IpcChannels.SETTINGS_SET_USER, async (_event, key: string, value: unknown) => {
  let current = (store.get('editorDefaults') ?? {}) as Record<string, unknown>
  if (value === undefined || value === null) {
    current = Object.fromEntries(Object.entries(current).filter(([entryKey]) => entryKey !== key))
  } else {
    current[key] = value
  }
  store.set('editorDefaults', current)

  // Push agent config updates to AgentManager if an agent.* key changed
  if (key.startsWith('agent.')) {
    const config = loadLlmConfig()
    const permConfig = loadPermissionConfig()
    const appDefs = resolveAppDefaults(store)
    for (const runtime of runtimeRegistry.list()) {
      getAgentManager(runtime)?.updateConfig(config)
      getAgentManager(runtime)?.updatePermissions(permConfig.permissionTier, permConfig.autoApprove)
      // Mirror permission updates into the CLI agent manager so OpenCode
      // permission decisions stay in sync with live tier changes.
      const cm = getCliAgentManager(runtime)
      cm?.updatePermissions(permConfig.permissionTier, permConfig.autoApprove)
      // Refresh OpenCode session-default seeds whenever any opencode default
      // is touched. New sessions started afterwards inherit the new values;
      // existing sessions retain their per-session overrides.
      cm?.updateOpencodeDefaults({
        providerID: appDefs['agent.opencode.defaultProvider'] || undefined,
        modelID: appDefs['agent.opencode.defaultModel'] || undefined,
        agent: appDefs['agent.opencode.defaultAgent'] || undefined,
        mode: appDefs['agent.opencode.defaultMode'] || undefined,
        systemPromptOverride: appDefs['agent.opencode.defaultSystemPrompt'] || undefined,
        toolToggles: appDefs['agent.opencode.defaultToolToggles'] ?? undefined,
      })
      runtime.refreshWorkload()
    }
  }

  // Push CLI agent path updates
  if (key === 'agent.claudeCodePath' || key === 'agent.opencodePath' || key === 'agent.codexPath') {
    const appDefs = resolveAppDefaults(store)
    for (const runtime of runtimeRegistry.list()) {
      getCliAgentManager(runtime)?.updatePaths(
        appDefs['agent.claudeCodePath'],
        appDefs['agent.opencodePath'],
        appDefs['agent.codexPath'],
      )
    }
  }

  // Phase 8: only allowlisted implicit-active use — merged project settings for the focused workspace
  const rootPath = resolveRepoRootForWorkspace(workspaceRegistry, undefined)
  const resolved = rootPath ? await resolveSettings(rootPath, store) : resolveAppDefaults(store)
  contentView?.webContents.send(IpcChannels.SETTINGS_CHANGED, resolved)
})

ipcMain.handle(IpcChannels.SETTINGS_GET_WORKSPACE, async (_event, workspaceId?: string | null) => {
  const rootPath = resolveRepoRootForWorkspace(workspaceRegistry, workspaceId)
  if (!rootPath) return {}
  const settingsPath = join(rootPath, '.aide', 'settings.json')
  if (!existsSync(settingsPath)) return {}
  try {
    const raw = await readFile(settingsPath, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
})

ipcMain.handle(
  IpcChannels.SETTINGS_SET_WORKSPACE,
  async (_event, key: string, value: unknown, workspaceId?: string | null) => {
    // Block sensitive agent keys from being written to project-level settings
    if (SENSITIVE_AGENT_KEYS.has(key)) return

    const rootPath = resolveRepoRootForWorkspace(workspaceRegistry, workspaceId)
    if (!rootPath) return

    const settingsPath = join(rootPath, '.aide', 'settings.json')

    // Ensure .aide directory exists
    const aideDir = join(rootPath, '.aide')
    if (!existsSync(aideDir)) await mkdir(aideDir, { recursive: true })

    // Read existing settings
    let current: Record<string, unknown> = {}
    if (existsSync(settingsPath)) {
      try {
        const raw = await readFile(settingsPath, 'utf-8')
        current = JSON.parse(raw)
      } catch {
        current = {}
      }
    }

    if (value === undefined || value === null) {
      current = Object.fromEntries(Object.entries(current).filter(([entryKey]) => entryKey !== key))
    } else {
      current[key] = value
    }

    await fsWriteFile(settingsPath, JSON.stringify(current, null, 2) + '\n', 'utf-8')

    // Broadcast resolved settings
    const resolved = await resolveSettings(rootPath, store)
    contentView?.webContents.send(IpcChannels.SETTINGS_CHANGED, resolved)
  },
)

// Keybinding overrides IPC handlers
// Migrate old Record<commandId, keybinding> format to KeybindingRule[] on first read
function migrateKeybindingOverrides(
  stored: unknown,
): { key: string; command: string; when?: string }[] {
  if (Array.isArray(stored)) return stored
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    const migrated = Object.entries(stored as Record<string, string>).map(([command, key]) => ({
      key,
      command,
    }))
    store.set('keybindingOverrides', migrated)
    return migrated
  }
  return []
}

ipcMain.handle(IpcChannels.KEYBINDINGS_GET, () => {
  return migrateKeybindingOverrides(store.get('keybindingOverrides'))
})

ipcMain.handle(
  IpcChannels.KEYBINDINGS_SET,
  async (_event, rules: { key: string; command: string; when?: string }[]) => {
    store.set('keybindingOverrides', rules)
    contentView?.webContents.send(IpcChannels.KEYBINDINGS_CHANGED, rules)
  },
)

// Gitignore security audit IPC handlers
ipcMain.handle(IpcChannels.GITIGNORE_AUDIT, async (_event, workspaceId?: string | null) => {
  const rootPath = resolveRepoRootForWorkspace(workspaceRegistry, workspaceId)
  if (!rootPath) return { missing: [], total: 0 }
  return auditGitignore(rootPath)
})

ipcMain.handle(
  IpcChannels.GITIGNORE_APPEND,
  async (_event, patterns: string[], workspaceId?: string | null) => {
    const rootPath = resolveRepoRootForWorkspace(workspaceRegistry, workspaceId)
    if (!rootPath) return
    await appendToGitignore(rootPath, patterns)
  },
)

ipcMain.handle(IpcChannels.GITIGNORE_DISMISS, async (_event, workspaceId?: string | null) => {
  const rootPath = resolveRepoRootForWorkspace(workspaceRegistry, workspaceId)
  if (!rootPath) return
  await dismissAudit(rootPath)
})

/**
 * Initializes the module-level TaskRunner for the given workspace and forwards its events to the renderer via IPC.
 *
 * Loads task definitions after creating the runner and attaches handlers that propagate status, input requests,
 * diagnostics, PTY output, and PTY exit events to the renderer process. After loading, schedules any
 * runOn.workspaceOpen tasks.
 *
 * @param rootPath - Filesystem path of the workspace to manage tasks for
 */
async function initTaskRunner(runtime: WorkspaceRuntime, rootPath: string): Promise<void> {
  const getWc = () => contentView?.webContents ?? null
  runtime.resetWorkspaceOpenScheduled()
  const wid = runtime.workspaceId
  const taskRunner = new TaskRunner(rootPath, wid, {
    onStatusChanged: (execution) => {
      getWc()?.send(IpcChannels.TASK_STATUS_CHANGED, execution)
      runtime.refreshWorkload()
    },
    onRequestInput: (request) => {
      getWc()?.send(IpcChannels.TASK_REQUEST_INPUT, request)
      runtime.refreshWorkload()
    },
    onDiagnostics: (diagnostics) => {
      const payload: TaskDiagnosticsPayload = { workspaceId: wid, diagnostics }
      getWc()?.send(IpcChannels.TASK_DIAGNOSTICS, payload)
    },
    onPtyData: (ptyId, data) => {
      const payload: PtyDataOutPayload = { workspaceId: wid, ptyId, data }
      getWc()?.send(IpcChannels.PTY_DATA_OUT, payload)
    },
    onPtyExit: (ptyId, exitCode) => {
      const payload: PtyExitPayload = { workspaceId: wid, ptyId, exitCode }
      getWc()?.send(IpcChannels.PTY_EXIT, payload)
    },
  })
  runtime.setServices({ taskRunner })
  const loaded = await taskRunner.loadTasks()
  runtime.refreshWorkload()
  if (loaded) {
    scheduleWorkspaceOpenTasks(runtime, rootPath, getWc)
  }
}

/**
 * Schedule runOn.workspaceOpen tasks after workspace initialization.
 * Skips tasks that are already running (singleton guard) and respects per-task delay.
 */
function scheduleWorkspaceOpenTasks(
  runtime: WorkspaceRuntime,
  rootPath: string,
  getWc: () => Electron.WebContents | null,
): void {
  const taskRunner = getTaskRunner(runtime)
  if (!taskRunner || runtime.isWorkspaceOpenScheduled()) return
  runtime.markWorkspaceOpenScheduled()

  const tasks = taskRunner.getWorkspaceOpenTasks()
  if (tasks.length === 0) return

  const eff = getEffectiveWorkspaceRoot(runtime.workspaceId, rootPath) ?? rootPath
  const ctx = {
    workspaceRoot: eff,
    workspaceName: eff.split('/').pop() ?? eff,
  }

  for (const task of tasks) {
    if (taskRunner.isTaskRunning(task.id)) {
      const result: TaskTriggerResult = {
        workspaceId: runtime.workspaceId,
        taskId: task.id,
        taskLabel: task.label,
        source: 'workspaceOpen',
        outcome: 'skipped',
        message: 'Already running',
      }
      getWc()?.send(IpcChannels.TASK_TRIGGER_RESULT, result)
      continue
    }

    const delay = task.runOn?.delay ?? 0
    const seqAtSchedule = runtime.getLifecycle().activationSeq
    const launch = () => {
      if (!runtime.acceptsActivation(seqAtSchedule) || !taskRunner) return
      taskRunner.run(task.id, ctx).then((execResult) => {
        runtime.refreshWorkload()
        const result: TaskTriggerResult = {
          workspaceId: runtime.workspaceId,
          taskId: task.id,
          taskLabel: task.label,
          source: 'workspaceOpen',
          outcome: 'error' in execResult ? 'failed' : 'started',
          message: 'error' in execResult ? execResult.error : undefined,
        }
        getWc()?.send(IpcChannels.TASK_TRIGGER_RESULT, result)
      })
    }

    if (delay > 0) {
      setTimeout(launch, delay)
    } else {
      launch()
    }
  }
}

ipcMain.handle(IpcChannels.TASK_LIST, async (_event, workspaceId: string) => {
  const taskRunner = getTaskRunner(runtimeRegistry.get(workspaceId))
  if (!taskRunner) return { tasks: [], compounds: [] }
  await taskRunner.loadTasks()
  return { tasks: taskRunner.getTasks(), compounds: taskRunner.getCompounds() }
})

ipcMain.handle(IpcChannels.TASK_LIST_RUNNING, async (_event, workspaceId: string) => {
  const taskRunner = getTaskRunner(runtimeRegistry.get(workspaceId))
  return taskRunner?.getRunning() ?? []
})

ipcMain.handle(
  IpcChannels.TASK_RUN,
  async (_event, workspaceId: string, taskId: string, context?: TaskRunContext) => {
    const runtime = runtimeRegistry.get(workspaceId)
    const taskRunner = getTaskRunner(runtime)
    if (!taskRunner) return { error: 'No workspace open' }
    const rootPath = runtime?.rootPath ?? null
    if (!rootPath) return { error: 'No workspace open' }

    const eff = getEffectiveWorkspaceRoot(workspaceId, rootPath) ?? rootPath
    const ctx = {
      workspaceRoot: eff,
      workspaceName: eff.split('/').pop() ?? eff,
      activeFile: context?.activeFile,
      selectedText: context?.selectedText,
      lineNumber: context?.lineNumber,
    }
    const result = await taskRunner.run(taskId, ctx)
    runtime?.refreshWorkload()
    return result
  },
)

ipcMain.on(IpcChannels.TASK_KILL, (_event, workspaceId: string, executionId: string) => {
  const runtime = runtimeRegistry.get(workspaceId)
  const taskRunner = getTaskRunner(runtime)
  taskRunner?.kill(executionId)
  runtime?.refreshWorkload()
})

ipcMain.handle(IpcChannels.TASK_RELOAD, async (_event, workspaceId: string) => {
  const taskRunner = getTaskRunner(runtimeRegistry.get(workspaceId))
  await taskRunner?.loadTasks()
})

ipcMain.on(
  IpcChannels.TASK_PROVIDE_INPUT,
  (_event, workspaceId: string, requestId: string, value: string | null) => {
    const runtime = runtimeRegistry.get(workspaceId)
    const taskRunner = getTaskRunner(runtime)
    taskRunner?.provideInput(requestId, value)
    runtime?.refreshWorkload()
  },
)

ipcMain.handle(IpcChannels.TASK_GENERATE, async (_event, workspaceId: string) => {
  const entry = workspaceRegistry.get(workspaceId)
  const rootPath = entry?.rootPath ?? null
  if (!rootPath) return { error: 'No workspace open' }
  const tasks = await detectTasks(rootPath)
  if (tasks.length === 0) return { error: 'No tasks detected' }
  return generateTasksFile(rootPath, tasks)
})

ipcMain.on(IpcChannels.TASK_FILE_SAVED, (_event, filePath: string) => {
  const runtime = runtimeRegistry.findByFilePath(filePath)
  if (!runtime) return
  const taskRunner = getTaskRunner(runtime)
  if (!taskRunner) return
  const rootPath = runtime.rootPath
  if (!rootPath) return
  const getWc = () => contentView?.webContents ?? null

  const relativePath = relative(rootPath, filePath).split(/[\\/]/).join('/')
  const tasks = taskRunner.getFileSaveTasks(relativePath)

  const seqAtSchedule = runtime.getLifecycle().activationSeq

  for (const task of tasks) {
    if (taskRunner.isTaskRunning(task.id)) continue

    const delay = task.runOn?.delay ?? 0
    const run = () => {
      if (!runtime.acceptsActivation(seqAtSchedule) || !taskRunner) return
      const eff = getEffectiveWorkspaceRoot(runtime.workspaceId, rootPath) ?? rootPath
      const ctx = {
        workspaceRoot: eff,
        workspaceName: eff.split('/').pop() ?? eff,
      }
      taskRunner.run(task.id, ctx).then((result) => {
        runtime.refreshWorkload()
        const triggerResult: TaskTriggerResult = {
          workspaceId: runtime.workspaceId,
          taskId: task.id,
          taskLabel: task.label,
          source: 'fileSave',
          outcome: 'error' in result ? 'failed' : 'started',
          message: 'error' in result ? result.error : undefined,
        }
        getWc()?.send(IpcChannels.TASK_TRIGGER_RESULT, triggerResult)
      })
    }

    if (delay > 0) {
      setTimeout(run, delay)
    } else {
      run()
    }
  }
})

// Filesystem IPC handlers
const HIDDEN_FILES = new Set(['.DS_Store', 'Thumbs.db'])

ipcMain.handle(
  IpcChannels.FS_READ_DIR,
  async (_event, dirPath: string): Promise<DirEntry[] | { error: string }> => {
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
  },
)

// Read file IPC handler — enforces 10 MB limit, rejects binary files
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

ipcMain.handle(
  IpcChannels.FS_READ_FILE,
  async (_event, filePath: string): Promise<{ content: string } | { error: string }> => {
    try {
      const info = await stat(filePath)
      if (!info.isFile()) return { error: 'Not a file' }
      if (info.size > MAX_FILE_SIZE)
        return {
          error: `File too large (${(info.size / 1024 / 1024).toFixed(1)} MB). Maximum is 10 MB.`,
        }

      const content = await readFile(filePath, 'utf-8')

      // Check for binary content (null bytes in first 8 KB)
      const sample = content.slice(0, 8192)
      if (sample.includes('\0')) return { error: 'Binary file — cannot display' }

      return { content }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error reading file'
      return { error: message }
    }
  },
)

// Write file IPC handler
ipcMain.handle(
  IpcChannels.FS_WRITE_FILE,
  async (
    _event,
    filePath: string,
    content: string,
  ): Promise<{ success: true } | { error: string }> => {
    try {
      await fsWriteFile(filePath, content, 'utf-8')
      return { success: true }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error writing file'
      return { error: message }
    }
  },
)

// Create file IPC handler
ipcMain.handle(
  IpcChannels.FS_CREATE_FILE,
  async (_event, filePath: string): Promise<{ success: true } | { error: string }> => {
    try {
      // Check if already exists
      try {
        await stat(filePath)
        return { error: 'File already exists' }
      } catch {
        // Expected — file doesn't exist yet
      }
      // Ensure parent directory exists
      await mkdir(dirname(filePath), { recursive: true })
      await fsWriteFile(filePath, '', 'utf-8')
      return { success: true }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error creating file'
      return { error: message }
    }
  },
)

// Create directory IPC handler
ipcMain.handle(
  IpcChannels.FS_CREATE_DIR,
  async (_event, dirPath: string): Promise<{ success: true } | { error: string }> => {
    try {
      await mkdir(dirPath)
      return { success: true }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error creating directory'
      return { error: message }
    }
  },
)

// Delete file or directory IPC handler
ipcMain.handle(
  IpcChannels.FS_DELETE,
  async (_event, entryPath: string): Promise<{ success: true } | { error: string }> => {
    try {
      await rm(entryPath, { recursive: true })
      return { success: true }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error deleting'
      return { error: message }
    }
  },
)

// Rename file or directory IPC handler
ipcMain.handle(
  IpcChannels.FS_RENAME,
  async (
    _event,
    oldPath: string,
    newPath: string,
  ): Promise<{ success: true } | { error: string }> => {
    try {
      // Check if target already exists
      try {
        await stat(newPath)
        return { error: 'A file or folder with that name already exists' }
      } catch {
        // Expected — target doesn't exist
      }
      await rename(oldPath, newPath)
      return { success: true }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error renaming'
      return { error: message }
    }
  },
)

// Reveal in Finder / file manager
ipcMain.on(IpcChannels.FS_REVEAL_IN_FINDER, (_event, filePath: string) => {
  shell.showItemInFolder(filePath)
})

ipcMain.handle(
  IpcChannels.OPEN_IN_VSCODE,
  async (_event, rootPath: string, files?: Array<{ path: string; line: number; col: number }>) => {
    const runCode = (args: string[]) =>
      new Promise<void>((resolve, reject) => {
        execFile('code', args, (err) => {
          if (err) return reject(err)
          resolve()
        })
      })

    try {
      execSync('command -v code', { stdio: 'ignore' })
      await runCode([rootPath])
      for (const file of files ?? []) {
        await runCode(['--goto', `${file.path}:${file.line}:${file.col}`])
      }
      return { ok: true as const }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return { error: `Failed to open in VS Code: ${message}` }
    }
  },
)

// List all files (quick open) — uses `git ls-files` for speed, falls back to recursive readdir
ipcMain.handle(
  IpcChannels.FS_LIST_ALL_FILES,
  async (_event, rootPath: string): Promise<string[]> => {
    // Try git ls-files first (fast, respects .gitignore)
    if (existsSync(join(rootPath, '.git'))) {
      try {
        const files = await new Promise<string[]>((resolve, reject) => {
          execFile(
            'git',
            ['ls-files', '--cached', '--others', '--exclude-standard'],
            { cwd: rootPath, maxBuffer: 10 * 1024 * 1024 },
            (err, stdout) => {
              if (err) return reject(err)
              resolve(stdout.trim().split('\n').filter(Boolean))
            },
          )
        })
        return files
      } catch {
        // fall through to readdir
      }
    }

    // Fallback: recursive readdir
    const SKIP = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'out', '__pycache__'])
    const results: string[] = []

    /**
     * Recursively traverses `dir` and appends discovered file paths (relative to `rootPath`) to the module-level `results` array.
     *
     * The walk skips entries whose names are in `SKIP` or that start with a dot. If `dir` cannot be read, the function returns without side effects.
     *
     * @param dir - The directory path to traverse
     */
    function walk(dir: string) {
      let entries
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (SKIP.has(entry.name) || entry.name.startsWith('.')) continue
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full)
        } else {
          results.push(relative(rootPath, full))
        }
      }
    }

    walk(rootPath)
    return results
  },
)

// Search (find in files) — ripgrep-backed
ipcMain.handle(IpcChannels.SEARCH_START, async (_event, opts: SearchOpts) => {
  const resolved = await resolveSettings(opts.rootPath, store)
  const excludeMap = { ...resolved.filesExclude, ...resolved.searchExclude }
  const excludeGlobs = Object.entries(excludeMap)
    .filter(([, enabled]) => enabled)
    .map(([pattern]) => pattern)

  startSearch(
    opts,
    (payload) => contentView?.webContents.send(IpcChannels.SEARCH_RESULTS, payload),
    (payload) => contentView?.webContents.send(IpcChannels.SEARCH_COMPLETE, payload),
    excludeGlobs,
  )
})

ipcMain.on(IpcChannels.SEARCH_CANCEL, () => {
  cancelSearch()
})

ipcMain.handle(IpcChannels.SEARCH_REPLACE, async (_event, opts: ReplaceOpts) => {
  try {
    const content = await readFile(opts.filePath, 'utf-8')
    const lines = content.split('\n')

    // Apply replacements in reverse order to preserve line/column positions
    const sorted = [...opts.replacements].sort((a, b) => {
      if (a.line !== b.line) return b.line - a.line
      return b.column - a.column
    })

    let skipped = 0

    for (const rep of sorted) {
      const lineIdx = rep.line - 1
      if (lineIdx < 0 || lineIdx >= lines.length) {
        skipped++
        continue
      }
      const line = lines[lineIdx]
      const colIdx = rep.column - 1
      if (colIdx < 0 || colIdx > line.length) {
        skipped++
        continue
      }
      const actual = line.slice(colIdx, colIdx + rep.matchText.length)
      if (actual !== rep.matchText) {
        skipped++
        continue
      }
      const before = line.slice(0, colIdx)
      const after = line.slice(colIdx + rep.matchText.length)
      lines[lineIdx] = before + rep.replaceText + after
    }

    await fsWriteFile(opts.filePath, lines.join('\n'))
    return { success: true as const, skipped }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { error: message }
  }
})

app.whenReady().then(async () => {
  // Handle --clean flag: clear session but keep registry
  const isClean = process.argv.includes('--clean')
  if (isClean) {
    console.log('[startup] --clean flag detected, clearing session')
    workspaceRegistry.setSessionWorkspaces([])
    runtimeRegistry.clearFocus()
  }

  // Detect crash from previous session
  const wasCleanShutdown = store.get('cleanShutdown')
  store.set('cleanShutdown', false)

  await themeRegistry.reload()

  buildAppMenu()
  createWindow()
  registerPtyHandlers(
    () => contentView?.webContents ?? null,
    (workspaceId) => {
      const entry = workspaceRegistry.get(workspaceId)
      const root = entry?.rootPath ?? null
      if (!root) return null
      return getEffectiveWorkspaceRoot(workspaceId, root)
    },
  )
  registerFileWatcherHandlers(() => contentView?.webContents ?? null)

  const getWebContents = () => contentView?.webContents ?? null
  registerGitStatusHandlers()
  registerGitDiffHandlers()
  registerWorktreeHandlers(getWebContents, (wid) => workspaceRegistry.get(wid)?.rootPath ?? null)

  // Notify renderer of crash recovery after window loads
  if (wasCleanShutdown === false && !isClean) {
    contentView?.webContents.once('did-finish-load', () => {
      getWebContents()?.send(IpcChannels.LIFECYCLE_CRASH_DETECTED)
    })
  }

  // Restore last session workspaces from registry
  const sessionIds = workspaceRegistry.getSessionWorkspaces()
  const staleIds = workspaceRegistry.validatePaths()

  if (staleIds.length > 0) {
    console.warn(`[startup] Removing ${staleIds.length} workspace(s) with missing paths`)
    for (const id of staleIds) {
      workspaceRegistry.remove(id)
    }
  }

  // Activate the last active workspace (if it still exists in session)
  const activeId = workspaceRegistry.getActiveId()
  const validSessionIds = sessionIds.filter((id) => !staleIds.includes(id))

  if (activeId && validSessionIds.includes(activeId)) {
    await activateWorkspace(activeId)
  } else if (validSessionIds.length > 0) {
    await activateWorkspace(validSessionIds[0])
  } else {
    // No workspaces — renderer shows welcome tab (default Dockview layout)
    await stopWatchers()
    stopAllGitPolling()
    stopAllWorktreePolling()
    runtimeRegistry.clearFocus()
  }
})

// Graceful quit: request renderer to save state, then clean up
let isQuitting = false

app.on('before-quit', (event) => {
  if (isQuitting) return // Already in quit sequence

  event.preventDefault()
  isQuitting = true

  const wc = contentView?.webContents ?? null

  if (wc) {
    // Ask renderer to save current workspace state
    wc.send(IpcChannels.LIFECYCLE_REQUEST_SAVE)

    // Wait for renderer to confirm save, or timeout after 2s
    const saveTimeout = setTimeout(() => {
      void finishQuit()
    }, 2000)

    ipcMain.once(IpcChannels.LIFECYCLE_SAVE_COMPLETE, () => {
      clearTimeout(saveTimeout)
      void finishQuit()
    })
  } else {
    void finishQuit()
  }
})

/**
 * Finalize application shutdown by persisting session workspace IDs, marking a clean shutdown, stopping background services, and quitting the app.
 *
 * Persists the current session workspace order to the registry, sets the stored `cleanShutdown` flag to `true`, terminates running tasks and PTYs, stops git/worktree/watch polling, and calls `app.quit()`.
 */
async function finishQuit(): Promise<void> {
  // Save session state to registry
  const sessionWorkspaces = workspaceRegistry.getAll().map((w) => w.id)
  workspaceRegistry.setSessionWorkspaces(sessionWorkspaces)

  // Mark clean shutdown
  store.set('cleanShutdown', true)

  killAllPtys()
  stopAllGitPolling()
  stopAllWorktreePolling()
  // Ensure no stray watcher scopes remain (per-workspace scopes are also cleared in disposeAll)
  await stopWatchers()
  await runtimeRegistry.disposeAll()

  app.quit()
}

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
