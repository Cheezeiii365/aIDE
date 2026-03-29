import { useState, useEffect, useCallback, useRef } from 'react'
import type {
  AgentBackend,
  CliAgentProcessStatus,
  CliAgentMessage,
  CliAgentSession,
  CliAgentStreamDelta,
  CliAgentStatusPayload,
} from '@aide/shared'

export interface UseCliAgentReturn {
  messages: CliAgentMessage[]
  processStatus: CliAgentProcessStatus
  streamingContent: string
  streamingMessageId: string | null
  model: string | null
  lastError: string | null
  start: (backend: AgentBackend) => Promise<void>
  send: (content: string) => Promise<void>
  stop: () => void
}

export function useCliAgent(workspaceId: string | undefined): UseCliAgentReturn {
  const sessionIdRef = useRef<string | null>(null)
  const messagesRef = useRef<CliAgentMessage[]>([])
  const [renderTick, setRenderTick] = useState(0)
  const [processStatus, setProcessStatus] = useState<CliAgentProcessStatus>('stopped')
  const [model, setModel] = useState<string | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null)
  const streamingContentRef = useRef('')
  const [streamingContent, setStreamingContent] = useState('')
  const rafRef = useRef<number | null>(null)

  const tick = useCallback(() => setRenderTick((n) => n + 1), [])

  // Load existing session on mount / workspace change
  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false

    window.api.cliAgentGetSession(workspaceId).then((session: CliAgentSession | null) => {
      if (cancelled || !session) return
      sessionIdRef.current = session.id
      messagesRef.current = session.messages
      setProcessStatus(session.processStatus)
      setModel(session.model ?? null)
      setLastError(session.lastError ?? null)
      tick()
    })

    return () => { cancelled = true }
  }, [workspaceId, tick])

  // Subscribe to stream deltas
  useEffect(() => {
    const unsub = window.api.onCliAgentStreamDelta((delta: CliAgentStreamDelta) => {
      if (delta.sessionId !== sessionIdRef.current) return

      setStreamingMessageId(delta.messageId)
      streamingContentRef.current += delta.delta

      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null
          setStreamingContent(streamingContentRef.current)
        })
      }
    })
    return unsub
  }, [])

  // Subscribe to messages
  useEffect(() => {
    const unsub = window.api.onCliAgentMessage((msg: CliAgentMessage & { sessionId: string }) => {
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

      messagesRef.current = [...messagesRef.current, msg]
      tick()
    })
    return unsub
  }, [tick])

  // Subscribe to status changes
  useEffect(() => {
    const unsub = window.api.onCliAgentStatus((status: CliAgentStatusPayload) => {
      if (status.sessionId !== sessionIdRef.current) return
      setProcessStatus(status.processStatus)
      if (status.error) setLastError(status.error)
    })
    return unsub
  }, [])

  // Cleanup rAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const start = useCallback(async (backend: AgentBackend) => {
    if (!workspaceId) return

    // Reset state
    messagesRef.current = []
    streamingContentRef.current = ''
    setStreamingContent('')
    setStreamingMessageId(null)
    setLastError(null)
    tick()

    const result = await window.api.cliAgentStart(workspaceId, backend)
    if ('error' in result) {
      setLastError(result.error)
      setProcessStatus('error')
    } else {
      sessionIdRef.current = result.sessionId
    }
  }, [workspaceId, tick])

  const send = useCallback(async (content: string) => {
    const sid = sessionIdRef.current
    if (!sid || !content.trim()) return

    streamingContentRef.current = ''
    setStreamingContent('')

    const result = await window.api.cliAgentSend(sid, content.trim())
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
    messages: messagesRef.current,
    processStatus,
    streamingContent,
    streamingMessageId,
    model,
    lastError,
    start,
    send,
    stop,
  }
}
