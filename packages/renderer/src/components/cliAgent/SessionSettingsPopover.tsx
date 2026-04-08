import { useEffect, useRef, useState } from 'react'
import type {
  CliAgentBackendState,
  OpenCodeAgentSummary,
  OpenCodeProviderSummary,
  OpenCodeToolSummary,
} from '@aide/shared'

/**
 * Compact, gear-anchored popover holding all per-session OpenCode overrides.
 *
 * Replaces the old `SessionSettingsPanel` which stacked four full-width
 * sections above the chat. The popover keeps the chat area uncluttered:
 * settings live one click away, never visible until you ask.
 *
 * Aesthetic: refined terminal-minimal — hairline borders, monospace section
 * labels, sharp 2px radii, transparent inputs that draw a focus underline
 * rather than a fill. Tabs use a bottom-border accent.
 */

type Tab = 'model' | 'agent' | 'tools' | 'prompt'

interface Props {
  sessionId: string
  state: CliAgentBackendState
  onPatch: (patch: Partial<CliAgentBackendState>) => Promise<boolean>
  /** Disables the trigger (e.g. while a turn is mid-flight). */
  disabled?: boolean
}

export function SessionSettingsPopover({ sessionId, state, onPatch, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('model')
  const popoverRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // Dismiss on outside click + Escape.
  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (popoverRef.current?.contains(target)) return
      if (triggerRef.current?.contains(target)) return
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

  // Visual indicator: a small dot when the session has any non-empty override.
  const hasOverrides =
    !!(state.providerID || state.modelID || state.agent || state.mode || state.systemPromptOverride)

  return (
    <div className="oc-settings-pop">
      <button
        ref={triggerRef}
        type="button"
        className="oc-settings-pop__trigger"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        title="Session settings"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {/* gear glyph drawn from box-drawing characters keeps the
            terminal-minimal language consistent with the rest of the pane */}
        <span className="oc-settings-pop__gear" aria-hidden>⌥</span>
        {hasOverrides && <span className="oc-settings-pop__dot" aria-hidden />}
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="oc-settings-pop__panel"
          role="dialog"
          aria-label="OpenCode session settings"
        >
          <header className="oc-settings-pop__head">
            <span className="oc-settings-pop__title">SESSION · OVERRIDES</span>
            <span className="oc-settings-pop__sid" title={sessionId}>
              {sessionId.slice(0, 8)}
            </span>
          </header>

          <nav className="oc-settings-pop__tabs" role="tablist">
            {(['model', 'agent', 'tools', 'prompt'] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                className={`oc-settings-pop__tab${tab === t ? ' is-active' : ''}`}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </nav>

          <div className="oc-settings-pop__body">
            {tab === 'model' && (
              <ModelTab sessionId={sessionId} state={state} onPatch={onPatch} />
            )}
            {tab === 'agent' && (
              <AgentTab sessionId={sessionId} state={state} onPatch={onPatch} />
            )}
            {tab === 'tools' && (
              <ToolsTab sessionId={sessionId} state={state} onPatch={onPatch} />
            )}
            {tab === 'prompt' && <PromptTab state={state} onPatch={onPatch} />}
          </div>

          <footer className="oc-settings-pop__foot">
            <span className="oc-settings-pop__hint">
              defaults live in settings → agent → opencode
            </span>
          </footer>
        </div>
      )}
    </div>
  )
}

// ─── Tab: Model ────────────────────────────────────────────────────

function ModelTab({
  sessionId,
  state,
  onPatch,
}: {
  sessionId: string
  state: CliAgentBackendState
  onPatch: (p: Partial<CliAgentBackendState>) => Promise<boolean>
}) {
  const [providers, setProviders] = useState<OpenCodeProviderSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const r = (await window.api.cliAgentListProviders(sessionId)) as
          | OpenCodeProviderSummary[]
          | { error: string }
          | undefined
        if (cancelled) return
        if (Array.isArray(r)) setProviders(r)
        else if (r && typeof r === 'object' && 'error' in r) setError(r.error ?? null)
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
    <div className="oc-tab">
      <Field label="provider">
        <select
          className="oc-input"
          value={state.providerID ?? ''}
          disabled={loading}
          onChange={(e) =>
            void onPatch({ providerID: e.target.value || undefined, modelID: undefined })
          }
        >
          <option value="">{loading ? 'loading…' : '—'}</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="model">
        <select
          className="oc-input"
          value={state.modelID ?? ''}
          disabled={!provider}
          onChange={(e) => void onPatch({ modelID: e.target.value || undefined })}
        >
          <option value="">{provider ? '—' : ''}</option>
          {provider?.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </Field>
      {provider && state.modelID && (
        <ModelMeta provider={provider} modelId={state.modelID} />
      )}
      {error && <div className="oc-error">{error}</div>}
    </div>
  )
}

function ModelMeta({
  provider,
  modelId,
}: {
  provider: OpenCodeProviderSummary
  modelId: string
}) {
  const m = provider.models.find((x) => x.id === modelId)
  if (!m) return null
  const flags: string[] = []
  if (m.reasoning) flags.push('reasoning')
  if (m.toolCall) flags.push('tools')
  if (m.attachment) flags.push('attach')
  return (
    <div className="oc-meta">
      {flags.length > 0 && <span className="oc-meta__flags">{flags.join(' · ')}</span>}
      {m.cost && (
        <span className="oc-meta__cost">
          ${m.cost.input.toFixed(2)} in / ${m.cost.output.toFixed(2)} out · per 1M
        </span>
      )}
    </div>
  )
}

// ─── Tab: Agent ────────────────────────────────────────────────────

function AgentTab({
  sessionId,
  state,
  onPatch,
}: {
  sessionId: string
  state: CliAgentBackendState
  onPatch: (p: Partial<CliAgentBackendState>) => Promise<boolean>
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

  const selected = agents.find((a) => a.name === state.agent)

  return (
    <div className="oc-tab">
      <Field label="agent">
        <select
          className="oc-input"
          value={state.agent ?? ''}
          onChange={(e) => void onPatch({ agent: e.target.value || undefined })}
        >
          <option value="">— default —</option>
          {agents.map((a) => (
            <option key={a.name} value={a.name}>
              {a.name}
            </option>
          ))}
        </select>
      </Field>
      {selected?.description && (
        <p className="oc-desc">{selected.description}</p>
      )}
      <Field label="mode">
        <select
          className="oc-input"
          value={state.mode ?? ''}
          onChange={(e) => void onPatch({ mode: e.target.value || undefined })}
        >
          <option value="">— default —</option>
          {modes.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </Field>
    </div>
  )
}

// ─── Tab: Tools ────────────────────────────────────────────────────

function ToolsTab({
  sessionId,
  state,
  onPatch,
}: {
  sessionId: string
  state: CliAgentBackendState
  onPatch: (p: Partial<CliAgentBackendState>) => Promise<boolean>
}) {
  const [tools, setTools] = useState<OpenCodeToolSummary[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!state.providerID || !state.modelID) return
    let cancelled = false
    void (async () => {
      try {
        const r = await window.api.cliAgentListTools(
          sessionId,
          state.providerID!,
          state.modelID!,
        )
        if (!cancelled && Array.isArray(r)) {
          setTools(r as OpenCodeToolSummary[])
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

  if (!state.providerID || !state.modelID) {
    return <div className="oc-empty">pick a provider/model first</div>
  }
  if (!loaded) return <div className="oc-empty">loading tools…</div>
  if (tools.length === 0) return <div className="oc-empty">no tools available</div>

  const toggles = state.toolToggles ?? {}
  return (
    <div className="oc-tab">
      <ul className="oc-tools">
        {tools.map((t) => {
          const enabled = toggles[t.id] !== false
          return (
            <li key={t.id} className="oc-tools__item">
              <label className="oc-tools__row">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) =>
                    void onPatch({
                      toolToggles: { ...toggles, [t.id]: e.target.checked },
                    })
                  }
                />
                <span className="oc-tools__name">{t.id}</span>
              </label>
              {t.description && <span className="oc-tools__desc">{t.description}</span>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ─── Tab: System Prompt ────────────────────────────────────────────

function PromptTab({
  state,
  onPatch,
}: {
  state: CliAgentBackendState
  onPatch: (p: Partial<CliAgentBackendState>) => Promise<boolean>
}) {
  const [value, setValue] = useState(state.systemPromptOverride ?? '')
  useEffect(() => setValue(state.systemPromptOverride ?? ''), [state.systemPromptOverride])
  return (
    <div className="oc-tab">
      <Field label="system prompt override">
        <textarea
          className="oc-input oc-input--area"
          rows={6}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() =>
            void onPatch({ systemPromptOverride: value.trim() ? value : undefined })
          }
          placeholder="leave blank to use the agent default"
        />
      </Field>
      <p className="oc-hint">applied on top of the agent's own system prompt</p>
    </div>
  )
}

// ─── Primitives ────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="oc-field">
      <span className="oc-field__label">{label}</span>
      {children}
    </label>
  )
}
