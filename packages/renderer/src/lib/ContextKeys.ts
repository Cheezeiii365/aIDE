// ── Context key system ──────────────────────────
// Tracks boolean context keys (e.g. editorFocused, sidebarVisible)
// and evaluates when-clause expressions for command enablement.

type Listener = () => void

const keys: Map<string, boolean> = new Map()
const listeners: Set<Listener> = new Set()

export function setContext(key: string, value: boolean): void {
  if (keys.get(key) === value) return
  keys.set(key, value)
  for (const cb of listeners) cb()
}

export function getContext(key: string): boolean {
  return keys.get(key) ?? false
}

/**
 * Evaluate a simple when-clause expression.
 * Supports: bare keys, `!` negation, `&&` conjunction.
 * Example: "editorFocused && !inputFocused"
 */
export function evaluateWhen(expr: string | undefined): boolean {
  if (!expr) return true
  return expr
    .split('&&')
    .map((t) => t.trim())
    .every((term) => {
      if (term.startsWith('!')) return !getContext(term.slice(1).trim())
      return getContext(term)
    })
}

export function subscribe(callback: Listener): () => void {
  listeners.add(callback)
  return () => listeners.delete(callback)
}
