import { useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'

interface MenuItem {
  label: string
  onClick: () => void
  danger?: boolean
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

export function WorkspaceContextMenu({ x, y, items, onClose }: Props) {
  useEffect(() => {
    const handler = () => onClose()
    window.addEventListener('click', handler)
    window.addEventListener('contextmenu', handler)
    return () => {
      window.removeEventListener('click', handler)
      window.removeEventListener('contextmenu', handler)
    }
  }, [onClose])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handleClick = useCallback((item: MenuItem) => {
    item.onClick()
    onClose()
  }, [onClose])

  return createPortal(
    <div
      className="context-menu"
      style={{ top: y, left: x }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          className={`context-menu__item${item.danger ? ' context-menu__item--danger' : ''}`}
          onClick={() => handleClick(item)}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  )
}
