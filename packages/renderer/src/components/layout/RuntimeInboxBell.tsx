import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PendingToolApprovalInfo, WorkspaceEntry } from '@aide/shared'
import {
  getApprovalInboxSnapshot,
  subscribeApprovalInbox,
  approvalInboxRemove,
} from '../../lib/workspace/approvalInboxStore'
import {
  getRuntimeActivitySnapshot,
  subscribeRuntimeActivity,
} from '../../lib/workspace/runtimeActivityStore'
import { showToast } from '../shared/Toast'

interface Props {
  workspaces: WorkspaceEntry[]
  onSwitchWorkspace: (id: string) => void
}

export function RuntimeInboxBell({
  workspaces,
  onSwitchWorkspace,
}: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const approvals = useSyncExternalStore(
    subscribeApprovalInbox,
    getApprovalInboxSnapshot,
    getApprovalInboxSnapshot,
  )
  const activity = useSyncExternalStore(
    subscribeRuntimeActivity,
    getRuntimeActivitySnapshot,
    getRuntimeActivitySnapshot,
  )

  const labelFor = useCallback(
    (workspaceId: string) => workspaces.find((w) => w.id === workspaceId)?.name ?? workspaceId,
    [workspaces],
  )

  useEffect(() => {
    const onOpen = (ev: Event) => {
      setOpen(true)
      const detail = (ev as CustomEvent<{ focusApprovalKey?: string }>).detail
      if (detail?.focusApprovalKey && rootRef.current) {
        const id = detail.focusApprovalKey
        requestAnimationFrame(() => {
          const el = rootRef.current?.querySelector(`[data-approval-id="${id}"]`)
          el?.scrollIntoView({ block: 'nearest' })
        })
      }
    }
    window.addEventListener('aide:open-runtime-inbox', onOpen as EventListener)
    return () => window.removeEventListener('aide:open-runtime-inbox', onOpen as EventListener)
  }, [])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const el = rootRef.current
      if (el && !el.contains(e.target as Node)) setOpen(false)
    }
    const t = setTimeout(() => document.addEventListener('mousedown', onDoc), 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', onDoc)
    }
  }, [open])

  const count = approvals.length

  const approve = async (row: PendingToolApprovalInfo) => {
    try {
      await window.api.chatToolApprove(row.sessionId, row.toolCall.id)
      approvalInboxRemove(row.workspaceId, row.sessionId, row.toolCall.id)
    } catch {
      showToast('Failed to approve tool call')
    }
  }

  const reject = async (row: PendingToolApprovalInfo) => {
    try {
      await window.api.chatToolReject(row.sessionId, row.toolCall.id)
      approvalInboxRemove(row.workspaceId, row.sessionId, row.toolCall.id)
    } catch {
      showToast('Failed to reject tool call')
    }
  }

  return (
    <div className="runtime-inbox" ref={rootRef}>
      <button
        type="button"
        className="ribbon-icon-btn runtime-inbox__bell"
        title={count ? `${count} pending tool approval(s)` : 'Runtime inbox (approvals & activity)'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <InboxIcon />
        {count > 0 && <span className="runtime-inbox__badge">{count > 9 ? '9+' : count}</span>}
      </button>
      {open && (
        <div className="runtime-inbox__panel">
          <div className="runtime-inbox__section">
            <div className="runtime-inbox__section-title">Pending tool approvals</div>
            {approvals.length === 0 && (
              <div className="runtime-inbox__empty">None</div>
            )}
            {approvals.map((row) => {
              const k = `${row.workspaceId}:${row.sessionId}:${row.toolCall.id}`
              return (
                <div key={k} className="runtime-inbox__approval" data-approval-id={k}>
                  <div className="runtime-inbox__approval-meta">
                    <span className="runtime-inbox__ws">{labelFor(row.workspaceId)}</span>
                    <span className="runtime-inbox__tool">{row.toolCall.name}</span>
                  </div>
                  <pre className="runtime-inbox__args">{truncateJson(row.toolCall.input)}</pre>
                  <div className="runtime-inbox__row-actions">
                    <button
                      type="button"
                      className="runtime-inbox__btn runtime-inbox__btn--approve"
                      onClick={() => void approve(row)}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="runtime-inbox__btn"
                      onClick={() => void reject(row)}
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      className="runtime-inbox__btn runtime-inbox__btn--ghost"
                      onClick={() => {
                        onSwitchWorkspace(row.workspaceId)
                        setOpen(false)
                      }}
                    >
                      Workspace
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="runtime-inbox__section">
            <div className="runtime-inbox__section-title">Recent activity</div>
            {activity.length === 0 && (
              <div className="runtime-inbox__empty">No events yet</div>
            )}
            {activity.slice(0, 15).map((item) => (
              <div key={item.id} className="runtime-inbox__activity-row">
                <span className="runtime-inbox__activity-ws">{labelFor(item.workspaceId)}</span>
                <span className="runtime-inbox__activity-kind">{item.kind}</span>
                <span className="runtime-inbox__activity-text">{item.summary}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function truncateJson(input: Record<string, unknown>): string {
  try {
    const s = JSON.stringify(input, null, 0)
    return s.length > 200 ? `${s.slice(0, 200)}…` : s
  } catch {
    return String(input)
  }
}

function InboxIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M4 10h2l1-4h10l1 4h2v10H4V10z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 14h6M9 18h6" strokeLinecap="round" />
    </svg>
  )
}
