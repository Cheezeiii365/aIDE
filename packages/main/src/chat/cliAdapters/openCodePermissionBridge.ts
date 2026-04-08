/**
 * IDE ↔ OpenCode permission bridge.
 *
 * Two responsibilities:
 *
 * 1. **Pre-flight** (`buildOpenCodePermissionConfig`): convert the IDE's
 *    `agent.permissionTier` + `agent.autoApprove` settings into an OpenCode
 *    agent `permission` config block. Pushed to the SDK once at session
 *    start so OpenCode itself short-circuits cheap cases.
 *
 * 2. **Runtime** (`decideOpenCodePermission`): when OpenCode raises a
 *    `permission.updated` event mid-turn, decide whether to auto-allow,
 *    auto-deny, or prompt the user. Uses the same `evaluatePermission`
 *    logic as the built-in `AgentManager`, with a category mapping from
 *    OpenCode's permission categories ('edit' / 'bash' / 'webfetch' / …)
 *    to the IDE's tool names ('file_write' / 'terminal_exec' / …).
 */

import type { PermissionTier, ToolPermissionConfig } from '@aide/shared'
import { evaluatePermission } from '../permissionMatching'

/**
 * OpenCode agent permission categories accepted by the SDK
 * (see `@opencode-ai/sdk` AgentConfig.permission).
 */
export type OpenCodePermissionCategory =
  | 'edit'
  | 'bash'
  | 'webfetch'
  | 'doom_loop'
  | 'external_directory'

export type OpenCodePermissionDecision = 'allow' | 'ask' | 'deny'
export type OpenCodePermissionResponse = 'always' | 'once' | 'reject'

/**
 * Map an OpenCode permission category onto the IDE tool name used by
 * `agent.autoApprove`. The mapping is intentionally narrow — IDE tool names
 * with no OpenCode counterpart simply have no auto-approve effect on
 * OpenCode-side prompts.
 */
const CATEGORY_TO_IDE_TOOL: Record<OpenCodePermissionCategory, string> = {
  edit: 'file_write',
  bash: 'terminal_exec',
  webfetch: 'browser_read',
  doom_loop: 'doom_loop',
  external_directory: 'external_directory',
}

/** Inverse for diagnostic / fall-through use. */
export function ideToolNameForCategory(category: string): string {
  return (CATEGORY_TO_IDE_TOOL as Record<string, string>)[category] ?? category
}

/**
 * Build an OpenCode `agent.permission` config block from the IDE settings.
 *
 * Tier rules:
 *   - `autopilot`    → all 'allow'
 *   - `auto-approve` → 'webfetch' (read-only) → 'allow'; 'edit' / 'bash' / others → 'ask'
 *   - `confirm`      → all 'ask'
 *
 * `autoApprove` overrides:
 *   - `true`              → 'allow' for that category
 *   - `false`             → 'deny'  for that category
 *   - patterns (object)   → 'ask'   (we still need the runtime decision)
 */
export function buildOpenCodePermissionConfig(
  tier: PermissionTier,
  autoApprove: Record<string, boolean | ToolPermissionConfig>,
): Record<OpenCodePermissionCategory, OpenCodePermissionDecision> {
  const out = {} as Record<OpenCodePermissionCategory, OpenCodePermissionDecision>
  const categories: OpenCodePermissionCategory[] = [
    'edit',
    'bash',
    'webfetch',
    'doom_loop',
    'external_directory',
  ]

  for (const category of categories) {
    const ideTool = CATEGORY_TO_IDE_TOOL[category]
    const override = autoApprove[ideTool]

    if (override === true) {
      out[category] = 'allow'
      continue
    }
    if (override === false) {
      out[category] = 'deny'
      continue
    }
    if (typeof override === 'object' && override !== null) {
      // Pattern config — still need runtime evaluation for each call.
      out[category] = 'ask'
      continue
    }

    switch (tier) {
      case 'autopilot':
        out[category] = 'allow'
        break
      case 'auto-approve':
        // Only webfetch is "read-only" in IDE terms
        out[category] = category === 'webfetch' ? 'allow' : 'ask'
        break
      case 'confirm':
      default:
        out[category] = 'ask'
        break
    }
  }
  return out
}

export interface DecideInput {
  category: string
  pattern?: string | string[]
  metadata?: Record<string, unknown>
}

/**
 * Decide what to do with a runtime OpenCode permission request. Returns
 * `'prompt'` when the user must be asked; otherwise returns the OpenCode
 * response value to POST back.
 */
export function decideOpenCodePermission(
  input: DecideInput,
  tier: PermissionTier,
  autoApprove: Record<string, boolean | ToolPermissionConfig>,
): OpenCodePermissionResponse | 'prompt' {
  const ideTool = ideToolNameForCategory(input.category)
  const matchInput = buildMatchInput(input)

  const decision = evaluatePermission(ideTool, matchInput, tier, autoApprove)
  if (decision === 'allow') return 'always'
  if (decision === 'deny') return 'reject'
  return 'prompt'
}

function buildMatchInput(input: DecideInput): Record<string, unknown> {
  // For bash-like categories, the pattern is the shell command(s) — feed it as
  // `command` so the existing matchTargetFor() shortcut for terminal_exec
  // matches against the command string.
  if (input.category === 'bash') {
    if (Array.isArray(input.pattern)) {
      return { command: input.pattern.join(' && ') }
    }
    return { command: input.pattern ?? '' }
  }

  // For edit / webfetch / external_directory, treat the pattern as a path/URL
  // and stringify the whole input so glob patterns can match against it.
  return {
    pattern: input.pattern,
    ...input.metadata,
  }
}
