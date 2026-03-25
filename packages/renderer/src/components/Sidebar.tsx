import { useState, useCallback, useRef, useEffect, type ReactNode } from 'react'
import { FileTree } from './FileTree/FileTree'
import { SidebarSection } from './SidebarSection'

const MIN_WIDTH = 180
const MAX_WIDTH = 500

interface Props {
  onFileOpen: (filePath: string) => void
  collapsed?: boolean
  activeRoot: string | null
  onOpenFolder: () => void
  worktreeSection?: ReactNode
}

export function Sidebar({ onFileOpen, collapsed = false, activeRoot, onOpenFolder, worktreeSection }: Props) {
  const [width, setWidth] = useState(220) // fallback until loaded
  const [filter, setFilter] = useState('')
  const dragging = useRef(false)
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Load persisted sidebar width on mount
  useEffect(() => {
    window.api.getSidebarWidth().then(setWidth)
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

  if (collapsed) {
    return null
  }

  return (
    <aside className="sidebar" style={{ width }}>
      <div className="sidebar__content">
        {activeRoot ? (
          <>
            <SidebarSection title="Explorer" defaultExpanded>
              <input
                className="sidebar__filter-input"
                type="text"
                placeholder="Filter files..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setFilter('')
                }}
              />
              <FileTree rootPath={activeRoot} onFileOpen={onFileOpen} filter={filter} />
            </SidebarSection>
            {worktreeSection}
          </>
        ) : (
          <div className="sidebar__empty">
            <button className="sidebar__open-btn" onClick={onOpenFolder}>
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
