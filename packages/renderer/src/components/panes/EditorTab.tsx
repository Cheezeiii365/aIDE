import { DockviewDefaultTab, type IDockviewPanelHeaderProps } from 'dockview-react'
import { isDocumentDirty } from '../../lib/editor/documentStore'

interface EditorTabParams {
  filePath: string
  workspaceId?: string
}

export function EditorTab(props: IDockviewPanelHeaderProps<EditorTabParams>) {
  const handleClose = () => {
    const filePath = props.params.filePath
    const workspaceId = props.params.workspaceId
    if (filePath && isDocumentDirty(workspaceId, filePath)) {
      if (!window.confirm('Discard unsaved changes?')) return
    }
    props.api.close()
  }

  return <DockviewDefaultTab {...props} closeActionOverride={handleClose} />
}
