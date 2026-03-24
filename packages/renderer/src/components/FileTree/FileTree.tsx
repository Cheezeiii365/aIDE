import { useState, useEffect, useCallback } from 'react'
import type { DirEntry } from '@aide/shared'
import { FileTreeItem } from './FileTreeItem'

interface FileTreeNode {
  path: string
  name: string
  isDirectory: boolean
  depth: number
  isExpanded: boolean
  isLoaded: boolean
  children: string[]
}

interface Props {
  rootPath: string
}

export function FileTree({ rootPath }: Props) {
  const [nodes, setNodes] = useState<Map<string, FileTreeNode>>(new Map())

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
    return () => { cancelled = true }
  }, [rootPath])

  const toggleExpand = useCallback(async (path: string) => {
    setNodes((prev) => {
      const node = prev.get(path)
      if (!node || !node.isDirectory) return prev

      // If collapsing, just toggle
      if (node.isExpanded) {
        const next = new Map(prev)
        next.set(path, { ...node, isExpanded: false })
        return next
      }

      // If already loaded, just expand
      if (node.isLoaded) {
        const next = new Map(prev)
        next.set(path, { ...node, isExpanded: true })
        return next
      }

      // Need to load — trigger async then update state
      return prev
    })

    // Check if we need to load
    const node = nodes.get(path)
    if (!node || !node.isDirectory) return
    if (node.isExpanded) return // was collapsing — handled above
    if (node.isLoaded) return // was expanding loaded — handled above

    // Lazy load children
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
            depth: (node.depth) + 1,
            isExpanded: false,
            isLoaded: false,
            children: [],
          })
        }
      }

      const current = next.get(path)!
      next.set(path, { ...current, isExpanded: true, isLoaded: true, children: childPaths })
      return next
    })
  }, [nodes])

  // Compute visible nodes via DFS
  const visibleNodes: FileTreeNode[] = []
  const rootNode = nodes.get(rootPath)
  if (rootNode) {
    const stack = [...rootNode.children].reverse()
    while (stack.length > 0) {
      const p = stack.pop()!
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

  return (
    <div className="file-tree">
      {visibleNodes.map((node) => (
        <FileTreeItem
          key={node.path}
          node={node}
          onToggle={toggleExpand}
        />
      ))}
    </div>
  )
}
