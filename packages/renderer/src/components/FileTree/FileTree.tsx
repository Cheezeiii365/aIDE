import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { DirEntry, FsWatchEvent, GitFileStatus } from '@aide/shared'
import { FileTreeItem } from './FileTreeItem'
import type { FileTreeNode, VirtualRow } from './FileTreeItem'
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

/** Check if a path is gitignored (directly or via an ignored ancestor). */
function isGitIgnored(path: string, ignored: Set<string>, rootPath: string): boolean {
  if (ignored.has(path)) return true
  // Check if any ancestor directory is ignored
  let dir = path
  while (true) {
    const parts = dir.split('/')
    parts.pop()
    dir = parts.join('/') || '/'
    if (dir.length <= rootPath.length) break
    if (ignored.has(dir)) return true
  }
  return false
}

// ── Component ──────────────────────────────────

interface Props {
  rootPath: string
  onFileOpen: (filePath: string) => void
  filter?: string
}

export function FileTree({ rootPath, onFileOpen, filter = '' }: Props) {
  const [nodes, setNodes] = useState<Map<string, FileTreeNode>>(new Map())
  const [gitStatus, setGitStatus] = useState<Record<string, GitFileStatus>>({})
  const [ignoredPaths, setIgnoredPaths] = useState<Set<string>>(new Set())
  const loadingPaths = useRef<Set<string>>(new Set())
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
        }

        return changed ? next : prev
      })
    })

    return unsub
  }, [])

  // Subscribe to git status updates
  useEffect(() => {
    window.api.getGitStatus().then((result) => {
      if (result) {
        setGitStatus(result.files)
        if (result.ignoredPaths) setIgnoredPaths(new Set(result.ignoredPaths))
      }
    })
    const unsub = window.api.onGitStatusChanged((result) => {
      setGitStatus(result.files)
      if (result.ignoredPaths) setIgnoredPaths(new Set(result.ignoredPaths))
    })
    return unsub
  }, [rootPath])

  const toggleExpand = useCallback(async (path: string) => {
    // Read node state DIRECTLY — not inside the updater — because React 18
    // may defer functional updaters when other state updates are batched,
    // making outer variables (needsLoad, nodeDepth) unreliable.
    const node = nodes.get(path)
    if (!node || !node.isDirectory) return

    // Already expanded → collapse
    if (node.isExpanded) {
      setNodes((prev) => {
        const n = prev.get(path)
        if (!n) return prev
        const next = new Map(prev)
        next.set(path, { ...n, isExpanded: false })
        return next
      })
      return
    }

    // Already loaded → just expand
    if (node.isLoaded) {
      setNodes((prev) => {
        const n = prev.get(path)
        if (!n) return prev
        const next = new Map(prev)
        next.set(path, { ...n, isExpanded: true })
        return next
      })
      return
    }

    // Not yet loaded — guard against concurrent loads
    if (loadingPaths.current.has(path)) return
    loadingPaths.current.add(path)

    const nodeDepth = node.depth

    // Mark expanded immediately
    setNodes((prev) => {
      const n = prev.get(path)
      if (!n) return prev
      const next = new Map(prev)
      next.set(path, { ...n, isExpanded: true })
      return next
    })

    try {
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
              depth: nodeDepth + 1,
              isExpanded: false,
              isLoaded: false,
              children: [],
            })
          }
        }

        const current = next.get(path)
        if (!current) return prev
        next.set(path, { ...current, isLoaded: true, children: childPaths })
        return next
      })
    } finally {
      loadingPaths.current.delete(path)
    }
  }, [nodes])

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

  // ── Compute directory git status (has any dirty descendant) ──
  const dirGitStatus = useMemo(() => {
    const dirStatus = new Map<string, GitFileStatus>()
    for (const filePath of Object.keys(gitStatus)) {
      // Walk up the path to mark all ancestor directories
      let dir = filePath
      while (true) {
        const parts = dir.split('/')
        parts.pop()
        dir = parts.join('/') || '/'
        if (dir.length < rootPath.length) break
        if (!dirStatus.has(dir)) {
          dirStatus.set(dir, 'M') // any dirty child → dot indicator
        }
      }
    }
    return dirStatus
  }, [gitStatus, rootPath])

  // ── Compute visible rows via DFS ─────────────

  const filterLower = filter.toLowerCase()

  // When filtering, pre-compute which paths match and their ancestors
  const filterMatchSet = useMemo(() => {
    if (!filterLower) return null
    const matched = new Set<string>()
    for (const [path, node] of nodes) {
      if (path === rootPath) continue
      if (node.name.toLowerCase().includes(filterLower)) {
        matched.add(path)
        let dir = path
        while (true) {
          const parts = dir.split('/')
          parts.pop()
          dir = parts.join('/') || '/'
          if (dir.length < rootPath.length) break
          matched.add(dir)
        }
      }
    }
    return matched
  }, [filterLower, nodes, rootPath])

  // Build flat VirtualRow[] with create-input rows merged in
  const virtualRows = useMemo<VirtualRow[]>(() => {
    const rows: VirtualRow[] = []
    const rootNode = nodes.get(rootPath)
    if (!rootNode) return rows

    const stack = [...rootNode.children].reverse()
    while (stack.length > 0) {
      const p = stack.pop()
      if (!p) continue
      const node = nodes.get(p)
      if (!node) continue

      if (filterMatchSet && !filterMatchSet.has(p)) continue

      rows.push({ type: 'node', node })

      if (node.isDirectory) {
        const shouldShowChildren = filterMatchSet ? true : node.isExpanded
        if (shouldShowChildren) {
          // Insert create-input row right after the expanded directory (before its children)
          if (creatingIn && creatingIn.parentDir === node.path) {
            const parentNode = nodes.get(creatingIn.parentDir)
            if (parentNode) {
              rows.push({
                type: 'create-input',
                parentDir: creatingIn.parentDir,
                depth: parentNode.depth + 1,
                inputType: creatingIn.type,
              })
            }
          }
          for (let i = node.children.length - 1; i >= 0; i--) {
            stack.push(node.children[i])
          }
        }
      }
    }

    // Create-input at root level
    if (creatingIn && creatingIn.parentDir === rootPath) {
      const parentNode = nodes.get(rootPath)
      if (parentNode) {
        rows.push({
          type: 'create-input',
          parentDir: rootPath,
          depth: parentNode.depth + 1,
          inputType: creatingIn.type,
        })
      }
    }

    return rows
  }, [nodes, rootPath, filterMatchSet, creatingIn])

  // ── Virtualizer ─────────────────────────────

  const scrollRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: virtualRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 22,
    overscan: 15,
    getItemKey: (index) => {
      const row = virtualRows[index]
      return row.type === 'node' ? row.node.path : `__create__${row.parentDir}`
    },
  })

  // Scroll to create-input row when it appears
  useEffect(() => {
    if (!creatingIn) return
    const idx = virtualRows.findIndex(
      (r) => r.type === 'create-input' && r.parentDir === creatingIn.parentDir,
    )
    if (idx >= 0) {
      virtualizer.scrollToIndex(idx, { align: 'auto' })
    }
  }, [creatingIn, virtualRows, virtualizer])

  // ── Render ───────────────────────────────────

  return (
    <div ref={scrollRef} className="file-tree">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const row = virtualRows[virtualItem.index]
          return (
            <div
              key={virtualItem.key}
              style={{
                position: 'absolute',
                top: virtualItem.start,
                left: 0,
                width: '100%',
                height: 22,
              }}
            >
              {row.type === 'node' ? (
                <FileTreeItem
                  node={row.node}
                  onToggle={toggleExpand}
                  onFileOpen={onFileOpen}
                  onContextMenu={handleContextMenu}
                  isRenaming={renamingPath === row.node.path}
                  onRenameSubmit={handleRenameSubmit}
                  onRenameCancel={handleRenameCancel}
                  gitStatus={
                    isGitIgnored(row.node.path, ignoredPaths, rootPath)
                      ? undefined
                      : (gitStatus[row.node.path] ?? dirGitStatus.get(row.node.path))
                  }
                  isIgnored={isGitIgnored(row.node.path, ignoredPaths, rootPath)}
                />
              ) : (
                <div
                  className="file-tree__row"
                  style={{ paddingLeft: row.depth * 16 + 8 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="file-tree__chevron-spacer" />
                  <input
                    className="file-tree__rename-input"
                    autoFocus
                    placeholder={row.inputType === 'file' ? 'filename' : 'folder name'}
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
            </div>
          )
        })}
      </div>

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
