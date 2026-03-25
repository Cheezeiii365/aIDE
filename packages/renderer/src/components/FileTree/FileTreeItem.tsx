import { useCallback, useRef, useEffect } from 'react'
import type { GitFileStatus } from '@aide/shared'
import { FileTypeIcon, FolderTypeIcon } from './FileTypeIcon'

export interface FileTreeNode {
  path: string
  name: string
  isDirectory: boolean
  depth: number
  isExpanded: boolean
  isLoaded: boolean
  children: string[]
}

export type VirtualRow =
  | { type: 'node'; node: FileTreeNode }
  | { type: 'create-input'; parentDir: string; depth: number; inputType: 'file' | 'folder' }

interface Props {
  node: FileTreeNode
  onToggle: (path: string) => void
  onFileOpen: (filePath: string) => void
  onContextMenu: (e: React.MouseEvent, path: string, isDirectory: boolean) => void
  isRenaming: boolean
  onRenameSubmit: (oldPath: string, newName: string) => void
  onRenameCancel: () => void
  gitStatus?: GitFileStatus
  isIgnored?: boolean
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
  isIgnored,
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
  const ignoredClass = isIgnored ? ' file-tree__row--ignored' : ''

  return (
    <div
      className={`file-tree__row${node.isDirectory ? ' file-tree__row--dir' : ''}${statusClass}${ignoredClass}`}
      style={{ paddingLeft: indent }}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      {node.isDirectory ? (
        <ChevronIcon expanded={node.isExpanded} />
      ) : (
        <span className="file-tree__chevron-spacer" />
      )}
      {node.isDirectory ? <FolderTypeIcon name={node.name} expanded={node.isExpanded} /> : <FileTypeIcon name={node.name} />}
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
