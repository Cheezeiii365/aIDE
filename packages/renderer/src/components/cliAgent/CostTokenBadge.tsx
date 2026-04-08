import type { CliAgentTokenUsage } from '@aide/shared'

export interface CostTokenBadgeProps {
  costUsd?: number | null
  tokens?: CliAgentTokenUsage | null
  compact?: boolean
  /**
   * Suppress the dollar-cost portion of the badge while still showing the
   * token breakdown. Used for the Claude Code CLI harness, which is billed
   * via subscription rather than per-token API pricing.
   */
  hideCost?: boolean
}

/** Small badge showing cumulative cost + tokens for a session or message. */
export function CostTokenBadge({ costUsd, tokens, compact, hideCost }: CostTokenBadgeProps) {
  const cost = typeof costUsd === 'number' ? costUsd : 0
  const hasCost = !hideCost && cost > 0
  const hasTokens = tokens && (tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite > 0)
  if (!hasCost && !hasTokens) return null

  const formatCost = (n: number) => {
    if (n < 0.0001) return '<$0.0001'
    if (n < 0.01) return `$${n.toFixed(4)}`
    if (n < 1) return `$${n.toFixed(3)}`
    return `$${n.toFixed(2)}`
  }

  const formatTokens = (n: number) => {
    if (n < 1000) return String(n)
    if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
    return `${(n / 1_000_000).toFixed(2)}M`
  }

  return (
    <span
      className="cli-agent-cost-token-badge"
      title={
        tokens
          ? `Input ${tokens.input.toLocaleString()} · Output ${tokens.output.toLocaleString()} · Reasoning ${tokens.reasoning.toLocaleString()} · Cache R ${tokens.cacheRead.toLocaleString()} W ${tokens.cacheWrite.toLocaleString()}`
          : 'Cost'
      }
      style={{
        display: 'inline-flex',
        gap: 6,
        padding: compact ? '1px 4px' : '2px 6px',
        fontSize: compact ? 10 : 11,
        borderRadius: 3,
        background: 'var(--color-surface-2, rgba(255,255,255,0.06))',
        color: 'var(--color-text-2, rgba(255,255,255,0.7))',
        whiteSpace: 'nowrap',
      }}
    >
      {hasCost && <span>{formatCost(cost)}</span>}
      {hasTokens && tokens && (
        <span>
          {formatTokens(tokens.input)}↑ {formatTokens(tokens.output)}↓
          {tokens.cacheRead > 0 ? ` ${formatTokens(tokens.cacheRead)}c` : ''}
        </span>
      )}
    </span>
  )
}
