import type { WorktreeInfo } from '@aide/shared'

interface Props {
  worktree: WorktreeInfo
  onClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
}

export function WorktreeItem({ worktree, onClick, onContextMenu }: Props) {
  return (
    <div
      className={`worktree-item ${worktree.isCurrent ? 'worktree-item--active' : ''}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <svg className="worktree-item__icon" viewBox="0 0 16 16" fill="currentColor">
        <path d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm-2.116.842a2.25 2.25 0 1 1 .908 2.85L8.66 8.073a.75.75 0 0 1-1.318 0L5.458 6.192a2.25 2.25 0 1 1 .907-2.85L8 5.603l1.634-2.261zM4.25 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM8 9.927l1.882 2.605a2.25 2.25 0 1 0 .908-.85L8 9.422l-2.79 2.26a2.25 2.25 0 1 0 .908.85L8 9.927zm3.75 2.573a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5zm-7.5 0a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5z" />
      </svg>
      <span className="worktree-item__branch">{worktree.branch}</span>
      {worktree.isMain && <span className="worktree-item__badge worktree-item__badge--main">main</span>}
      {worktree.isDirty && <span className="worktree-item__dirty" title="Uncommitted changes" />}
    </div>
  )
}
