import type { WorktreeInfo } from '@aide/shared'

interface Props {
  worktree: WorktreeInfo
  onClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onOpenTerminal: (path: string) => void
  onStartAgent: (path: string) => void
  onMoreActions: (e: React.MouseEvent, worktree: WorktreeInfo) => void
}

/**
 * Render a clickable row representing a repository worktree, showing branch, status badges, and action buttons.
 *
 * @param worktree - Worktree metadata used for display and styling (uses `branch`, `path`, `isCurrent`, `isMain`, and `isDirty`)
 * @param onClick - Called when the row is clicked
 * @param onContextMenu - Called when the row receives a context menu event
 * @param onOpenTerminal - Called with the worktree `path` when the "Open in Terminal" action is invoked
 * @param onMoreActions - Called with the mouse event and the `worktree` when the "More actions" button is invoked
 * @returns The rendered worktree row element
 */
export function WorktreeItem({ worktree, onClick, onContextMenu, onOpenTerminal, onStartAgent, onMoreActions }: Props) {
  return (
    <div
      className={`worktree-item${worktree.isCurrent ? ' worktree-item--active' : ''}${worktree.isMain ? ' worktree-item--main' : ''}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <svg className="worktree-item__icon" viewBox="0 0 16 16" fill="currentColor">
        <path d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm-2.116.842a2.25 2.25 0 1 1 .908 2.85L8.66 8.073a.75.75 0 0 1-1.318 0L5.458 6.192a2.25 2.25 0 1 1 .907-2.85L8 5.603l1.634-2.261zM4.25 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM8 9.927l1.882 2.605a2.25 2.25 0 1 0 .908-.85L8 9.422l-2.79 2.26a2.25 2.25 0 1 0 .908.85L8 9.927zm3.75 2.573a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5zm-7.5 0a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5z" />
      </svg>
      <span className="worktree-item__branch">{worktree.branch}</span>
      {worktree.isMain && <span className="worktree-item__badge worktree-item__badge--main">main</span>}
      {worktree.isDirty && <span className="worktree-item__dirty" title="Uncommitted changes">M</span>}

      <div className="worktree-item__actions">
        {/* Agent button */}
        <button
          className="worktree-item__action-btn"
          title="Start Agent in Worktree"
          onClick={(e) => {
            e.stopPropagation()
            onStartAgent(worktree.path)
          }}
        >
          <svg viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h9.586a2 2 0 0 1 1.414.586l2 2V2a1 1 0 0 0-1-1H2zm12-1a2 2 0 0 1 2 2v12.793a.5.5 0 0 1-.854.353l-2.853-2.853A1 1 0 0 0 11.586 12H2a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h12z" />
          </svg>
        </button>
        {/* Terminal button */}
        <button
          className="worktree-item__action-btn"
          title="Open in Terminal"
          onClick={(e) => {
            e.stopPropagation()
            onOpenTerminal(worktree.path)
          }}
        >
          <svg viewBox="0 0 16 16" fill="currentColor">
            <path d="M0 3a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3zm1.5 0v10a.5.5 0 0 0 .5.5h12a.5.5 0 0 0 .5-.5V3a.5.5 0 0 0-.5-.5H2a.5.5 0 0 0-.5.5zm2.22 2.72a.75.75 0 0 1 1.06 0l2 2a.75.75 0 0 1 0 1.06l-2 2a.75.75 0 0 1-1.06-1.06L5.44 8 3.72 6.28a.75.75 0 0 1 0-1.06zM8 11a.75.75 0 0 1 0-1.5h2.5a.75.75 0 0 1 0 1.5H8z" />
          </svg>
        </button>
        {/* More actions button */}
        <button
          className="worktree-item__action-btn"
          title="More actions"
          onClick={(e) => {
            e.stopPropagation()
            onMoreActions(e, worktree)
          }}
        >
          <svg viewBox="0 0 16 16" fill="currentColor">
            <circle cx="8" cy="3" r="1.5" />
            <circle cx="8" cy="8" r="1.5" />
            <circle cx="8" cy="13" r="1.5" />
          </svg>
        </button>
      </div>
    </div>
  )
}
