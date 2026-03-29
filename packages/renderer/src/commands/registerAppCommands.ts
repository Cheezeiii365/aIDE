/**
 * @fileoverview Composition root: aggregates domain command lists and registers each with `registerCommand`.
 *
 * Called once from `AppShell` on mount. Individual handlers close over `getContext`, so they must
 * not capture `CommandContext` at registration time—only call `getContext()` when the user runs the command.
 */

import { registerCommand } from './CommandRegistry'
import type { GetCommandContext } from './context'
import { collectAideCommands } from './domains/aide'
import { collectAgentCommands } from './domains/agent'
import { collectBrowserCommands } from './domains/browser'
import { collectEditorCommands } from './domains/editor'
import { collectPaneCommands } from './domains/panes'
import { collectTaskCommands } from './domains/tasks'
import { collectTerminalCommands } from './domains/terminal'
import { collectViewCommands } from './domains/view'
import { collectWorkspaceCommands } from './domains/workspace'

/**
 * Registers every app-wide command id. Re-invoking overwrites the same ids (e.g. React strict mode double mount).
 *
 * @param getContext - Returns the current `CommandContext` (typically `() => commandContextRef.current!`).
 */
export function registerAppCommands(getContext: GetCommandContext): void {
  /** Order only affects registration sequence; runtime behavior is identical. */
  const collectors = [
    collectWorkspaceCommands,
    collectEditorCommands,
    collectPaneCommands,
    collectViewCommands,
    collectBrowserCommands,
    collectAgentCommands,
    collectTerminalCommands,
    collectTaskCommands,
    collectAideCommands,
  ]

  for (const collect of collectors) {
    for (const { def, handler } of collect(getContext)) {
      registerCommand(def, handler)
    }
  }
}
