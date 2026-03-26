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

// ── Public API ─────────────────────────────────

export function registerCommand(
  def: CommandDefinition,
  handler: () => void,
): void {
  commands.set(def.id, { ...def, handler })
  if (def.keybinding) {
    registerShortcut(def.id, def.keybinding, () => executeCommand(def.id))
  }
}

export function unregisterCommand(id: string): void {
  unregisterShortcut(id)
  commands.delete(id)
}

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

export function getAllCommands(): CommandEntry[] {
  return Array.from(commands.values())
}

export function getCommand(id: string): CommandEntry | undefined {
  return commands.get(id)
}

export function getRecentlyUsed(): string[] {
  return [...recentlyUsed]
}

export function isEnabled(id: string): boolean {
  const entry = commands.get(id)
  if (!entry) return false
  return evaluateWhen(entry.when)
}

// ── React hook ─────────────────────────────────

/**
 * Register a command scoped to the component lifecycle.
 *
 * @example
 * useCommand('view.toggleSidebar', {
 *   label: 'Toggle Sidebar',
 *   keybinding: 'Cmd+B',
 *   category: 'View',
 * }, () => setSidebarCollapsed(c => !c))
 */
export function useCommand(
  id: string,
  def: Omit<CommandDefinition, 'id'>,
  handler: () => void,
): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    registerCommand({ id, ...def }, () => handlerRef.current())
    return () => unregisterCommand(id)
  }, [id, def.keybinding])
}
