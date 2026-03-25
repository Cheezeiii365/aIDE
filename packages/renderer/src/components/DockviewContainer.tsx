import { useCallback } from 'react'
import { DockviewReact, type DockviewReadyEvent, type DockviewApi } from 'dockview-react'
import { PlaceholderPane } from './panes/PlaceholderPane'
import { EditorPane } from './panes/EditorPane'
import { EditorTab } from './panes/EditorTab'
import { TerminalPane } from './panes/TerminalPane'
import { MarkdownPreviewPane } from './panes/MarkdownPreviewPane'
import 'dockview/dist/styles/dockview.css'
import '../styles/dockview-theme.css'

const components = {
  placeholder: PlaceholderPane,
  editorPane: EditorPane,
  terminalPane: TerminalPane,
  markdownPreview: MarkdownPreviewPane,
}

const tabComponents = {
  editorTab: EditorTab,
}

interface Props {
  onApiReady: (api: DockviewApi) => void
}

export function DockviewContainer({ onApiReady }: Props) {
  const handleReady = useCallback(
    (event: DockviewReadyEvent) => {
      const { api } = event

      const editorPanel = api.addPanel({
        id: 'editor',
        component: 'placeholder',
        params: { title: 'Welcome' },
      })

      api.addPanel({
        id: 'terminal',
        component: 'terminalPane',
        title: 'Terminal',
        params: {},
        position: { referencePanel: editorPanel, direction: 'below' },
        initialHeight: 200,
      })

      api.addPanel({
        id: 'agent',
        component: 'placeholder',
        params: { title: 'Agent' },
        position: { referencePanel: editorPanel, direction: 'right' },
        initialWidth: 350,
      })

      onApiReady(api)
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
