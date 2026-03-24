import { useState, useEffect } from 'react'
import { ThemeToggle } from './ThemeToggle'
import { AgentStatusDot } from './AgentStatusDot'

export function WorkspaceRibbon() {
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    return window.api.onFullscreenChanged(setIsFullscreen)
  }, [])

  return (
    <header className={`workspace-ribbon${isFullscreen ? ' workspace-ribbon--fullscreen' : ''}`}>
      <div className="workspace-ribbon__tabs">
        <button className="workspace-tab workspace-tab--active">
          <AgentStatusDot status="running" />
          <span>Project A</span>
        </button>
        <button className="workspace-tab">
          <AgentStatusDot status="idle" />
          <span>Project B</span>
        </button>
      </div>
      <div className="workspace-ribbon__actions">
        <span className="workspace-ribbon__cost">$0.00</span>
        <div className="workspace-ribbon__separator" />
        <ThemeToggle />
      </div>
    </header>
  )
}
