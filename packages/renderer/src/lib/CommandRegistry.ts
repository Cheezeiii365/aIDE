import { useEffect, useRef } from 'react'
import type { CommandDefinition } from '@shared/index'
import { evaluateWhen } from './ContextKeys'
import { registerShortcut, unregisterShortcut } from './ShortcutManager'

// ── Types ──────────────────────────────────────

export interface CommandEntry extends CommandDefinition {
  handler: () => void
}

// ── Singleton state ────────────────────────────

const commands: Map<string, CommandEntry> = new Map()
const recentlyUsed: string[] = []
const MAX_RECENT = 20

/**
 * Register a command definition with its execution handler and optional keybinding.
 *
 * @param def - Command definition (must include `id`; may include `keybinding` and `when`)
 * @param handler - Callback invoked when the command is executed
 */

export function registerCommand(
  def: CommandDefinition,
  handler: () => void,
): void {
  commands.set(def.id, { ...def, handler })
  if (def.keybinding) {
    registerShortcut(def.id, def.keybinding, () => executeCommand(def.id))
  }
}

/**
 * Unregisters a command and its associated shortcut from the registry.
 *
 * @param id - The identifier of the command to remove
 */
export function unregisterCommand(id: string): void {
  unregisterShortcut(id)
  commands.delete(id)
}

/**
 * Executes the command with the given id if it is registered and its `when` condition evaluates to true.
 *
 * Invokes the command's handler and records the command as most-recently-used when executed.
 *
 * @param id - The command identifier to execute
 * @returns `true` if the command was found, its `when` condition passed, and the handler was invoked; `false` otherwise.
 */
export function executeCommand(id: string): boolean {
  const entry = commands.get(id)
  if (!entry) return false
  if (!evaluateWhen(entry.when)) return false
  entry.handler()
  // Track recency
  const idx = recentlyUsed.indexOf(id)
  if (idx !== -1) recentlyUsed.splice(idx, 1)
  recentlyUsed.unshift(id)
  if (recentlyUsed.length > MAX_RECENT) recentlyUsed.pop()
  return true
}

/**
 * Retrieve all commands currently registered in the registry.
 *
 * @returns An array containing every registered `CommandEntry` in insertion order
 */
export function getAllCommands(): CommandEntry[] {
  return Array.from(commands.values())
}

/**
 * Retrieve the registered command entry for a given command identifier.
 *
 * @param id - Command identifier to look up
 * @returns The `CommandEntry` associated with `id` if registered, `undefined` otherwise
 */
export function getCommand(id: string): CommandEntry | undefined {
  return commands.get(id)
}

/**
 * Retrieves a copy of the list of recently used command ids in most-recent-first order.
 *
 * @returns A shallow copy of the recently used command id array, ordered from most to least recent.
 */
export function getRecentlyUsed(): string[] {
  return [...recentlyUsed]
}

/**
 * Determine whether a registered command is currently enabled according to its `when` condition.
 *
 * @param id - The command identifier to check
 * @returns `true` if the command exists and its `when` condition evaluates to `true`, `false` otherwise
 */
export function isEnabled(id: string): boolean {
  const entry = commands.get(id)
  if (!entry) return false
  return evaluateWhen(entry.when)
}

// ── React hook ─────────────────────────────────

/**
 * Register a command scoped to the component lifecycle.
 *
 * Keeps the command registered while the component is mounted and automatically
 * unregisters it on unmount. The hook retains the latest `handler` reference so
 * updating `handler` does not trigger re-registration; changes to `id` or
 * `def.keybinding` will re-register.
 *
 * @param id - Unique command identifier
 * @param def - Command definition (omit `id`); changes to `def.keybinding` cause re-registration
 * @param handler - Function invoked when the command is executed
 */
export function useCommand(
  id: string,
  def: Omit<CommandDefinition, 'id'>,
  handler: () => void,
): void {
  const handlerRef = useRef(handler)
  const defRef = useRef(def)
  handlerRef.current = handler
  defRef.current = def

  useEffect(() => {
    registerCommand({ id, ...defRef.current }, () => handlerRef.current())
    return () => unregisterCommand(id)
  }, [id, def])
}
