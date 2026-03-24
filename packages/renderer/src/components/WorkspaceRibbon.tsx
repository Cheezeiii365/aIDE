import { ThemeToggle } from './ThemeToggle'
import { AgentStatusDot } from './AgentStatusDot'

export function WorkspaceRibbon() {
  return (
    <header className="workspace-ribbon">
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
        <ThemeToggle />
      </div>
    </header>
  )
}
