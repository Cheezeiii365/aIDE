import { DockviewDefaultTab, type IDockviewPanelHeaderProps } from 'dockview-react'
import { isDirty } from '../../lib/editorDirtyState'

interface EditorTabParams {
  filePath: string
}

export function EditorTab(props: IDockviewPanelHeaderProps<EditorTabParams>) {
  const handleClose = () => {
    const filePath = props.params.filePath
    if (filePath && isDirty(filePath)) {
      if (!window.confirm('Discard unsaved changes?')) return
    }
    props.api.close()
  }

  return <DockviewDefaultTab {...props} closeActionOverride={handleClose} />
}
