import { useState } from 'react'
import type { ToolCall } from '@aide/shared'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'

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

type BadgeVariant = 'neutral' | 'success' | 'warning' | 'error' | 'info'

const STATUS_META: Record<
  string,
  { label: string; className: string; variant: BadgeVariant }
> = {
  pending: { label: 'awaiting', className: 'pending', variant: 'warning' },
  approved: { label: 'approved', className: 'approved', variant: 'success' },
  rejected: { label: 'denied', className: 'rejected', variant: 'error' },
  completed: { label: 'done', className: 'completed', variant: 'success' },
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

  const meta = STATUS_META[toolCall.status] ?? STATUS_META.pending
  const icon = TOOL_ICONS[toolCall.name] ?? '⬡'
  const summary = getToolSummary(toolCall.name, toolCall.input)
  const isPending = toolCall.status === 'pending'
  const isDone = toolCall.status === 'completed' || toolCall.status === 'approved'

  return (
    <div className={`tc-card tc-card--${meta.className}`}>
      <div className="tc-card__header">
        <span className="tc-card__icon">{icon}</span>
        <span className="tc-card__name">{toolCall.name}</span>
        {summary && (
          <>
            <span className="tc-card__sep">·</span>
            <span className="tc-card__summary">{summary}</span>
          </>
        )}
        <div className="tc-card__status-area">
          {toolCall.autoApproved && <Badge variant="info">auto</Badge>}
          <Badge variant={meta.variant}>{meta.label}</Badge>
        </div>
      </div>

      <button
        className="tc-card__expand-btn"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span className={`tc-card__chevron${expanded ? ' tc-card__chevron--open' : ''}`}>▸</span>
        {expanded ? 'Hide details' : 'Show details'}
      </button>

      {expanded && <pre className="tc-card__detail">{formatToolInput(toolCall.input)}</pre>}

      {isPending && !toolCall.autoApproved && (
        <div className="tc-card__actions">
          <Button variant="outline" size="sm" onClick={() => onApprove(toolCall.id)}>
            ✓ Allow
          </Button>
          <Button variant="danger" size="sm" onClick={() => onReject(toolCall.id)}>
            ✕ Deny
          </Button>
        </div>
      )}

      {isDone && !toolCall.autoApproved && (
        <div className="tc-card__resolved">
          <span className="tc-card__resolved-icon">✓</span>
          executed
        </div>
      )}
    </div>
  )
}
