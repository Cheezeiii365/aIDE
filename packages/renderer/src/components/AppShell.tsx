import { useState, useRef, useCallback, useEffect } from 'react'
import type { DockviewApi } from 'dockview-react'
import { WorkspaceRibbon } from './WorkspaceRibbon'
import { Sidebar } from './Sidebar'
import { DockviewContainer } from './DockviewContainer'
import { StatusBar } from './StatusBar'
import { registerAppActions } from '../lib/appActions'
import { useShortcut } from '../lib/ShortcutManager'

export function AppShell() {
  const dockviewApiRef = useRef<DockviewApi | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const onApiReady = useCallback((api: DockviewApi) => {
    dockviewApiRef.current = api
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
  }, [])

  return (
    <div className="app-shell">
      <WorkspaceRibbon />
      <div className="app-middle">
        <Sidebar onFileOpen={onFileOpen} collapsed={sidebarCollapsed} />
        <div className="dockview-wrapper">
          <DockviewContainer onApiReady={onApiReady} />
        </div>
      </div>
      <StatusBar />
    </div>
  )
}
