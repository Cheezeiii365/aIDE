import { useState, useEffect, useCallback, useRef } from 'react'
import type {
  ChatSession,
  ChatMessage,
  ChatMode,
  ChatSessionStatus,
  ChatStreamChunk,
  ChatStreamEnd,
  ChatToolCallPayload,
} from '@aide/shared'

export interface UseChatReturn {
  messages: ChatMessage[]
  status: ChatSessionStatus
  mode: ChatMode
  workingSet: string[]
  streamingMessageId: string | null
  streamingContent: string
  sendMessage: (content: string) => Promise<void>
  setMode: (mode: ChatMode) => void
  setWorkingSet: (paths: string[]) => void
  approveToolCall: (toolCallId: string) => void
  rejectToolCall: (toolCallId: string) => void
  stop: () => void
}

export function useChat(workspaceId: string | undefined): UseChatReturn {
  const sessionIdRef = useRef<string | null>(null)
  const messagesRef = useRef<ChatMessage[]>([])
  const [renderTick, setRenderTick] = useState(0)
  const [status, setStatus] = useState<ChatSessionStatus>('idle')
  const [mode, setModeState] = useState<ChatMode>('agent')
  const [workingSet, setWorkingSetState] = useState<string[]>([])
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null)
  const streamingContentRef = useRef('')
  const [streamingContent, setStreamingContent] = useState('')
  const rafRef = useRef<number | null>(null)

  const tick = useCallback(() => setRenderTick((n) => n + 1), [])

  // Load session on mount / workspace change
  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false

    window.api.chatGetHistory(workspaceId).then((session: ChatSession | null) => {
      if (cancelled || !session) return
      sessionIdRef.current = session.id
      messagesRef.current = session.messages
      setModeState(session.mode)
      setWorkingSetState(session.workingSet)
      setStatus(session.status)
      tick()
    })

    return () => { cancelled = true }
  }, [workspaceId, tick])

  // Subscribe to stream chunks
  useEffect(() => {
    const unsub = window.api.onChatStreamChunk((chunk: ChatStreamChunk) => {
      if (chunk.sessionId !== sessionIdRef.current) return

      setStreamingMessageId(chunk.messageId)
      streamingContentRef.current += chunk.delta
      setStatus('thinking')

      // Throttle renders to rAF
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null
          setStreamingContent(streamingContentRef.current)
        })
      }
    })
    return unsub
  }, [])

  // Subscribe to stream end
  useEffect(() => {
    const unsub = window.api.onChatStreamEnd((end: ChatStreamEnd) => {
      if (end.sessionId !== sessionIdRef.current) return

      // Finalize the streaming message into the messages array
      if (streamingContentRef.current) {
        const finalMsg: ChatMessage = {
          id: end.messageId,
          role: 'assistant',
          content: streamingContentRef.current,
          timestamp: Date.now(),
        }
        // Check if the message already exists (appended by backend via getHistory)
        const existing = messagesRef.current.find((m) => m.id === end.messageId)
        if (!existing) {
          messagesRef.current = [...messagesRef.current, finalMsg]
        }
      }

      // Reset streaming state
      streamingContentRef.current = ''
      setStreamingContent('')
      setStreamingMessageId(null)
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }

      // Refresh session to get full message history with tool results
      if (sessionIdRef.current) {
        window.api.chatGetHistory(workspaceId!).then((session: ChatSession | null) => {
          if (!session) return
          messagesRef.current = session.messages
          setStatus(session.status)
          tick()
        })
      } else {
        setStatus('idle')
        tick()
      }
    })
    return unsub
  }, [workspaceId, tick])

  // Subscribe to tool calls
  useEffect(() => {
    const unsub = window.api.onChatToolCall((payload: ChatToolCallPayload) => {
      if (payload.sessionId !== sessionIdRef.current) return
      setStatus('awaiting_approval')

      // Find the assistant message and add the tool call, or refresh from backend
      window.api.chatGetHistory(workspaceId!).then((session: ChatSession | null) => {
        if (!session) return
        messagesRef.current = session.messages
        setStatus(session.status)
        tick()
      })
    })
    return unsub
  }, [workspaceId, tick])

  // Cleanup rAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const sendMessage = useCallback(async (content: string) => {
    const sid = sessionIdRef.current
    if (!sid || !content.trim()) return

    // Optimistic: add user message locally
    const userMsg: ChatMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: content.trim(),
      timestamp: Date.now(),
    }
    messagesRef.current = [...messagesRef.current, userMsg]
    setStatus('thinking')
    streamingContentRef.current = ''
    setStreamingContent('')
    tick()

    const result = await window.api.chatSendMessage(sid, content.trim())
    if ('error' in result) {
      setStatus('idle')
      tick()
    }
  }, [tick])

  const setMode = useCallback((newMode: ChatMode) => {
    const sid = sessionIdRef.current
    if (!sid) return
    setModeState(newMode)
    window.api.chatSetMode(sid, newMode)
  }, [])

  const setWorkingSet = useCallback((paths: string[]) => {
    const sid = sessionIdRef.current
    if (!sid) return
    setWorkingSetState(paths)
    window.api.chatSetWorkingSet(sid, paths)
  }, [])

  const approveToolCall = useCallback((toolCallId: string) => {
    const sid = sessionIdRef.current
    if (!sid) return
    window.api.chatToolApprove(sid, toolCallId)
    setStatus('tool_running')
  }, [])

  const rejectToolCall = useCallback((toolCallId: string) => {
    const sid = sessionIdRef.current
    if (!sid) return
    window.api.chatToolReject(sid, toolCallId)
  }, [])

  const stop = useCallback(() => {
    const sid = sessionIdRef.current
    if (!sid) return
    window.api.chatStop(sid)
    setStatus('idle')
    streamingContentRef.current = ''
    setStreamingContent('')
    setStreamingMessageId(null)
  }, [])

  // Force re-read of ref on renderTick change
  void renderTick

  return {
    messages: messagesRef.current,
    status,
    mode,
    workingSet,
    streamingMessageId,
    streamingContent,
    sendMessage,
    setMode,
    setWorkingSet,
    approveToolCall,
    rejectToolCall,
    stop,
  }
}
