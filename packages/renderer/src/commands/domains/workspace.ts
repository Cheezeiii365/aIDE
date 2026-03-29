/**
 * @fileoverview Workspace ribbon commands: numeric switch, cycle, close, new blank, open folder.
 *
 * Bound to Cmd+1–9, Cmd+Shift+[/], Cmd+Shift+W/N, Cmd+O via `defaultKeybindings`.
 */

import type { GetCommandContext } from '../context'
import type { CommandSpec } from './types'

/**
 * @returns Command specs whose ids start with `workspace.`; handlers delegate to `CommandContext`.
 */
export function collectWorkspaceCommands(getCtx: GetCommandContext): CommandSpec[] {
  const specs: CommandSpec[] = []

  for (let n = 1; n <= 9; n++) {
    const index = n - 1
    specs.push({
      def: { id: `workspace.switchTo${n}`, label: `Switch to Workspace ${n}`, category: 'Workspace' },
      handler: () => {
        const ctx = getCtx()
        ctx.switchWorkspaceByIndex(index)
      },
    })
  }

  specs.push(
    {
      def: { id: 'workspace.close', label: 'Close Workspace', category: 'Workspace' },
      handler: () => getCtx().closeActiveWorkspace(),
    },
    {
      def: { id: 'workspace.new', label: 'New Workspace', category: 'Workspace' },
      handler: () => void getCtx().newBlankWorkspace(),
    },
    {
      def: { id: 'workspace.openFolder', label: 'Open Folder...', category: 'Workspace' },
      handler: () => void getCtx().openFolder(),
    },
    {
      def: { id: 'workspace.cycleTabNext', label: 'Next Workspace', category: 'Workspace' },
      handler: () => getCtx().cycleWorkspace(1),
    },
    {
      def: { id: 'workspace.cycleTabPrev', label: 'Previous Workspace', category: 'Workspace' },
      handler: () => getCtx().cycleWorkspace(-1),
    },
  )

  return specs
}
