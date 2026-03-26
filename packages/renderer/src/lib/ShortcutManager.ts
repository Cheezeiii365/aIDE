import { useEffect, useRef } from 'react'

// ── Types ──────────────────────────────────────

interface ShortcutParts {
  key: string
  meta: boolean
  shift: boolean
  alt: boolean
}

interface ShortcutEntry {
  id: string
  parts: ShortcutParts[] // length 1 = single, length 2 = chord
  handler: () => unknown
}

// ── Platform detection ─────────────────────────

let isMac = true // safe default; updated on init
function initPlatform() {
  try {
    isMac = window.api.platform === 'darwin'
  } catch {
    // preload not ready yet — keep default
  }
}

// ── Singleton state ────────────────────────────

const shortcuts: Map<string, ShortcutEntry> = new Map()
let listening = false

// Chord state
let pendingChord: { parts: ShortcutParts; timestamp: number } | null = null
const CHORD_TIMEOUT = 1500

/**
 * Ensures the global keydown listener for shortcut handling is installed.
 *
 * Calls initPlatform(), registers the window 'keydown' listener in the capture phase if not already installed, and marks the manager as listening.
 */
function ensureListener() {
  if (listening) return
  initPlatform()
  window.addEventListener('keydown', handleKeyDown, true)
  listening = true
}

/**
 * Parse a single shortcut segment into its modifier flags and key.
 *
 * @param segment - A single segment of a shortcut (e.g. "Cmd+K", "Shift+Alt+X"); tokens are trimmed and treated case-insensitively
 * @returns An object with:
 *  - `meta`: `true` if `cmd` or `ctrl` was present,
 *  - `shift`: `true` if `shift` was present,
 *  - `alt`: `true` if `alt` or `opt` was present,
 *  - `key`: the first non-modifier token lowercased, or an empty string if none
 */

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

/**
 * Parses a keyboard shortcut string into its constituent parts.
 *
 * @returns An array of one or two `ShortcutParts` objects; length `1` represents a single-key shortcut, length `2` represents a two-key chord
 */
function parse(shortcut: string): ShortcutParts[] {
  const segments = shortcut.split(/\s+/)
  return segments.map(parseSingle)
}

/**
 * Determines whether a keyboard event matches the expected shortcut parts.
 *
 * @param parts - Expected shortcut components: key (lowercase) and modifier booleans (`meta`, `shift`, `alt`)
 * @param e - The keyboard event to test
 * @returns `true` if `e`'s key and modifier state match `parts`, `false` otherwise
 */
function partsMatch(parts: ShortcutParts, e: KeyboardEvent): boolean {
  const modKey = isMac ? e.metaKey : e.ctrlKey
  return (
    parts.meta === modKey &&
    parts.shift === e.shiftKey &&
    parts.alt === e.altKey &&
    parts.key === e.key.toLowerCase()
  )
}

/**
 * Processes global keydown events to trigger registered shortcuts and manage two-key chords.
 *
 * If a chord is pending and its second part is pressed within CHORD_TIMEOUT, the matching chord handler is invoked.
 * If no pending chord matches, a keystroke that matches a chord's first part begins a pending chord; otherwise, a matching single-key shortcut handler is invoked.
 * When a shortcut or chord part is matched, the event's default is prevented and propagation is stopped; the pending chord state is set or cleared as appropriate.
 *
 * @param e - The KeyboardEvent from the global keydown listener
 */

function handleKeyDown(e: KeyboardEvent) {
  // Check chord continuation first
  if (pendingChord) {
    const elapsed = Date.now() - pendingChord.timestamp
    if (elapsed < CHORD_TIMEOUT) {
      // Try to match second part of any chord that started with pendingChord
      for (const entry of shortcuts.values()) {
        if (entry.parts.length !== 2) continue
        if (!partsEqual(entry.parts[0], pendingChord.parts)) continue
        if (partsMatch(entry.parts[1], e)) {
          e.preventDefault()
          e.stopPropagation()
          pendingChord = null
          entry.handler()
          return
        }
      }
    }
    // Chord timed out or no match — clear and fall through to single-key matching
    pendingChord = null
  }

  // Check if this keystroke is the first part of any chord
  for (const entry of shortcuts.values()) {
    if (entry.parts.length !== 2) continue
    if (partsMatch(entry.parts[0], e)) {
      e.preventDefault()
      e.stopPropagation()
      pendingChord = { parts: entry.parts[0], timestamp: Date.now() }
      return
    }
  }

  // Single-key shortcut matching
  for (const entry of shortcuts.values()) {
    if (entry.parts.length !== 1) continue
    if (partsMatch(entry.parts[0], e)) {
      e.preventDefault()
      e.stopPropagation()
      entry.handler()
      return
    }
  }
}

/**
 * Check whether two ShortcutParts represent the same key combination.
 *
 * @param a - The first shortcut part to compare
 * @param b - The second shortcut part to compare
 * @returns `true` if `key`, `meta`, `shift`, and `alt` are equal in both parts, `false` otherwise
 */
function partsEqual(a: ShortcutParts, b: ShortcutParts): boolean {
  return a.key === b.key && a.meta === b.meta && a.shift === b.shift && a.alt === b.alt
}

/**
 * Warns when a newly registered shortcut has the same parts sequence as an existing shortcut.
 *
 * @param id - The identifier of the shortcut being registered
 * @param newParts - The parsed shortcut parts to check (array length 1 for a single key, 2 for a two-key chord)
 */

function checkConflict(id: string, newParts: ShortcutParts[]) {
  for (const entry of shortcuts.values()) {
    if (entry.id === id) continue
    if (entry.parts.length !== newParts.length) continue
    const allMatch = entry.parts.every((p, i) => partsEqual(p, newParts[i]))
    if (allMatch) {
      console.warn(
        `[ShortcutManager] Keybinding conflict: "${id}" overrides "${entry.id}"`,
      )
    }
  }
}

/**
 * Register a global keyboard shortcut with a unique identifier.
 *
 * Registers a single-key shortcut or a two-key chord (two segments separated by whitespace) and stores or overwrites the binding for `id`.
 *
 * @param id - Unique identifier for the shortcut binding
 * @param shortcut - Shortcut string, e.g. "Cmd+K" for a single key or "Cmd+K Cmd+S" for a chord; supported modifier tokens: `cmd`/`ctrl`, `shift`, `alt`/`opt`
 * @param handler - Function invoked when the shortcut is triggered
 */

export function registerShortcut(
  id: string,
  shortcut: string,
  handler: () => unknown,
) {
  ensureListener()
  const parts = parse(shortcut)
  checkConflict(id, parts)
  shortcuts.set(id, { id, parts, handler })
}

/**
 * Unregisters a previously registered keyboard shortcut.
 *
 * @param id - Identifier of the shortcut to remove
 */
export function unregisterShortcut(id: string) {
  shortcuts.delete(id)
}

// ── React hook ─────────────────────────────────

/**
 * Register a keyboard shortcut scoped to the component lifecycle.
 *
 * @example
 * useShortcut('new-terminal', 'Cmd+Shift+T', () => { ... })
 */
export function useShortcut(
  id: string,
  shortcut: string,
  handler: () => unknown,
) {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    registerShortcut(id, shortcut, () => handlerRef.current())
    return () => unregisterShortcut(id)
  }, [id, shortcut])
}
