import { useEffect, useState } from 'react'
import type { OpenCodePathInfo, OpenCodeServerInfo } from '@aide/shared'

/**
 * Read-only diagnostics for an active OpenCode session: server info,
 * resolved paths, LSP/formatter status. Hidden behind a disclosure to
 * keep the pane header tidy.
 */
export function DiagnosticsPanel({
  workspaceId,
  sessionId,
}: {
  workspaceId: string | null
  sessionId: string | null
}) {
  const [open, setOpen] = useState(false)
  const [server, setServer] = useState<OpenCodeServerInfo | null>(null)
  const [paths, setPaths] = useState<OpenCodePathInfo | null>(null)
  const [lsp, setLsp] = useState<unknown>(null)
  const [formatter, setFormatter] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !sessionId || !workspaceId) return
    let cancelled = false
    void (async () => {
      try {
        const s = (await window.api.cliAgentServerInfo(workspaceId)) as OpenCodeServerInfo | null
        if (!cancelled) setServer(s)
        const p = await window.api.cliAgentPathGet(sessionId)
        if (!cancelled && !p.error) setPaths((p.paths as OpenCodePathInfo) ?? null)
        const l = await window.api.cliAgentLspStatus(sessionId)
        if (!cancelled) setLsp(l.status)
        const f = await window.api.cliAgentFormatterStatus(sessionId)
        if (!cancelled) setFormatter(f.status)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, sessionId, workspaceId])

  if (!sessionId) return null

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      style={{
        margin: '6px 0',
        padding: '6px 8px',
        background: 'var(--color-surface-2, rgba(255,255,255,0.04))',
        borderRadius: 4,
        fontSize: 11,
      }}
    >
      <summary style={{ cursor: 'pointer', userSelect: 'none' }}>Diagnostics</summary>
      {open && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {error && <div style={{ color: 'tomato' }}>{error}</div>}
          {server && (
            <Field label="Server">
              {server.url} <em>({server.mode})</em> pid={server.pid}
            </Field>
          )}
          {paths?.config && <Field label="Config">{paths.config}</Field>}
          {paths?.data && <Field label="Data">{paths.data}</Field>}
          {paths?.cache && <Field label="Cache">{paths.cache}</Field>}
          {paths?.log && <Field label="Log">{paths.log}</Field>}
          {lsp != null && (
            <Field label="LSP">
              <code style={{ fontSize: 10 }}>{JSON.stringify(lsp).slice(0, 200)}</code>
            </Field>
          )}
          {formatter != null && (
            <Field label="Formatter">
              <code style={{ fontSize: 10 }}>{JSON.stringify(formatter).slice(0, 200)}</code>
            </Field>
          )}
          <button
            onClick={() => void window.api.cliAgentLogWrite(sessionId, 'log from aIDE diagnostics', 'INFO')}
            style={{
              alignSelf: 'flex-start',
              fontSize: 10,
              padding: '2px 6px',
              marginTop: 4,
            }}
          >
            Write test log
          </button>
        </div>
      )}
    </details>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <strong style={{ opacity: 0.6, marginRight: 4 }}>{label}:</strong>
      {children}
    </div>
  )
}
