/**
 * @fileoverview Terminal commands — currently `terminal.new` only.
 *
 * New terminals stack beside an existing terminal panel when one exists.
 */

import { createTerminalPanelParams } from '../../lib/terminal/terminalState'
import type { GetCommandContext } from '../context'
import type { CommandSpec } from './types'

/**
 * @returns Terminal-related command specs.
 */
export function collectTerminalCommands(getCtx: GetCommandContext): CommandSpec[] {
  return [
    {
      def: { id: 'terminal.new', label: 'New Terminal', category: 'Terminal' },
      handler: () => {
        const ctx = getCtx()
        const api = ctx.getDockviewApi()
        if (!api) return

        const id = `terminal-${Date.now()}`
        const existingTerminal = api.panels.find(
          (p) => p.id === 'terminal' || p.id.startsWith('terminal-'),
        )
        const position = existingTerminal
          ? { referencePanel: existingTerminal }
          : undefined

        api.addPanel({
          id,
          component: 'terminalPane',
          title: 'Terminal',
          params: createTerminalPanelParams(
            ctx.getActiveWorkspaceId() ?? undefined,
            ctx.getActiveWorktreeRoot() ?? undefined,
            'Terminal',
          ),
          position,
        })
        ctx.persistWorkspaceRuntime()
      },
    },
  ]
}
