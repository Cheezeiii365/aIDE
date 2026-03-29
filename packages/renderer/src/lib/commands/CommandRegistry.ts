import { useEffect, useRef } from 'react'
import type { CommandDefinition } from '@shared/index'

// ── Types ──────────────────────────────────────

export interface CommandEntry extends CommandDefinition {
  handler: () => void
}

// ── Singleton state ────────────────────────────

const commands: Map<string, CommandEntry> = new Map()
const recentlyUsed: string[] = []
const MAX_RECENT = 20

/**
 * Register a command with its execution handler.
 * Commands are pure actions — keybindings are managed separately by KeybindingService.
 */
export function registerCommand(
  def: CommandDefinition,
  handler: () => void,
): void {
  commands.set(def.id, { ...def, handler })
}

/**
 * Unregisters a command from the registry.
 */
export function unregisterCommand(id: string): void {
  commands.delete(id)
}

/**
 * Executes the command with the given id.
 * No `when` check — context gating is handled by KeybindingService at dispatch time.
 * Programmatic calls (command palette, API) always execute.
 */
export function executeCommand(id: string): boolean {
  const entry = commands.get(id)
  if (!entry) return false
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
 */
export function getAllCommands(): CommandEntry[] {
  return Array.from(commands.values())
}

/**
 * Retrieve the registered command entry for a given command identifier.
 */
export function getCommand(id: string): CommandEntry | undefined {
  return commands.get(id)
}

/**
 * Retrieves a copy of the list of recently used command ids in most-recent-first order.
 */
export function getRecentlyUsed(): string[] {
  return [...recentlyUsed]
}

/**
 * Check whether a command is registered.
 */
export function isEnabled(id: string): boolean {
  return commands.has(id)
}

// ── React hook ─────────────────────────────────

/**
 * Register a command scoped to the component lifecycle.
 * Keybindings are separate — use defaultKeybindings.ts or user overrides.
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
