import { useState, useEffect } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import type {
  CliAgentSession,
  OpenCodeFileEntry,
  OpenCodeFindResult,
  OpenCodeShellResult,
  OpenCodeSymbolResult,
} from '@aide/shared'
import { OpenCodeProvidersTab } from '../settings/OpenCodeProvidersTab'

interface OpenCodeToolsPaneParams {
  workspaceId?: string
  /** Optional session id to bind to. If absent, uses the workspace's active session. */
  sessionId?: string
}

type Tab = 'files' | 'search' | 'shell' | 'status' | 'providers'

/**
 * Dockview pane exposing OpenCode's file/find/shell/lsp endpoints as
 * opt-in commands. Only useful when an OpenCode session is active in the
 * workspace; otherwise shows an empty state.
 */
export function OpenCodeToolsPane({ params }: IDockviewPanelProps<OpenCodeToolsPaneParams>) {
  const { workspaceId, sessionId: paramSessionId } = params ?? {}
  const [tab, setTab] = useState<Tab>('files')
  const [sessionId, setSessionId] = useState<string | null>(paramSessionId ?? null)

  // Resolve the active OpenCode session for this workspace if not given.
  useEffect(() => {
    if (paramSessionId || !workspaceId) return
    let cancelled = false
    void (async () => {
      const s = (await window.api.cliAgentGetSession(workspaceId)) as CliAgentSession | null
      if (!cancelled && s && s.backend === 'opencode') setSessionId(s.id)
    })()
    return () => {
      cancelled = true
    }
  }, [workspaceId, paramSessionId])

  if (!sessionId) {
    return (
      <div style={{ padding: 12, fontSize: 12, opacity: 0.6 }}>
        Open an OpenCode chat in this workspace to use OpenCode tools.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontSize: 12 }}>
      <div
        style={{
          display: 'flex',
          gap: 4,
          padding: 4,
          borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.1))',
        }}
      >
        {(['files', 'search', 'shell', 'status', 'providers'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '2px 8px',
              background:
                tab === t
                  ? 'var(--color-accent-bg, rgba(120,180,255,0.2))'
                  : 'transparent',
              border: 'none',
              color: 'inherit',
              borderRadius: 3,
              cursor: 'pointer',
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
        {tab === 'files' && <FilesTab sessionId={sessionId} />}
        {tab === 'search' && <SearchTab sessionId={sessionId} />}
        {tab === 'shell' && <ShellTab sessionId={sessionId} />}
        {tab === 'status' && <StatusTab sessionId={sessionId} />}
        {tab === 'providers' && <OpenCodeProvidersTab workspaceId={workspaceId ?? null} />}
      </div>
    </div>
  )
}

function FilesTab({ sessionId }: { sessionId: string }) {
  const [path, setPath] = useState('.')
  const [entries, setEntries] = useState<OpenCodeFileEntry[]>([])
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const list = async (p: string) => {
    setError(null)
    const result = await window.api.cliAgentFileList(sessionId, p)
    if (result.error) setError(result.error)
    else setEntries((result.entries as OpenCodeFileEntry[]) ?? [])
  }

  useEffect(() => {
    void list('.')
  }, [sessionId])

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          style={{ flex: 1, fontSize: 11 }}
          placeholder="path…"
        />
        <button onClick={() => void list(path)}>List</button>
      </div>
      {error && <div style={{ color: 'tomato' }}>{error}</div>}
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {entries.map((e) => (
          <li
            key={e.path}
            onClick={() => {
              if (e.isDirectory) {
                setPath(e.path)
                void list(e.path)
              } else {
                void (async () => {
                  const result = await window.api.cliAgentFileRead(sessionId, e.path)
                  setContent(result.content ?? result.error ?? '')
                })()
              }
            }}
            style={{ cursor: 'pointer', padding: '1px 0' }}
          >
            {e.isDirectory ? '📁' : '📄'} {e.name}
          </li>
        ))}
      </ul>
      {content !== null && (
        <pre
          style={{
            marginTop: 8,
            padding: 6,
            maxHeight: 200,
            overflow: 'auto',
            background: 'var(--color-surface-1, rgba(0,0,0,0.2))',
            fontSize: 10,
          }}
        >
          {content}
        </pre>
      )}
    </div>
  )
}

function SearchTab({ sessionId }: { sessionId: string }) {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<'text' | 'files' | 'symbols'>('text')
  const [results, setResults] = useState<unknown[]>([])
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    if (!query.trim()) return
    setError(null)
    const fn =
      mode === 'text'
        ? () => window.api.cliAgentFindText(sessionId, query)
        : mode === 'files'
          ? () => window.api.cliAgentFindFiles(sessionId, query)
          : () => window.api.cliAgentFindSymbols(sessionId, query)
    const result = (await fn()) as { error?: string; results?: unknown[]; paths?: string[]; symbols?: unknown[] }
    if (result.error) setError(result.error)
    else if (mode === 'text') setResults((result.results as OpenCodeFindResult[]) ?? [])
    else if (mode === 'files') setResults(((result.paths as string[]) ?? []).map((p) => ({ path: p })))
    else setResults((result.symbols as OpenCodeSymbolResult[]) ?? [])
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        <select value={mode} onChange={(e) => setMode(e.target.value as 'text')}>
          <option value="text">Text</option>
          <option value="files">Files</option>
          <option value="symbols">Symbols</option>
        </select>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run()
          }}
          placeholder="query…"
          style={{ flex: 1, fontSize: 11 }}
        />
        <button onClick={() => void run()}>Find</button>
      </div>
      {error && <div style={{ color: 'tomato' }}>{error}</div>}
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 11 }}>
        {results.map((r, i) => (
          <li key={i} style={{ padding: '2px 0' }}>
            <pre style={{ margin: 0, fontSize: 10 }}>{JSON.stringify(r, null, 0)}</pre>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ShellTab({ sessionId }: { sessionId: string }) {
  const [cmd, setCmd] = useState('')
  const [output, setOutput] = useState<OpenCodeShellResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async () => {
    if (!cmd.trim()) return
    setBusy(true)
    setError(null)
    const result = await window.api.cliAgentShellRun(sessionId, cmd)
    if (result.error) setError(result.error)
    else setOutput(result.result as OpenCodeShellResult)
    setBusy(false)
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        <input
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run()
          }}
          placeholder="shell command…"
          style={{ flex: 1, fontSize: 11, fontFamily: 'monospace' }}
        />
        <button onClick={() => void run()} disabled={busy}>
          Run
        </button>
      </div>
      {error && <div style={{ color: 'tomato' }}>{error}</div>}
      {output && (
        <pre
          style={{
            margin: 0,
            padding: 6,
            background: 'var(--color-surface-1, rgba(0,0,0,0.2))',
            fontSize: 10,
            maxHeight: 240,
            overflow: 'auto',
          }}
        >
          [exit {output.exitCode}]{'\n'}
          {output.stdout}
          {output.stderr ? `\n--- stderr ---\n${output.stderr}` : ''}
        </pre>
      )}
    </div>
  )
}

function StatusTab({ sessionId }: { sessionId: string }) {
  const [lsp, setLsp] = useState<unknown>(null)
  const [formatter, setFormatter] = useState<unknown>(null)

  useEffect(() => {
    void (async () => {
      const l = await window.api.cliAgentLspStatus(sessionId)
      setLsp(l.status)
      const f = await window.api.cliAgentFormatterStatus(sessionId)
      setFormatter(f.status)
    })()
  }, [sessionId])

  return (
    <div>
      <h4 style={{ margin: '4px 0' }}>LSP</h4>
      <pre style={{ fontSize: 10, maxHeight: 120, overflow: 'auto' }}>
        {JSON.stringify(lsp, null, 2)}
      </pre>
      <h4 style={{ margin: '4px 0' }}>Formatter</h4>
      <pre style={{ fontSize: 10, maxHeight: 120, overflow: 'auto' }}>
        {JSON.stringify(formatter, null, 2)}
      </pre>
    </div>
  )
}
