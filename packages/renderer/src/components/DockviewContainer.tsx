import { useCallback } from 'react'
import { DockviewReact, type DockviewReadyEvent, type DockviewApi } from 'dockview-react'
import { PlaceholderPane } from './panes/PlaceholderPane'
import { WelcomePane } from './panes/WelcomePane'
import { EditorPane } from './panes/EditorPane'
import { EditorTab } from './panes/EditorTab'
import { TerminalPane } from './panes/TerminalPane'
import { MarkdownPreviewPane } from './panes/MarkdownPreviewPane'
import { FindInFilesPane } from './panes/FindInFilesPane'
import 'dockview/dist/styles/dockview.css'
import '../styles/dockview-theme.css'

const components = {
  placeholder: PlaceholderPane,
  welcomePane: WelcomePane,
  editorPane: EditorPane,
  terminalPane: TerminalPane,
  markdownPreview: MarkdownPreviewPane,
  findInFiles: FindInFilesPane,
}

const tabComponents = {
  editorTab: EditorTab,
}

interface Props {
  onApiReady: (api: DockviewApi) => void
}

/**
 * Renders a Dockview container and initializes a default layout (editor, terminal, and agent panels) when the Dockview API becomes available.
 *
 * @param onApiReady - Callback invoked with the `DockviewApi` instance once the Dockview is ready
 * @returns The configured `DockviewReact` element
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
