import { useEffect, useState } from 'react'
import type {
  CliAgentBackendState,
  OpenCodeAgentSummary,
  OpenCodeProviderSummary,
  OpenCodeToolSummary,
} from '@aide/shared'

/**
 * Collapsible per-session settings panel for OpenCode sessions.
 * Wraps provider/model picker, agent picker, mode picker, system prompt
 * editor, and tool toggle list. Each sub-component lazily fetches its
 * options the first time the panel is opened.
 */
export function SessionSettingsPanel({
  sessionId,
  backendState,
  onPatch,
}: {
  sessionId: string | null
  backendState: CliAgentBackendState
  onPatch: (patch: Partial<CliAgentBackendState>) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  if (!sessionId) return null

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="cli-agent-session-settings"
      style={{
        margin: '6px 0',
        padding: '6px 8px',
        background: 'var(--color-surface-2, rgba(255,255,255,0.04))',
        borderRadius: 4,
        fontSize: 12,
      }}
    >
      <summary style={{ cursor: 'pointer', userSelect: 'none', fontWeight: 500 }}>
        Session settings
      </summary>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          <ProviderModelPicker sessionId={sessionId} state={backendState} onPatch={onPatch} />
          <AgentModePicker sessionId={sessionId} state={backendState} onPatch={onPatch} />
          <SystemPromptEditor state={backendState} onPatch={onPatch} />
          <ToolToggleList sessionId={sessionId} state={backendState} onPatch={onPatch} />
        </div>
      )}
    </details>
  )
}

function ProviderModelPicker({
  sessionId,
  state,
  onPatch,
}: {
  sessionId: string
  state: CliAgentBackendState
  onPatch: (patch: Partial<CliAgentBackendState>) => Promise<boolean>
}) {
  const [providers, setProviders] = useState<OpenCodeProviderSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const result = (await window.api.cliAgentListProviders(sessionId)) as
          | OpenCodeProviderSummary[]
          | { error: string }
          | undefined
        if (cancelled) return
        if (Array.isArray(result)) setProviders(result)
        else if (result && typeof result === 'object' && 'error' in result) {
          setError(result.error ?? 'Failed to load providers')
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId])

  const provider = providers.find((p) => p.id === state.providerID)
  return (
    <div>
      <label style={{ display: 'block', opacity: 0.7, marginBottom: 2 }}>Provider / Model</label>
      <div style={{ display: 'flex', gap: 4 }}>
        <select
          value={state.providerID ?? ''}
          onChange={(e) => void onPatch({ providerID: e.target.value || undefined, modelID: undefined })}
          style={selectStyle}
          disabled={loading}
        >
          <option value="">{loading ? 'Loading…' : '— provider —'}</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          value={state.modelID ?? ''}
          onChange={(e) => void onPatch({ modelID: e.target.value || undefined })}
          style={selectStyle}
          disabled={!provider}
        >
          <option value="">{provider ? '— model —' : ''}</option>
          {provider?.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      {error && <div style={{ color: 'tomato', fontSize: 10 }}>{error}</div>}
    </div>
  )
}

function AgentModePicker({
  sessionId,
  state,
  onPatch,
}: {
  sessionId: string
  state: CliAgentBackendState
  onPatch: (patch: Partial<CliAgentBackendState>) => Promise<boolean>
}) {
  const [agents, setAgents] = useState<OpenCodeAgentSummary[]>([])
  const [modes, setModes] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [a, m] = await Promise.all([
          window.api.cliAgentListAgents(sessionId),
          window.api.cliAgentListModes(sessionId),
        ])
        if (cancelled) return
        if (Array.isArray(a)) setAgents(a as OpenCodeAgentSummary[])
        if (Array.isArray(m)) setModes(m as string[])
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId])

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <div style={{ flex: 1 }}>
        <label style={{ display: 'block', opacity: 0.7, marginBottom: 2 }}>Agent</label>
        <select
          value={state.agent ?? ''}
          onChange={(e) => void onPatch({ agent: e.target.value || undefined })}
          style={selectStyle}
        >
          <option value="">— default —</option>
          {agents.map((a) => (
            <option key={a.name} value={a.name}>
              {a.name}
              {a.description ? ` — ${a.description}` : ''}
            </option>
          ))}
        </select>
      </div>
      <div style={{ flex: 1 }}>
        <label style={{ display: 'block', opacity: 0.7, marginBottom: 2 }}>Mode</label>
        <select
          value={state.mode ?? ''}
          onChange={(e) => void onPatch({ mode: e.target.value || undefined })}
          style={selectStyle}
        >
          <option value="">— default —</option>
          {modes.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

function SystemPromptEditor({
  state,
  onPatch,
}: {
  state: CliAgentBackendState
  onPatch: (patch: Partial<CliAgentBackendState>) => Promise<boolean>
}) {
  const [value, setValue] = useState(state.systemPromptOverride ?? '')
  useEffect(() => setValue(state.systemPromptOverride ?? ''), [state.systemPromptOverride])
  return (
    <div>
      <label style={{ display: 'block', opacity: 0.7, marginBottom: 2 }}>
        System prompt override
      </label>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() =>
          void onPatch({ systemPromptOverride: value.trim() ? value : undefined })
        }
        rows={3}
        placeholder="Leave blank to use the agent default"
        style={{
          width: '100%',
          fontFamily: 'inherit',
          fontSize: 11,
          padding: 4,
          borderRadius: 3,
          background: 'var(--color-surface-1, rgba(0,0,0,0.2))',
          color: 'inherit',
          border: '1px solid var(--color-border, rgba(255,255,255,0.1))',
          resize: 'vertical',
        }}
      />
    </div>
  )
}

function ToolToggleList({
  sessionId,
  state,
  onPatch,
}: {
  sessionId: string
  state: CliAgentBackendState
  onPatch: (patch: Partial<CliAgentBackendState>) => Promise<boolean>
}) {
  const [tools, setTools] = useState<OpenCodeToolSummary[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!state.providerID || !state.modelID) return
    let cancelled = false
    void (async () => {
      try {
        const result = await window.api.cliAgentListTools(
          sessionId,
          state.providerID!,
          state.modelID!,
        )
        if (!cancelled && Array.isArray(result)) {
          setTools(result as OpenCodeToolSummary[])
          setLoaded(true)
        }
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId, state.providerID, state.modelID])

  if (!loaded || tools.length === 0) {
    return (
      <div style={{ opacity: 0.5, fontSize: 11 }}>
        {state.providerID && state.modelID
          ? 'Tools will appear once available…'
          : 'Pick a provider/model to list tools'}
      </div>
    )
  }

  const toggles = state.toolToggles ?? {}
  return (
    <div>
      <label style={{ display: 'block', opacity: 0.7, marginBottom: 2 }}>Tools</label>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
          maxHeight: 120,
          overflowY: 'auto',
          padding: 4,
          background: 'var(--color-surface-1, rgba(0,0,0,0.2))',
          borderRadius: 3,
        }}
      >
        {tools.map((t) => {
          const enabled = toggles[t.id] !== false
          return (
            <label
              key={t.id}
              title={t.description ?? t.id}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 10,
                padding: '1px 4px',
              }}
            >
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) =>
                  void onPatch({
                    toolToggles: { ...toggles, [t.id]: e.target.checked },
                  })
                }
              />
              {t.id}
            </label>
          )
        })}
      </div>
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  flex: 1,
  fontSize: 11,
  padding: '2px 4px',
  background: 'var(--color-surface-1, rgba(0,0,0,0.2))',
  color: 'inherit',
  border: '1px solid var(--color-border, rgba(255,255,255,0.1))',
  borderRadius: 3,
}
