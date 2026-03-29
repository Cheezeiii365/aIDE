/**
 * @fileoverview Central command registry for the renderer process.
 *
 * Holds a single `Map` of command id → metadata + synchronous handler. {@link registerAppCommands}
 * populates this map once at app startup; `KeybindingService` and the command palette call
 * `executeCommand` by id. Keybindings and `when` clauses live in KeybindingService and ContextKeys, not here.
 *
 * @see registerAppCommands
 * @see useCommand
 */

import { useEffect, useRef } from 'react'
import type { CommandDefinition } from '@shared/index'

// ── Types ──────────────────────────────────────

/** A registered command: shared {@link CommandDefinition} fields plus the runnable handler. */
export interface CommandEntry extends CommandDefinition {
  handler: () => void
}

// ── Singleton state ────────────────────────────

/** In-memory registry; last registration wins for a given id. */
const commands: Map<string, CommandEntry> = new Map()
/** Most-recently executed command ids (palette ordering); capped for memory. */
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
 * Register a command scoped to the component lifecycle (e.g. a pane-specific action).
 * App-wide commands should be registered once via `registerAppCommands` in AppShell.
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
