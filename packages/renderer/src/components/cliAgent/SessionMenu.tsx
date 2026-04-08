import { useState } from 'react'

/**
 * Kebab menu in the CliAgentPane header for OpenCode session ops:
 * share, summarize, revert, unrevert, abort, fork, view diff, todos,
 * initialize project, delete remote.
 *
 * Each action calls the corresponding window.api.cliAgentSession* IPC
 * and surfaces success / error in a small toast.
 */
export function SessionMenu({
  sessionId,
  disabled,
  onMessage,
}: {
  sessionId: string | null
  disabled?: boolean
  onMessage: (text: string, variant?: 'success' | 'error') => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const wrap = async (fn: () => Promise<{ error?: string } | { url?: string } | { newSessionId?: string }>) => {
    if (!sessionId) return
    setBusy(true)
    setOpen(false)
    try {
      const result = await fn()
      if ('error' in result && result.error) {
        onMessage(result.error, 'error')
      } else if ('url' in result && result.url) {
        try {
          await navigator.clipboard.writeText(result.url)
          onMessage(`Shared · URL copied to clipboard`, 'success')
        } catch {
          onMessage(`Shared · ${result.url}`, 'success')
        }
      } else if ('newSessionId' in result && result.newSessionId) {
        onMessage(`Forked → ${result.newSessionId.slice(0, 8)}`, 'success')
      } else {
        onMessage('Done', 'success')
      }
    } catch (e) {
      onMessage(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!sessionId) return null

  return (
    <div className="cli-agent-session-menu" style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={disabled || busy}
        title="Session actions"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          cursor: 'pointer',
          padding: '2px 6px',
          fontSize: 14,
        }}
      >
        ⋮
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: '100%',
            zIndex: 10,
            background: 'var(--color-surface-1, #1e1e1e)',
            border: '1px solid var(--color-border, rgba(255,255,255,0.15))',
            borderRadius: 4,
            padding: 4,
            minWidth: 160,
            display: 'flex',
            flexDirection: 'column',
            fontSize: 12,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          }}
        >
          <MenuItem onClick={() => wrap(() => window.api.cliAgentSessionShare(sessionId))}>
            Share session
          </MenuItem>
          <MenuItem onClick={() => wrap(() => window.api.cliAgentSessionUnshare(sessionId))}>
            Unshare
          </MenuItem>
          <MenuItem onClick={() => wrap(() => window.api.cliAgentSessionSummarize(sessionId))}>
            Summarize
          </MenuItem>
          <MenuItem onClick={() => wrap(() => window.api.cliAgentSessionUnrevert(sessionId))}>
            Unrevert
          </MenuItem>
          <MenuItem onClick={() => wrap(() => window.api.cliAgentSessionAbort(sessionId))}>
            Abort
          </MenuItem>
          <MenuItem onClick={() => wrap(() => window.api.cliAgentSessionInit(sessionId))}>
            Initialize AGENTS.md
          </MenuItem>
          <MenuItem
            onClick={() => wrap(() => window.api.cliAgentSessionDeleteRemote(sessionId))}
            danger
          >
            Delete remote session
          </MenuItem>
        </div>
      )}
    </div>
  )
}

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block',
        textAlign: 'left',
        background: 'transparent',
        border: 'none',
        color: danger ? 'tomato' : 'inherit',
        padding: '4px 8px',
        cursor: 'pointer',
        borderRadius: 3,
        fontSize: 12,
      }}
      onMouseEnter={(e) =>
        ((e.target as HTMLButtonElement).style.background = 'var(--color-surface-2, rgba(255,255,255,0.06))')
      }
      onMouseLeave={(e) => ((e.target as HTMLButtonElement).style.background = 'transparent')}
    >
      {children}
    </button>
  )
}
