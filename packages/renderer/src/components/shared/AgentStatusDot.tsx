interface AgentStatusDotProps {
  /** `blocked` = workspace needs input (e.g. tool approval) while unfocused. */
  status: 'idle' | 'running' | 'blocked' | 'error'
}

const STATUS_COLORS: Record<AgentStatusDotProps['status'], string> = {
  idle: 'var(--text-muted)',
  running: 'var(--text-success)',
  blocked: 'var(--accent, #d97706)',
  error: 'var(--text-error)',
}

export function AgentStatusDot({ status }: AgentStatusDotProps) {
  const pulse = status === 'running' || status === 'blocked'
  return (
    <span
      className={`agent-status-dot${pulse ? ' agent-status-dot--pulse' : ''}`}
      style={{ backgroundColor: STATUS_COLORS[status] }}
    />
  )
}
