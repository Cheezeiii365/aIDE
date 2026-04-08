import { useEffect, useState } from 'react'
import type { IDockviewPanelHeaderProps } from 'dockview-react'
import { isDocumentDirty, onDocumentSessionChanged } from '../../lib/editor/documentStore'
import { FileTypeIcon } from '../FileTree/FileTypeIcon'

interface EditorTabParams {
  filePath: string
  workspaceId?: string
}

export function EditorTab(props: IDockviewPanelHeaderProps<EditorTabParams>) {
  const { filePath, workspaceId } = props.params
  const name = filePath?.split('/').pop() ?? filePath ?? 'untitled'

  const [dirty, setDirty] = useState(() => isDocumentDirty(workspaceId, filePath))

  useEffect(() => {
    setDirty(isDocumentDirty(workspaceId, filePath))
    return onDocumentSessionChanged((wk, path) => {
      if (path === filePath && wk === (workspaceId ?? '')) {
        setDirty(isDocumentDirty(workspaceId, filePath))
      }
    })
  }, [filePath, workspaceId])

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (filePath && isDocumentDirty(workspaceId, filePath)) {
      if (!window.confirm('Discard unsaved changes?')) return
    }
    props.api.close()
  }

  return (
    <div className="editor-tab" title={filePath}>
      <span className="editor-tab__icon">
        <FileTypeIcon name={name} />
      </span>
      <span className="editor-tab__name">{name}</span>
      {dirty ? (
        <span className="editor-tab__dirty" aria-label="Unsaved changes" />
      ) : (
        <button
          type="button"
          className="editor-tab__close"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={handleClose}
          aria-label="Close tab"
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  )
}
