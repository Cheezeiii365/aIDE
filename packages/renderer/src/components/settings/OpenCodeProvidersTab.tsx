import { useEffect, useState } from 'react'
import type { CliAgentSession, OpenCodeAuthMethod, OpenCodeProviderSummary } from '@aide/shared'

/**
 * Settings tab listing OpenCode providers and exposing per-provider sign-in
 * (OAuth via system browser, or API key via input). Hooks straight into the
 * cliAgentProvider* IPC methods on the active workspace's session.
 *
 * v1 OAuth flow: opens the authorize URL in the system browser, then asks
 * the user to paste the callback code. (Custom protocol handler is a
 * follow-up.)
 */
export function OpenCodeProvidersTab({ workspaceId }: { workspaceId: string | null }) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [providers, setProviders] = useState<OpenCodeProviderSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    void (async () => {
      const s = (await window.api.cliAgentGetSession(workspaceId)) as CliAgentSession | null
      if (!cancelled) setSessionId(s?.backend === 'opencode' ? s.id : null)
    })()
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const result = (await window.api.cliAgentListProviders(sessionId)) as
          | OpenCodeProviderSummary[]
          | { error: string }
        if (cancelled) return
        if (Array.isArray(result)) setProviders(result)
        else if ('error' in result) setError(result.error)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId])

  if (!sessionId) {
    return (
      <div style={{ padding: 12, fontSize: 12, opacity: 0.6 }}>
        Open an OpenCode chat in this workspace to manage providers.
      </div>
    )
  }

  return (
    <div style={{ padding: 12, fontSize: 12 }}>
      <h3 style={{ marginTop: 0 }}>OpenCode providers</h3>
      {error && <div style={{ color: 'tomato' }}>{error}</div>}
      {loading && <div style={{ opacity: 0.6 }}>Loading providers…</div>}
      {providers.map((p) => (
        <ProviderCard key={p.id} sessionId={sessionId} provider={p} />
      ))}
    </div>
  )
}

function ProviderCard({
  sessionId,
  provider,
}: {
  sessionId: string
  provider: OpenCodeProviderSummary
}) {
  const [authMethods, setAuthMethods] = useState<OpenCodeAuthMethod[] | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [oauthCode, setOauthCode] = useState('')
  const [authStatus, setAuthStatus] = useState<string | null>(null)

  const loadAuth = async () => {
    const result = await window.api.cliAgentProviderAuth(sessionId, provider.id)
    if (Array.isArray(result.methods)) setAuthMethods(result.methods as OpenCodeAuthMethod[])
  }

  return (
    <div
      style={{
        padding: 8,
        marginBottom: 8,
        border: '1px solid var(--color-border, rgba(255,255,255,0.1))',
        borderRadius: 4,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>{provider.name}</strong>
        <button onClick={() => void loadAuth()} style={{ fontSize: 11 }}>
          Auth methods
        </button>
      </div>
      <div style={{ opacity: 0.7, fontSize: 11 }}>{provider.id}</div>
      <details style={{ marginTop: 4 }}>
        <summary style={{ cursor: 'pointer' }}>Models ({provider.models.length})</summary>
        <ul style={{ margin: '4px 0 0 0', paddingLeft: 16, fontSize: 11 }}>
          {provider.models.map((m) => (
            <li key={m.id}>
              {m.name}
              {m.cost ? (
                <span style={{ marginLeft: 6, opacity: 0.5 }}>
                  ${m.cost.input}/M in · ${m.cost.output}/M out
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </details>
      {authMethods && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {authMethods.map((m) => (
            <div key={m.id}>
              <span style={{ opacity: 0.7 }}>{m.label ?? m.id}</span> ·{' '}
              <em style={{ opacity: 0.5 }}>{m.type}</em>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="API key…"
              style={{ flex: 1, fontSize: 11 }}
            />
            <button
              onClick={async () => {
                const result = await window.api.cliAgentAuthSet(sessionId, provider.id, apiKey)
                setAuthStatus(result.error ?? 'Saved')
                setApiKey('')
              }}
            >
              Save
            </button>
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button
              onClick={async () => {
                const result = await window.api.cliAgentProviderOauthAuthorize(sessionId, provider.id)
                if (result.error) {
                  setAuthStatus(result.error)
                } else if (result.url) {
                  setAuthStatus(`Opened ${result.url} — paste the callback code below`)
                  // Best-effort: open in default browser via the IDE's existing platform integration
                  // (the renderer doesn't have shell.openExternal, so we provide the URL inline)
                  try {
                    window.open(result.url, '_blank', 'noopener')
                  } catch {
                    /* ignore */
                  }
                }
              }}
            >
              Sign in (OAuth)
            </button>
            <input
              value={oauthCode}
              onChange={(e) => setOauthCode(e.target.value)}
              placeholder="callback code…"
              style={{ flex: 1, fontSize: 11 }}
            />
            <button
              onClick={async () => {
                const result = await window.api.cliAgentProviderOauthCallback(sessionId, oauthCode)
                setAuthStatus(result.error ?? 'OAuth complete')
                setOauthCode('')
              }}
            >
              Complete
            </button>
          </div>
          {authStatus && (
            <div
              style={{
                fontSize: 11,
                opacity: 0.7,
                color: authStatus.toLowerCase().includes('error') ? 'tomato' : undefined,
              }}
            >
              {authStatus}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
