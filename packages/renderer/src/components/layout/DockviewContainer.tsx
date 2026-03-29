import { useCallback } from 'react'
import { DockviewReact, type DockviewReadyEvent, type DockviewApi } from 'dockview-react'
import { PlaceholderPane } from '../panes/PlaceholderPane'
import { WelcomePane } from '../panes/WelcomePane'
import { EditorPane } from '../panes/EditorPane'
import { EditorTab } from '../panes/EditorTab'
import { AgentTab } from '../panes/AgentTab'
import { TerminalPane } from '../panes/TerminalPane'
import { MarkdownPreviewPane } from '../panes/MarkdownPreviewPane'
import { FindInFilesPane } from '../panes/FindInFilesPane'
import { BrowserPane } from '../panes/BrowserPane'
import { SettingsPane } from '../panes/SettingsPane'
import { ChatPane } from '../panes/ChatPane'
import { CliAgentPane } from '../panes/CliAgentPane'
import { ChatHistoryPane } from '../panes/ChatHistoryPane'
import 'dockview/dist/styles/dockview.css'
import '../../styles/dockview-theme.css'

const components = {
  placeholder: PlaceholderPane,
  welcomePane: WelcomePane,
  editorPane: EditorPane,
  terminalPane: TerminalPane,
  markdownPreview: MarkdownPreviewPane,
  findInFiles: FindInFilesPane,
  browserPane: BrowserPane,
  settingsPane: SettingsPane,
  chatPane: ChatPane,
  cliAgentPane: CliAgentPane,
  chatHistoryPane: ChatHistoryPane,
}

const tabComponents = {
  editorTab: EditorTab,
  agentTab: AgentTab,
}

interface Props {
  onApiReady: (api: DockviewApi) => void
}

/**
 * Render a DockviewReact component and forward its API to the provided callback when the Dockview becomes ready.
 *
 * @param onApiReady - Callback invoked with the Dockview API instance once the Dockview is ready
 * @returns The configured DockviewReact element
 */
export function DockviewContainer({ onApiReady }: Props) {
  const handleReady = useCallback(
    (event: DockviewReadyEvent) => {
      onApiReady(event.api)
    },
    [onApiReady],
  )

  return (
    <DockviewReact
      className="dockview-theme-aide"
      onReady={handleReady}
      components={components}
      tabComponents={tabComponents}
    />
  )
}
