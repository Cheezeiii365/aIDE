/**
 * Command system types shared between main and renderer.
 */

/** Pure command definition — no keybinding, no context. */
export interface CommandDefinition {
  id: string
  label: string
  category?: string
}

/**
 * A single keybinding rule in the ordered rule list.
 * Rules are evaluated last-match-wins: user overrides appended after defaults win.
 * Prefix command with `-` to suppress a default binding (negative rule).
 */
export interface KeybindingRule {
  key: string       // e.g. "Cmd+K" or "Cmd+K Cmd+S" (chord)
  command: string   // command id, or "-commandId" to negate
  when?: string     // when-clause expression evaluated against context keys
}
