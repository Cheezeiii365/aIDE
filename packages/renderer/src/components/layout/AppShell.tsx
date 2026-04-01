import { useState, useRef, useCallback, useEffect, useLayoutEffect, use } from 'react'
import type { DockviewApi } from 'dockview-react'
import { WorkspaceRibbon } from './WorkspaceRibbon'
import { Sidebar } from './Sidebar'
import { DockviewContainer } from './DockviewContainer'
import { StatusBar } from './StatusBar'
import { WorktreePanel } from '../WorktreePanel/WorktreePanel'
import { SidebarSection } from './SidebarSection'
import { registerAppActions, type OpenFileOpts } from '../../lib/appActions'
import { setContext } from '../../commands/ContextKeys'
import { registerAppCommands } from '../../commands/registerAppCommands'
import type { CommandContext, TaskPickerItem } from '../../commands/context'
import { useWorktrees } from '../../hooks/useWorktrees'
import { ToastContainer, showToast } from '../shared/Toast'
import { CommandPalette } from '../modals/CommandPalette'
import { QuickOpen } from '../modals/QuickOpen'
import { GitignoreReviewModal } from '../modals/GitignoreReviewModal'
import { TaskInputModal } from '../modals/TaskInputModal'
import { TaskSelectModal } from '../modals/TaskSelectModal'
import { WorkspaceContextMenu } from './WorkspaceContextMenu'
import { NewBrowserPaneModal } from '../modals/NewBrowserPaneModal'
import { loadKeybindings } from '../../commands/KeybindingService'
import { defaultKeybindings } from '../../commands/defaultKeybindings'
import { useTasks } from '../../hooks/useTasks'
import { useWorkspaces } from '../../hooks/useWorkspaces'
import { autoSave, switchWorkspace as doSwitchWorkspace } from '../../lib/workspace/workspaceSwitcher'
import { createTerminalPanelParams, getTerminalParams } from '../../lib/terminal/terminalState'
import { createBrowserPanelParams, getBrowserParams } from '../../lib/browserState'
import { getPanelZoomFactor, updatePanelZoomParams } from '../../lib/panelZoom'
import { DockviewNavigation } from '../../lib/dockviewNavigation'
import {
  captureWorkspaceRuntimeSnapshot,
  clearWorkspaceRuntimeSnapshot,
  saveWorkspaceRuntimeSnapshot,
} from '../../lib/workspace/workspaceRuntimeSnapshots'
import type { AideTask, BrowserSessionMode, GitignoreAuditResult, TaskExecution, TaskInputRequest, TaskTriggerResult } from '@aide/shared'
import { adjustZoomFactor, resetZoomFactor } from '@aide/shared'

/**
 * Top-level application shell coordinating workspace lifecycle, Dockview panels, keyboard commands, and primary UI.
 *
 * Renders the workspace ribbon, sidebar (with optional worktrees), Dockview area, status bar, toasts, and modal overlays;
 * wires workspace/open/close/remove handlers, autosave and lifecycle persistence, Dockview event syncing, and app-wide commands.
 *
 * @returns The root React element composing the application's shell and primary UI regions.
 */
export function AppShell() {
  const dockviewApiRef = useRef<DockviewApi | null>(null)
  const dockviewNavigationRef = useRef<DockviewNavigation | null>(null)
  const sidebarWidthRef = useRef(220)
  const prevWorkspaceRootRef = useRef<string | null>(null)
  const prevWorkspaceIdRef = useRef<string | null>(null)
  const preservedTerminalIdsRef = useRef(new Set<string>())
  const destroyedWorkspaceIdsRef = useRef(new Set<string>())
  const isSwitchingWorkspaceRef = useRef(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [quickOpenOpen, setQuickOpenOpen] = useState(false)
  const [gitignoreAudit, setGitignoreAudit] = useState<GitignoreAuditResult | null>(null)
  const [gitignoreModalOpen, setGitignoreModalOpen] = useState(false)
  const [taskInputRequest, setTaskInputRequest] = useState<TaskInputRequest | null>(null)
  const [wsContextMenu, setWsContextMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [newBrowserPaneOpen, setNewBrowserPaneOpen] = useState(false)
  const [taskPickerItems, setTaskPickerItems] = useState<TaskPickerItem[] | null>(null)
  const [terminatePickerExecutions, setTerminatePickerExecutions] = useState<TaskExecution[] | null>(null)
  const [activeBrowserPaneId, setActiveBrowserPaneId] = useState<string | null>(null)
  const [activePanelId, setActivePanelId] = useState<string | null>(null)
  const commandContextRef = useRef<CommandContext | null>(null)
  const {
    runningTasks,
    diagnostics: taskDiagnostics,
    runTask,
    killTask,
    reloadTasks,
    getLastTaskId,
    getRunningTasks,
    clearDiagnostics: clearAllDiagnostics,
  } = useTasks()
  const taskTerminalMapRef = useRef(new Map<string, string>())

  // Workspace registry
  const {
    workspaces,
    runtimeSnapshots,
    activeWorkspaceId,
    activeWorkspace,
    switchWorkspace,
    createWorkspace,
    closeWorkspace,
    removeWorkspace,
    updateWorkspace,
    reorderWorkspaces,
  } = useWorkspaces()

  // Derive workspaceRoot from active workspace for existing consumers
  const workspaceRoot = activeWorkspace?.rootPath ?? null
  const { worktrees, activeRoot, switchWorktree } = useWorktrees(workspaceRoot)

  const persistWorkspaceRuntime = useCallback((
    workspaceId: string | null = activeWorkspaceId,
    rootPath: string | null = workspaceRoot,
  ) => {
    const api = dockviewApiRef.current
    if (!api || !workspaceId) return

    const snapshot = saveWorkspaceRuntimeSnapshot(captureWorkspaceRuntimeSnapshot(
      api,
      workspaceId,
      rootPath,
      sidebarWidthRef.current,
      sidebarCollapsed,
    ))

    if (snapshot.rootPath) {
      window.api.saveWorkspaceState(snapshot.rootPath, snapshot.state).catch(() => {})
      window.api.saveTerminalState(snapshot.rootPath, snapshot.terminals).catch(() => {})
    }
  }, [activeWorkspaceId, sidebarCollapsed, workspaceRoot])

  const handleOpenFolder = useCallback(async () => {
    // If in a blank workspace (no rootPath), set root instead of creating new
    if (activeWorkspace && !activeWorkspace.rootPath) {
      const selected = await window.api.openWorkspaceDialog()
      if (selected) {
        await window.api.setWorkspaceRoot(activeWorkspace.id, selected)
      }
      return
    }
    await createWorkspace()
  }, [createWorkspace, activeWorkspace])

  const handleNewBlankWorkspace = useCallback(async () => {
    await window.api.createBlankWorkspace()
  }, [])

  const handleCloseWorkspace = useCallback(async (id: string) => {
    const workspace = workspaces.find((entry) => entry.id === id)
    destroyedWorkspaceIdsRef.current.add(id)
    clearWorkspaceRuntimeSnapshot(id)
    window.api.browserDestroyWorkspace(id)
    if (workspace?.rootPath) {
      window.api.saveTerminalState(workspace.rootPath, { terminals: [], activeTerminalId: null }).catch(() => {})
    }
    window.api.ptyKillWorkspace(id)
    await closeWorkspace(id)
  }, [closeWorkspace, workspaces])

  const handleRemoveWorkspace = useCallback(async (id: string) => {
    const workspace = workspaces.find((entry) => entry.id === id)
    destroyedWorkspaceIdsRef.current.add(id)
    clearWorkspaceRuntimeSnapshot(id)
    window.api.browserDestroyWorkspace(id)
    if (workspace?.rootPath) {
      window.api.saveTerminalState(workspace.rootPath, { terminals: [], activeTerminalId: null }).catch(() => {})
    }
    window.api.ptyKillWorkspace(id)
    await removeWorkspace(id)
  }, [removeWorkspace, workspaces])

  const showWelcomeLayout = useCallback((api: DockviewApi) => {
    const panels = [...api.panels]
    for (const panel of panels) {
      try {
        panel.api.close()
      } catch {
        // Panel may already be disposed.
      }
    }
    api.addPanel({ id: 'welcome', component: 'welcomePane', params: {} })
  }, [])

  // Full Dockview clear + restore when workspace changes
  useEffect(() => {
    const api = dockviewApiRef.current
    if (!api) return
    const prevRoot = prevWorkspaceRootRef.current
    const prevWorkspaceId = prevWorkspaceIdRef.current
    const wasDestroyed = prevWorkspaceId ? destroyedWorkspaceIdsRef.current.has(prevWorkspaceId) : false

    if (!activeWorkspaceId) {
      if (prevWorkspaceId && !wasDestroyed) {
        autoSave(api, prevWorkspaceId, prevRoot, sidebarWidthRef.current, sidebarCollapsed)
      }
      showWelcomeLayout(api)
      if (prevWorkspaceId) destroyedWorkspaceIdsRef.current.delete(prevWorkspaceId)
      prevWorkspaceRootRef.current = workspaceRoot
      prevWorkspaceIdRef.current = activeWorkspaceId
      return
    }

    if (prevWorkspaceId === activeWorkspaceId) {
      if (prevRoot !== workspaceRoot) {
        persistWorkspaceRuntime(activeWorkspaceId, workspaceRoot)
      } else if (api.panels.length === 0) {
        doSwitchWorkspace({
          dockviewApi: api,
          currentWorkspaceId: null,
          currentRootPath: null,
          targetWorkspaceId: activeWorkspaceId,
          targetRootPath: workspaceRoot,
          sidebarWidth: sidebarWidthRef.current,
          sidebarCollapsed,
          onSidebarRestore: (width, collapsed) => {
            sidebarWidthRef.current = width
            setSidebarCollapsed(collapsed)
          },
          onBeforeClearPanels: () => {
            isSwitchingWorkspaceRef.current = true
            preservedTerminalIdsRef.current = new Set(
              api.panels
                .map((panel) => getTerminalParams(panel)?.terminalId)
                .filter((id): id is string => !!id),
            )
          },
          onAfterRestorePanels: () => {
            isSwitchingWorkspaceRef.current = false
            preservedTerminalIdsRef.current.clear()
          },
        })
      }
      prevWorkspaceRootRef.current = workspaceRoot
      prevWorkspaceIdRef.current = activeWorkspaceId
      return
    }

    doSwitchWorkspace({
      dockviewApi: api,
      currentWorkspaceId: prevWorkspaceId,
      currentRootPath: prevRoot,
      targetWorkspaceId: activeWorkspaceId ?? '',
      targetRootPath: workspaceRoot,
      sidebarWidth: sidebarWidthRef.current,
      sidebarCollapsed,
      skipCurrentSave: wasDestroyed,
      onSidebarRestore: (width, collapsed) => {
        sidebarWidthRef.current = width
        setSidebarCollapsed(collapsed)
      },
      onBeforeClearPanels: () => {
        isSwitchingWorkspaceRef.current = true
        preservedTerminalIdsRef.current = new Set(
          api.panels
            .map((panel) => getTerminalParams(panel)?.terminalId)
            .filter((id): id is string => !!id),
        )
      },
      onAfterRestorePanels: () => {
        isSwitchingWorkspaceRef.current = false
        preservedTerminalIdsRef.current.clear()
      },
    })
    if (prevWorkspaceId) destroyedWorkspaceIdsRef.current.delete(prevWorkspaceId)
    prevWorkspaceRootRef.current = workspaceRoot
    prevWorkspaceIdRef.current = activeWorkspaceId
  }, [activeWorkspaceId, persistWorkspaceRuntime, showWelcomeLayout, sidebarCollapsed, workspaceRoot])

  const presentGitignoreAudit = useCallback((result: GitignoreAuditResult) => {
    setGitignoreAudit(result)
    showToast(
      `Found ${result.missing.length} missing .gitignore pattern${result.missing.length !== 1 ? 's' : ''} for sensitive files`,
      { label: 'Review', onClick: () => setGitignoreModalOpen(true) },
    )
  }, [])

  useEffect(() => {
    const unsub = window.api.onGitignoreAuditResult(presentGitignoreAudit)
    return unsub
  }, [presentGitignoreAudit])

  // Listen for task input requests
  useEffect(() => {
    const unsub = window.api.onTaskRequestInput((request: TaskInputRequest) => {
      setTaskInputRequest(request)
    })
    return unsub
  }, [])

  // Listen for task auto-detect results (offer to generate tasks.json)
  useEffect(() => {
    const unsub = window.api.onTaskAutoDetect((tasks: AideTask[]) => {
      showToast(
        `Detected ${tasks.length} task${tasks.length !== 1 ? 's' : ''} from project config`,
        {
          label: 'Generate tasks.json',
          onClick: async () => {
            const result = await window.api.generateTasks()
            if ('error' in result) {
              showToast(result.error)
            } else {
              showToast('Generated .aide/tasks.json')
            }
          },
        },
      )
    })
    return unsub
  }, [])

  // Terminal routing for task executions
  useEffect(() => {
    const unsub = window.api.onTaskStatusChanged((execution) => {
      const api = dockviewApiRef.current
      if (!api) return

      if (execution.status === 'running' && execution.ptyId) {
        const policy = execution.panelPolicy ?? 'shared'
        let panelId: string

        if (policy === 'shared') {
          panelId = 'task-terminal-shared'
        } else if (policy === 'dedicated') {
          panelId = `task-terminal-${execution.taskId}`
        } else {
          panelId = `task-terminal-${execution.executionId}`
        }

        // Track mapping for cleanup
        taskTerminalMapRef.current.set(execution.executionId, panelId)

        const existing = api.panels.find((p) => p.id === panelId)
        if (existing) {
          // Reuse: update the ptyId to the new execution's PTY
          existing.api.updateParameters({
            ...existing.params,
            taskPtyId: execution.ptyId,
            taskExecutionId: execution.executionId,
            taskId: execution.taskId,
            title: `Task: ${execution.taskLabel}`,
          })
          existing.api.setActive()
        } else {
          // Create new task terminal panel
          const existingTerminal = api.panels.find(
            (p) => p.id === 'terminal' || p.id.startsWith('terminal-'),
          )
          api.addPanel({
            id: panelId,
            component: 'terminalPane',
            title: `Task: ${execution.taskLabel}`,
            params: {
              terminalId: panelId,
              workspaceId: activeWorkspaceId ?? undefined,
              taskPtyId: execution.ptyId,
              taskExecutionId: execution.executionId,
              taskId: execution.taskId,
              title: `Task: ${execution.taskLabel}`,
              zoomFactor: 1,
            },
            position: existingTerminal ? { referencePanel: existingTerminal } : undefined,
          })
        }
      }

      // Handle close-on-exit for 'new' policy terminals
      if (
        execution.status === 'succeeded'
        && execution.closeOnExit
        && execution.panelPolicy === 'new'
      ) {
        const termPanelId = taskTerminalMapRef.current.get(execution.executionId)
        if (termPanelId && api) {
          const panel = api.panels.find((p) => p.id === termPanelId)
          if (panel) {
            setTimeout(() => panel.api.close(), 500)
          }
        }
        taskTerminalMapRef.current.delete(execution.executionId)
      }
    })
    return unsub
  }, [activeWorkspaceId])

  // Listen for task trigger results (auto-run outcomes) and show toasts
  useEffect(() => {
    const unsub = window.api.onTaskTriggerResult((result: TaskTriggerResult) => {
      if (result.outcome === 'failed') {
        showToast(`Task "${result.taskLabel}" failed to start: ${result.message ?? 'unknown error'}`)
      } else if (result.outcome === 'skipped') {
        // Silently skip - no toast needed for already-running tasks
      }
      // 'started' is normal, no toast needed
    })
    return unsub
  }, [])

  // Update Problems panel diagnostics when they change
  useEffect(() => {
    const api = dockviewApiRef.current
    if (!api) return

    const problemsPanel = api.panels.find((p) => p.id === 'problems')
    if (problemsPanel) {
      problemsPanel.api.updateParameters({ ...problemsPanel.params, diagnostics: taskDiagnostics })
    } else if (taskDiagnostics.length > 0) {
      // Open the Problems panel on first diagnostics
      const existingTerminal = api.panels.find(
        (p) => p.id === 'terminal' || p.id.startsWith('terminal-') || p.id.startsWith('task-terminal-'),
      )
      api.addPanel({
        id: 'problems',
        component: 'problemsPane',
        title: 'Problems',
        params: { diagnostics: taskDiagnostics, zoomFactor: 1 },
        position: existingTerminal ? { referencePanel: existingTerminal } : undefined,
      })
    }
  }, [taskDiagnostics])

  // Clear diagnostics on workspace switch
  useEffect(() => {
    clearAllDiagnostics()
  }, [activeWorkspaceId, clearAllDiagnostics])

  // Keep sidebarVisible context key in sync
  useEffect(() => {
    setContext('sidebarVisible', !sidebarCollapsed)
  }, [sidebarCollapsed])

  useEffect(() => {
    const shouldSuppress =
      commandPaletteOpen
      || quickOpenOpen
      || gitignoreModalOpen
      || !!taskInputRequest
      || newBrowserPaneOpen
      || !!taskPickerItems
      || !!terminatePickerExecutions
    if (shouldSuppress) {
      window.api.browserSuppressOverlays()
    } else {
      window.api.browserUnsuppressOverlays()
    }
  }, [
    commandPaletteOpen,
    gitignoreModalOpen,
    newBrowserPaneOpen,
    quickOpenOpen,
    taskInputRequest,
    taskPickerItems,
    terminatePickerExecutions,
  ])

  useEffect(() => {
    const unsub = window.api.onBrowserFocusChanged(({ paneId, focused }) => {
      if (focused) {
        setActiveBrowserPaneId(paneId)
        setContext('browserFocused', true)
      } else {
        setActiveBrowserPaneId((current) => {
          const next = current === paneId ? null : current
          setContext('browserFocused', next !== null)
          return next
        })
      }
    })
    return unsub
  }, [])

  const updateActivePanelZoom = useCallback(async (nextZoom: number) => {
    const api = dockviewApiRef.current
    if (!api || !activePanelId) return
    const activePanel = api.panels.find((panel) => panel.id === activePanelId)
    if (!activePanel) return

    const browserParams = getBrowserParams(activePanel)
    if (browserParams) {
      const appliedZoom = await window.api.setBrowserZoom(browserParams.paneId, nextZoom)
      activePanel.api.updateParameters({ ...browserParams, zoomFactor: appliedZoom })
      persistWorkspaceRuntime()
      return
    }

    activePanel.api.updateParameters(updatePanelZoomParams(
      (activePanel.params as Record<string, unknown> | undefined),
      nextZoom,
    ))
    persistWorkspaceRuntime()
  }, [activePanelId, persistWorkspaceRuntime])

  const handleZoomCommand = useCallback((action: 'in' | 'out' | 'reset') => {
    const activePanel = dockviewApiRef.current?.panels.find((panel) => panel.id === activePanelId)
    if (!activePanel) return
    const currentZoom = getPanelZoomFactor(activePanel.params)
    const nextZoom = action === 'reset'
      ? resetZoomFactor()
      : adjustZoomFactor(currentZoom, action === 'in' ? 0.1 : -0.1)
    void updateActivePanelZoom(nextZoom)
  }, [activePanelId, updateActivePanelZoom])

  useEffect(() => {
    return window.api.onZoomCommand(({ action, target }) => {
      if (target === 'panel') {
        handleZoomCommand(action)
      }
    })
  }, [handleZoomCommand])

  // Auto-save workspace state every 30 seconds (crash safety net)
  useEffect(() => {
    const interval = setInterval(() => {
      autoSave(
        dockviewApiRef.current,
        activeWorkspaceId,
        workspaceRoot,
        sidebarWidthRef.current,
        sidebarCollapsed,
      )
    }, 30_000)
    return () => clearInterval(interval)
  }, [activeWorkspaceId, workspaceRoot, sidebarCollapsed])

  // Handle quit save request from main process
  useEffect(() => {
    const unsub = window.api.onLifecycleRequestSave(() => {
      autoSave(
        dockviewApiRef.current,
        activeWorkspaceId,
        workspaceRoot,
        sidebarWidthRef.current,
        sidebarCollapsed,
      )
      window.api.lifecycleSaveComplete()
    })
    return unsub
  }, [activeWorkspaceId, sidebarCollapsed, workspaceRoot])

  // Handle crash recovery notification
  useEffect(() => {
    const unsub = window.api.onCrashDetected(() => {
      showToast('aIDE recovered from an unexpected shutdown. Some recent changes may not have been saved.')
    })
    return unsub
  }, [])

  const openMarkdownPreview = useCallback((filePath: string) => {
    const api = dockviewApiRef.current
    if (!api) return

    const previewId = `preview:${filePath}`
    const existing = api.panels.find((p) => p.id === previewId)
    if (existing) {
      existing.api.close()
      return
    }

    const editorPanel = api.panels.find((p) => p.id === filePath)
    const name = filePath.split('/').pop() ?? filePath

    api.addPanel({
      id: previewId,
      component: 'markdownPreview',
      title: `Preview: ${name}`,
      params: { filePath },
      position: editorPanel
        ? { referencePanel: editorPanel, direction: 'right' }
        : undefined,
    })
  }, [])

  useLayoutEffect(() => {
    commandContextRef.current = {
      getDockviewApi: () => dockviewApiRef.current,
      getDockviewNavigation: () => dockviewNavigationRef.current,
      getActiveWorkspaceId: () => activeWorkspaceId,
      getWorkspaceRoot: () => workspaceRoot,
      getActiveWorktreeRoot: () => activeRoot,
      getActiveBrowserPaneId: () => activeBrowserPaneId,
      getWorkspaces: () => workspaces,
      switchWorkspaceByIndex: (index: number) => {
        if (index < workspaces.length) void switchWorkspace(workspaces[index].id)
      },
      cycleWorkspace: (direction: 1 | -1) => {
        if (workspaces.length === 0 || !activeWorkspaceId) return
        const currentIdx = workspaces.findIndex((w) => w.id === activeWorkspaceId)
        const nextIdx = (currentIdx + direction + workspaces.length) % workspaces.length
        void switchWorkspace(workspaces[nextIdx].id)
      },
      closeActiveWorkspace: () => {
        if (activeWorkspaceId) void handleCloseWorkspace(activeWorkspaceId)
      },
      openFolder: () => void handleOpenFolder(),
      newBlankWorkspace: () => void handleNewBlankWorkspace(),
      toggleSidebar: () => setSidebarCollapsed((prev) => !prev),
      openCommandPalette: () => {
        setQuickOpenOpen(false)
        setCommandPaletteOpen(true)
      },
      openQuickOpen: () => {
        setCommandPaletteOpen(false)
        setQuickOpenOpen(true)
      },
      openNewBrowserModal: () => {
        setCommandPaletteOpen(false)
        setQuickOpenOpen(false)
        setNewBrowserPaneOpen(true)
      },
      persistWorkspaceRuntime,
      presentGitignoreAudit,
      openTaskPicker: (items) => setTaskPickerItems(items),
      openTerminateTaskPicker: (executions) => setTerminatePickerExecutions(executions),
      runTaskById: (id) => void runTask(id),
      getLastTaskId,
      getRunningTasks,
      killTaskByExecutionId: (executionId) => killTask(executionId),
      reloadTasksDefinitions: () => reloadTasks(),
      toggleMarkdownPreview: () => {
        const api = dockviewApiRef.current
        if (!api) return
        const active = api.activePanel
        if (!active) return
        const filePath = (active.params as Record<string, unknown>)?.filePath as string | undefined
        if (!filePath || !filePath.endsWith('.md')) return
        openMarkdownPreview(filePath)
      },
    }
  }, [
    activeWorkspaceId,
    activeBrowserPaneId,
    activeRoot,
    getLastTaskId,
    getRunningTasks,
    handleCloseWorkspace,
    handleNewBlankWorkspace,
    handleOpenFolder,
    killTask,
    openMarkdownPreview,
    persistWorkspaceRuntime,
    presentGitignoreAudit,
    reloadTasks,
    runTask,
    switchWorkspace,
    workspaceRoot,
    workspaces,
  ])

  useEffect(() => {
    registerAppCommands(() => commandContextRef.current!)
  }, [])

  const onApiReady = useCallback((api: DockviewApi) => {
    dockviewApiRef.current = api
    dockviewNavigationRef.current = new DockviewNavigation(api)

    // Auto-close preview pane when its source editor is closed
    api.onDidRemovePanel((event) => {
      const previewId = `preview:${event.id}`
      const preview = api.panels.find((p) => p.id === previewId)
      if (preview) preview.api.close()

      const terminalParams = getTerminalParams(event)
      if (terminalParams?.terminalId) {
        const shouldPreserve = preservedTerminalIdsRef.current.has(terminalParams.terminalId)
        if (!shouldPreserve) {
          window.api.ptyKill(terminalParams.terminalId)
          persistWorkspaceRuntime()
        }
      }

      const browserParams = getBrowserParams(event)
      if (browserParams && !isSwitchingWorkspaceRef.current) {
        setActiveBrowserPaneId((current) => (current === browserParams.paneId ? null : current))
        setContext('browserFocused', false)
        window.api.browserDestroy(browserParams.paneId)
        persistWorkspaceRuntime()
      }
    })

    // Track which pane type is focused
    api.onDidActivePanelChange((panel) => {
      if (!panel) {
        setActivePanelId(null)
        setContext('editorFocused', false)
        setContext('terminalFocused', false)
        setContext('browserFocused', false)
        return
      }
      const id = panel.id
      setActivePanelId(id)
      const isTerminal = id === 'terminal' || id.startsWith('terminal-')
      const browserParams = getBrowserParams(panel)
      const isBrowser = !!browserParams
      setActiveBrowserPaneId(browserParams?.paneId ?? null)
      setContext('terminalFocused', isTerminal)
      setContext('browserFocused', isBrowser)
      setContext('editorFocused', !isTerminal && !isBrowser)
    })

    // Initialize keybinding service: load defaults, then layer user overrides
    window.api
      .getKeybindingOverrides()
      .then((overrides) => {
        loadKeybindings(defaultKeybindings, overrides)
      })
      .catch((err) => {
        console.error('Failed to load keybinding overrides:', err)
        loadKeybindings(defaultKeybindings, [])
      })
  }, [persistWorkspaceRuntime])

  const onFileOpen = useCallback((filePath: string, opts?: OpenFileOpts) => {
    const api = dockviewApiRef.current
    if (!api) return

    // If panel already exists, focus it and optionally jump to line
    const existing = api.panels.find((p) => p.id === filePath)
    if (existing) {
      existing.api.setActive()
      if (opts?.line) {
        existing.api.updateParameters({ ...existing.params, jumpToLine: opts.line, jumpToColumn: opts.column })
      }
      return
    }

    // Extract filename for tab title
    const name = filePath.split('/').pop() ?? filePath

    // Find the editor group (first group, or wherever the welcome panel lives)
    const welcomePanel = api.panels.find((p) => p.id === 'editor')
    const position = welcomePanel
      ? { referencePanel: welcomePanel }
      : undefined

    api.addPanel({
      id: filePath,
      component: 'editorPane',
      tabComponent: 'editorTab',
      title: name,
      params: { filePath, workspaceRoot, jumpToLine: opts?.line, jumpToColumn: opts?.column },
      position,
    })

    // Suggest preview for markdown files
    if (filePath.endsWith('.md')) {
      showToast('Markdown file detected', {
        label: 'Open Preview',
        onClick: () => openMarkdownPreview(filePath),
      })
    }
  }, [openMarkdownPreview, workspaceRoot])

  // Register app-wide action dispatch layer — re-register when onFileOpen changes
  // so workspace root stays current after workspace switches.
  useEffect(() => {
    registerAppActions({
      openFile: (filePath: string, opts?: OpenFileOpts) => onFileOpen(filePath, opts),
      openUrl: (url: string) => window.open(url),
    })
  }, [onFileOpen])

  const handleCreateBrowserPane = useCallback((sessionMode: BrowserSessionMode, url: string) => {
    const api = dockviewApiRef.current
    if (!api || !activeWorkspaceId) return

    const activePanel = api.activePanel
    const params = createBrowserPanelParams(activeWorkspaceId, sessionMode, url.trim())
    api.addPanel({
      id: params.paneId,
      component: 'browserPane',
      title: 'Browser',
      params,
      position: activePanel ? { referencePanel: activePanel, direction: 'right' } : undefined,
    })
    setNewBrowserPaneOpen(false)
    persistWorkspaceRuntime()
  }, [activeWorkspaceId, persistWorkspaceRuntime])

  return (
    <div className="app-shell">
      <WorkspaceRibbon
        workspaces={workspaces}
        runtimeSnapshots={runtimeSnapshots}
        activeWorkspaceId={activeWorkspaceId}
        onSwitch={switchWorkspace}
        onOpenFolder={handleOpenFolder}
        onNewWorkspace={handleNewBlankWorkspace}
        onCloseWorkspace={handleCloseWorkspace}
        onReorder={reorderWorkspaces}
        onContextMenu={(id, x, y) => setWsContextMenu({ id, x, y })}
      />
      <div className="app-middle">
        <Sidebar
          onFileOpen={onFileOpen}
          collapsed={sidebarCollapsed}
          activeRoot={activeRoot}
          onOpenFolder={handleOpenFolder}
          worktreeSection={
            workspaceRoot && worktrees.length > 0 ? (
              <SidebarSection title="Worktrees" defaultExpanded>
                <WorktreePanel
                  worktrees={worktrees}
                  onSwitch={switchWorktree}
                  onOpenTerminal={(worktreePath) => {
                    const api = dockviewApiRef.current
                    if (!api) return
                    const id = `terminal-${Date.now()}`
                    const branch = worktrees.find((w) => w.path === worktreePath)?.branch
                    const existingTerminal = api.panels.find(
                      (p) => p.id === 'terminal' || p.id.startsWith('terminal-'),
                    )
                    api.addPanel({
                      id,
                      component: 'terminalPane',
                      tabComponent: branch ? 'agentTab' : undefined,
                      title: branch ? `Terminal (${branch})` : 'Terminal',
                      params: {
                        ...createTerminalPanelParams(
                          activeWorkspaceId ?? undefined,
                          worktreePath,
                          branch ? `Terminal (${branch})` : 'Terminal',
                        ),
                        worktreeBranch: branch,
                      },
                      position: existingTerminal ? { referencePanel: existingTerminal } : undefined,
                    })
                    persistWorkspaceRuntime()
                  }}
                  onStartAgent={(worktreePath) => {
                    const api = dockviewApiRef.current
                    if (!api || !activeWorkspaceId) return
                    const branch = worktrees.find((w) => w.path === worktreePath)?.branch

                    const editorPanel = api.panels.find(
                      (p) => p.id === 'editor' || (p.params as Record<string, unknown> | undefined)?.filePath,
                    )

                    window.api.getResolvedSettings().then((resolved) => {
                      const backend = resolved['agent.backend'] ?? 'built-in'

                      if (backend === 'claude-code' || backend === 'codex') {
                        api.addPanel({
                          id: `agent-${Date.now()}`,
                          component: 'cliAgentPane',
                          tabComponent: 'agentTab',
                          title: branch
                            ? `${backend === 'claude-code' ? 'Claude Code' : 'Codex'} (${branch})`
                            : backend === 'claude-code' ? 'Claude Code' : 'Codex',
                          params: {
                            workspaceId: activeWorkspaceId,
                            workspaceRoot: workspaceRoot ?? undefined,
                            backend,
                            conversationId: crypto.randomUUID(),
                            worktreePath,
                            worktreeBranch: branch,
                          },
                          position: editorPanel
                            ? { referencePanel: editorPanel, direction: 'right' }
                            : undefined,
                          initialWidth: 400,
                        })
                        persistWorkspaceRuntime()
                      } else {
                        void window.api.conversationCreate({
                          workspaceId: activeWorkspaceId,
                          backend: 'built-in',
                          worktreePath,
                          worktreeBranch: branch,
                        }).then((meta) => {
                          api.addPanel({
                            id: `agent-${Date.now()}`,
                            component: 'chatPane',
                            tabComponent: 'agentTab',
                            title: branch ? `Agent (${branch})` : 'Agent',
                            params: {
                              workspaceId: activeWorkspaceId,
                              workspaceRoot: workspaceRoot ?? undefined,
                              conversationId: meta.id,
                              worktreePath,
                              worktreeBranch: branch,
                            },
                            position: editorPanel
                              ? { referencePanel: editorPanel, direction: 'right' }
                              : undefined,
                            initialWidth: 350,
                          })
                          persistWorkspaceRuntime()
                        }).catch(() => {
                          api.addPanel({
                            id: `agent-${Date.now()}`,
                            component: 'chatPane',
                            tabComponent: 'agentTab',
                            title: branch ? `Agent (${branch})` : 'Agent',
                            params: {
                              workspaceId: activeWorkspaceId,
                              workspaceRoot: workspaceRoot ?? undefined,
                              worktreePath,
                              worktreeBranch: branch,
                            },
                            position: editorPanel
                              ? { referencePanel: editorPanel, direction: 'right' }
                              : undefined,
                            initialWidth: 350,
                          })
                          persistWorkspaceRuntime()
                        })
                      }
                    }).catch(() => {
                      // Fallback to built-in
                      void window.api.conversationCreate({
                        workspaceId: activeWorkspaceId,
                        backend: 'built-in',
                        worktreePath,
                        worktreeBranch: branch,
                      }).then((meta) => {
                        api.addPanel({
                          id: `agent-${Date.now()}`,
                          component: 'chatPane',
                          tabComponent: 'agentTab',
                          title: branch ? `Agent (${branch})` : 'Agent',
                          params: {
                            workspaceId: activeWorkspaceId,
                            workspaceRoot: workspaceRoot ?? undefined,
                            conversationId: meta.id,
                            worktreePath,
                            worktreeBranch: branch,
                          },
                          position: editorPanel
                            ? { referencePanel: editorPanel, direction: 'right' }
                            : undefined,
                          initialWidth: 350,
                        })
                        persistWorkspaceRuntime()
                      }).catch(() => {
                        api.addPanel({
                          id: `agent-${Date.now()}`,
                          component: 'chatPane',
                          tabComponent: 'agentTab',
                          title: branch ? `Agent (${branch})` : 'Agent',
                          params: {
                            workspaceId: activeWorkspaceId,
                            workspaceRoot: workspaceRoot ?? undefined,
                            worktreePath,
                            worktreeBranch: branch,
                          },
                          position: editorPanel
                            ? { referencePanel: editorPanel, direction: 'right' }
                            : undefined,
                          initialWidth: 350,
                        })
                        persistWorkspaceRuntime()
                      })
                    })
                  }}
                />
              </SidebarSection>
            ) : undefined
          }
        />
        <div className="dockview-wrapper">
          <DockviewContainer onApiReady={onApiReady} />
        </div>
      </div>
      <StatusBar runningTasks={runningTasks} />
      <ToastContainer />
      {commandPaletteOpen && (
        <CommandPalette onClose={() => setCommandPaletteOpen(false)} />
      )}
      {quickOpenOpen && (
        <QuickOpen
          onClose={() => setQuickOpenOpen(false)}
          workspaceRoot={activeRoot}
        />
      )}
      {gitignoreModalOpen && gitignoreAudit && (
        <GitignoreReviewModal
          auditResult={gitignoreAudit}
          onClose={() => {
            setGitignoreModalOpen(false)
            setGitignoreAudit(null)
          }}
        />
      )}
      {taskInputRequest && (
        <TaskInputModal
          request={taskInputRequest}
          onClose={() => setTaskInputRequest(null)}
        />
      )}
      {taskPickerItems && (
        <TaskSelectModal
          title="Task"
          placeholder="Select a task…"
          items={taskPickerItems.map((t) => ({
            id: t.id,
            label: t.label,
            description: t.group,
            searchText: `${t.label} ${t.group ?? ''} ${t.id}`,
          }))}
          onSelect={(id) => void runTask(id)}
          onClose={() => setTaskPickerItems(null)}
        />
      )}
      {terminatePickerExecutions && (
        <TaskSelectModal
          title="Running task"
          placeholder="Terminate…"
          items={terminatePickerExecutions.map((e) => ({
            id: e.executionId,
            label: e.taskLabel,
            description: e.taskId,
            searchText: `${e.taskLabel} ${e.taskId}`,
          }))}
          onSelect={(id) => killTask(id)}
          onClose={() => setTerminatePickerExecutions(null)}
        />
      )}
      {newBrowserPaneOpen && (
        <NewBrowserPaneModal
          onClose={() => setNewBrowserPaneOpen(false)}
          onSubmit={handleCreateBrowserPane}
        />
      )}
      {wsContextMenu && (
        <WorkspaceContextMenu
          x={wsContextMenu.x}
          y={wsContextMenu.y}
          onClose={() => setWsContextMenu(null)}
          items={[
            {
              label: 'Rename',
              onClick: () => {
                const ws = workspaces.find((w) => w.id === wsContextMenu.id)
                if (!ws) return
                const newName = prompt('Rename workspace:', ws.name)
                if (newName && newName !== ws.name) {
                  updateWorkspace(wsContextMenu.id, { name: newName })
                }
              },
            },
            {
              label: 'Reveal in Finder',
              onClick: () => {
                const ws = workspaces.find((w) => w.id === wsContextMenu.id)
                if (ws?.rootPath) window.api.revealInFinder(ws.rootPath)
              },
            },
            {
              label: 'Close Workspace',
              onClick: () => handleCloseWorkspace(wsContextMenu.id),
            },
            {
              label: 'Remove Workspace',
              danger: true,
              onClick: () => handleRemoveWorkspace(wsContextMenu.id),
            },
          ]}
        />
      )}
    </div>
  )
}
