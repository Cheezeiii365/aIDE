import { useState, useEffect, useRef, useCallback } from 'react'
import { ThemeToggle } from './ThemeToggle'
import { AgentStatusDot } from './AgentStatusDot'
import type { WorkspaceEntry } from '@aide/shared'

interface Props {
  workspaces: WorkspaceEntry[]
  activeWorkspaceId: string | null
  onSwitch: (id: string) => void
  onCreateWorkspace: () => void
  onReorder: (ids: string[]) => void
  onContextMenu: (id: string, x: number, y: number) => void
}

export function WorkspaceRibbon({
  workspaces,
  activeWorkspaceId,
  onSwitch,
  onCreateWorkspace,
  onReorder,
  onContextMenu,
}: Props) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const draggedIdRef = useRef<string | null>(null)

  useEffect(() => {
    return window.api.onFullscreenChanged(setIsFullscreen)
  }, [])

  const handleDragStart = useCallback((id: string) => {
    draggedIdRef.current = id
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, id: string) => {
    e.preventDefault()
    setDragOverId(id)
  }, [])

  const handleDrop = useCallback((targetId: string) => {
    const draggedId = draggedIdRef.current
    if (!draggedId || draggedId === targetId) {
      setDragOverId(null)
      draggedIdRef.current = null
      return
    }

    const ids = workspaces.map((w) => w.id)
    const dragIdx = ids.indexOf(draggedId)
    const dropIdx = ids.indexOf(targetId)
    if (dragIdx < 0 || dropIdx < 0) return

    ids.splice(dragIdx, 1)
    ids.splice(dropIdx, 0, draggedId)
    onReorder(ids)

    setDragOverId(null)
    draggedIdRef.current = null
  }, [workspaces, onReorder])

  const handleDragEnd = useCallback(() => {
    setDragOverId(null)
    draggedIdRef.current = null
  }, [])

  return (
    <header className={`workspace-ribbon${isFullscreen ? ' workspace-ribbon--fullscreen' : ''}`}>
      <div className="workspace-ribbon__tabs">
        {workspaces.map((ws) => (
          <button
            key={ws.id}
            className={`workspace-tab${ws.id === activeWorkspaceId ? ' workspace-tab--active' : ''}${ws.id === dragOverId ? ' workspace-tab--drag-over' : ''}`}
            onClick={() => onSwitch(ws.id)}
            onContextMenu={(e) => {
              e.preventDefault()
              onContextMenu(ws.id, e.clientX, e.clientY)
            }}
            draggable
            onDragStart={() => handleDragStart(ws.id)}
            onDragOver={(e) => handleDragOver(e, ws.id)}
            onDrop={() => handleDrop(ws.id)}
            onDragEnd={handleDragEnd}
            title={ws.rootPath}
          >
            {ws.color && (
              <span
                className="workspace-tab__dot"
                style={{ backgroundColor: ws.color }}
              />
            )}
            {!ws.color && <AgentStatusDot status="idle" />}
            <span className="workspace-tab__name">
              {ws.icon ? `${ws.icon} ` : ''}{ws.name}
            </span>
          </button>
        ))}
        {workspaces.length === 0 && (
          <button
            className="workspace-tab workspace-tab--active"
            onClick={onCreateWorkspace}
          >
            <span>No Project</span>
          </button>
        )}
        <button
          className="workspace-tab workspace-tab--add"
          onClick={onCreateWorkspace}
          title="New Workspace"
        >
          +
        </button>
      </div>
      <div className="workspace-ribbon__actions">
        <span className="workspace-ribbon__cost">$0.00</span>
        <div className="workspace-ribbon__separator" />
        <ThemeToggle />
      </div>
    </header>
  )
}
