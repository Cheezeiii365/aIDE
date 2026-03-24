import { useRef, useCallback } from 'react'
import type { DockviewApi } from 'dockview-react'
import { WorkspaceRibbon } from './WorkspaceRibbon'
import { Sidebar } from './Sidebar'
import { DockviewContainer } from './DockviewContainer'
import { StatusBar } from './StatusBar'

export function AppShell() {
  const dockviewApiRef = useRef<DockviewApi | null>(null)

  const onApiReady = useCallback((api: DockviewApi) => {
    dockviewApiRef.current = api
  }, [])

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
        <Sidebar onFileOpen={onFileOpen} />
        <div className="dockview-wrapper">
          <DockviewContainer onApiReady={onApiReady} />
        </div>
      </div>
      <StatusBar />
    </div>
  )
}
