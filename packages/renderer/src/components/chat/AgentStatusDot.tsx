import type { CliAgentProcessStatus } from '@aide/shared'
import '../../styles/agent-status-dot.css'

interface AgentStatusDotProps {
  status: CliAgentProcessStatus
}

const STATUS_LABELS: Record<CliAgentProcessStatus, string> = {
  stopped: 'Stopped',
  starting: 'Starting',
  running: 'Running',
  rate_limited: 'Rate limited',
  error: 'Error',
  stopping: 'Stopping',
}

export function AgentStatusDot({ status }: AgentStatusDotProps) {
  return (
    <span
      className={`agent-status-dot agent-status-dot--${status}`}
      title={STATUS_LABELS[status]}
    />
  )
}
