import { useState, useCallback, useRef, useEffect } from 'react'
import { FileTree } from './FileTree/FileTree'

const MIN_WIDTH = 180
const MAX_WIDTH = 500

export function Sidebar() {
  const [width, setWidth] = useState(220) // fallback until loaded
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null)
  const dragging = useRef(false)
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Load persisted sidebar width and workspace root on mount
  useEffect(() => {
    window.api.getSidebarWidth().then(setWidth)
    window.api.getWorkspaceRoot().then(setWorkspaceRoot)
  }, [])

  // Debounced save of sidebar width
  const persistWidth = useCallback((w: number) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => {
      window.api.setSidebarWidth(w)
    }, 500)
  }, [])

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX))
      setWidth(newWidth)
      persistWidth(newWidth)
    }

    const onMouseUp = () => {
      dragging.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [persistWidth])

  const handleOpenFolder = useCallback(async () => {
    const selected = await window.api.openWorkspaceDialog()
    if (selected) setWorkspaceRoot(selected)
  }, [])

  return (
    <aside className="sidebar" style={{ width }}>
      <div className="sidebar__content">
        <div className="sidebar__header">Explorer</div>
        {workspaceRoot ? (
          <FileTree rootPath={workspaceRoot} />
        ) : (
          <div className="sidebar__empty">
            <button className="sidebar__open-btn" onClick={handleOpenFolder}>
              Open Folder
            </button>
            <span className="sidebar__empty-hint">
              Open a folder to start exploring
            </span>
          </div>
        )}
      </div>
      <div className="sidebar__resize-handle" onMouseDown={onMouseDown} />
    </aside>
  )
}
