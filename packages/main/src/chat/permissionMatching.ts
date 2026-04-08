/**
 * Shared permission decision utilities.
 *
 * Lifted from `agentManager.ts` so both the built-in `AgentManager` and the
 * `CliAgentManager` (for OpenCode permission events) can apply the same
 * permission tier + autoApprove rules to tool/operation requests.
 *
 * The IDE's permission model lives in user settings:
 *   - `agent.permissionTier`: 'confirm' | 'auto-approve' | 'autopilot'
 *   - `agent.autoApprove`:    Record<toolName, boolean | { allowPatterns?, denyPatterns? }>
 */

import type { PermissionTier, ToolPermissionConfig } from '@aide/shared'

/**
 * IDE-canonical "read-only" tools — auto-approved under the `auto-approve`
 * tier. These are the tool names used by the built-in `AgentManager`. The
 * OpenCode permission bridge maps SDK permission categories onto these names
 * (see `openCodePermissionBridge.ts`).
 */
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  'file_read',
  'file_list',
  'search_files',
  'git_status',
  'git_diff',
  'browser_read',
])

/**
 * Decide whether a tool call should be auto-approved without prompting the user.
 *
 * Precedence (highest first):
 *   1. autoApprove[toolName] === false  → deny
 *   2. autoApprove[toolName] === true   → allow
 *   3. autoApprove[toolName] is a pattern config → glob match against input
 *   4. permissionTier:
 *        - 'autopilot'    → allow everything
 *        - 'auto-approve' → allow read-only tools, prompt for the rest
 *        - 'confirm'      → prompt for everything
 */
export function shouldAutoApprove(
  toolName: string,
  input: Record<string, unknown>,
  tier: PermissionTier,
  autoApprove: Record<string, boolean | ToolPermissionConfig>,
): boolean {
  const override = autoApprove[toolName]
  if (override === true) return true
  if (override === false) return false
  if (typeof override === 'object' && override !== null) {
    return matchesPatternConfig(override, toolName, input)
  }

  switch (tier) {
    case 'autopilot':
      return true
    case 'auto-approve':
      return READ_ONLY_TOOLS.has(toolName)
    case 'confirm':
    default:
      return false
  }
}

/**
 * Same as {@link shouldAutoApprove} but also distinguishes "explicitly denied"
 * (deny pattern matched) from "not matched, fall through". The OpenCode bridge
 * needs the three-way distinction to map onto OpenCode's `'always' | 'once'
 * | 'reject'` permission response.
 */
export function evaluatePermission(
  toolName: string,
  input: Record<string, unknown>,
  tier: PermissionTier,
  autoApprove: Record<string, boolean | ToolPermissionConfig>,
): 'allow' | 'deny' | 'prompt' {
  const override = autoApprove[toolName]
  if (override === false) return 'deny'
  if (override === true) return 'allow'
  if (typeof override === 'object' && override !== null) {
    const matchTarget = matchTargetFor(toolName, input)
    if (override.denyPatterns?.some((p) => globMatch(matchTarget, p))) return 'deny'
    if (override.allowPatterns && override.allowPatterns.length > 0) {
      return override.allowPatterns.some((p) => globMatch(matchTarget, p)) ? 'allow' : 'prompt'
    }
    return 'prompt'
  }

  switch (tier) {
    case 'autopilot':
      return 'allow'
    case 'auto-approve':
      return READ_ONLY_TOOLS.has(toolName) ? 'allow' : 'prompt'
    case 'confirm':
    default:
      return 'prompt'
  }
}

export function matchesPatternConfig(
  config: ToolPermissionConfig,
  toolName: string,
  input: Record<string, unknown>,
): boolean {
  const matchTarget = matchTargetFor(toolName, input)

  if (config.denyPatterns?.some((p) => globMatch(matchTarget, p))) {
    return false
  }
  if (config.allowPatterns && config.allowPatterns.length > 0) {
    return config.allowPatterns.some((p) => globMatch(matchTarget, p))
  }
  return false
}

function matchTargetFor(toolName: string, input: Record<string, unknown>): string {
  if (toolName === 'terminal_exec') {
    return String(input.command ?? '')
  }
  return JSON.stringify(input)
}

export function globMatch(text: string, pattern: string): boolean {
  // Simple glob: * matches any sequence of characters.
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp('^' + escaped.replace(/\*/g, '.*') + '$')
  return regex.test(text)
}
