import { useState, useEffect, useCallback, useRef } from 'react'
import type {
  AgentBackend,
  ChatComposerSubmission,
  CliAgentBackendState,
  CliAgentProcessStatus,
  CliAgentMessage,
  CliAgentResultPayload,
  CliAgentStreamDelta,
  CliAgentStatusPayload,
  CliAgentMessagePayload,
  CliAgentTokenUsage,
  ConversationListChangedPayload,
} from '@aide/shared'
import { scopedTo } from '../lib/workspace/workspaceScopedListener'

export interface UseCliAgentReturn {
  /** False while loading persisted/native history for an existing conversation. */
  historyHydrated: boolean
  /** The active CLI session id (null until first start()). */
  sessionId: string | null
  messages: CliAgentMessage[]
  processStatus: CliAgentProcessStatus
  streamingContent: string
  streamingMessageId: string | null
  model: string | null
  lastError: string | null
  conversationTitle: string
  /** Currently active external backend for this session (source of truth for the pane header). */
  activeBackend: AgentBackend | null
  /** Cumulative cost (USD) for the session. */
  totalCostUsd: number
  /** Cumulative token usage for the session. */
  totalTokens: CliAgentTokenUsage | null
  /** Per-backend state (provider/model/agent/system/tools) for the active backend. */
  backendState: CliAgentBackendState | null
  start: (backend: AgentBackend) => Promise<void>
  send: (payload: ChatComposerSubmission) => Promise<void>
  stop: () => void
  /** Hot-swap the underlying CLI backend for this conversation. Returns true on success. */
  switchBackend: (backend: AgentBackend) => Promise<boolean>
  /** Patch backend-state overrides for the current session (model / agent / system / tools / etc.). */
  updateSessionConfig: (patch: Partial<CliAgentBackendState>) => Promise<boolean>
}

export interface UseCliAgentOptions {
  workspaceId?: string
  backend?: AgentBackend
  conversationId?: string
  worktreePath?: string
}

export function useCliAgent(options: UseCliAgentOptions): UseCliAgentReturn {
  const { workspaceId, conversationId, worktreePath } = options
  const [activeBackend, setActiveBackend] = useState<AgentBackend | null>(options.backend ?? null)
  const sessionIdRef = useRef<string | null>(null)
  const messagesRef = useRef<CliAgentMessage[]>([])
  const [renderTick, setRenderTick] = useState(0)
  const [processStatus, setProcessStatus] = useState<CliAgentProcessStatus>('stopped')
  const [model, setModel] = useState<string | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const [conversationTitle, setConversationTitle] = useState('New Chat')
  const [historyHydrated, setHistoryHydrated] = useState(() => !options.conversationId)
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null)
  const streamingContentRef = useRef('')
  const [streamingContent, setStreamingContent] = useState('')
  const [totalCostUsd, setTotalCostUsd] = useState(0)
  const [totalTokens, setTotalTokens] = useState<CliAgentTokenUsage | null>(null)
  const [backendState, setBackendState] = useState<CliAgentBackendState | null>(null)
  const rafRef = useRef<number | null>(null)
  const hydrateGenRef = useRef(0)
  const listRetryGenRef = useRef(0)
  const lastHydrateKeyRef = useRef<string | null>(null)

  const tick = useCallback(() => setRenderTick((n) => n + 1), [])

  // Load in-memory session, else hydrate from disk / native JSONL (before start()).
  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false

    // No workspace-wide session lookup: multiple unsaved CLI tabs must not share the first in-memory match.
    if (!conversationId) {
      setHistoryHydrated(true)
      return () => {
        cancelled = true
      }
    }

    setHistoryHydrated(false)
    const myGen = ++hydrateGenRef.current
    listRetryGenRef.current += 1
    const hydrateKey = `${workspaceId}:${conversationId}`
    if (lastHydrateKeyRef.current !== hydrateKey) {
      messagesRef.current = []
      lastHydrateKeyRef.current = hydrateKey
    }
    sessionIdRef.current = null
    ;(async () => {
      const session = await window.api.cliAgentGetSession(workspaceId, conversationId)
      if (cancelled || myGen !== hydrateGenRef.current) return
      if (session && session.id === conversationId) {
        if (cancelled || myGen !== hydrateGenRef.current) return
        sessionIdRef.current = session.id
        messagesRef.current = session.messages
        setProcessStatus(session.processStatus)
        setModel(session.model ?? null)
        setLastError(session.lastError ?? null)
        const ab = session.activeBackend ?? session.backend ?? options.backend ?? null
        setActiveBackend(ab)
        setBackendState(extractBackendState(session, ab))
        setHistoryHydrated(true)
        tick()
        return
      }
      sessionIdRef.current = conversationId
      try {
        const prior = await window.api.cliAgentLoadMessages(workspaceId, conversationId)
        if (cancelled || myGen !== hydrateGenRef.current) return
        if (prior.length === 0 && messagesRef.current.length > 0) {
          // Stale empty IPC (e.g. native-prefix on wrong workspace root) — keep hydrated transcript.
        } else {
          messagesRef.current = prior
        }
      } finally {
        if (!cancelled && myGen === hydrateGenRef.current) setHistoryHydrated(true)
        if (myGen === hydrateGenRef.current) tick()
      }
    })()

    window.api
      .conversationGet(workspaceId, conversationId)
      .then((meta) => {
        if (!cancelled && meta) setConversationTitle(meta.title)
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [workspaceId, conversationId, tick])

  // Subscribe to conversation list changes (titles + late native hydration when the watcher fills the cache).
  useEffect(() => {
    const unsub = window.api.onConversationListChanged(
      scopedTo<ConversationListChangedPayload>(workspaceId, (payload) => {
        const sid = sessionIdRef.current ?? conversationId
        if (!sid) return
        const meta = payload.conversations.find((c) => c.id === sid)
        if (meta) {
          setConversationTitle(meta.title)
        }
        if (
          !conversationId ||
          !meta ||
          meta.source !== 'claude-native' ||
          (meta.messageCount ?? 0) < 1 ||
          messagesRef.current.length > 0
        ) {
          return
        }
        const g = ++listRetryGenRef.current
        void (async () => {
          const prior = await window.api.cliAgentLoadMessages(workspaceId!, conversationId)
          if (g !== listRetryGenRef.current) return
          if (prior.length > 0) {
            messagesRef.current = prior
            tick()
          }
        })()
      }),
    )
    return unsub
  }, [workspaceId, conversationId, tick])

  // Subscribe to stream deltas
  useEffect(() => {
    const unsub = window.api.onCliAgentStreamDelta(
      scopedTo<CliAgentStreamDelta>(workspaceId, (delta) => {
        if (delta.sessionId !== sessionIdRef.current) return

        setStreamingMessageId(delta.messageId)
        streamingContentRef.current += delta.delta

        if (rafRef.current === null) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null
            setStreamingContent(streamingContentRef.current)
          })
        }
      }),
    )
    return unsub
  }, [workspaceId])

  // Subscribe to messages
  useEffect(() => {
    const unsub = window.api.onCliAgentMessage(
      scopedTo<CliAgentMessagePayload>(workspaceId, (msg) => {
        if (msg.sessionId !== sessionIdRef.current) return

        // If we have streaming content, finalize it into the message
        if (msg.type === 'assistant' && streamingContentRef.current) {
          streamingContentRef.current = ''
          setStreamingContent('')
          setStreamingMessageId(null)
          if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current)
            rafRef.current = null
          }
        }

        const { workspaceId: _w, sessionId: _s, ...rest } = msg
        messagesRef.current = [...messagesRef.current, rest as CliAgentMessage]
        tick()
      }),
    )
    return unsub
  }, [workspaceId, tick])

  // Subscribe to status changes
  useEffect(() => {
    const unsub = window.api.onCliAgentStatus(
      scopedTo<CliAgentStatusPayload>(workspaceId, (status) => {
        if (status.sessionId !== sessionIdRef.current) return
        setProcessStatus(status.processStatus)
        if (status.error) setLastError(status.error)
      }),
    )
    return unsub
  }, [workspaceId])

  // Subscribe to result events for cost / token totals.
  useEffect(() => {
    const unsub = window.api.onCliAgentResult((result: CliAgentResultPayload) => {
      if (result.sessionId !== sessionIdRef.current) return
      setTotalCostUsd(result.totalCostUsd)
      if (result.totalTokens) setTotalTokens(result.totalTokens)
    })
    return unsub
  }, [])

  // Cleanup rAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const start = useCallback(
    async (backend: AgentBackend) => {
      if (!workspaceId) return

      // New chat: clear local state. Resuming (conversationId set): main loads history; we hydrate after start.
      if (!conversationId) {
        messagesRef.current = []
      }
      streamingContentRef.current = ''
      setStreamingContent('')
      setStreamingMessageId(null)
      setLastError(null)
      tick()

      const result = await window.api.cliAgentStart(
        workspaceId,
        backend,
        conversationId,
        worktreePath,
      )
      if ('error' in result) {
        setLastError(result.error)
        setProcessStatus('error')
      } else {
        sessionIdRef.current = result.sessionId
        setActiveBackend(backend)
        const session = await window.api.cliAgentGetSession(workspaceId, result.sessionId)
        if (session) {
          // Main starts native / external sessions with [] until first send; keep hydrated history.
          if (session.messages.length > 0) {
            messagesRef.current = session.messages
          }
          setProcessStatus(session.processStatus)
          setModel(session.model ?? null)
          setLastError(session.lastError ?? null)
          const ab = session.activeBackend ?? session.backend ?? backend
          setActiveBackend(ab)
          setBackendState(extractBackendState(session, ab))
          if (typeof session.totalCostUsd === 'number') setTotalCostUsd(session.totalCostUsd)
          if (session.totalTokens) setTotalTokens(session.totalTokens)
        }
        tick()
      }
    },
    [workspaceId, conversationId, worktreePath, tick],
  )

  const updateSessionConfig = useCallback(
    async (patch: Partial<CliAgentBackendState>): Promise<boolean> => {
      const sid = sessionIdRef.current
      if (!sid) return false
      // Optimistically merge so the picker reflects the selection immediately
      // (main only emits a status event afterwards, which doesn't carry
      // backend-state, so we cannot rely on a roundtrip refresh).
      setBackendState((prev) => ({ ...(prev ?? {}), ...patch }))
      const result = await window.api.cliAgentUpdateSessionConfig(
        sid,
        patch as Record<string, unknown>,
      )
      if (result.error) {
        setLastError(result.error)
        return false
      }
      if (patch.model) setModel(patch.model)
      return true
    },
    [],
  )

  const switchBackend = useCallback(async (backend: AgentBackend): Promise<boolean> => {
    const sid = sessionIdRef.current
    if (!sid) return false
    const result = await window.api.cliAgentSwitchBackend(sid, backend)
    if ('error' in result) {
      setLastError(result.error)
      return false
    }
    setActiveBackend(backend)
    setLastError(null)
    return true
  }, [])

  const send = useCallback(async (payload: ChatComposerSubmission) => {
    const sid = sessionIdRef.current
    if (!sid || (!payload.text.trim() && payload.mentionedFiles.length === 0)) return

    streamingContentRef.current = ''
    setStreamingContent('')

    const result = await window.api.cliAgentSend(sid, payload)
    if ('error' in result) {
      setLastError(result.error)
    }
  }, [])

  const stop = useCallback(() => {
    const sid = sessionIdRef.current
    if (!sid) return
    window.api.cliAgentStop(sid)
    streamingContentRef.current = ''
    setStreamingContent('')
    setStreamingMessageId(null)
  }, [])

  // Force re-read of ref on renderTick change
  void renderTick

  return {
    historyHydrated,
    sessionId: sessionIdRef.current,
    messages: messagesRef.current,
    processStatus,
    streamingContent,
    streamingMessageId,
    model,
    lastError,
    conversationTitle,
    activeBackend,
    totalCostUsd,
    totalTokens,
    backendState,
    start,
    send,
    stop,
    switchBackend,
    updateSessionConfig,
  }
}

/**
 * Pull the per-backend state for the *active* backend out of a session
 * payload. Returns null when the session has no recorded state for that
 * backend yet (e.g. fresh session, no overrides applied).
 */
function extractBackendState(
  session: {
    activeBackend?: AgentBackend
    backend?: AgentBackend
    backendStates?: Record<string, CliAgentBackendState> | undefined
  },
  active: AgentBackend | null,
): CliAgentBackendState | null {
  const key = active ?? session.activeBackend ?? session.backend
  if (!key || !session.backendStates) return null
  return session.backendStates[key as string] ?? null
}
