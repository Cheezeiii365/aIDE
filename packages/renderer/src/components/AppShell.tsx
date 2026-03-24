import { WorkspaceRibbon } from './WorkspaceRibbon'
import { Sidebar } from './Sidebar'
import { DockviewContainer } from './DockviewContainer'
import { StatusBar } from './StatusBar'

export function AppShell() {
  return (
    <div className="app-shell">
      <WorkspaceRibbon />
      <div className="app-middle">
        <Sidebar />
        <div className="dockview-wrapper">
          <DockviewContainer />
        </div>
      </div>
      <StatusBar />
    </div>
  )
}
