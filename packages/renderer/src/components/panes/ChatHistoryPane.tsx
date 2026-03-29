import { useState, useRef, useEffect, useCallback } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import type { ConversationMeta, AgentBackend } from '@aide/shared'
import { useConversationHistory } from '../../hooks/useConversationHistory'
import '../../styles/chat-history-pane.css'

interface ChatHistoryPanelParams {
  workspaceId?: string
  workspaceRoot?: string
  /** Callback to open a conversation as a tab — injected by AppShell */
  onOpenConversation?: (meta: ConversationMeta) => void
  zoomFactor?: number
}

export function ChatHistoryPane({ params }: IDockviewPanelProps<ChatHistoryPanelParams>) {
  const history = useConversationHistory(params?.workspaceId)
  const [filter, setFilter] = useState('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; meta: ConversationMeta } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const filterRef = useRef<HTMLInputElement>(null)

  const filtered = filter
    ? history.conversations.filter(c =>
        c.title.toLowerCase().includes(filter.toLowerCase()) ||
        (c.firstMessage?.toLowerCase().includes(filter.toLowerCase()))
      )
    : history.conversations

  const handleClick = (meta: ConversationMeta) => {
    if (params?.onOpenConversation) {
      params.onOpenConversation(meta)
    }
  }

  const handleContextMenu = (e: React.MouseEvent, meta: ConversationMeta) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, meta })
  }

  const handleRenameStart = (meta: ConversationMeta) => {
    setRenaming(meta.id)
    setRenameValue(meta.title)
    setContextMenu(null)
  }

  const handleRenameSubmit = async () => {
    if (renaming && renameValue.trim()) {
      await history.renameConversation(renaming, renameValue.trim())
    }
    setRenaming(null)
  }

  const handleDelete = async (meta: ConversationMeta) => {
    setContextMenu(null)
    await history.deleteConversation(meta.id)
  }

  const handleNewChat = async (backend: AgentBackend = 'built-in') => {
    const meta = await history.createConversation(backend)
    if (params?.onOpenConversation) {
      params.onOpenConversation(meta)
    }
  }

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return
    const handler = () => setContextMenu(null)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [contextMenu])

  return (
    <div className="chat-history-pane" style={{ ['--panel-zoom' as string]: String(params?.zoomFactor ?? 1) }}>
      {/* Header */}
      <div className="chat-history-pane__header">
        <span className="chat-history-pane__title">Conversations</span>
        <button
          className="chat-history-pane__new-btn"
          onClick={() => handleNewChat('built-in')}
          title="New conversation"
        >
          +
        </button>
      </div>

      {/* Filter */}
      <div className="chat-history-pane__filter-row">
        <input
          ref={filterRef}
          type="text"
          className="chat-history-pane__filter"
          placeholder="Filter..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {/* List */}
      <div className="chat-history-pane__list">
        {history.loading && (
          <div className="chat-history-pane__empty">Loading...</div>
        )}
        {!history.loading && filtered.length === 0 && (
          <div className="chat-history-pane__empty">
            {filter ? 'No matches' : 'No conversations yet'}
          </div>
        )}

        {filtered.map((meta) => (
          <div
            key={meta.id}
            className="chat-history-pane__item"
            onClick={() => handleClick(meta)}
            onContextMenu={(e) => handleContextMenu(e, meta)}
          >
            <div className="chat-history-pane__item-row1">
              {renaming === meta.id ? (
                <input
                  className="chat-history-pane__rename-input"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={handleRenameSubmit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRenameSubmit()
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="chat-history-pane__item-title">{meta.title}</span>
              )}
              <span className="chat-history-pane__item-time">
                {formatRelativeTime(meta.updatedAt)}
              </span>
            </div>
            <div className="chat-history-pane__item-row2">
              {meta.worktreeBranch && (
                <span className="chat-history-pane__item-branch">{meta.worktreeBranch}</span>
              )}
              {isCliBackend(meta.backend) && (
                <span className="chat-history-pane__item-badge chat-history-pane__item-badge--cli">CLI</span>
              )}
              <span className={`chat-history-pane__item-badge chat-history-pane__item-badge--${meta.backend}`}>
                {backendLabel(meta.backend)}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="chat-history-pane__context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="chat-history-pane__context-item"
            onClick={() => handleRenameStart(contextMenu.meta)}
          >
            Rename
          </button>
          <div className="chat-history-pane__context-separator" />
          <button
            className="chat-history-pane__context-item chat-history-pane__context-item--danger"
            onClick={() => handleDelete(contextMenu.meta)}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isCliBackend(backend: AgentBackend): boolean {
  return backend === 'claude-code' || backend === 'codex'
}

function backendLabel(backend: AgentBackend): string {
  switch (backend) {
    case 'built-in': return 'built-in'
    case 'claude-code': return 'claude'
    case 'codex': return 'codex'
    default: return backend
  }
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d`
  const months = Math.floor(days / 30)
  return `${months}mo`
}
