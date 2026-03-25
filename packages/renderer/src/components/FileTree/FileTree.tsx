import { useState, useEffect, useCallback } from 'react'
import type { DirEntry, FsWatchEvent } from '@aide/shared'
import { FileTreeItem } from './FileTreeItem'
import type { FileTreeNode } from './FileTreeItem'
import { ContextMenu } from './ContextMenu'

// ── Helpers ────────────────────────────────────

function dirname(p: string): string {
  const parts = p.split('/')
  parts.pop()
  return parts.join('/') || '/'
}

function basename(p: string): string {
  return p.split('/').pop() ?? p
}

/** Insert a path into children array maintaining dirs-first + alphabetical sort. */
function insertSorted(
  children: string[],
  newPath: string,
  nodes: Map<string, FileTreeNode>,
): string[] {
  const newNode = nodes.get(newPath)
  if (!newNode) return [...children, newPath]
  const result = [...children]
  const insertIndex = result.findIndex((childPath) => {
    const child = nodes.get(childPath)
    if (!child) return false
    // Directories come before files
    if (child.isDirectory !== newNode.isDirectory) return !newNode.isDirectory
    return child.name.localeCompare(newNode.name, undefined, { sensitivity: 'base' }) > 0
  })
  if (insertIndex === -1) result.push(newPath)
  else result.splice(insertIndex, 0, newPath)
  return result
}

// ── Component ──────────────────────────────────

interface Props {
  rootPath: string
  onFileOpen: (filePath: string) => void
}

export function FileTree({ rootPath, onFileOpen }: Props) {
  const [nodes, setNodes] = useState<Map<string, FileTreeNode>>(new Map())
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    path: string
    isDirectory: boolean
  } | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [creatingIn, setCreatingIn] = useState<{
    parentDir: string
    type: 'file' | 'folder'
  } | null>(null)

  // Load root children on mount or when rootPath changes
  useEffect(() => {
    let cancelled = false

    async function loadRoot() {
      const entries = await window.api.readDir(rootPath)
      if (cancelled || 'error' in entries) return

      const nextNodes = new Map<string, FileTreeNode>()
      const childPaths: string[] = []

      for (const entry of entries as DirEntry[]) {
        childPaths.push(entry.path)
        nextNodes.set(entry.path, {
          path: entry.path,
          name: entry.name,
          isDirectory: entry.isDirectory,
          depth: 0,
          isExpanded: false,
          isLoaded: false,
          children: [],
        })
      }

      // Sentinel root node to hold top-level children
      nextNodes.set(rootPath, {
        path: rootPath,
        name: '',
        isDirectory: true,
        depth: -1,
        isExpanded: true,
        isLoaded: true,
        children: childPaths,
      })

      setNodes(nextNodes)
    }

    loadRoot()
    return () => {
      cancelled = true
    }
  }, [rootPath])

  // Subscribe to file watcher events for incremental tree updates
  useEffect(() => {
    const unsub = window.api.onFsWatchEvent((events: FsWatchEvent[]) => {
      setNodes((prev) => {
        const next = new Map(prev)
        let changed = false

        for (const event of events) {
          const parentPath = dirname(event.path)
          const parentNode = next.get(parentPath)

          if (event.type === 'create') {
            // Only add if parent is loaded and expanded (lazy load handles the rest)
            if (!parentNode || !parentNode.isLoaded) continue
            // Skip if already exists (duplicate event)
            if (next.has(event.path)) continue

            const newNode: FileTreeNode = {
              path: event.path,
              name: basename(event.path),
              isDirectory: event.isDirectory,
              depth: parentNode.depth + 1,
              isExpanded: false,
              isLoaded: false,
              children: [],
            }
            next.set(event.path, newNode)
            next.set(parentPath, {
              ...parentNode,
              children: insertSorted(parentNode.children, event.path, next),
            })
            changed = true
          } else if (event.type === 'delete') {
            const node = next.get(event.path)
            if (!node) continue

            // Remove from parent's children
            if (parentNode) {
              next.set(parentPath, {
                ...parentNode,
                children: parentNode.children.filter((c) => c !== event.path),
              })
            }

            // Recursively remove all descendants
            const toRemove = [event.path]
            while (toRemove.length > 0) {
              const p = toRemove.pop()
              if (!p) continue
              const n = next.get(p)
              if (n) {
                if (n.children) toRemove.push(...n.children)
                next.delete(p)
              }
            }
            changed = true
          }
          // 'update' events are no-ops for the tree (content changed, not structure)
          // TODO: trigger git status badge refresh when implemented
        }

        return changed ? next : prev
      })
    })

    return unsub
  }, [])

  const toggleExpand = useCallback(
    async (path: string) => {
      setNodes((prev) => {
        const node = prev.get(path)
        if (!node || !node.isDirectory) return prev

        if (node.isExpanded) {
          const next = new Map(prev)
          next.set(path, { ...node, isExpanded: false })
          return next
        }

        if (node.isLoaded) {
          const next = new Map(prev)
          next.set(path, { ...node, isExpanded: true })
          return next
        }

        return prev
      })

      const node = nodes.get(path)
      if (!node || !node.isDirectory) return
      if (node.isExpanded) return
      if (node.isLoaded) return

      const entries = await window.api.readDir(path)
      if ('error' in entries) return

      setNodes((prev) => {
        const next = new Map(prev)
        const childPaths: string[] = []

        for (const entry of entries as DirEntry[]) {
          childPaths.push(entry.path)
          if (!next.has(entry.path)) {
            next.set(entry.path, {
              path: entry.path,
              name: entry.name,
              isDirectory: entry.isDirectory,
              depth: node.depth + 1,
              isExpanded: false,
              isLoaded: false,
              children: [],
            })
          }
        }

        const current = next.get(path)
        if (!current) return prev
        next.set(path, { ...current, isExpanded: true, isLoaded: true, children: childPaths })
        return next
      })
    },
    [nodes],
  )

  // ── Context menu handlers ──────────────────────

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, path: string, isDirectory: boolean) => {
      setContextMenu({ x: e.clientX, y: e.clientY, path, isDirectory })
    },
    [],
  )

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  const handleNewFile = useCallback((parentDir: string) => {
    setCreatingIn({ parentDir, type: 'file' })
    // Expand the parent directory so the input is visible
    setNodes((prev) => {
      const parent = prev.get(parentDir)
      if (!parent || parent.isExpanded) return prev
      const next = new Map(prev)
      next.set(parentDir, { ...parent, isExpanded: true })
      return next
    })
  }, [])

  const handleNewFolder = useCallback((parentDir: string) => {
    setCreatingIn({ parentDir, type: 'folder' })
    setNodes((prev) => {
      const parent = prev.get(parentDir)
      if (!parent || parent.isExpanded) return prev
      const next = new Map(prev)
      next.set(parentDir, { ...parent, isExpanded: true })
      return next
    })
  }, [])

  const handleCreateSubmit = useCallback(
    async (name: string) => {
      if (!creatingIn) return
      const fullPath = `${creatingIn.parentDir}/${name}`
      const result =
        creatingIn.type === 'file'
          ? await window.api.createFile(fullPath)
          : await window.api.createDir(fullPath)
      if ('error' in result) {
        console.error('Create failed:', result.error)
      }
      setCreatingIn(null)
    },
    [creatingIn],
  )

  const handleRename = useCallback((path: string) => {
    setRenamingPath(path)
  }, [])

  const handleRenameSubmit = useCallback(async (oldPath: string, newName: string) => {
    const parentDir = dirname(oldPath)
    const newPath = `${parentDir}/${newName}`
    const result = await window.api.renameEntry(oldPath, newPath)
    if ('error' in result) {
      console.error('Rename failed:', result.error)
    }
    setRenamingPath(null)
  }, [])

  const handleRenameCancel = useCallback(() => {
    setRenamingPath(null)
  }, [])

  const handleDelete = useCallback(async (path: string) => {
    const name = basename(path)
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return
    const result = await window.api.deleteEntry(path)
    if ('error' in result) {
      console.error('Delete failed:', result.error)
    }
  }, [])

  // ── Compute visible nodes via DFS ────────────

  const visibleNodes: FileTreeNode[] = []
  const rootNode = nodes.get(rootPath)
  if (rootNode) {
    const stack = [...rootNode.children].reverse()
    while (stack.length > 0) {
      const p = stack.pop()
      if (!p) continue
      const node = nodes.get(p)
      if (!node) continue
      visibleNodes.push(node)
      if (node.isDirectory && node.isExpanded && node.children.length > 0) {
        for (let i = node.children.length - 1; i >= 0; i--) {
          stack.push(node.children[i])
        }
      }
    }
  }

  // ── Render ───────────────────────────────────

  // Build the creation input row if creating a new file/folder
  const createInputRow = creatingIn
    ? (() => {
        const parentNode = nodes.get(creatingIn.parentDir)
        if (!parentNode) return null
        const depth = parentNode.depth + 1
        const indent = depth * 16 + 8
        return {
          parentDir: creatingIn.parentDir,
          depth,
          indent,
          type: creatingIn.type,
        }
      })()
    : null

  return (
    <div className="file-tree">
      {visibleNodes.map((node) => {
        const elements: React.ReactNode[] = []

        // If we're creating inside this directory, render the input at the top of its children
        if (
          createInputRow &&
          createInputRow.parentDir === node.path &&
          node.isDirectory &&
          node.isExpanded
        ) {
          elements.push(
            <div
              key="__creating__"
              className="file-tree__row"
              style={{ paddingLeft: createInputRow.indent }}
              onClick={(e) => e.stopPropagation()}
            >
              <span className="file-tree__chevron-spacer" />
              <input
                className="file-tree__rename-input"
                autoFocus
                placeholder={createInputRow.type === 'file' ? 'filename' : 'folder name'}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const value = (e.target as HTMLInputElement).value.trim()
                    if (value && !value.includes('/')) handleCreateSubmit(value)
                  } else if (e.key === 'Escape') {
                    setCreatingIn(null)
                  }
                }}
                onBlur={() => setCreatingIn(null)}
              />
            </div>,
          )
        }

        elements.push(
          <FileTreeItem
            key={node.path}
            node={node}
            onToggle={toggleExpand}
            onFileOpen={onFileOpen}
            onContextMenu={handleContextMenu}
            isRenaming={renamingPath === node.path}
            onRenameSubmit={handleRenameSubmit}
            onRenameCancel={handleRenameCancel}
          />,
        )

        return elements
      })}

      {/* Render creation input at root level if creating at root */}
      {createInputRow && createInputRow.parentDir === rootPath && (
        <div
          className="file-tree__row"
          style={{ paddingLeft: createInputRow.indent }}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="file-tree__chevron-spacer" />
          <input
            className="file-tree__rename-input"
            autoFocus
            placeholder={createInputRow.type === 'file' ? 'filename' : 'folder name'}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const value = (e.target as HTMLInputElement).value.trim()
                if (value && !value.includes('/')) handleCreateSubmit(value)
              } else if (e.key === 'Escape') {
                setCreatingIn(null)
              }
            }}
            onBlur={() => setCreatingIn(null)}
          />
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          targetPath={contextMenu.path}
          isDirectory={contextMenu.isDirectory}
          onClose={closeContextMenu}
          onNewFile={handleNewFile}
          onNewFolder={handleNewFolder}
          onRename={handleRename}
          onDelete={handleDelete}
        />
      )}
    </div>
  )
}
