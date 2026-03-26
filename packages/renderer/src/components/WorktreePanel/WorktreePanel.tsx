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

/**
 * Render a panel listing worktrees with support for switching active worktree, opening a terminal,
 * showing a contextual menu (open in terminal, reveal in Finder, remove), and creating new worktrees.
 *
 * @param worktrees - Array of worktree metadata to display
 * @param onSwitch - Callback invoked with the selected worktree path (or `null` for the main worktree) to switch active worktree
 * @param onOpenTerminal - Callback invoked with a worktree path to open a terminal for that worktree
 * @returns The rendered worktree panel element
 */
export function WorktreePanel({ worktrees, onSwitch, onOpenTerminal }: Props) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [enteringPaths, setEnteringPaths] = useState<Set<string>>(new Set())
  const prevPathsRef = useRef<Set<string>>(new Set())
  const menuRef = useRef<HTMLDivElement>(null)

  // Track new items for entry animation
  useEffect(() => {
    const currentPaths = new Set(worktrees.map((wt) => wt.path))
    const prevPaths = prevPathsRef.current

    if (prevPaths.size > 0) {
      const newPaths = new Set<string>()
      for (const p of currentPaths) {
        if (!prevPaths.has(p)) newPaths.add(p)
      }
      if (newPaths.size > 0) {
        setEnteringPaths(newPaths)
        const timer = setTimeout(() => setEnteringPaths(new Set()), 220)
        return () => clearTimeout(timer)
      }
    }

    prevPathsRef.current = currentPaths
  }, [worktrees])

  const handleContextMenu = useCallback((e: React.MouseEvent, worktree: WorktreeInfo) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, worktree })
  }, [])

  const openContextMenuAt = useCallback((e: React.MouseEvent, worktree: WorktreeInfo) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setContextMenu({ x: rect.right, y: rect.top, worktree })
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

  const onlyMainWorktree = worktrees.length <= 1

  return (
    <div className="worktree-panel">
      <div className="worktree-panel__list">
        {worktrees.map((wt) => (
          <div
            key={wt.path}
            className={enteringPaths.has(wt.path) ? 'worktree-item--entering' : ''}
          >
            <WorktreeItem
              worktree={wt}
              onClick={() => onSwitch(wt.isMain ? null : wt.path)}
              onContextMenu={(e) => handleContextMenu(e, wt)}
              onOpenTerminal={onOpenTerminal}
              onMoreActions={(e, worktree) => openContextMenuAt(e, worktree)}
            />
          </div>
        ))}
      </div>

      {onlyMainWorktree ? (
        <div className="worktree-panel__empty">
          <span className="worktree-panel__empty-text">
            Work on multiple branches simultaneously
          </span>
          <button
            className="worktree-panel__empty-btn"
            onClick={() => setShowCreateModal(true)}
          >
            Create a worktree
          </button>
        </div>
      ) : (
        <button
          className="worktree-panel__add-btn"
          onClick={() => setShowCreateModal(true)}
          title="Create worktree"
        >
          <span className="worktree-panel__add-icon">+</span>
          New Worktree
        </button>
      )}

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
              <svg className="context-menu__icon" viewBox="0 0 16 16" fill="currentColor">
                <path d="M0 3a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3zm1.5 0v10a.5.5 0 0 0 .5.5h12a.5.5 0 0 0 .5-.5V3a.5.5 0 0 0-.5-.5H2a.5.5 0 0 0-.5.5zm2.22 2.72a.75.75 0 0 1 1.06 0l2 2a.75.75 0 0 1 0 1.06l-2 2a.75.75 0 0 1-1.06-1.06L5.44 8 3.72 6.28a.75.75 0 0 1 0-1.06zM8 11a.75.75 0 0 1 0-1.5h2.5a.75.75 0 0 1 0 1.5H8z" />
              </svg>
              Open in Terminal
            </button>
            <button
              className="context-menu__item"
              onClick={() => {
                window.api.revealInFinder(contextMenu.worktree.path)
                closeContextMenu()
              }}
            >
              <svg className="context-menu__icon" viewBox="0 0 16 16" fill="currentColor">
                <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h3.879a1.5 1.5 0 0 1 1.06.44l1.122 1.12A.5.5 0 0 0 8.914 4H13.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9zM2.5 3a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5v-7a.5.5 0 0 0-.5-.5H8.914a1.5 1.5 0 0 1-1.06-.44L6.732 3.44A.5.5 0 0 0 6.379 3H2.5z" />
              </svg>
              Reveal in Finder
            </button>
            {!contextMenu.worktree.isMain && (
              <>
                <div className="context-menu__separator" />
                <button
                  className="context-menu__item context-menu__item--danger"
                  onClick={handleRemove}
                >
                  <svg className="context-menu__icon" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z" />
                    <path fillRule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z" />
                  </svg>
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
