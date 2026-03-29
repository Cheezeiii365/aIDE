import { useRef, useEffect, useCallback } from 'react'
import type { ChatMessage, ChatSessionStatus } from '@aide/shared'
import { MessageBubble } from './MessageBubble'
import { ToolCallCard } from './ToolCallCard'

interface MessageListProps {
  messages: ChatMessage[]
  streamingMessageId: string | null
  streamingContent: string
  status: ChatSessionStatus
  onApproveToolCall: (toolCallId: string) => void
  onRejectToolCall: (toolCallId: string) => void
}

export function MessageList({
  messages,
  streamingMessageId,
  streamingContent,
  status,
  onApproveToolCall,
  onRejectToolCall,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50
  }, [])

  // Auto-scroll when new content arrives
  useEffect(() => {
    if (isAtBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, streamingContent, status])

  if (messages.length === 0 && !streamingMessageId) {
    return (
      <div className="chat-messages">
        <div className="chat-messages__empty">Start a conversation</div>
      </div>
    )
  }

  return (
    <div className="chat-messages" ref={scrollRef} onScroll={handleScroll}>
      {messages.map((msg) => {
        const isStreamingThis = msg.id === streamingMessageId
        return (
          <div key={msg.id}>
            <MessageBubble
              message={msg}
              isStreaming={isStreamingThis}
              streamingContent={isStreamingThis ? streamingContent : undefined}
            />
            {msg.toolCalls?.map((tc) => (
              <ToolCallCard
                key={tc.id}
                toolCall={tc}
                onApprove={onApproveToolCall}
                onReject={onRejectToolCall}
              />
            ))}
          </div>
        )
      })}

      {/* Streaming message that hasn't been finalized yet */}
      {streamingMessageId && !messages.some((m) => m.id === streamingMessageId) && streamingContent && (
        <MessageBubble
          message={{
            id: streamingMessageId,
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
          }}
          isStreaming
          streamingContent={streamingContent}
        />
      )}

      {/* Status line */}
      {status === 'thinking' && (
        <div className="chat-status">Thinking...</div>
      )}
      {status === 'tool_running' && (
        <div className="chat-status">Running tool...</div>
      )}
      {status === 'awaiting_approval' && (
        <div className="chat-status chat-status--warning">Waiting for approval</div>
      )}
    </div>
  )
}
