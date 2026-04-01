import { useState, useEffect, useRef, useCallback } from 'react'
import { ThemeToggle } from './ThemeToggle'
import { AgentStatusDot } from '../shared/AgentStatusDot'
import type { WorkspaceEntry, WorkspaceRuntimeSnapshot } from '@aide/shared'

interface Props {
  workspaces: WorkspaceEntry[]
  runtimeSnapshots: Record<string, WorkspaceRuntimeSnapshot>
  activeWorkspaceId: string | null
  onSwitch: (id: string) => void
  onOpenFolder: () => void
  onNewWorkspace: () => void
  onCloseWorkspace: (id: string) => void
  onReorder: (ids: string[]) => void
  onContextMenu: (id: string, x: number, y: number) => void
}

/**
 * Renders the workspace ribbon: a horizontal list of workspace tabs with controls for switching,
 * closing, creating, reordering (drag-and-drop), and opening a context menu.
 *
 * @param workspaces - Array of workspace entries to display as tabs
 * @param activeWorkspaceId - Id of the currently active workspace (tab receives active styling)
 * @param onSwitch - Called with a workspace id when a tab is clicked to make it active
 * @param onOpenFolder - Called when the empty-state tab ("No Project") is clicked
 * @param onNewWorkspace - Called when the New Workspace (+) tab is clicked
 * @param onCloseWorkspace - Called with a workspace id to close that workspace (also invoked via middle-click or close control)
 * @param onReorder - Called with the updated array of workspace ids after a drag-and-drop reorder
 * @param onContextMenu - Called with (id, x, y) when a workspace tab's context menu is requested
 * @returns The rendered workspace ribbon JSX element
 */
export function WorkspaceRibbon({
  workspaces,
  runtimeSnapshots,
  activeWorkspaceId,
  onSwitch,
  onOpenFolder,
  onNewWorkspace,
  onCloseWorkspace,
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

  const handleMiddleClick = useCallback((e: React.MouseEvent, id: string) => {
    if (e.button === 1) {
      e.preventDefault()
      onCloseWorkspace(id)
    }
  }, [onCloseWorkspace])

  const getRuntimeDotStatus = useCallback((workspaceId: string): 'idle' | 'running' | 'error' => {
    const snapshot = runtimeSnapshots[workspaceId]
    if (!snapshot) return 'idle'
    if (snapshot.status === 'error') return 'error'
    if (
      snapshot.state === 'foreground' ||
      snapshot.state === 'backgrounded' ||
      snapshot.workload.agentsRunning ||
      snapshot.workload.tasksRunning ||
      snapshot.workload.pendingApproval ||
      snapshot.workload.pendingUserInput
    ) {
      return 'running'
    }
    return 'idle'
  }, [runtimeSnapshots])

  return (
    <header className={`workspace-ribbon${isFullscreen ? ' workspace-ribbon--fullscreen' : ''}`}>
      <div className="workspace-ribbon__tabs">
        {workspaces.map((ws) => (
          <button
            key={ws.id}
            className={`workspace-tab${ws.id === activeWorkspaceId ? ' workspace-tab--active' : ''}${ws.id === dragOverId ? ' workspace-tab--drag-over' : ''}`}
            onClick={() => onSwitch(ws.id)}
            onMouseDown={(e) => handleMiddleClick(e, ws.id)}
            onContextMenu={(e) => {
              e.preventDefault()
              onContextMenu(ws.id, e.clientX, e.clientY)
            }}
            draggable
            onDragStart={() => handleDragStart(ws.id)}
            onDragOver={(e) => handleDragOver(e, ws.id)}
            onDrop={() => handleDrop(ws.id)}
            onDragEnd={handleDragEnd}
            title={
              runtimeSnapshots[ws.id]
                ? `${ws.rootPath ?? ws.name} • ${runtimeSnapshots[ws.id].state} • ${runtimeSnapshots[ws.id].status}`
                : (ws.rootPath ?? ws.name)
            }
          >
            {ws.color && (
              <span
                className="workspace-tab__dot"
                style={{ backgroundColor: ws.color }}
              />
            )}
            {!ws.color && <AgentStatusDot status={getRuntimeDotStatus(ws.id)} />}
            <span className="workspace-tab__name">
              {ws.icon ? `${ws.icon} ` : ''}{ws.name}
            </span>
            <span
              className="workspace-tab__close"
              onClick={(e) => {
                e.stopPropagation()
                onCloseWorkspace(ws.id)
              }}
              title="Close Workspace"
            >
              ×
            </span>
          </button>
        ))}
        {workspaces.length === 0 && (
          <button
            className="workspace-tab workspace-tab--active"
            onClick={onOpenFolder}
          >
            <span>No Project</span>
          </button>
        )}
        <button
          className="workspace-tab workspace-tab--add"
          onClick={onNewWorkspace}
          title="New Workspace (⌘⇧N)"
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
