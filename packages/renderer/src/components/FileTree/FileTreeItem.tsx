import { useCallback, useRef, useEffect } from 'react'
import type { GitFileStatus } from '@aide/shared'

export interface FileTreeNode {
  path: string
  name: string
  isDirectory: boolean
  depth: number
  isExpanded: boolean
  isLoaded: boolean
  children: string[]
}

interface Props {
  node: FileTreeNode
  onToggle: (path: string) => void
  onFileOpen: (filePath: string) => void
  onContextMenu: (e: React.MouseEvent, path: string, isDirectory: boolean) => void
  isRenaming: boolean
  onRenameSubmit: (oldPath: string, newName: string) => void
  onRenameCancel: () => void
  gitStatus?: GitFileStatus
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`file-tree__chevron${expanded ? ' file-tree__chevron--expanded' : ''}`}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  )
}

function FolderIcon() {
  return (
    <svg className="file-tree__icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1.5 2A1.5 1.5 0 003 3.5h3.379a.5.5 0 01.354.146L7.854 4.77a.5.5 0 00.353.146H13A1.5 1.5 0 0114.5 6.5v6A1.5 1.5 0 0113 14H3a1.5 1.5 0 01-1.5-1.5v-10z"
        opacity="0.7"
      />
    </svg>
  )
}

function FileIcon() {
  return (
    <svg className="file-tree__icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M3 1.5A1.5 1.5 0 014.5 0h4.879a1.5 1.5 0 011.06.44l2.122 2.12A1.5 1.5 0 0113 3.622V14.5A1.5 1.5 0 0111.5 16h-7A1.5 1.5 0 013 14.5v-13z"
        opacity="0.5"
      />
    </svg>
  )
}

function RenameInput({
  initialName,
  onSubmit,
  onCancel,
}: {
  initialName: string
  onSubmit: (name: string) => void
  onCancel: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    // Select name without extension for files
    const dotIndex = initialName.lastIndexOf('.')
    if (dotIndex > 0) {
      el.setSelectionRange(0, dotIndex)
    } else {
      el.select()
    }
  }, [initialName])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      const value = inputRef.current?.value.trim()
      if (value && !value.includes('/')) {
        onSubmit(value)
      }
    } else if (e.key === 'Escape') {
      onCancel()
    }
  }

  return (
    <input
      ref={inputRef}
      className="file-tree__rename-input"
      defaultValue={initialName}
      onKeyDown={handleKeyDown}
      onBlur={onCancel}
      onClick={(e) => e.stopPropagation()}
    />
  )
}

const GIT_STATUS_LABELS: Record<GitFileStatus, string> = {
  M: 'M',
  A: 'A',
  '?': 'U',
  D: 'D',
}

export function FileTreeItem({
  node,
  onToggle,
  onFileOpen,
  onContextMenu,
  isRenaming,
  onRenameSubmit,
  onRenameCancel,
  gitStatus,
}: Props) {
  const handleClick = useCallback(() => {
    if (node.isDirectory) {
      onToggle(node.path)
    } else {
      onFileOpen(node.path)
    }
  }, [node.path, node.isDirectory, onToggle, onFileOpen])

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      onContextMenu(e, node.path, node.isDirectory)
    },
    [node.path, node.isDirectory, onContextMenu],
  )

  const indent = node.depth * 16 + 8

  const statusClass = gitStatus ? ` file-tree__row--git-${gitStatus === '?' ? 'untracked' : gitStatus.toLowerCase()}` : ''

  return (
    <div
      className={`file-tree__row${node.isDirectory ? ' file-tree__row--dir' : ''}${statusClass}`}
      style={{ paddingLeft: indent }}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      {node.isDirectory ? (
        <ChevronIcon expanded={node.isExpanded} />
      ) : (
        <span className="file-tree__chevron-spacer" />
      )}
      {node.isDirectory ? <FolderIcon /> : <FileIcon />}
      {isRenaming ? (
        <RenameInput
          initialName={node.name}
          onSubmit={(newName) => onRenameSubmit(node.path, newName)}
          onCancel={onRenameCancel}
        />
      ) : (
        <span className="file-tree__name">{node.name}</span>
      )}
      {gitStatus && !isRenaming && (
        <span className={`file-tree__git-badge file-tree__git-badge--${gitStatus === '?' ? 'untracked' : gitStatus.toLowerCase()}`}>
          {node.isDirectory ? '\u2022' : GIT_STATUS_LABELS[gitStatus]}
        </span>
      )}
    </div>
  )
}
