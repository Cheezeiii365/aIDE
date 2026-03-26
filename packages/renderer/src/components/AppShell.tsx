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
import { registerDefaultCommands } from '../lib/defaultCommands'
import { useTasks } from '../hooks/useTasks'
import { useWorkspaces } from '../hooks/useWorkspaces'
import { autoSave, switchWorkspace as doSwitchWorkspace } from '../lib/workspaceSwitcher'
import { createTerminalPanelParams, getTerminalParams } from '../lib/terminalState'
import {
  captureWorkspaceRuntimeSnapshot,
  clearWorkspaceRuntimeSnapshot,
  saveWorkspaceRuntimeSnapshot,
} from '../lib/workspaceRuntimeSnapshots'
import type { AideTask, GitignoreAuditResult, TaskInputRequest } from '@aide/shared'

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
  const sidebarWidthRef = useRef(220)
  const prevWorkspaceRootRef = useRef<string | null>(null)
  const prevWorkspaceIdRef = useRef<string | null>(null)
  const preservedTerminalIdsRef = useRef(new Set<string>())
  const destroyedWorkspaceIdsRef = useRef(new Set<string>())
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [quickOpenOpen, setQuickOpenOpen] = useState(false)
  const [gitignoreAudit, setGitignoreAudit] = useState<GitignoreAuditResult | null>(null)
  const [gitignoreModalOpen, setGitignoreModalOpen] = useState(false)
  const [taskInputRequest, setTaskInputRequest] = useState<TaskInputRequest | null>(null)
  const [wsContextMenu, setWsContextMenu] = useState<{ id: string; x: number; y: number } | null>(null)
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
            preservedTerminalIdsRef.current = new Set(
              api.panels
                .map((panel) => getTerminalParams(panel)?.terminalId)
                .filter((id): id is string => !!id),
            )
          },
          onAfterRestorePanels: () => {
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
        preservedTerminalIdsRef.current = new Set(
          api.panels
            .map((panel) => getTerminalParams(panel)?.terminalId)
            .filter((id): id is string => !!id),
        )
      },
      onAfterRestorePanels: () => {
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
    })

    // Track which pane type is focused
    api.onDidActivePanelChange((panel) => {
      if (!panel) {
        setContext('editorFocused', false)
        setContext('terminalFocused', false)
        return
      }
      const id = panel.id
      const isTerminal = id === 'terminal' || id.startsWith('terminal-')
      setContext('terminalFocused', isTerminal)
      setContext('editorFocused', !isTerminal)
    })

    registerDefaultCommands(api)
  }, [persistWorkspaceRuntime])

  // Register app-wide action dispatch layer
  useEffect(() => {
    registerAppActions({
      openFile: (filePath: string, opts?: OpenFileOpts) => onFileOpen(filePath, opts),
      openUrl: (url: string) => window.open(url),
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Cmd+Shift+T — open a new terminal tab
  useCommand('terminal.new', {
    label: 'New Terminal',
    keybinding: 'Cmd+Shift+T',
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

  // Cmd+B — toggle sidebar
  useCommand('view.toggleSidebar', {
    label: 'Toggle Sidebar',
    keybinding: 'Cmd+B',
    category: 'View',
  }, () => {
    setSidebarCollapsed((prev) => !prev)
  })

  // Cmd+W — close active panel
  useCommand('panel.close', {
    label: 'Close Active Panel',
    keybinding: 'Cmd+W',
    category: 'Panel',
  }, () => {
    const api = dockviewApiRef.current
    if (!api) return
    const active = api.activePanel
    if (active) {
      active.api.close()
    }
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
    keybinding: 'Cmd+Shift+V',
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
    keybinding: 'Cmd+Shift+P',
    category: 'View',
  }, () => {
    setQuickOpenOpen(false)
    setCommandPaletteOpen(true)
  })

  // Cmd+P — quick open
  useCommand('quickOpen.open', {
    label: 'Quick Open',
    keybinding: 'Cmd+P',
    category: 'View',
  }, () => {
    setCommandPaletteOpen(false)
    setQuickOpenOpen(true)
  })

  // Cmd+Shift+F — find in files
  useCommand('search.findInFiles', {
    label: 'Find in Files',
    keybinding: 'Cmd+Shift+F',
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
      params: { filePath, jumpToLine: opts?.line, jumpToColumn: opts?.column },
      position,
    })

    // Suggest preview for markdown files
    if (filePath.endsWith('.md')) {
      showToast('Markdown file detected', {
        label: 'Open Preview',
        onClick: () => openMarkdownPreview(filePath),
      })
    }
  }, [openMarkdownPreview])

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
