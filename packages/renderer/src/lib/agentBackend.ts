/**
 * Frontend helpers for the agent-backend taxonomy.
 *
 * Single source of truth for which backends count as "CLI" (external),
 * how to label them in the UI, and a stable color slug for badges. Keep
 * the renderer's switch statements out of feature files — they belong here.
 */

import type { AgentBackend, ExternalCliBackend } from '@aide/shared'

/** External CLI backends, in the order we render them in pickers. */
export const CLI_BACKENDS: readonly ExternalCliBackend[] = [
  'claude-code',
  'opencode',
  'codex',
] as const

export function isCliBackend(backend: AgentBackend): backend is ExternalCliBackend {
  return backend === 'claude-code' || backend === 'opencode' || backend === 'codex'
}

/** Human-facing label for tabs, headers, and command palette entries. */
export function backendLabel(backend: AgentBackend): string {
  switch (backend) {
    case 'claude-code': return 'Claude Code'
    case 'opencode':    return 'OpenCode'
    case 'codex':       return 'Codex'
    case 'built-in':    return 'Built-in'
    default:            return backend
  }
}

/** Compact lowercase label for inline badges in history/transcript rows. */
export function backendBadgeLabel(backend: AgentBackend): string {
  switch (backend) {
    case 'claude-code': return 'claude'
    case 'opencode':    return 'opencode'
    case 'codex':       return 'codex'
    case 'built-in':    return 'built-in'
    default:            return backend
  }
}
