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

function ensureListener() {
  if (listening) return
  initPlatform()
  window.addEventListener('keydown', handleKeyDown, true)
  listening = true
}

// ── Shortcut string parser ─────────────────────

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
 * Parses a shortcut string into parts.
 * Supports single ("Cmd+B") and chord ("Cmd+K Cmd+S") formats.
 */
function parse(shortcut: string): ShortcutParts[] {
  const segments = shortcut.split(/\s+/)
  return segments.map(parseSingle)
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

// ── Keydown handler ────────────────────────────

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

function partsEqual(a: ShortcutParts, b: ShortcutParts): boolean {
  return a.key === b.key && a.meta === b.meta && a.shift === b.shift && a.alt === b.alt
}

// ── Conflict detection ─────────────────────────

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

// ── Public API ─────────────────────────────────

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
