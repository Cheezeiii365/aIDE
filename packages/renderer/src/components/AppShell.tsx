import { useState, useRef, useCallback, useEffect } from 'react'
import type { DockviewApi } from 'dockview-react'
import { WorkspaceRibbon } from './WorkspaceRibbon'
import { Sidebar } from './Sidebar'
import { DockviewContainer } from './DockviewContainer'
import { StatusBar } from './StatusBar'
import { WorktreePanel } from './WorktreePanel/WorktreePanel'
import { SidebarSection } from './SidebarSection'
import { registerAppActions, type OpenFileOpts } from '../lib/appActions'
import { useCommand } from '../lib/CommandRegistry'
import { setContext } from '../lib/ContextKeys'
import { useWorktrees } from '../hooks/useWorktrees'
import { ToastContainer, showToast } from './Toast'
import { CommandPalette } from './CommandPalette'
import { QuickOpen } from './QuickOpen'
import { GitignoreReviewModal } from './GitignoreReviewModal'
import { TaskInputModal } from './TaskInputModal'
import { WorkspaceContextMenu } from './WorkspaceContextMenu'
import { NewBrowserPaneModal } from './NewBrowserPaneModal'
import { registerDefaultCommands } from '../lib/defaultCommands'
import { loadKeybindings } from '../lib/KeybindingService'
import { defaultKeybindings } from '../lib/defaultKeybindings'
import { useTasks } from '../hooks/useTasks'
import { useWorkspaces } from '../hooks/useWorkspaces'
import { autoSave, switchWorkspace as doSwitchWorkspace } from '../lib/workspaceSwitcher'
import { createTerminalPanelParams, getTerminalParams } from '../lib/terminalState'
import { createBrowserPanelParams, getBrowserParams } from '../lib/browserState'
import { getPanelZoomFactor, updatePanelZoomParams } from '../lib/panelZoom'
import { DockviewNavigation } from '../lib/dockviewNavigation'
import {
  commentLineInActiveEditor,
  toggleLineCommentInActiveEditor,
  uncommentLineInActiveEditor,
} from '../lib/editorComments'
import {
  captureWorkspaceRuntimeSnapshot,
  clearWorkspaceRuntimeSnapshot,
  saveWorkspaceRuntimeSnapshot,
} from '../lib/workspaceRuntimeSnapshots'
import type { AideTask, BrowserSessionMode, GitignoreAuditResult, TaskInputRequest } from '@aide/shared'
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
  const [activeBrowserPaneId, setActiveBrowserPaneId] = useState<string | null>(null)
  const [activePanelId, setActivePanelId] = useState<string | null>(null)
  const { runningTasks } = useTasks()

  // Workspace registry
  const {
    workspaces,
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

  // Listen for gitignore audit results from main process and command palette
  useEffect(() => {
    const handleAudit = (result: GitignoreAuditResult) => {
      setGitignoreAudit(result)
      showToast(
        `Found ${result.missing.length} missing .gitignore pattern${result.missing.length !== 1 ? 's' : ''} for sensitive files`,
        { label: 'Review', onClick: () => setGitignoreModalOpen(true) },
      )
    }

    const unsub = window.api.onGitignoreAuditResult(handleAudit)

    // Also listen for command-palette-triggered audits
    const handleCustom = (e: Event) => {
      handleAudit((e as CustomEvent<GitignoreAuditResult>).detail)
    }
    window.addEventListener('aide:gitignore-audit', handleCustom)

    return () => {
      unsub()
      window.removeEventListener('aide:gitignore-audit', handleCustom)
    }
  }, [])

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

  // Cmd+1-9 and Cmd+Shift+[/] workspace switching
  useEffect(() => {
    const handleSwitch = (e: Event) => {
      const { index } = (e as CustomEvent<{ index: number }>).detail
      if (index < workspaces.length) {
        switchWorkspace(workspaces[index].id)
      }
    }
    const handleCycle = (e: Event) => {
      const { direction } = (e as CustomEvent<{ direction: number }>).detail
      if (workspaces.length === 0 || !activeWorkspaceId) return
      const currentIdx = workspaces.findIndex((w) => w.id === activeWorkspaceId)
      const nextIdx = (currentIdx + direction + workspaces.length) % workspaces.length
      switchWorkspace(workspaces[nextIdx].id)
    }
    window.addEventListener('aide:workspace-switch', handleSwitch)
    window.addEventListener('aide:workspace-cycle', handleCycle)
    return () => {
      window.removeEventListener('aide:workspace-switch', handleSwitch)
      window.removeEventListener('aide:workspace-cycle', handleCycle)
    }
  }, [workspaces, activeWorkspaceId, switchWorkspace])

  // Cmd+Shift+W close, Cmd+Shift+N new blank, Cmd+O open folder
  useEffect(() => {
    const handleClose = () => {
      if (activeWorkspaceId) handleCloseWorkspace(activeWorkspaceId)
    }
    const handleNewBlank = () => handleNewBlankWorkspace()
    const handleOpenFolderEvt = () => handleOpenFolder()

    window.addEventListener('aide:workspace-close', handleClose)
    window.addEventListener('aide:workspace-new-blank', handleNewBlank)
    window.addEventListener('aide:workspace-open-folder', handleOpenFolderEvt)
    return () => {
      window.removeEventListener('aide:workspace-close', handleClose)
      window.removeEventListener('aide:workspace-new-blank', handleNewBlank)
      window.removeEventListener('aide:workspace-open-folder', handleOpenFolderEvt)
    }
  }, [activeWorkspaceId, handleCloseWorkspace, handleOpenFolder, handleNewBlankWorkspace])

  // Keep sidebarVisible context key in sync
  useEffect(() => {
    setContext('sidebarVisible', !sidebarCollapsed)
  }, [sidebarCollapsed])

  useEffect(() => {
    const shouldSuppress = commandPaletteOpen || quickOpenOpen || gitignoreModalOpen || !!taskInputRequest || newBrowserPaneOpen
    if (shouldSuppress) {
      window.api.browserSuppressOverlays()
    } else {
      window.api.browserUnsuppressOverlays()
    }
  }, [commandPaletteOpen, gitignoreModalOpen, newBrowserPaneOpen, quickOpenOpen, taskInputRequest])

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

    registerDefaultCommands(api)

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

  // Ctrl+` — open a new terminal tab
  useCommand('terminal.new', {
    label: 'New Terminal',
    category: 'Terminal',
  }, () => {
    const api = dockviewApiRef.current
    if (!api) return

    const id = `terminal-${Date.now()}`
    const existingTerminal = api.panels.find(
      (p) => p.id === 'terminal' || p.id.startsWith('terminal-'),
    )
    const position = existingTerminal
      ? { referencePanel: existingTerminal }
      : undefined

    api.addPanel({
      id,
      component: 'terminalPane',
      title: 'Terminal',
      params: createTerminalPanelParams(activeWorkspaceId ?? undefined, activeRoot ?? undefined, 'Terminal'),
      position,
    })
    persistWorkspaceRuntime()
  })

  useCommand('editor.toggleComment', {
    label: 'Toggle Line Comment',
    category: 'Editor',
  }, () => {
    const result = toggleLineCommentInActiveEditor()
    if (result === 'no-editor') {
      showToast('No active editor')
      return
    }
    if (result === 'unsupported') {
      showToast('Line comments are not available for this file type')
    }
  })

  useCommand('editor.commentLine', {
    label: 'Comment Line',
    category: 'Editor',
  }, () => {
    const result = commentLineInActiveEditor()
    if (result === 'no-editor') {
      showToast('No active editor')
      return
    }
    if (result === 'unsupported') {
      showToast('Line comments are not available for this file type')
    }
  })

  useCommand('editor.uncommentLine', {
    label: 'Uncomment Line',
    category: 'Editor',
  }, () => {
    const result = uncommentLineInActiveEditor()
    if (result === 'no-editor') {
      showToast('No active editor')
      return
    }
    if (result === 'unsupported') {
      showToast('Line comments are not available for this file type')
    }
  })

  // Cmd+B — toggle sidebar
  useCommand('view.toggleSidebar', {
    label: 'Toggle Sidebar',
    category: 'View',
  }, () => {
    setSidebarCollapsed((prev) => !prev)
  })

  // Cmd+W — close active panel
  useCommand('panel.close', {
    label: 'Close Active Panel',
    category: 'Panel',
  }, () => {
    const api = dockviewApiRef.current
    if (!api) return
    const active = api.activePanel
    if (active) {
      active.api.close()
    }
  })

  useCommand('pane.cycleRecent', {
    label: 'Cycle Recent Pane',
    category: 'Pane',
  }, () => {
    dockviewNavigationRef.current?.focusPaneRecent(1)
  })

  useCommand('pane.cycleRecentReverse', {
    label: 'Cycle Recent Pane Backward',
    category: 'Pane',
  }, () => {
    dockviewNavigationRef.current?.focusPaneRecent(-1)
  })

  useCommand('pane.focusNext', {
    label: 'Focus Next Pane',
    category: 'Pane',
  }, () => {
    dockviewNavigationRef.current?.focusPaneLinear(1)
  })

  useCommand('pane.focusPrevious', {
    label: 'Focus Previous Pane',
    category: 'Pane',
  }, () => {
    dockviewNavigationRef.current?.focusPaneLinear(-1)
  })

  useCommand('pane.tab.cycleRecent', {
    label: 'Cycle Recent Tab In Pane',
    category: 'Pane',
  }, () => {
    dockviewNavigationRef.current?.focusTabRecent(1)
  })

  useCommand('pane.tab.cycleRecentReverse', {
    label: 'Cycle Recent Tab In Pane Backward',
    category: 'Pane',
  }, () => {
    dockviewNavigationRef.current?.focusTabRecent(-1)
  })

  useCommand('pane.tab.focusNext', {
    label: 'Focus Next Tab In Pane',
    category: 'Pane',
  }, () => {
    dockviewNavigationRef.current?.focusTabLinear(1)
  })

  useCommand('pane.tab.focusPrevious', {
    label: 'Focus Previous Tab In Pane',
    category: 'Pane',
  }, () => {
    dockviewNavigationRef.current?.focusTabLinear(-1)
  })

  // Open or toggle markdown preview for a file
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

  // Cmd+Shift+V — toggle markdown preview for active .md file
  useCommand('markdown.togglePreview', {
    label: 'Toggle Markdown Preview',
    category: 'Markdown',
  }, () => {
    const api = dockviewApiRef.current
    if (!api) return
    const active = api.activePanel
    if (!active) return
    const filePath = (active.params as Record<string, unknown>)?.filePath as string | undefined
    if (!filePath || !filePath.endsWith('.md')) return
    openMarkdownPreview(filePath)
  })

  // Cmd+Shift+P — command palette
  useCommand('commandPalette.open', {
    label: 'Command Palette',
    category: 'View',
  }, () => {
    setQuickOpenOpen(false)
    setCommandPaletteOpen(true)
  })

  // Cmd+P — quick open
  useCommand('quickOpen.open', {
    label: 'Quick Open',
    category: 'View',
  }, () => {
    setCommandPaletteOpen(false)
    setQuickOpenOpen(true)
  })

  useCommand('browser.new', {
    label: 'New Browser Pane',
    category: 'Browser',
  }, () => {
    if (!activeWorkspaceId) return
    setCommandPaletteOpen(false)
    setQuickOpenOpen(false)
    setNewBrowserPaneOpen(true)
  })

  useCommand('agent.open', {
    label: 'Open Agent Panel',
    category: 'Agent',
  }, () => {
    const api = dockviewApiRef.current
    if (!api || !activeWorkspaceId) return

    // Focus existing agent panel if present
    const existing = api.panels.find((p) => p.id === 'agent' || p.id.startsWith('agent-'))
    if (existing) {
      existing.api.setActive()
      return
    }

    // Place next to editor or at the right
    const editorPanel = api.panels.find(
      (p) => p.id === 'editor' || (p.params as Record<string, unknown> | undefined)?.filePath,
    )

    // Check backend setting to decide which pane to open
    window.api.getResolvedSettings().then((resolved) => {
      const backend = resolved['agent.backend'] ?? 'built-in'
      if (backend === 'claude-code' || backend === 'codex') {
        api.addPanel({
          id: `agent-${Date.now()}`,
          component: 'cliAgentPane',
          title: backend === 'claude-code' ? 'Claude Code' : 'Codex',
          params: { workspaceId: activeWorkspaceId, workspaceRoot: workspaceRoot ?? undefined, backend },
          position: editorPanel
            ? { referencePanel: editorPanel, direction: 'right' }
            : undefined,
          initialWidth: 400,
        })
      } else {
        api.addPanel({
          id: `agent-${Date.now()}`,
          component: 'chatPane',
          title: 'Agent',
          params: { workspaceId: activeWorkspaceId, workspaceRoot: workspaceRoot ?? undefined },
          position: editorPanel
            ? { referencePanel: editorPanel, direction: 'right' }
            : undefined,
          initialWidth: 350,
        })
      }
      persistWorkspaceRuntime()
    }).catch(() => {
      // Fallback to built-in
      api.addPanel({
        id: `agent-${Date.now()}`,
        component: 'chatPane',
        title: 'Agent',
        params: { workspaceId: activeWorkspaceId, workspaceRoot: workspaceRoot ?? undefined },
        position: editorPanel
          ? { referencePanel: editorPanel, direction: 'right' }
          : undefined,
        initialWidth: 350,
      })
      persistWorkspaceRuntime()
    })
  })

  useCommand('browser.back', {
    label: 'Browser Back',
    category: 'Browser',
  }, () => {
    if (activeBrowserPaneId) window.api.browserGoBack(activeBrowserPaneId)
  })

  useCommand('browser.forward', {
    label: 'Browser Forward',
    category: 'Browser',
  }, () => {
    if (activeBrowserPaneId) window.api.browserGoForward(activeBrowserPaneId)
  })

  useCommand('browser.reload', {
    label: 'Browser Reload',
    category: 'Browser',
  }, () => {
    if (activeBrowserPaneId) window.api.browserReload(activeBrowserPaneId)
  })

  // Cmd+Shift+F — find in files
  useCommand('search.findInFiles', {
    label: 'Find in Files',
    category: 'Search',
  }, () => {
    const api = dockviewApiRef.current
    if (!api) return

    // Focus existing panel or create new one
    const existing = api.panels.find((p) => p.id === 'findInFiles')
    if (existing) {
      existing.api.setActive()
      return
    }

    const terminalPanel = api.panels.find(
      (p) => p.id === 'terminal' || p.id.startsWith('terminal-'),
    )

    api.addPanel({
      id: 'findInFiles',
      component: 'findInFiles',
      title: 'Find in Files',
      params: { workspaceRoot: activeRoot },
      position: terminalPanel
        ? { referencePanel: terminalPanel }
        : undefined,
    })
  })

  // Cmd+, — open settings
  useCommand('settings.open', {
    label: 'Open Settings',
    category: 'Preferences',
  }, () => {
    const api = dockviewApiRef.current
    if (!api) return

    const existing = api.panels.find((p) => p.id === 'settings')
    if (existing) {
      existing.api.setActive()
      return
    }

    api.addPanel({
      id: 'settings',
      component: 'settingsPane',
      title: 'Settings',
      params: {},
    })
  })

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
                      title: branch ? `Terminal (${branch})` : 'Terminal',
                      params: createTerminalPanelParams(
                        activeWorkspaceId ?? undefined,
                        worktreePath,
                        branch ? `Terminal (${branch})` : 'Terminal',
                      ),
                      position: existingTerminal ? { referencePanel: existingTerminal } : undefined,
                    })
                    persistWorkspaceRuntime()
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
