import { app, BaseWindow, WebContentsView, ipcMain, Menu, dialog, shell } from 'electron'
import { join, dirname, relative } from 'path'
import { existsSync, readdirSync } from 'fs'
import { execFile, execSync } from 'child_process'
import { readdir, readFile, writeFile as fsWriteFile, stat, mkdir, rm, rename } from 'fs/promises'
import Store from 'electron-store'
import { IpcChannels, DEFAULT_SETTINGS, SENSITIVE_AGENT_KEYS } from '@aide/shared'
import type { AppSettings, ThemeName, DirEntry, SearchOpts, ReplaceOpts } from '@aide/shared'
import { registerPtyHandlers, killAllPtys } from './terminal/ptyManager'
import { registerFileWatcherHandlers, startWatchers, stopWatcher } from './workspace/fileWatcher'
import { registerGitStatusHandlers, startGitPolling, stopGitPolling } from './git/gitStatus'
import { registerWorktreeHandlers, startWorktreePolling, stopWorktreePolling } from './workspace/worktreeManager'
import { startSearch, cancelSearch } from './search/ripgrepSearch'
import { ensureAideFolder } from './workspace/aideInit'
import { resolveAppDefaults, resolveSettings, BUILT_IN_DEFAULTS } from './workspace/settingsResolver'
import { auditGitignore, appendToGitignore, isAuditDismissed, dismissAudit } from './git/gitignoreAudit'
import { TaskRunner } from './tasks/taskRunner'
import { detectTasks, generateTasksFile, hasTasksFile } from './tasks/taskAutoDetect'
import { WorkspaceRegistry } from './workspace/workspaceRegistry'
import { saveWorkspaceState, loadWorkspaceState, saveTerminalState, loadTerminalState } from './workspace/stateSerializer'
import { BrowserPaneManager } from './browserPaneManager'
import { registerGitDiffHandlers } from './git/gitDiff'
import { AgentManager } from './chat/agentManager'
import { CliAgentManager } from './chat/cliAgentManager'
import { ConversationStore } from './chat/conversationStore'
import { ClaudeNativeSessionWatcher } from './chat/claudeNativeSessionWatcher'
import type { ChatMode, LlmProviderConfig, PermissionTier, ToolPermissionConfig, AgentBackend, ConversationCreateOpts, ConversationMeta, CliAgentMessage } from '@aide/shared'

const store = new Store<AppSettings>({ defaults: DEFAULT_SETTINGS })
const workspaceRegistry = new WorkspaceRegistry()

let taskRunner: TaskRunner | null = null
let agentManager: AgentManager | null = null
let cliAgentManager: CliAgentManager | null = null
let conversationStore: ConversationStore | null = null
let nativeSessionWatcher: ClaudeNativeSessionWatcher | null = null
let nativeSessionCache: ConversationMeta[] = []

let mainWindow: BaseWindow | null = null
let contentView: WebContentsView | null = null
const browserPaneManager = new BrowserPaneManager({
  getWindow: () => mainWindow,
  getRendererWebContents: () => contentView?.webContents ?? null,
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
    contentView.webContents.loadFile(
      join(__dirname, '../../renderer/dist/index.html'),
    )
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
ipcMain.handle(IpcChannels.THEME_GET, () => store.get('theme'))
ipcMain.handle(IpcChannels.THEME_SET, (_event, theme: ThemeName) => {
  store.set('theme', theme)
  contentView?.webContents.send(IpcChannels.THEME_CHANGED, theme)
})

// Sidebar width IPC handlers
ipcMain.handle(IpcChannels.SIDEBAR_WIDTH_GET, () => store.get('sidebarWidth'))
ipcMain.handle(IpcChannels.SIDEBAR_WIDTH_SET, (_event, width: number) => {
  store.set('sidebarWidth', width)
})

ipcMain.handle(IpcChannels.BROWSER_ZOOM_GET, (_event, paneId: string) => browserPaneManager.getZoom(paneId))
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

ipcMain.handle(IpcChannels.WORKSPACE_ROOT_GET, () => store.get('workspaceRoot'))

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

/**
 * Activate the workspace identified by `id` and initialize its background services.
 *
 * Updates the registry and persisted workspace root, stops any existing task runner, watchers, and pollers, and — if the workspace has a filesystem root — ensures the workspace `.aide` folder exists, initializes the task runner, and starts file watchers, git polling, and worktree polling. Finally broadcasts the updated workspace registry to the renderer.
 *
 * @param id - The workspace id to activate
 */
let workspaceActivationSeq = 0

async function activateWorkspace(id: string): Promise<void> {
  const activationSeq = ++workspaceActivationSeq
  const entry = workspaceRegistry.get(id)
  if (!entry) return

  workspaceRegistry.setActive(id)
  store.set('workspaceRoot', entry.rootPath)
  store.set('activeWorktree', null)

  // Stop old pollers before starting new ones
  taskRunner?.killAll()
  taskRunner = null
  stopGitPolling()
  stopWorktreePolling()
  stopWatcher()
  if (entry.rootPath) {
    await ensureAideFolder(entry.rootPath)
    if (activationSeq !== workspaceActivationSeq) return

    initTaskRunner(entry.rootPath)

    await startWatchers('default', [entry.rootPath])
    if (activationSeq !== workspaceActivationSeq) {
      stopWatcher()
      return
    }

    const getWc = () => contentView?.webContents ?? null
    await startGitPolling(entry.rootPath, getWc)
    if (activationSeq !== workspaceActivationSeq) {
      stopGitPolling()
      stopWatcher()
      return
    }

    await startWorktreePolling(entry.rootPath, getWc, store)
    if (activationSeq !== workspaceActivationSeq) {
      stopWorktreePolling()
      stopGitPolling()
      stopWatcher()
      return
    }
  }

  // Initialize conversation store + agent managers for this workspace
  await agentManager?.destroy()
  await cliAgentManager?.destroy()
  nativeSessionWatcher?.stop()
  agentManager = null
  cliAgentManager = null
  conversationStore = null
  nativeSessionWatcher = null
  nativeSessionCache = []
  if (entry.rootPath) {
    conversationStore = new ConversationStore(entry.rootPath)
    const wsId = entry.id
    nativeSessionWatcher = new ClaudeNativeSessionWatcher({
      workspaceRoot: entry.rootPath,
      workspaceId: wsId,
      emit: (sessions) => {
        nativeSessionCache = sessions
        contentView?.webContents.send(IpcChannels.CONVERSATION_LIST_CHANGED, {
          workspaceId: wsId,
          conversations: sessions,
          source: 'claude-native',
        })
      },
    })
    void nativeSessionWatcher.start()
    const permConfig = loadPermissionConfig()
    agentManager = new AgentManager({
      config: loadLlmConfig(),
      workspaceRoot: entry.rootPath,
      getWebContents: () => contentView?.webContents ?? null,
      browserPaneManager,
      permissionTier: permConfig.permissionTier,
      autoApprove: permConfig.autoApprove,
      conversationStore,
    })
    const resolved = resolveAppDefaults(store)
    cliAgentManager = new CliAgentManager({
      workspaceRoot: entry.rootPath,
      getWebContents: () => contentView?.webContents ?? null,
      claudeCodePath: resolved['agent.claudeCodePath'],
      codexPath: resolved['agent.codexPath'],
      conversationStore,
    })
  }

  broadcastWorkspaceRegistry()
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
    storeKeys: Object.keys(userDefaults).filter(k => k.startsWith('agent.')),
  })
  return config
}

function loadPermissionConfig(): { permissionTier: PermissionTier; autoApprove: Record<string, boolean | ToolPermissionConfig> } {
  const userDefaults = (store.get('editorDefaults') ?? {}) as Record<string, unknown>
  return {
    permissionTier: (userDefaults['agent.permissionTier'] as PermissionTier) || 'confirm',
    autoApprove: (userDefaults['agent.autoApprove'] as Record<string, boolean | ToolPermissionConfig>) || {},
  }
}

ipcMain.handle(IpcChannels.WORKSPACE_LIST, () => {
  return workspaceRegistry.getAll()
})

ipcMain.handle(IpcChannels.WORKSPACE_CREATE, async (_event, rootPath: string) => {
  const entry = workspaceRegistry.create(rootPath)
  await activateWorkspace(entry.id)

  // Auto-detect tasks (non-blocking)
  if (!hasTasksFile(rootPath)) {
    detectTasks(rootPath).then((tasks) => {
      if (tasks.length > 0) {
        contentView?.webContents.send(IpcChannels.TASK_AUTO_DETECT, tasks)
      }
    })
  }

  // Gitignore audit (non-blocking)
  isAuditDismissed(rootPath).then(async (dismissed) => {
    if (dismissed) return
    const auditResult = await auditGitignore(rootPath)
    if (auditResult.missing.length > 0) {
      contentView?.webContents.send(IpcChannels.GITIGNORE_AUDIT_RESULT, auditResult)
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
        contentView?.webContents.send(IpcChannels.TASK_AUTO_DETECT, tasks)
      }
    })
  }

  isAuditDismissed(rootPath).then(async (dismissed) => {
    if (dismissed) return
    const auditResult = await auditGitignore(rootPath)
    if (auditResult.missing.length > 0) {
      contentView?.webContents.send(IpcChannels.GITIGNORE_AUDIT_RESULT, auditResult)
    }
  })
})

ipcMain.handle(IpcChannels.WORKSPACE_REMOVE, async (_event, id: string) => {
  const wasActive = workspaceRegistry.getActiveId() === id
  workspaceRegistry.remove(id)

  if (wasActive) {
    const nextId = workspaceRegistry.getActiveId()
    if (nextId) {
      await activateWorkspace(nextId)
    } else {
      taskRunner?.killAll()
      taskRunner = null
      stopGitPolling()
      stopWorktreePolling()
      stopWatcher()
      store.set('workspaceRoot', null)
      store.set('activeWorktree', null)
      broadcastWorkspaceRegistry()
    }
    return
  }

  broadcastWorkspaceRegistry()
})

ipcMain.handle(IpcChannels.WORKSPACE_CLOSE, async (_event, id: string) => {
  const wasActive = workspaceRegistry.getActiveId() === id
  workspaceRegistry.close(id)

  if (wasActive) {
    const remaining = workspaceRegistry.getSessionWorkspaces()
    const nextId = remaining[0] ?? null
    if (nextId) {
      await activateWorkspace(nextId)
    } else {
      // No workspaces left — clean up all background services
      taskRunner?.killAll()
      taskRunner = null
      stopGitPolling()
      stopWorktreePolling()
      stopWatcher()
      store.set('workspaceRoot', null)
      store.set('activeWorktree', null)
      broadcastWorkspaceRegistry()
    }
  } else {
    broadcastWorkspaceRegistry()
  }
})

ipcMain.handle(IpcChannels.WORKSPACE_SWITCH, async (_event, id: string) => {
  await activateWorkspace(id)
})

ipcMain.handle(IpcChannels.WORKSPACE_UPDATE, (_event, id: string, patch: Partial<{ name: string; icon: string; color: string }>) => {
  workspaceRegistry.update(id, patch)
  broadcastWorkspaceRegistry()
})

ipcMain.handle(IpcChannels.WORKSPACE_REORDER, (_event, ids: string[]) => {
  workspaceRegistry.reorder(ids)
  broadcastWorkspaceRegistry()
})

ipcMain.handle(IpcChannels.WORKSPACE_GET_ACTIVE, () => {
  return workspaceRegistry.getActiveId()
})

// ─── Chat / Agent IPC handlers ─────────────────────────────────────

ipcMain.handle(IpcChannels.CHAT_SEND_MESSAGE, async (_event, sessionId: string, content: string) => {
  if (!agentManager) return { error: 'No workspace open' }
  return agentManager.sendMessage(sessionId, content)
})

ipcMain.handle(IpcChannels.CHAT_GET_HISTORY, async (_event, workspaceId: string, conversationId?: string) => {
  if (!agentManager) return null
  return agentManager.getHistory(workspaceId, conversationId)
})

ipcMain.handle(IpcChannels.CHAT_SET_MODE, async (_event, sessionId: string, mode: ChatMode) => {
  agentManager?.setMode(sessionId, mode)
})

ipcMain.handle(IpcChannels.CHAT_SET_WORKING_SET, async (_event, sessionId: string, paths: string[]) => {
  agentManager?.setWorkingSet(sessionId, paths)
})

ipcMain.handle(IpcChannels.CHAT_TOOL_APPROVE, async (_event, sessionId: string, toolCallId: string) => {
  agentManager?.approveToolCall(sessionId, toolCallId)
})

ipcMain.handle(IpcChannels.CHAT_TOOL_REJECT, async (_event, sessionId: string, toolCallId: string) => {
  agentManager?.rejectToolCall(sessionId, toolCallId)
})

ipcMain.on(IpcChannels.CHAT_STOP, (_event, sessionId: string) => {
  agentManager?.stop(sessionId)
})

// ─── CLI Agent IPC handlers ─────────────────────────────────────

ipcMain.handle(IpcChannels.CLI_AGENT_START, async (_event, workspaceId: string, backend: AgentBackend, conversationId?: string, worktreePath?: string) => {
  if (!cliAgentManager) return { error: 'No workspace open' }
  return cliAgentManager.start(workspaceId, backend, conversationId, worktreePath)
})

ipcMain.handle(IpcChannels.CLI_AGENT_SEND, async (_event, sessionId: string, content: string) => {
  if (!cliAgentManager) return { error: 'No workspace open' }
  return cliAgentManager.send(sessionId, content)
})

ipcMain.handle(IpcChannels.CLI_AGENT_GET_SESSION, async (_event, workspaceId: string, sessionId?: string) => {
  if (!cliAgentManager) return null
  if (sessionId) {
    const s = cliAgentManager.getSessionById(sessionId)
    if (!s || s.workspaceId !== workspaceId) return null
    return s
  }
  return cliAgentManager.getSession(workspaceId) ?? null
})

ipcMain.handle(
  IpcChannels.CLI_AGENT_LOAD_MESSAGES,
  async (_event, workspaceId: string, conversationId: string): Promise<CliAgentMessage[]> => {
    if (workspaceRegistry.getActiveId() !== workspaceId) {
      return []
    }
    const nativeMeta =
      nativeSessionCache.find((c) => c.id === conversationId) ??
      nativeSessionCache.find((c) => c.claudeSessionId === conversationId)
    if (nativeMeta?.source === 'claude-native' && nativeMeta.claudeSessionId && nativeSessionWatcher) {
      return nativeSessionWatcher.loadMessages(nativeMeta.claudeSessionId)
    }
    const nativePrefix = 'claude-native:'
    if (conversationId.startsWith(nativePrefix) && nativeSessionWatcher) {
      const rawId = conversationId.slice(nativePrefix.length)
      if (
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId)
      ) {
        return nativeSessionWatcher.loadMessages(rawId)
      }
    }
    const stored = await conversationStore?.loadMessages(conversationId)
    if (!stored || typeof stored !== 'object') {
      return []
    }
    const msgs = (stored as { messages?: unknown }).messages
    const out = Array.isArray(msgs) ? (msgs as CliAgentMessage[]) : []
    return out
  },
)

ipcMain.on(IpcChannels.CLI_AGENT_STOP, (_event, sessionId: string) => {
  cliAgentManager?.stop(sessionId)
})

// ─── Conversation History IPC handlers ──────────────────────────

ipcMain.handle(IpcChannels.CONVERSATION_LIST, async (_event, workspaceId: string) => {
  const aideConvos = await conversationStore?.loadIndex() ?? []
  return [...aideConvos, ...nativeSessionCache]
})

ipcMain.handle(IpcChannels.CONVERSATION_CREATE, async (_event, opts: ConversationCreateOpts) => {
  if (!conversationStore) return { error: 'No workspace open' }
  const meta = await conversationStore.create(opts)
  // Notify renderer
  const index = await conversationStore.loadIndex()
  contentView?.webContents.send(IpcChannels.CONVERSATION_LIST_CHANGED, {
    workspaceId: opts.workspaceId,
    conversations: index,
  })
  return meta
})

ipcMain.handle(IpcChannels.CONVERSATION_DELETE, async (_event, conversationId: string) => {
  if (!conversationStore) return
  const meta = await conversationStore.get(conversationId)
  await conversationStore.delete(conversationId)
  // Stop any active session
  agentManager?.stop(conversationId)
  cliAgentManager?.stop(conversationId)
  // Notify renderer
  if (meta) {
    const index = await conversationStore.loadIndex()
    contentView?.webContents.send(IpcChannels.CONVERSATION_LIST_CHANGED, {
      workspaceId: meta.workspaceId,
      conversations: index,
    })
  }
})

ipcMain.handle(IpcChannels.CONVERSATION_RENAME, async (_event, conversationId: string, title: string) => {
  if (!conversationStore) return
  await conversationStore.updateMeta(conversationId, { title, autoTitled: false, updatedAt: Date.now() })
  const meta = await conversationStore.get(conversationId)
  if (meta) {
    const index = await conversationStore.loadIndex()
    contentView?.webContents.send(IpcChannels.CONVERSATION_LIST_CHANGED, {
      workspaceId: meta.workspaceId,
      conversations: index,
    })
  }
})

ipcMain.handle(IpcChannels.CONVERSATION_GET, async (_event, conversationId: string) => {
  return conversationStore?.get(conversationId) ?? null
})

// State persistence IPC handlers
ipcMain.handle(IpcChannels.STATE_SAVE, async (_event, rootPath: string, state: import('@aide/shared').AideLocalState) => {
  await saveWorkspaceState(rootPath, state)
})

ipcMain.handle(IpcChannels.STATE_LOAD, async (_event, rootPath: string) => {
  return loadWorkspaceState(rootPath)
})

ipcMain.handle(IpcChannels.STATE_SAVE_TERMINALS, async (_event, rootPath: string, state: import('@aide/shared').AideLocalTerminals) => {
  await saveTerminalState(rootPath, state)
})

ipcMain.handle(IpcChannels.STATE_LOAD_TERMINALS, async (_event, rootPath: string) => {
  return loadTerminalState(rootPath)
})

// Browser pane IPC handlers
ipcMain.handle(IpcChannels.BROWSER_CREATE, (_event, paneId: string, workspaceId: string, sessionMode: import('@aide/shared').BrowserSessionMode) => {
  return browserPaneManager.create(paneId, workspaceId, sessionMode)
})

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

ipcMain.on(IpcChannels.BROWSER_HOST_UPDATE, (_event, update: import('@aide/shared').BrowserHostUpdate) => {
  browserPaneManager.handleHostUpdate(update)
})

ipcMain.on(IpcChannels.BROWSER_SUPPRESS_OVERLAYS, () => {
  browserPaneManager.suppressOverlays()
})

ipcMain.on(IpcChannels.BROWSER_UNSUPPRESS_OVERLAYS, () => {
  browserPaneManager.unsuppressOverlays()
})

// Full .aide initialization (on-demand from command palette)
ipcMain.handle(IpcChannels.AIDE_INIT, async () => {
  const rootPath = store.get('workspaceRoot')
  if (!rootPath) return { error: 'No workspace folder open' }

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
    if (auditResult.missing.length > 0) {
      contentView?.webContents.send(IpcChannels.GITIGNORE_AUDIT_RESULT, auditResult)
    }
  }

  return initResult
})

// .aide settings IPC handler
ipcMain.handle(IpcChannels.AIDE_GET_RESOLVED_SETTINGS, async () => {
  const rootPath = store.get('workspaceRoot')
  if (!rootPath) return resolveAppDefaults(store)
  return resolveSettings(rootPath, store)
})

// Settings IPC handlers
ipcMain.handle(IpcChannels.SETTINGS_GET_DEFAULTS, () => BUILT_IN_DEFAULTS)

ipcMain.handle(IpcChannels.SETTINGS_GET_USER, () => {
  return store.get('editorDefaults') ?? {}
})

ipcMain.handle(IpcChannels.SETTINGS_SET_USER, async (_event, key: string, value: unknown) => {
  let current = (store.get('editorDefaults') ?? {}) as Record<string, unknown>
  if (value === undefined || value === null) {
    current = Object.fromEntries(
      Object.entries(current).filter(([entryKey]) => entryKey !== key),
    )
  } else {
    current[key] = value
  }
  store.set('editorDefaults', current)

  // Push agent config updates to AgentManager if an agent.* key changed
  if (key.startsWith('agent.') && agentManager) {
    agentManager.updateConfig(loadLlmConfig())
    const permConfig = loadPermissionConfig()
    agentManager.updatePermissions(permConfig.permissionTier, permConfig.autoApprove)
  }

  // Push CLI agent path updates
  if ((key === 'agent.claudeCodePath' || key === 'agent.codexPath') && cliAgentManager) {
    const appDefs = resolveAppDefaults(store)
    cliAgentManager.updatePaths(appDefs['agent.claudeCodePath'], appDefs['agent.codexPath'])
  }

  // Broadcast resolved settings
  const rootPath = store.get('workspaceRoot')
  const resolved = rootPath
    ? await resolveSettings(rootPath, store)
    : resolveAppDefaults(store)
  contentView?.webContents.send(IpcChannels.SETTINGS_CHANGED, resolved)
})

ipcMain.handle(IpcChannels.SETTINGS_GET_WORKSPACE, async () => {
  const rootPath = store.get('workspaceRoot')
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

ipcMain.handle(IpcChannels.SETTINGS_SET_WORKSPACE, async (_event, key: string, value: unknown) => {
  // Block sensitive agent keys from being written to project-level settings
  if (SENSITIVE_AGENT_KEYS.has(key)) return

  const rootPath = store.get('workspaceRoot')
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
    current = Object.fromEntries(
      Object.entries(current).filter(([entryKey]) => entryKey !== key),
    )
  } else {
    current[key] = value
  }

  await fsWriteFile(settingsPath, JSON.stringify(current, null, 2) + '\n', 'utf-8')

  // Broadcast resolved settings
  const resolved = await resolveSettings(rootPath, store)
  contentView?.webContents.send(IpcChannels.SETTINGS_CHANGED, resolved)
})

// Keybinding overrides IPC handlers
// Migrate old Record<commandId, keybinding> format to KeybindingRule[] on first read
function migrateKeybindingOverrides(stored: unknown): { key: string; command: string; when?: string }[] {
  if (Array.isArray(stored)) return stored
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    const migrated = Object.entries(stored as Record<string, string>).map(([command, key]) => ({ key, command }))
    store.set('keybindingOverrides', migrated)
    return migrated
  }
  return []
}

ipcMain.handle(IpcChannels.KEYBINDINGS_GET, () => {
  return migrateKeybindingOverrides(store.get('keybindingOverrides'))
})

ipcMain.handle(IpcChannels.KEYBINDINGS_SET, async (_event, rules: { key: string; command: string; when?: string }[]) => {
  store.set('keybindingOverrides', rules)
  contentView?.webContents.send(IpcChannels.KEYBINDINGS_CHANGED, rules)
})

// Gitignore security audit IPC handlers
ipcMain.handle(IpcChannels.GITIGNORE_AUDIT, async () => {
  const rootPath = store.get('workspaceRoot')
  if (!rootPath) return { missing: [], total: 0 }
  return auditGitignore(rootPath)
})

ipcMain.handle(IpcChannels.GITIGNORE_APPEND, async (_event, patterns: string[]) => {
  const rootPath = store.get('workspaceRoot')
  if (!rootPath) return
  await appendToGitignore(rootPath, patterns)
})

ipcMain.handle(IpcChannels.GITIGNORE_DISMISS, async () => {
  const rootPath = store.get('workspaceRoot')
  if (!rootPath) return
  await dismissAudit(rootPath)
})

/**
 * Initializes the module-level TaskRunner for the given workspace and forwards its events to the renderer via IPC.
 *
 * Loads task definitions after creating the runner and attaches handlers that propagate status, input requests,
 * diagnostics, PTY output, and PTY exit events to the renderer process.
 *
 * @param rootPath - Filesystem path of the workspace to manage tasks for
 */
function initTaskRunner(rootPath: string): void {
  const getWc = () => contentView?.webContents ?? null
  taskRunner = new TaskRunner(rootPath, {
    onStatusChanged: (execution) => getWc()?.send(IpcChannels.TASK_STATUS_CHANGED, execution),
    onRequestInput: (request) => getWc()?.send(IpcChannels.TASK_REQUEST_INPUT, request),
    onDiagnostics: (diagnostics) => getWc()?.send(IpcChannels.TASK_DIAGNOSTICS, diagnostics),
    onPtyData: (ptyId, data) => getWc()?.send(IpcChannels.PTY_DATA_OUT, ptyId, data),
    onPtyExit: (ptyId, exitCode) => getWc()?.send(IpcChannels.PTY_EXIT, ptyId, exitCode),
  })
  taskRunner.loadTasks()
}

ipcMain.handle(IpcChannels.TASK_LIST, async () => {
  if (!taskRunner) return { tasks: [], compounds: [] }
  await taskRunner.loadTasks()
  return { tasks: taskRunner.getTasks(), compounds: taskRunner.getCompounds() }
})

ipcMain.handle(IpcChannels.TASK_RUN, async (_event, taskId: string) => {
  if (!taskRunner) return { error: 'No workspace open' }
  const rootPath = store.get('workspaceRoot')
  if (!rootPath) return { error: 'No workspace open' }

  const ctx = {
    workspaceRoot: rootPath,
    workspaceName: rootPath.split('/').pop() ?? rootPath,
  }
  return taskRunner.run(taskId, ctx)
})

ipcMain.on(IpcChannels.TASK_KILL, (_event, executionId: string) => {
  taskRunner?.kill(executionId)
})

ipcMain.handle(IpcChannels.TASK_RELOAD, async () => {
  await taskRunner?.loadTasks()
})

ipcMain.on(IpcChannels.TASK_PROVIDE_INPUT, (_event, requestId: string, value: string | null) => {
  taskRunner?.provideInput(requestId, value)
})

ipcMain.handle(IpcChannels.TASK_GENERATE, async () => {
  const rootPath = store.get('workspaceRoot')
  if (!rootPath) return { error: 'No workspace open' }
  const tasks = await detectTasks(rootPath)
  if (tasks.length === 0) return { error: 'No tasks detected' }
  return generateTasksFile(rootPath, tasks)
})

// Filesystem IPC handlers
const HIDDEN_FILES = new Set(['.DS_Store', 'Thumbs.db'])

ipcMain.handle(IpcChannels.FS_READ_DIR, async (_event, dirPath: string): Promise<DirEntry[] | { error: string }> => {
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
})

// Read file IPC handler — enforces 10 MB limit, rejects binary files
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

ipcMain.handle(IpcChannels.FS_READ_FILE, async (_event, filePath: string): Promise<{ content: string } | { error: string }> => {
  try {
    const info = await stat(filePath)
    if (!info.isFile()) return { error: 'Not a file' }
    if (info.size > MAX_FILE_SIZE) return { error: `File too large (${(info.size / 1024 / 1024).toFixed(1)} MB). Maximum is 10 MB.` }

    const content = await readFile(filePath, 'utf-8')

    // Check for binary content (null bytes in first 8 KB)
    const sample = content.slice(0, 8192)
    if (sample.includes('\0')) return { error: 'Binary file — cannot display' }

    return { content }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error reading file'
    return { error: message }
  }
})

// Write file IPC handler
ipcMain.handle(IpcChannels.FS_WRITE_FILE, async (_event, filePath: string, content: string): Promise<{ success: true } | { error: string }> => {
  try {
    await fsWriteFile(filePath, content, 'utf-8')
    return { success: true }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error writing file'
    return { error: message }
  }
})

// Create file IPC handler
ipcMain.handle(IpcChannels.FS_CREATE_FILE, async (_event, filePath: string): Promise<{ success: true } | { error: string }> => {
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
})

// Create directory IPC handler
ipcMain.handle(IpcChannels.FS_CREATE_DIR, async (_event, dirPath: string): Promise<{ success: true } | { error: string }> => {
  try {
    await mkdir(dirPath)
    return { success: true }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error creating directory'
    return { error: message }
  }
})

// Delete file or directory IPC handler
ipcMain.handle(IpcChannels.FS_DELETE, async (_event, entryPath: string): Promise<{ success: true } | { error: string }> => {
  try {
    await rm(entryPath, { recursive: true })
    return { success: true }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error deleting'
    return { error: message }
  }
})

// Rename file or directory IPC handler
ipcMain.handle(IpcChannels.FS_RENAME, async (_event, oldPath: string, newPath: string): Promise<{ success: true } | { error: string }> => {
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
})

// Reveal in Finder / file manager
ipcMain.on(IpcChannels.FS_REVEAL_IN_FINDER, (_event, filePath: string) => {
  shell.showItemInFolder(filePath)
})

ipcMain.handle(
  IpcChannels.OPEN_IN_VSCODE,
  async (
    _event,
    rootPath: string,
    files?: Array<{ path: string; line: number; col: number }>,
  ) => {
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
ipcMain.handle(IpcChannels.FS_LIST_ALL_FILES, async (_event, rootPath: string): Promise<string[]> => {
  // Try git ls-files first (fast, respects .gitignore)
  if (existsSync(join(rootPath, '.git'))) {
    try {
      const files = await new Promise<string[]>((resolve, reject) => {
        execFile('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: rootPath, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
          if (err) return reject(err)
          resolve(stdout.trim().split('\n').filter(Boolean))
        })
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
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
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
})

// Search (find in files) — ripgrep-backed
ipcMain.handle(IpcChannels.SEARCH_START, async (_event, opts: SearchOpts) => {
  const resolved = await resolveSettings(opts.rootPath, store)
  const excludeMap = { ...resolved.filesExclude, ...resolved.searchExclude }
  const excludeGlobs = Object.entries(excludeMap)
    .filter(([, enabled]) => enabled)
    .map(([pattern]) => pattern)

  startSearch(
    opts,
    (results) => contentView?.webContents.send(IpcChannels.SEARCH_RESULTS, results),
    (summary) => contentView?.webContents.send(IpcChannels.SEARCH_COMPLETE, summary),
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
      if (lineIdx < 0 || lineIdx >= lines.length) { skipped++; continue }
      const line = lines[lineIdx]
      const colIdx = rep.column - 1
      if (colIdx < 0 || colIdx > line.length) { skipped++; continue }
      const actual = line.slice(colIdx, colIdx + rep.matchText.length)
      if (actual !== rep.matchText) { skipped++; continue }
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
    store.set('workspaceRoot', null)
    store.set('activeWorktree', null)
  }

  // Detect crash from previous session
  const wasCleanShutdown = store.get('cleanShutdown')
  store.set('cleanShutdown', false)

  buildAppMenu()
  createWindow()
  registerPtyHandlers(() => contentView?.webContents ?? null, store)
  registerFileWatcherHandlers(() => contentView?.webContents ?? null)

  const getWebContents = () => contentView?.webContents ?? null
registerGitStatusHandlers()
  registerGitDiffHandlers()
  registerWorktreeHandlers(getWebContents, store)

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
    store.set('workspaceRoot', null)
    store.set('activeWorktree', null)
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
    const saveTimeout = setTimeout(() => finishQuit(), 2000)

    ipcMain.once(IpcChannels.LIFECYCLE_SAVE_COMPLETE, () => {
      clearTimeout(saveTimeout)
      finishQuit()
    })
  } else {
    finishQuit()
  }
})

/**
 * Finalize application shutdown by persisting session workspace IDs, marking a clean shutdown, stopping background services, and quitting the app.
 *
 * Persists the current session workspace order to the registry, sets the stored `cleanShutdown` flag to `true`, terminates running tasks and PTYs, stops git/worktree/watch polling, and calls `app.quit()`.
 */
function finishQuit(): void {
  // Save session state to registry
  const sessionWorkspaces = workspaceRegistry.getAll().map((w) => w.id)
  workspaceRegistry.setSessionWorkspaces(sessionWorkspaces)

  // Mark clean shutdown
  store.set('cleanShutdown', true)

  // Clean up resources (async destroy for persistence, but don't block quit)
  agentManager?.destroy().catch(() => {})
  agentManager = null
  cliAgentManager?.destroy().catch(() => {})
  cliAgentManager = null
  nativeSessionWatcher?.stop()
  nativeSessionWatcher = null
  conversationStore = null
  taskRunner?.killAll()
  killAllPtys()
  stopGitPolling()
  stopWorktreePolling()
  stopWatcher()

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
