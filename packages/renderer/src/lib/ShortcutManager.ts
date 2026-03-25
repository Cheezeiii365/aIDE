import { useEffect, useRef } from 'react'

// ── Types ──────────────────────────────────────

interface ShortcutEntry {
  id: string
  key: string // normalised lowercase letter, e.g. 'b', 't', 'w'
  meta: boolean // Cmd (macOS) or Ctrl (Linux/Windows)
  shift: boolean
  alt: boolean
  handler: () => unknown // return true = handled
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

function ensureListener() {
  if (listening) return
  initPlatform()
  window.addEventListener('keydown', handleKeyDown, true)
  listening = true
}

// ── Shortcut string parser ─────────────────────

/**
 * Parses a shortcut string like "Cmd+Shift+T" into its parts.
 * "Cmd" is normalised per-platform (metaKey on macOS, ctrlKey elsewhere).
 */
function parse(shortcut: string): Pick<ShortcutEntry, 'key' | 'meta' | 'shift' | 'alt'> {
  const parts = shortcut
    .split('+')
    .map((p) => p.trim().toLowerCase())

  return {
    meta: parts.includes('cmd') || parts.includes('ctrl'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt') || parts.includes('opt'),
    key: parts.filter((p) => !['cmd', 'ctrl', 'shift', 'alt', 'opt'].includes(p))[0] ?? '',
  }
}

// ── Keydown handler ────────────────────────────

function handleKeyDown(e: KeyboardEvent) {
  const modKey = isMac ? e.metaKey : e.ctrlKey

  for (const entry of shortcuts.values()) {
    if (
      entry.meta === modKey &&
      entry.shift === e.shiftKey &&
      entry.alt === e.altKey &&
      entry.key === e.key.toLowerCase()
    ) {
      e.preventDefault()
      e.stopPropagation()
      entry.handler()
      return
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
  const parsed = parse(shortcut)
  shortcuts.set(id, { id, ...parsed, handler })
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
