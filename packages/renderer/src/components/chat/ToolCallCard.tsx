import { useState } from 'react'
import type { ToolCall } from '@aide/shared'

interface ToolCallCardProps {
  toolCall: ToolCall
  onApprove: (toolCallId: string) => void
  onReject: (toolCallId: string) => void
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'waiting',
  approved: 'approved',
  rejected: 'denied',
  completed: 'done',
}

export function ToolCallCard({ toolCall, onApprove, onReject }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="chat-tool-card">
      <div className="chat-tool-card__header">
        <span className="chat-tool-card__name">{toolCall.name}</span>
        <span className="chat-tool-card__badge">
          <span className={`chat-tool-card__dot chat-tool-card__dot--${toolCall.status}`} />
          {STATUS_LABELS[toolCall.status] ?? toolCall.status}
          {toolCall.autoApproved && <span className="chat-tool-card__auto-badge">auto</span>}
        </span>
      </div>

      <button
        className="chat-tool-card__toggle"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? 'Hide input' : 'Show input...'}
      </button>

      {expanded && (
        <div className="chat-tool-card__preview">
          {JSON.stringify(toolCall.input, null, 2)}
        </div>
      )}

      {toolCall.status === 'pending' && (
        <div className="chat-tool-card__actions">
          <button
            className="chat-tool-card__btn chat-tool-card__btn--approve"
            onClick={() => onApprove(toolCall.id)}
          >
            Allow
          </button>
          <button
            className="chat-tool-card__btn chat-tool-card__btn--deny"
            onClick={() => onReject(toolCall.id)}
          >
            Deny
          </button>
        </div>
      )}
    </div>
  )
}
