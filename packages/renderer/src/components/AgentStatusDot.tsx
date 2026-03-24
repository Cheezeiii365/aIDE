interface AgentStatusDotProps {
  status: 'idle' | 'running' | 'error'
}

const STATUS_COLORS: Record<AgentStatusDotProps['status'], string> = {
  idle: 'var(--text-muted)',
  running: 'var(--text-success)',
  error: 'var(--text-error)',
}

export function AgentStatusDot({ status }: AgentStatusDotProps) {
  return (
    <span
      className={`agent-status-dot${status === 'running' ? ' agent-status-dot--pulse' : ''}`}
      style={{ backgroundColor: STATUS_COLORS[status] }}
    />
  )
}
