import { useState, useEffect, useCallback, useRef } from 'react'
import type {
  ChatComposerSubmission,
  ChatSession,
  ChatMessage,
  ChatMode,
  ChatSessionStatus,
  ChatStreamChunk,
  ChatStreamEnd,
  ChatToolCallPayload,
  ConversationListChangedPayload,
} from '@aide/shared'
import { scopedTo } from '../lib/workspace/workspaceScopedListener'
import { approvalInboxRemove } from '../lib/workspace/approvalInboxStore'

export interface UseChatReturn {
  sessionId: string | null
  messages: ChatMessage[]
  status: ChatSessionStatus
  mode: ChatMode
  workingSet: string[]
  streamingMessageId: string | null
  streamingContent: string
  conversationTitle: string
  sendMessage: (payload: ChatComposerSubmission) => Promise<void>
  setMode: (mode: ChatMode) => void
  setWorkingSet: (paths: string[]) => void
  approveToolCall: (toolCallId: string) => void
  rejectToolCall: (toolCallId: string) => void
  stop: () => void
}

export function useChat(workspaceId: string | undefined, conversationId?: string): UseChatReturn {
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
  const [conversationTitle, setConversationTitle] = useState('New Chat')

  const tick = useCallback(() => setRenderTick((n) => n + 1), [])

  // Load session on mount / workspace change / conversationId change
  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false

    window.api.chatGetHistory(workspaceId, conversationId).then((session: ChatSession | null) => {
      if (cancelled || !session) return
      sessionIdRef.current = session.id
      messagesRef.current = session.messages
      setModeState(session.mode)
      setWorkingSetState(session.workingSet)
      setStatus(session.status)
      tick()

      // Load conversation title from store
      if (session.id) {
        window.api
          .conversationGet(workspaceId, session.id)
          .then((meta) => {
            if (!cancelled && meta) {
              setConversationTitle(meta.title)
            }
          })
          .catch(() => {})
      }
    })

    return () => {
      cancelled = true
    }
  }, [workspaceId, conversationId, tick])

  // Subscribe to conversation list changes (for title updates)
  useEffect(() => {
    const unsub = window.api.onConversationListChanged(
      scopedTo<ConversationListChangedPayload>(workspaceId, (payload) => {
        const sid = sessionIdRef.current
        if (!sid) return
        const meta = payload.conversations.find((c) => c.id === sid)
        if (meta) {
          setConversationTitle(meta.title)
        }
      }),
    )
    return unsub
  }, [workspaceId])

  // Subscribe to stream chunks
  useEffect(() => {
    const unsub = window.api.onChatStreamChunk(
      scopedTo<ChatStreamChunk>(workspaceId, (chunk) => {
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
      }),
    )
    return unsub
  }, [workspaceId])

  // Subscribe to stream end
  useEffect(() => {
    const unsub = window.api.onChatStreamEnd(
      scopedTo<ChatStreamEnd>(workspaceId, (end) => {
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
          window.api
            .chatGetHistory(workspaceId!, end.sessionId)
            .then((session: ChatSession | null) => {
              if (!session) return
              messagesRef.current = session.messages
              setStatus(session.status)
              tick()
            })
        } else {
          setStatus('idle')
          tick()
        }
      }),
    )
    return unsub
  }, [workspaceId, tick])

  // Subscribe to tool calls
  useEffect(() => {
    const unsub = window.api.onChatToolCall(
      scopedTo<ChatToolCallPayload>(workspaceId, (payload) => {
        if (payload.sessionId !== sessionIdRef.current) return
        setStatus('awaiting_approval')

        // Find the assistant message and add the tool call, or refresh from backend
        window.api
          .chatGetHistory(workspaceId!, payload.sessionId)
          .then((session: ChatSession | null) => {
            if (!session) return
            messagesRef.current = session.messages
            setStatus(session.status)
            tick()
          })
      }),
    )
    return unsub
  }, [workspaceId, tick])

  // Cleanup rAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const sendMessage = useCallback(
    async (payload: ChatComposerSubmission) => {
      const sid = sessionIdRef.current
      if (!sid || (!payload.text.trim() && payload.mentionedFiles.length === 0)) return

      // Optimistic: add user message locally
      const userMsg: ChatMessage = {
        id: `local-${Date.now()}`,
        role: 'user',
        content: payload.rawText?.trim() || payload.text.trim(),
        contextualContent: payload.text.trim(),
        mentionedFiles: payload.mentionedFiles,
        commandId: payload.commandId,
        timestamp: Date.now(),
      }
      messagesRef.current = [...messagesRef.current, userMsg]
      setStatus('thinking')
      streamingContentRef.current = ''
      setStreamingContent('')
      tick()

      const result = await window.api.chatSendMessage(sid, payload)
      if ('error' in result) {
        setStatus('idle')
        tick()
      }
    },
    [tick],
  )

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

  const approveToolCall = useCallback(
    (toolCallId: string) => {
      const sid = sessionIdRef.current
      const wid = workspaceId
      if (!sid || !wid) return
      void window.api.chatToolApprove(sid, toolCallId)
      approvalInboxRemove(wid, sid, toolCallId)
      setStatus('tool_running')
    },
    [workspaceId],
  )

  const rejectToolCall = useCallback(
    (toolCallId: string) => {
      const sid = sessionIdRef.current
      const wid = workspaceId
      if (!sid || !wid) return
      void window.api.chatToolReject(sid, toolCallId)
      approvalInboxRemove(wid, sid, toolCallId)
    },
    [workspaceId],
  )

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
    sessionId: sessionIdRef.current,
    messages: messagesRef.current,
    status,
    mode,
    workingSet,
    streamingMessageId,
    streamingContent,
    conversationTitle,
    sendMessage,
    setMode,
    setWorkingSet,
    approveToolCall,
    rejectToolCall,
    stop,
  }
}
