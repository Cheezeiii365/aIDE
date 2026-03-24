import { DockviewReact, type DockviewReadyEvent } from 'dockview-react'
import { PlaceholderPane } from './panes/PlaceholderPane'
import 'dockview/dist/styles/dockview.css'
import '../styles/dockview-theme.css'

const components = {
  placeholder: PlaceholderPane,
}

function buildDefaultLayout(event: DockviewReadyEvent) {
  const { api } = event

  const editorPanel = api.addPanel({
    id: 'editor',
    component: 'placeholder',
    params: { title: 'Editor' },
  })

  api.addPanel({
    id: 'terminal',
    component: 'placeholder',
    params: { title: 'Terminal' },
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
}

export function DockviewContainer() {
  return (
    <DockviewReact
      className="dockview-theme-aide"
      onReady={buildDefaultLayout}
      components={components}
    />
  )
}
