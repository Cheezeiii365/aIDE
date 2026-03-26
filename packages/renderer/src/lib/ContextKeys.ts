// ── Context key system ──────────────────────────
// Tracks boolean context keys (e.g. editorFocused, sidebarVisible)
// and evaluates when-clause expressions for command enablement.

type Listener = () => void

const keys: Map<string, boolean> = new Map()
const listeners: Set<Listener> = new Set()

/**
 * Sets a boolean context key and notifies all subscribers if the value changed.
 *
 * @param key - The context key identifier
 * @param value - The boolean value to assign to the key
 */
export function setContext(key: string, value: boolean): void {
  if (keys.get(key) === value) return
  keys.set(key, value)
  for (const cb of listeners) cb()
}

/**
 * Retrieve the value associated with a context key.
 *
 * @param key - The context key name to read
 * @returns `true` if the key exists and is set to `true`, `false` otherwise.
 */
export function getContext(key: string): boolean {
  return keys.get(key) ?? false
}

/**
 * Evaluate a simple when-clause expression composed of `&&`-separated terms.
 *
 * Supports bare keys and `!` prefix negation; whitespace around terms is ignored.
 * An undefined or empty `expr` is treated as always satisfied.
 *
 * @returns `true` if the expression is satisfied (all terms evaluate to true), `false` otherwise.
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

/**
 * Register a listener to be notified when any context key changes.
 *
 * @param callback - The function invoked whenever the context registry is updated
 * @returns A function that removes the registered listener so it will no longer be notified
 */
export function subscribe(callback: Listener): () => void {
  listeners.add(callback)
  return () => listeners.delete(callback)
}
