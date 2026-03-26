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
import { registerDefaultCommands } from '../lib/defaultCommands'
import { useTasks } from '../hooks/useTasks'
import type { GitignoreAuditResult, TaskInputRequest } from '@aide/shared'

/**
 * Top-level application shell that manages workspace state, dockview panels, shortcuts, and the main UI layout.
 *
 * Manages a persisted workspace root and worktrees, registers application actions, wires keyboard shortcuts for
 * terminal, sidebar toggle, panel closing, and markdown previewing, and provides handlers for opening files,
 * folders, terminals, and markdown previews. Renders the workspace ribbon, sidebar (including an optional Worktrees
 * section), the dockview container, status bar, and toast container.
 *
 * @returns The React element that composes the application's shell and primary UI regions.
 */
export function AppShell() {
  const dockviewApiRef = useRef<DockviewApi | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [quickOpenOpen, setQuickOpenOpen] = useState(false)
  const [gitignoreAudit, setGitignoreAudit] = useState<GitignoreAuditResult | null>(null)
  const [gitignoreModalOpen, setGitignoreModalOpen] = useState(false)
  const [taskInputRequest, setTaskInputRequest] = useState<TaskInputRequest | null>(null)
  const { worktrees, activeWorktree, activeRoot, switchWorktree } = useWorktrees(workspaceRoot)
  const { runningTasks } = useTasks()

  // Load persisted workspace root on mount
  useEffect(() => {
    window.api.getWorkspaceRoot().then(setWorkspaceRoot)
  }, [])

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
    const unsub = window.api.onTaskRequestInput((request) => {
      setTaskInputRequest(request)
    })
    return unsub
  }, [])

  // Listen for task auto-detect results (offer to generate tasks.json)
  useEffect(() => {
    const unsub = window.api.onTaskAutoDetect((tasks) => {
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

  // Keep sidebarVisible context key in sync
  useEffect(() => {
    setContext('sidebarVisible', !sidebarCollapsed)
  }, [sidebarCollapsed])

  const handleOpenFolder = useCallback(async () => {
    const selected = await window.api.openWorkspaceDialog()
    if (selected) setWorkspaceRoot(selected)
  }, [])

  const onApiReady = useCallback((api: DockviewApi) => {
    dockviewApiRef.current = api

    // Auto-close preview pane when its source editor is closed
    api.onDidRemovePanel((event) => {
      const previewId = `preview:${event.id}`
      const preview = api.panels.find((p) => p.id === previewId)
      if (preview) preview.api.close()
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
  }, [])

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
      params: { worktreePath: activeRoot },
      position,
    })
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
      <WorkspaceRibbon />
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
                      params: { worktreePath },
                      position: existingTerminal ? { referencePanel: existingTerminal } : undefined,
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
    </div>
  )
}
