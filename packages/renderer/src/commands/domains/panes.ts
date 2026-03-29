/**
 * @fileoverview Dockview pane and tab focus commands (MRU cycling, linear next/prev).
 *
 * All navigation goes through `DockviewNavigation` from context; no hard-coded panel ids here.
 */

import type { GetCommandContext } from '../context'
import type { CommandSpec } from './types'

/**
 * @returns `panel.close` plus `pane.*` / `pane.tab.*` navigation specs.
 */
export function collectPaneCommands(getCtx: GetCommandContext): CommandSpec[] {
  return [
    {
      def: { id: 'panel.close', label: 'Close Active Panel', category: 'Panel' },
      handler: () => {
        const api = getCtx().getDockviewApi()
        if (!api) return
        const active = api.activePanel
        active?.api.close()
      },
    },
    {
      def: { id: 'pane.cycleRecent', label: 'Cycle Recent Pane', category: 'Pane' },
      handler: () => getCtx().getDockviewNavigation()?.focusPaneRecent(1),
    },
    {
      def: { id: 'pane.cycleRecentReverse', label: 'Cycle Recent Pane Backward', category: 'Pane' },
      handler: () => getCtx().getDockviewNavigation()?.focusPaneRecent(-1),
    },
    {
      def: { id: 'pane.focusNext', label: 'Focus Next Pane', category: 'Pane' },
      handler: () => getCtx().getDockviewNavigation()?.focusPaneLinear(1),
    },
    {
      def: { id: 'pane.focusPrevious', label: 'Focus Previous Pane', category: 'Pane' },
      handler: () => getCtx().getDockviewNavigation()?.focusPaneLinear(-1),
    },
    {
      def: { id: 'pane.tab.cycleRecent', label: 'Cycle Recent Tab In Pane', category: 'Pane' },
      handler: () => getCtx().getDockviewNavigation()?.focusTabRecent(1),
    },
    {
      def: { id: 'pane.tab.cycleRecentReverse', label: 'Cycle Recent Tab In Pane Backward', category: 'Pane' },
      handler: () => getCtx().getDockviewNavigation()?.focusTabRecent(-1),
    },
    {
      def: { id: 'pane.tab.focusNext', label: 'Focus Next Tab In Pane', category: 'Pane' },
      handler: () => getCtx().getDockviewNavigation()?.focusTabLinear(1),
    },
    {
      def: { id: 'pane.tab.focusPrevious', label: 'Focus Previous Tab In Pane', category: 'Pane' },
      handler: () => getCtx().getDockviewNavigation()?.focusTabLinear(-1),
    },
  ]
}
