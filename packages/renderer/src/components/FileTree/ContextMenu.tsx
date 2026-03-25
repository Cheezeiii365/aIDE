import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

interface ContextMenuProps {
  x: number
  y: number
  targetPath: string
  isDirectory: boolean
  onClose: () => void
  onNewFile: (parentDir: string) => void
  onNewFolder: (parentDir: string) => void
  onRename: (path: string) => void
  onDelete: (path: string) => void
}

function dirname(p: string): string {
  const parts = p.split('/')
  parts.pop()
  return parts.join('/') || '/'
}

export function ContextMenu({
  x,
  y,
  targetPath,
  isDirectory,
  onClose,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  // Adjust position to stay within viewport
  useEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.right > window.innerWidth) {
      el.style.left = `${window.innerWidth - rect.width - 4}px`
    }
    if (rect.bottom > window.innerHeight) {
      el.style.top = `${window.innerHeight - rect.height - 4}px`
    }
  }, [])

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const parentDir = isDirectory ? targetPath : dirname(targetPath)

  const items: Array<{ label: string; action: () => void; danger?: boolean } | 'separator'> = [
    { label: 'New File', action: () => onNewFile(parentDir) },
    { label: 'New Folder', action: () => onNewFolder(parentDir) },
    'separator',
    { label: 'Rename', action: () => onRename(targetPath) },
    { label: 'Delete', action: () => onDelete(targetPath), danger: true },
    'separator',
    {
      label: 'Copy Path',
      action: () => {
        navigator.clipboard.writeText(targetPath)
        onClose()
      },
    },
    {
      label: 'Reveal in Finder',
      action: () => {
        window.api.revealInFinder(targetPath)
        onClose()
      },
    },
  ]

  return createPortal(
    <div className="context-menu-overlay" onMouseDown={onClose}>
      <div
        ref={menuRef}
        className="context-menu"
        style={{ left: x, top: y }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {items.map((item, i) => {
          if (item === 'separator') {
            return <div key={i} className="context-menu__separator" />
          }
          return (
            <button
              key={item.label}
              className={`context-menu__item${item.danger ? ' context-menu__item--danger' : ''}`}
              onClick={() => {
                item.action()
                if (item.label !== 'Copy Path' && item.label !== 'Reveal in Finder') {
                  onClose()
                }
              }}
            >
              {item.label}
            </button>
          )
        })}
      </div>
    </div>,
    document.body,
  )
}
