import { useEffect, useRef } from 'react'
import type { KeybindingRule } from '@aide/shared'
import { evaluateWhen } from './ContextKeys'
import { executeCommand } from './CommandRegistry'

// ── Types ──────────────────────────────────────

interface ShortcutParts {
  key: string
  meta: boolean
  shift: boolean
  alt: boolean
}

type RuleSource = 'default' | 'user'

interface ResolvedRule {
  rule: KeybindingRule
  parts: ShortcutParts[]  // length 1 = single, length 2 = chord
  source: RuleSource
  suppressed: boolean     // marked true by negative-rule preprocessing
}

// ── Platform detection ─────────────────────────

let isMac = true
function initPlatform() {
  try {
    isMac = window.api.platform === 'darwin'
  } catch {
    // preload not ready yet
  }
}

// ── Singleton state ────────────────────────────

let rules: ResolvedRule[] = []
let listening = false

// Chord state
let pendingChord: { parts: ShortcutParts; timestamp: number } | null = null
const CHORD_TIMEOUT = 1500

// ── Listener setup ─────────────────────────────

function ensureListener() {
  if (listening) return
  initPlatform()
  window.addEventListener('keydown', handleKeyDown, true)
  listening = true
}

// ── Parsing ────────────────────────────────────

function parseSingle(segment: string): ShortcutParts {
  const tokens = segment
    .split('+')
    .map((p) => p.trim().toLowerCase())

  return {
    meta: tokens.includes('cmd') || tokens.includes('ctrl'),
    shift: tokens.includes('shift'),
    alt: tokens.includes('alt') || tokens.includes('opt'),
    key: tokens.filter((p) => !['cmd', 'ctrl', 'shift', 'alt', 'opt'].includes(p))[0] ?? '',
  }
}

function parse(shortcut: string): ShortcutParts[] {
  return shortcut.split(/\s+/).map(parseSingle)
}

function partsMatch(parts: ShortcutParts, e: KeyboardEvent): boolean {
  const modKey = isMac ? e.metaKey : e.ctrlKey
  return (
    parts.meta === modKey &&
    parts.shift === e.shiftKey &&
    parts.alt === e.altKey &&
    parts.key === e.key.toLowerCase()
  )
}

function partsEqual(a: ShortcutParts, b: ShortcutParts): boolean {
  return a.key === b.key && a.meta === b.meta && a.shift === b.shift && a.alt === b.alt
}

function partsToString(parts: ShortcutParts): string {
  const tokens: string[] = []
  if (parts.meta) tokens.push('Cmd')
  if (parts.shift) tokens.push('Shift')
  if (parts.alt) tokens.push('Alt')
  if (parts.key) tokens.push(parts.key.length === 1 ? parts.key.toUpperCase() : capitalize(parts.key))
  return tokens.join('+')
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ── Negative rule preprocessing (VS Code handleRemovals pattern) ──

function processRemovals(allRules: ResolvedRule[]): void {
  // Collect negative rules
  const removals: ResolvedRule[] = []
  for (const r of allRules) {
    if (r.rule.command.startsWith('-')) {
      removals.push(r)
      r.suppressed = true // negative rules themselves don't dispatch
    }
  }

  // For each removal, suppress matching default rules
  for (const removal of removals) {
    const targetCommand = removal.rule.command.slice(1) // strip leading `-`
    for (const r of allRules) {
      if (r.suppressed) continue
      if (r.rule.command !== targetCommand) continue
      if (r.parts.length !== removal.parts.length) continue
      const chordsMatch = r.parts.every((p, i) => partsEqual(p, removal.parts[i]))
      if (!chordsMatch) continue
      // When clauses must match (both undefined = match)
      if (r.rule.when === removal.rule.when) {
        r.suppressed = true
      }
    }
  }
}

// ── Core API ───────────────────────────────────

/**
 * Load keybinding rules. Concatenates defaults + user overrides.
 * User rules go last so they win (last-match-wins dispatch).
 * Call this on init and whenever overrides change.
 */
export function loadKeybindings(
  defaults: KeybindingRule[],
  userOverrides: KeybindingRule[] = [],
): void {
  ensureListener()

  const resolved: ResolvedRule[] = [
    ...defaults.map((rule) => ({
      rule,
      parts: parse(rule.key),
      source: 'default' as RuleSource,
      suppressed: false,
    })),
    ...userOverrides.map((rule) => ({
      rule,
      parts: parse(rule.key),
      source: 'user' as RuleSource,
      suppressed: false,
    })),
  ]

  processRemovals(resolved)
  rules = resolved
}

/**
 * Get all active (non-suppressed) keybinding rules for a given command.
 * Used by CommandPalette and KeyboardShortcutsTable for display.
 */
export function getKeybindingsForCommand(commandId: string): KeybindingRule[] {
  return rules
    .filter((r) => !r.suppressed && r.rule.command === commandId)
    .map((r) => r.rule)
}

/**
 * Get all keybinding rules (including suppressed) for the settings table.
 */
export function getAllKeybindingRules(): { rule: KeybindingRule; source: RuleSource; suppressed: boolean }[] {
  return rules
    .filter((r) => !r.rule.command.startsWith('-')) // hide negative rules from UI
    .map((r) => ({ rule: r.rule, source: r.source, suppressed: r.suppressed }))
}

/**
 * Format a KeybindingRule's key for display (e.g. "Cmd+K Cmd+S" → "Cmd+K Cmd+S").
 */
export function formatRuleKey(rule: KeybindingRule): string {
  const resolved = rules.find((r) => r.rule === rule)
  if (resolved) return resolved.parts.map(partsToString).join(' ')
  return parse(rule.key).map(partsToString).join(' ')
}

// ── Keydown dispatch ───────────────────────────

/**
 * Handles keydown events. Iterates rules in REVERSE (last match wins).
 * Evaluates `when` clauses, skips suppressed rules, fires executeCommand().
 */
function handleKeyDown(e: KeyboardEvent) {
  // ── Chord continuation ──
  if (pendingChord) {
    const elapsed = Date.now() - pendingChord.timestamp
    if (elapsed < CHORD_TIMEOUT) {
      // Try to match second part of any chord that started with pendingChord
      for (let i = rules.length - 1; i >= 0; i--) {
        const entry = rules[i]
        if (entry.suppressed) continue
        if (entry.parts.length !== 2) continue
        if (!partsEqual(entry.parts[0], pendingChord.parts)) continue
        if (partsMatch(entry.parts[1], e)) {
          if (!evaluateWhen(entry.rule.when)) continue
          e.preventDefault()
          e.stopPropagation()
          pendingChord = null
          executeCommand(entry.rule.command)
          return
        }
      }
    }
    // Chord timed out or no match — clear and fall through
    pendingChord = null
  }

  // ── Check if this keystroke starts a chord ──
  for (let i = rules.length - 1; i >= 0; i--) {
    const entry = rules[i]
    if (entry.suppressed) continue
    if (entry.parts.length !== 2) continue
    if (partsMatch(entry.parts[0], e)) {
      e.preventDefault()
      e.stopPropagation()
      pendingChord = { parts: entry.parts[0], timestamp: Date.now() }
      return
    }
  }

  // ── Single-key shortcut matching (last match wins) ──
  for (let i = rules.length - 1; i >= 0; i--) {
    const entry = rules[i]
    if (entry.suppressed) continue
    if (entry.parts.length !== 1) continue
    if (partsMatch(entry.parts[0], e)) {
      if (!evaluateWhen(entry.rule.when)) continue
      e.preventDefault()
      e.stopPropagation()
      executeCommand(entry.rule.command)
      return
    }
  }
}

// ── React hook ─────────────────────────────────

/**
 * Register a keybinding rule scoped to the component lifecycle.
 * Appended as a user-priority rule so it wins over defaults.
 */
export function useKeybinding(
  key: string,
  command: string,
  when?: string,
) {
  const ruleRef = useRef<ResolvedRule | null>(null)

  useEffect(() => {
    ensureListener()
    const rule: KeybindingRule = { key, command, when }
    const resolved: ResolvedRule = {
      rule,
      parts: parse(key),
      source: 'user',
      suppressed: false,
    }
    rules.push(resolved)
    ruleRef.current = resolved
    return () => {
      const idx = rules.indexOf(resolved)
      if (idx !== -1) rules.splice(idx, 1)
      ruleRef.current = null
    }
  }, [key, command, when])
}
