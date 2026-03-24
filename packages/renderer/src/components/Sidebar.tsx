import { useState, useCallback, useRef } from 'react'

const MIN_WIDTH = 180
const MAX_WIDTH = 500
const DEFAULT_WIDTH = 220

export function Sidebar() {
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const dragging = useRef(false)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX))
      setWidth(newWidth)
    }

    const onMouseUp = () => {
      dragging.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [])

  return (
    <aside className="sidebar" style={{ width }}>
      <div className="sidebar__content">
        <div className="sidebar__header">Explorer</div>
        <div className="sidebar__placeholder">File Tree</div>
      </div>
      <div className="sidebar__resize-handle" onMouseDown={onMouseDown} />
    </aside>
  )
}
