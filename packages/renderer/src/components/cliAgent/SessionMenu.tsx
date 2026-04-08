import { useEffect, useRef, useState } from 'react'

/**
 * Trimmed kebab menu in the CliAgentPane header for OpenCode session ops.
 *
 * Surfaces only the three actions a user is likely to reach for from inside
 * the chat itself: Share, Summarize, and Delete (remote). Less-common ops
 * (init AGENTS.md, abort, fork, revert) live in the OpenCodeToolsPane or
 * are exposed contextually elsewhere — see frontend redesign 2026-04-08.
 *
 * Each action calls the corresponding `window.api.cliAgentSession*` IPC
 * and surfaces success / error in a small toast (handled by parent).
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
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Dismiss on outside click + Escape, matching the popover behaviour.
  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (menuRef.current?.contains(t)) return
      if (triggerRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const wrap = async (
    fn: () => Promise<{ error?: string } | { url?: string }>,
  ) => {
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
          onMessage('Shared · URL copied to clipboard', 'success')
        } catch {
          onMessage(`Shared · ${result.url}`, 'success')
        }
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
    <div className="oc-kebab">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled || busy}
        title="Session actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className="oc-kebab__trigger"
      >
        ⋯
      </button>
      {open && (
        <div ref={menuRef} role="menu" className="oc-kebab__menu">
          <button
            role="menuitem"
            className="oc-kebab__item"
            onClick={() => wrap(() => window.api.cliAgentSessionShare(sessionId))}
          >
            Share session
          </button>
          <button
            role="menuitem"
            className="oc-kebab__item"
            onClick={() => wrap(() => window.api.cliAgentSessionSummarize(sessionId))}
          >
            Summarize
          </button>
          <div className="oc-kebab__sep" />
          <button
            role="menuitem"
            className="oc-kebab__item oc-kebab__item--danger"
            onClick={() => wrap(() => window.api.cliAgentSessionDeleteRemote(sessionId))}
          >
            Delete remote
          </button>
        </div>
      )}
    </div>
  )
}
