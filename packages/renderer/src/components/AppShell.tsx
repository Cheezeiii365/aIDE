import { useState, useRef, useCallback, useEffect } from 'react'
import type { DockviewApi } from 'dockview-react'
import { WorkspaceRibbon } from './WorkspaceRibbon'
import { Sidebar } from './Sidebar'
import { DockviewContainer } from './DockviewContainer'
import { StatusBar } from './StatusBar'
import { WorktreePanel } from './WorktreePanel/WorktreePanel'
import { SidebarSection } from './SidebarSection'
import { registerAppActions } from '../lib/appActions'
import { useShortcut } from '../lib/ShortcutManager'
import { useWorktrees } from '../hooks/useWorktrees'
import { ToastContainer, showToast } from './Toast'

export function AppShell() {
  const dockviewApiRef = useRef<DockviewApi | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null)
  const { worktrees, activeWorktree, activeRoot, switchWorktree } = useWorktrees(workspaceRoot)

  // Load persisted workspace root on mount
  useEffect(() => {
    window.api.getWorkspaceRoot().then(setWorkspaceRoot)
  }, [])

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
  }, [])

  // Register app-wide action dispatch layer
  useEffect(() => {
    registerAppActions({
      openFile: (filePath: string) => onFileOpen(filePath),
      openUrl: (url: string) => window.open(url),
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Cmd+Shift+T — open a new terminal tab
  useShortcut('new-terminal', 'Cmd+Shift+T', () => {
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
  useShortcut('toggle-sidebar', 'Cmd+B', () => {
    setSidebarCollapsed((prev) => !prev)
  })

  // Cmd+W — close active panel
  useShortcut('close-panel', 'Cmd+W', () => {
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
  useShortcut('toggle-md-preview', 'Cmd+Shift+V', () => {
    const api = dockviewApiRef.current
    if (!api) return
    const active = api.activePanel
    if (!active) return
    const filePath = (active.params as Record<string, unknown>)?.filePath as string | undefined
    if (!filePath || !filePath.endsWith('.md')) return
    openMarkdownPreview(filePath)
  })

  const onFileOpen = useCallback((filePath: string) => {
    const api = dockviewApiRef.current
    if (!api) return

    // If panel already exists, focus it
    const existing = api.panels.find((p) => p.id === filePath)
    if (existing) {
      existing.api.setActive()
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
      params: { filePath },
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
      <StatusBar />
      <ToastContainer />
    </div>
  )
}
