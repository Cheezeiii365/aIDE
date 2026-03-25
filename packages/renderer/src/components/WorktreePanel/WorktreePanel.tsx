import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { WorktreeInfo } from '@aide/shared'
import { WorktreeItem } from './WorktreeItem'
import { CreateWorktreeModal } from './CreateWorktreeModal'

interface Props {
  worktrees: WorktreeInfo[]
  onSwitch: (worktreePath: string | null) => void
  onOpenTerminal: (worktreePath: string) => void
}

interface ContextMenuState {
  x: number
  y: number
  worktree: WorktreeInfo
}

export function WorktreePanel({ worktrees, onSwitch, onOpenTerminal }: Props) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const handleContextMenu = useCallback((e: React.MouseEvent, worktree: WorktreeInfo) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, worktree })
  }, [])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  // Close context menu on Escape
  useEffect(() => {
    if (!contextMenu) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeContextMenu()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [contextMenu, closeContextMenu])

  // Adjust context menu position to stay within viewport
  useEffect(() => {
    const el = menuRef.current
    if (!el || !contextMenu) return
    const rect = el.getBoundingClientRect()
    if (rect.right > window.innerWidth) {
      el.style.left = `${window.innerWidth - rect.width - 4}px`
    }
    if (rect.bottom > window.innerHeight) {
      el.style.top = `${window.innerHeight - rect.height - 4}px`
    }
  }, [contextMenu])

  const handleRemove = useCallback(async () => {
    if (!contextMenu) return
    const result = await window.api.removeWorktree(contextMenu.worktree.path)
    if ('error' in result) {
      console.error('Failed to remove worktree:', result.error)
    }
    closeContextMenu()
  }, [contextMenu, closeContextMenu])

  return (
    <div className="worktree-panel">
      <div className="worktree-panel__list">
        {worktrees.map((wt) => (
          <WorktreeItem
            key={wt.path}
            worktree={wt}
            onClick={() => {
              // Clicking the main worktree when it's not a custom worktree → reset to null
              onSwitch(wt.isMain ? null : wt.path)
            }}
            onContextMenu={(e) => handleContextMenu(e, wt)}
          />
        ))}
      </div>

      <button
        className="worktree-panel__add-btn"
        onClick={() => setShowCreateModal(true)}
        title="Create worktree"
      >
        + New Worktree
      </button>

      {contextMenu && createPortal(
        <div className="context-menu-overlay" onMouseDown={closeContextMenu}>
          <div
            ref={menuRef}
            className="context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              className="context-menu__item"
              onClick={() => {
                onOpenTerminal(contextMenu.worktree.path)
                closeContextMenu()
              }}
            >
              Open in Terminal
            </button>
            <button
              className="context-menu__item"
              onClick={() => {
                window.api.revealInFinder(contextMenu.worktree.path)
                closeContextMenu()
              }}
            >
              Reveal in Finder
            </button>
            {!contextMenu.worktree.isMain && (
              <>
                <div className="context-menu__separator" />
                <button
                  className="context-menu__item context-menu__item--danger"
                  onClick={handleRemove}
                >
                  Remove Worktree
                </button>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}

      {showCreateModal && (
        <CreateWorktreeModal onClose={() => setShowCreateModal(false)} />
      )}
    </div>
  )
}
