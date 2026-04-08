import { useMemo } from 'react'
import type { ChatMessage } from '@aide/shared'
import { renderMarkdown } from '../../lib/markdownRenderer'

interface MessageBubbleProps {
  message: ChatMessage
  isStreaming: boolean
  streamingContent?: string
}

export function MessageBubble({ message, isStreaming, streamingContent }: MessageBubbleProps) {
  const displayContent = isStreaming ? (streamingContent ?? '') : message.content

  if (message.role === 'tool_result') {
    const isError = message.toolResults?.some((r) => r.isError)
    const output =
      message.toolResults?.map((r) => r.output).filter(Boolean).join('\n\n') || message.content
    return (
      <div className={`chat-msg chat-msg--tool-result${isError ? ' chat-msg--tool-result-error' : ''}`}>
        <div className="chat-msg__role">{isError ? 'Tool error' : 'Tool result'}</div>
        <div className="chat-msg__body">{output}</div>
      </div>
    )
  }

  if (message.role === 'user') {
    return (
      <div className="chat-msg chat-msg--user">
        <div className="chat-msg__role">You</div>
        <div className="chat-msg__body">{message.content}</div>
      </div>
    )
  }

  // Assistant message — render markdown
  return <AssistantMessage content={displayContent} isStreaming={isStreaming} />
}

function AssistantMessage({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  const html = useMemo(() => {
    if (!content) return ''
    return renderMarkdown(content)
  }, [content])

  return (
    <div className="chat-msg chat-msg--assistant">
      <div className="chat-msg__role">Claude</div>
      <div className="chat-msg__body">
        {/* Safe: HTML is sanitized through DOMPurify in renderMarkdown */}
        <span dangerouslySetInnerHTML={{ __html: html }} />
        {isStreaming && <span className="chat-msg__cursor">{'\u2588'}</span>}
      </div>
    </div>
  )
}
