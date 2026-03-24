import { useCallback } from 'react'

interface FileTreeNode {
  path: string
  name: string
  isDirectory: boolean
  depth: number
  isExpanded: boolean
}

interface Props {
  node: FileTreeNode
  onToggle: (path: string) => void
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

export function FileTreeItem({ node, onToggle }: Props) {
  const handleClick = useCallback(() => {
    if (node.isDirectory) {
      onToggle(node.path)
    }
  }, [node.path, node.isDirectory, onToggle])

  const indent = node.depth * 16 + 8

  return (
    <div
      className={`file-tree__row${node.isDirectory ? ' file-tree__row--dir' : ''}`}
      style={{ paddingLeft: indent }}
      onClick={handleClick}
    >
      {node.isDirectory ? (
        <ChevronIcon expanded={node.isExpanded} />
      ) : (
        <span className="file-tree__chevron-spacer" />
      )}
      {node.isDirectory ? <FolderIcon /> : <FileIcon />}
      <span className="file-tree__name">{node.name}</span>
    </div>
  )
}
