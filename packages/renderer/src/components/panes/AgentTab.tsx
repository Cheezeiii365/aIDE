import { DockviewDefaultTab, type IDockviewPanelHeaderProps } from 'dockview-react'
import '../../styles/agent-tab.css'

interface AgentTabParams {
  worktreeBranch?: string
  [key: string]: unknown
}

export function AgentTab(props: IDockviewPanelHeaderProps<AgentTabParams>) {
  const branch = props.params?.worktreeBranch

  return (
    <div className="agent-tab">
      <DockviewDefaultTab {...props} />
      {branch && (
        <span className="agent-tab__worktree-badge" title={`Worktree: ${branch}`}>
          {branch}
        </span>
      )}
    </div>
  )
}
