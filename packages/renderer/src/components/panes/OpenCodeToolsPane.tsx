import { useState, useEffect } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import type {
  CliAgentSession,
  OpenCodeFileEntry,
  OpenCodeFindResult,
  OpenCodePathInfo,
  OpenCodeServerInfo,
  OpenCodeShellResult,
  OpenCodeSymbolResult,
} from '@aide/shared'
import { OpenCodeProvidersTab } from '../settings/OpenCodeProvidersTab'
import '../../styles/cli-agent-settings.css'

interface OpenCodeToolsPaneParams {
  workspaceId?: string
  /** Optional session id to bind to. If absent, uses the workspace's active session. */
  sessionId?: string
}

type Tab = 'files' | 'search' | 'shell' | 'status' | 'providers'

const TABS: Tab[] = ['files', 'search', 'shell', 'status', 'providers']

/**
 * Dockview pane exposing OpenCode's file/find/shell/lsp endpoints as
 * opt-in commands. The Status tab also hosts diagnostics + TUI controls
 * + the Initialize AGENTS.md command, which used to live as cluttered
 * disclosures inside the chat pane itself.
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
      <div className="oc-tools-pane">
        <div className="oc-tools-pane__empty">
          open an opencode chat in this workspace to use opencode tools
        </div>
      </div>
    )
  }

  return (
    <div className="oc-tools-pane">
      <nav className="oc-tools-pane__tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`oc-tools-pane__tab${tab === t ? ' is-active' : ''}`}
          >
            {t}
          </button>
        ))}
      </nav>
      <div className="oc-tools-pane__body">
        {tab === 'files' && <FilesTab sessionId={sessionId} />}
        {tab === 'search' && <SearchTab sessionId={sessionId} />}
        {tab === 'shell' && <ShellTab sessionId={sessionId} />}
        {tab === 'status' && (
          <StatusTab sessionId={sessionId} workspaceId={workspaceId ?? null} />
        )}
        {tab === 'providers' && <OpenCodeProvidersTab workspaceId={workspaceId ?? null} />}
      </div>
    </div>
  )
}

// ─── Files ─────────────────────────────────────────────────────────

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  return (
    <div className="oc-status">
      <div className="oc-status__inline">
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="path…"
        />
        <button className="oc-status__btn" onClick={() => void list(path)}>
          List
        </button>
      </div>
      {error && <div className="oc-error">{error}</div>}
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
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
            style={{ cursor: 'pointer', padding: '2px 0', color: e.isDirectory ? 'var(--accent)' : 'var(--text-primary)' }}
          >
            {e.isDirectory ? '▸ ' : '  '}{e.name}
          </li>
        ))}
      </ul>
      {content !== null && <pre className="oc-status__pre">{content}</pre>}
    </div>
  )
}

// ─── Search ────────────────────────────────────────────────────────

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
    <div className="oc-status">
      <div className="oc-status__inline">
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as 'text')}
          style={{ padding: '3px 6px', background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 2, fontFamily: 'var(--font-mono)', fontSize: 10 }}
        >
          <option value="text">text</option>
          <option value="files">files</option>
          <option value="symbols">symbols</option>
        </select>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run()
          }}
          placeholder="query…"
        />
        <button className="oc-status__btn" onClick={() => void run()}>
          Find
        </button>
      </div>
      {error && <div className="oc-error">{error}</div>}
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {results.map((r, i) => (
          <li key={i} style={{ padding: '2px 0' }}>
            <pre className="oc-status__pre">{JSON.stringify(r, null, 0)}</pre>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ─── Shell ─────────────────────────────────────────────────────────

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
    <div className="oc-status">
      <div className="oc-status__inline">
        <input
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run()
          }}
          placeholder="shell command…"
        />
        <button className="oc-status__btn" disabled={busy} onClick={() => void run()}>
          Run
        </button>
      </div>
      {error && <div className="oc-error">{error}</div>}
      {output && (
        <pre className="oc-status__pre" style={{ maxHeight: 240 }}>
          [exit {output.exitCode}]{'\n'}
          {output.stdout}
          {output.stderr ? `\n--- stderr ---\n${output.stderr}` : ''}
        </pre>
      )}
    </div>
  )
}

// ─── Status (formerly the cluttered DiagnosticsPanel + TuiControlPanel) ───

function StatusTab({
  sessionId,
  workspaceId,
}: {
  sessionId: string
  workspaceId: string | null
}) {
  const [server, setServer] = useState<OpenCodeServerInfo | null>(null)
  const [paths, setPaths] = useState<OpenCodePathInfo | null>(null)
  const [lsp, setLsp] = useState<unknown>(null)
  const [formatter, setFormatter] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        if (workspaceId) {
          const s = (await window.api.cliAgentServerInfo(workspaceId)) as OpenCodeServerInfo | null
          if (!cancelled) setServer(s)
        }
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
  }, [sessionId, workspaceId])

  const flash = (text: string) => {
    setToast(text)
    window.setTimeout(() => setToast(null), 2400)
  }

  const onInitAgents = async () => {
    const result = await window.api.cliAgentSessionInit(sessionId)
    if (result.error) flash(`error: ${result.error}`)
    else flash('AGENTS.md initialization started')
  }

  return (
    <div className="oc-status">
      {error && <div className="oc-error">{error}</div>}
      {toast && (
        <div
          style={{
            padding: '4px 8px',
            background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
            border: '1px solid var(--accent)',
            borderRadius: 2,
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            color: 'var(--text-primary)',
            letterSpacing: '0.04em',
          }}
        >
          {toast}
        </div>
      )}

      {/* SERVER */}
      <section className="oc-status__section">
        <h3 className="oc-status__heading">Server</h3>
        {server ? (
          <dl className="oc-status__row">
            <dt>url</dt>
            <dd>{server.url}</dd>
            <dt>mode</dt>
            <dd>{server.mode}</dd>
            <dt>pid</dt>
            <dd>{server.pid ?? '—'}</dd>
            <dt>started</dt>
            <dd>{new Date(server.startedAt).toLocaleTimeString()}</dd>
          </dl>
        ) : (
          <div className="oc-empty">no server info</div>
        )}
      </section>

      {/* PATHS */}
      {paths && (
        <section className="oc-status__section">
          <h3 className="oc-status__heading">Paths</h3>
          <dl className="oc-status__row">
            {paths.config && (
              <>
                <dt>config</dt>
                <dd>{paths.config}</dd>
              </>
            )}
            {paths.data && (
              <>
                <dt>data</dt>
                <dd>{paths.data}</dd>
              </>
            )}
            {paths.cache && (
              <>
                <dt>cache</dt>
                <dd>{paths.cache}</dd>
              </>
            )}
            {paths.log && (
              <>
                <dt>log</dt>
                <dd>{paths.log}</dd>
              </>
            )}
          </dl>
        </section>
      )}

      {/* LSP / FORMATTER */}
      <section className="oc-status__section">
        <h3 className="oc-status__heading">LSP</h3>
        <pre className="oc-status__pre">{JSON.stringify(lsp, null, 2)}</pre>
      </section>
      <section className="oc-status__section">
        <h3 className="oc-status__heading">Formatter</h3>
        <pre className="oc-status__pre">{JSON.stringify(formatter, null, 2)}</pre>
      </section>

      {/* COMMANDS — pulled in from the old SessionMenu */}
      <section className="oc-status__section">
        <h3 className="oc-status__heading">Commands</h3>
        <button className="oc-status__btn" onClick={() => void onInitAgents()}>
          Initialize AGENTS.md
        </button>
        <button
          className="oc-status__btn"
          onClick={() =>
            void window.api
              .cliAgentLogWrite(sessionId, 'log from aIDE diagnostics', 'INFO')
              .then(() => flash('log line written'))
          }
        >
          Write test log
        </button>
      </section>

      {/* ADVANCED — opt-in TUI controls (mostly useful for power users
          driving an external opencode TUI alongside aIDE) */}
      <details className="oc-status__advanced">
        <summary>Advanced · TUI controls</summary>
        <div className="oc-status__advanced-body">
          <TuiButtons sessionId={sessionId} flash={flash} />
        </div>
      </details>
    </div>
  )
}

function TuiButtons({
  sessionId,
  flash,
}: {
  sessionId: string
  flash: (text: string) => void
}) {
  const [appendText, setAppendText] = useState('')
  const [execCmd, setExecCmd] = useState('')

  const call = async (label: string, fn: () => Promise<{ error?: string }>) => {
    const r = await fn()
    if (r.error) flash(`${label}: ${r.error}`)
    else flash(`${label} ok`)
  }

  return (
    <>
      <div className="oc-status__btnrow">
        <button className="oc-status__btn" onClick={() => void call('help', () => window.api.cliAgentTuiOpenHelp(sessionId))}>
          Help
        </button>
        <button className="oc-status__btn" onClick={() => void call('sessions', () => window.api.cliAgentTuiOpenSessions(sessionId))}>
          Sessions
        </button>
        <button className="oc-status__btn" onClick={() => void call('themes', () => window.api.cliAgentTuiOpenThemes(sessionId))}>
          Themes
        </button>
        <button className="oc-status__btn" onClick={() => void call('models', () => window.api.cliAgentTuiOpenModels(sessionId))}>
          Models
        </button>
        <button className="oc-status__btn" onClick={() => void call('submit', () => window.api.cliAgentTuiSubmitPrompt(sessionId))}>
          Submit
        </button>
        <button className="oc-status__btn" onClick={() => void call('clear', () => window.api.cliAgentTuiClearPrompt(sessionId))}>
          Clear
        </button>
      </div>
      <div className="oc-status__inline">
        <input
          value={appendText}
          onChange={(e) => setAppendText(e.target.value)}
          placeholder="text to append…"
        />
        <button
          className="oc-status__btn"
          onClick={() => {
            void call('append', () => window.api.cliAgentTuiAppendPrompt(sessionId, appendText))
            setAppendText('')
          }}
        >
          Append
        </button>
      </div>
      <div className="oc-status__inline">
        <input
          value={execCmd}
          onChange={(e) => setExecCmd(e.target.value)}
          placeholder="tui command…"
        />
        <button
          className="oc-status__btn"
          onClick={() => {
            void call('execute', () => window.api.cliAgentTuiExecuteCommand(sessionId, execCmd))
            setExecCmd('')
          }}
        >
          Execute
        </button>
      </div>
    </>
  )
}
