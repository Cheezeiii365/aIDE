import { useState, useRef, useEffect } from 'react'
import type { ToolCall } from '@aide/shared'

interface ToolCallCardProps {
  toolCall: ToolCall
  onApprove: (toolCallId: string) => void
  onReject: (toolCallId: string) => void
}

const TOOL_ICONS: Record<string, string> = {
  file_read: '◻',
  file_write: '◼',
  file_list: '≡',
  search_files: '⌕',
  git_status: '⎇',
  git_diff: '±',
  terminal_exec: '>_',
  browser_read: '◎',
}

const STATUS_META: Record<string, { label: string; className: string }> = {
  pending: { label: 'awaiting', className: 'pending' },
  approved: { label: 'approved', className: 'approved' },
  rejected: { label: 'denied', className: 'rejected' },
  completed: { label: 'done', className: 'completed' },
}

function formatToolInput(input: Record<string, unknown>): string {
  const entries = Object.entries(input)
  if (entries.length === 0) return '(no arguments)'

  return entries
    .map(([k, v]) => {
      const val = typeof v === 'string'
        ? v.length > 80 ? `${v.slice(0, 77)}...` : v
        : JSON.stringify(v)
      return `${k}: ${val}`
    })
    .join('\n')
}

function getToolSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'file_read':
    case 'file_write':
      return (input.path as string) ?? (input.file_path as string) ?? ''
    case 'file_list':
      return (input.directory as string) ?? (input.path as string) ?? ''
    case 'search_files':
      return (input.query as string) ?? (input.pattern as string) ?? ''
    case 'terminal_exec':
      return (input.command as string) ?? ''
    case 'git_status':
      return 'repository status'
    case 'git_diff':
      return (input.ref as string) ?? 'working tree'
    case 'browser_read':
      return (input.url as string) ?? ''
    default:
      return ''
  }
}

export function ToolCallCard({ toolCall, onApprove, onReject }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [animateIn, setAnimateIn] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    requestAnimationFrame(() => setAnimateIn(true))
  }, [])

  const meta = STATUS_META[toolCall.status] ?? STATUS_META.pending
  const icon = TOOL_ICONS[toolCall.name] ?? '⬡'
  const summary = getToolSummary(toolCall.name, toolCall.input)
  const isPending = toolCall.status === 'pending'
  const isDone = toolCall.status === 'completed' || toolCall.status === 'approved'

  return (
    <div
      ref={cardRef}
      className={`tc-card tc-card--${meta.className}${animateIn ? ' tc-card--visible' : ''}${isPending ? ' tc-card--awaiting' : ''}`}
    >
      {/* Tier glow bar */}
      <div className="tc-card__glow" />

      <div className="tc-card__main">
        {/* Tool icon + name row */}
        <div className="tc-card__header">
          <span className="tc-card__icon">{icon}</span>
          <div className="tc-card__title-group">
            <span className="tc-card__name">{toolCall.name}</span>
            {summary && <span className="tc-card__summary">{summary}</span>}
          </div>
          <div className="tc-card__status-area">
            <span className={`tc-card__dot tc-card__dot--${meta.className}`} />
            <span className="tc-card__status-label">{meta.label}</span>
            {toolCall.autoApproved && (
              <span className="tc-card__auto-tag">auto</span>
            )}
          </div>
        </div>

        {/* Expandable input detail */}
        <button
          className="tc-card__expand-btn"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          <span className={`tc-card__chevron${expanded ? ' tc-card__chevron--open' : ''}`}>▸</span>
          {expanded ? 'Hide details' : 'Show details'}
        </button>

        {expanded && (
          <pre className="tc-card__detail">
            {formatToolInput(toolCall.input)}
          </pre>
        )}

        {/* Approval buttons */}
        {isPending && !toolCall.autoApproved && (
          <div className="tc-card__actions">
            <button
              className="tc-card__btn tc-card__btn--allow"
              onClick={() => onApprove(toolCall.id)}
            >
              <span className="tc-card__btn-icon">✓</span>
              Allow
            </button>
            <button
              className="tc-card__btn tc-card__btn--deny"
              onClick={() => onReject(toolCall.id)}
            >
              <span className="tc-card__btn-icon">✕</span>
              Deny
            </button>
          </div>
        )}

        {/* Completed state — subtle checkmark */}
        {isDone && !toolCall.autoApproved && (
          <div className="tc-card__resolved">
            <span className="tc-card__resolved-icon">✓</span>
            executed
          </div>
        )}
      </div>
    </div>
  )
}
