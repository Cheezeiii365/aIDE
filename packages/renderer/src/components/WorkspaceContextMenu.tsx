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

/**
 * Render a context menu as a React portal positioned at the specified screen coordinates.
 *
 * @param x - X coordinate used for the menu's left position (pixels).
 * @param y - Y coordinate used for the menu's top position (pixels).
 * @param items - Array of menu entries; each entry's `label` is rendered as the button text and `onClick` is invoked when that entry is selected.
 * @param onClose - Callback invoked to close the menu.
 * @returns A React portal element that mounts the context menu into `document.body`.
 */
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
