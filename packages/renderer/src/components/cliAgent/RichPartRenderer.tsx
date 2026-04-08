import { useMemo, useState } from 'react'
import type { CliAgentMessage } from '@aide/shared'
import { renderMarkdown } from '../../lib/markdownRenderer'
import { CostTokenBadge } from './CostTokenBadge'

/**
 * Render a rich CliAgentMessage variant. Handles every part type the OpenCode
 * adapter can emit (reasoning / patch / step / snapshot / retry / compaction /
 * agent_change / subtask / file_attachment) plus a fallback for the original
 * built-in message types so the existing CliAgentPane bubble can defer here.
 */
export function RichPartRenderer({
  message,
  onRevertMessage,
}: {
  message: CliAgentMessage
  onRevertMessage?: (messageId: string) => void
}) {
  switch (message.type) {
    case 'reasoning':
      return <ReasoningBubble message={message} />
    case 'patch':
      return <PatchBubble message={message} />
    case 'step':
      return <StepBubble message={message} />
    case 'snapshot':
      return <SnapshotBubble message={message} onRevert={onRevertMessage} />
    case 'retry':
      return <RetryBubble message={message} />
    case 'compaction':
      return <CompactionBubble message={message} />
    case 'agent_change':
      return <AgentChangeBubble message={message} />
    case 'subtask':
      return <SubtaskBubble message={message} />
    case 'file_attachment':
      return <FileAttachmentBubble message={message} />
    default:
      return null
  }
}

function ReasoningBubble({ message }: { message: CliAgentMessage }) {
  const [open, setOpen] = useState(!message.reasoningCollapsed)
  const html = useMemo(() => renderMarkdown(message.content || ''), [message.content])
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="cli-agent-msg cli-agent-msg--reasoning"
      style={{
        margin: '4px 0',
        padding: '4px 8px',
        borderLeft: '2px solid var(--color-accent-muted, #888)',
        opacity: 0.85,
        fontSize: 12,
      }}
    >
      <summary style={{ cursor: 'pointer', userSelect: 'none' }}>
        <em>Reasoning</em>
      </summary>
      <div style={{ marginTop: 4 }} dangerouslySetInnerHTML={{ __html: html }} />
    </details>
  )
}

function PatchBubble({ message }: { message: CliAgentMessage }) {
  const files = message.patchFiles ?? []
  return (
    <div
      className="cli-agent-msg cli-agent-msg--patch"
      style={{
        margin: '4px 0',
        padding: '6px 8px',
        background: 'var(--color-surface-2, rgba(120,180,255,0.08))',
        borderRadius: 4,
        fontSize: 12,
      }}
    >
      <strong>Patch</strong>
      {message.patchHash && (
        <code style={{ marginLeft: 6, opacity: 0.6, fontSize: 10 }}>{message.patchHash.slice(0, 8)}</code>
      )}
      <ul style={{ margin: '4px 0 0 0', paddingLeft: 16 }}>
        {files.map((f) => (
          <li key={f}>
            <code>{f}</code>
          </li>
        ))}
      </ul>
    </div>
  )
}

function StepBubble({ message }: { message: CliAgentMessage }) {
  const isFinish = message.stepPhase === 'finish'
  return (
    <div
      className="cli-agent-msg cli-agent-msg--step"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        margin: '6px 0',
        padding: '4px 0',
        borderTop: '1px dashed var(--color-border, rgba(255,255,255,0.1))',
        fontSize: 11,
        opacity: 0.7,
      }}
    >
      <span>{isFinish ? '◼' : '▶'}</span>
      <span>{message.stepReason ?? message.content}</span>
      {isFinish && (
        <CostTokenBadge
          costUsd={message.costUsd}
          tokens={message.tokens}
          compact
          hideCost={message.backend === 'claude-code'}
        />
      )}
    </div>
  )
}

function SnapshotBubble({
  message,
  onRevert,
}: {
  message: CliAgentMessage
  onRevert?: (messageId: string) => void
}) {
  return (
    <div
      className="cli-agent-msg cli-agent-msg--snapshot"
      style={{
        margin: '4px 0',
        padding: '4px 8px',
        background: 'var(--color-surface-2, rgba(255,200,80,0.08))',
        borderRadius: 4,
        fontSize: 11,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <span>📌 Snapshot</span>
      {message.snapshotHash && (
        <code style={{ opacity: 0.6 }}>{message.snapshotHash.slice(0, 8)}</code>
      )}
      {onRevert && (
        <button
          onClick={() => onRevert(message.id)}
          style={{
            marginLeft: 'auto',
            fontSize: 10,
            padding: '1px 6px',
            background: 'transparent',
            border: '1px solid currentColor',
            borderRadius: 3,
            cursor: 'pointer',
          }}
        >
          Revert here
        </button>
      )}
    </div>
  )
}

function RetryBubble({ message }: { message: CliAgentMessage }) {
  return (
    <div
      className="cli-agent-msg cli-agent-msg--retry"
      style={{
        margin: '4px 0',
        padding: '4px 8px',
        background: 'var(--color-warning-bg, rgba(255,180,80,0.1))',
        borderRadius: 4,
        fontSize: 11,
      }}
    >
      ⚠ {message.content}
    </div>
  )
}

function CompactionBubble({ message }: { message: CliAgentMessage }) {
  return (
    <div
      className="cli-agent-msg cli-agent-msg--compaction"
      style={{
        margin: '4px 0',
        padding: '4px 8px',
        textAlign: 'center',
        fontSize: 10,
        opacity: 0.6,
      }}
    >
      ─── {message.content} {message.compactionAuto ? '(auto)' : ''} ───
    </div>
  )
}

function AgentChangeBubble({ message }: { message: CliAgentMessage }) {
  return (
    <div
      className="cli-agent-msg cli-agent-msg--agent-change"
      style={{
        margin: '4px 0',
        padding: '2px 8px',
        fontSize: 11,
        opacity: 0.7,
      }}
    >
      🤖 Agent → <strong>{message.agentName ?? message.content}</strong>
    </div>
  )
}

function SubtaskBubble({ message }: { message: CliAgentMessage }) {
  return (
    <div
      className="cli-agent-msg cli-agent-msg--subtask"
      style={{
        margin: '4px 0 4px 16px',
        padding: '4px 8px',
        borderLeft: '2px solid var(--color-accent, #5b9)',
        fontSize: 12,
      }}
    >
      <strong>Subtask</strong>
      {message.subtaskAgent && <em style={{ marginLeft: 4 }}>({message.subtaskAgent})</em>}
      <div>{message.subtaskDescription ?? message.subtaskPrompt ?? message.content}</div>
    </div>
  )
}

function FileAttachmentBubble({ message }: { message: CliAgentMessage }) {
  return (
    <div
      className="cli-agent-msg cli-agent-msg--file"
      style={{
        margin: '4px 0',
        padding: '4px 8px',
        background: 'var(--color-surface-2, rgba(255,255,255,0.05))',
        borderRadius: 4,
        fontSize: 12,
        display: 'inline-flex',
        gap: 6,
      }}
    >
      📎 <code>{message.fileName ?? message.fileUrl ?? message.content}</code>
      {message.fileMime && <span style={{ opacity: 0.5 }}>({message.fileMime})</span>}
    </div>
  )
}

export function isRichPartType(type: CliAgentMessage['type']): boolean {
  return (
    type === 'reasoning' ||
    type === 'patch' ||
    type === 'step' ||
    type === 'snapshot' ||
    type === 'retry' ||
    type === 'compaction' ||
    type === 'agent_change' ||
    type === 'subtask' ||
    type === 'file_attachment'
  )
}
