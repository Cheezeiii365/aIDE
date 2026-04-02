/**
 * @fileoverview Shell UI commands: sidebar, command palette, quick open, find-in-files, settings, markdown preview.
 *
 * Several handlers add or focus fixed-id Dockview panels (`findInFiles`, `settings`).
 */

import type { GetCommandContext } from '../context'
import type { CommandSpec } from './types'

/**
 * @returns View / search / preferences command specs.
 */
export function collectViewCommands(getCtx: GetCommandContext): CommandSpec[] {
  return [
    {
      def: { id: 'view.toggleSidebar', label: 'Toggle Sidebar', category: 'View' },
      handler: () => getCtx().toggleSidebar(),
    },
    {
      def: { id: 'commandPalette.open', label: 'Command Palette', category: 'View' },
      handler: () => getCtx().openCommandPalette(),
    },
    {
      def: { id: 'quickOpen.open', label: 'Quick Open', category: 'View' },
      handler: () => getCtx().openQuickOpen(),
    },
    {
      def: { id: 'search.findInFiles', label: 'Find in Files', category: 'Search' },
      handler: () => {
        const ctx = getCtx()
        const api = ctx.getDockviewApi()
        if (!api) return

        const existing = api.panels.find((p) => p.id === 'findInFiles')
        if (existing) {
          existing.api.setActive()
          return
        }

        const terminalPanel = api.panels.find(
          (p) => p.id === 'terminal' || p.id.startsWith('terminal-'),
        )

        api.addPanel({
          id: 'findInFiles',
          component: 'findInFiles',
          title: 'Find in Files',
          params: {
            workspaceRoot: ctx.getActiveWorktreeRoot() ?? '',
            workspaceId: ctx.getActiveWorkspaceId() ?? '',
          },
          position: terminalPanel ? { referencePanel: terminalPanel } : undefined,
        })
      },
    },
    {
      def: { id: 'settings.open', label: 'Open Settings', category: 'Preferences' },
      handler: () => {
        const api = getCtx().getDockviewApi()
        if (!api) return

        const existing = api.panels.find((p) => p.id === 'settings')
        if (existing) {
          existing.api.setActive()
          return
        }

        api.addPanel({
          id: 'settings',
          component: 'settingsPane',
          title: 'Settings',
          params: {},
        })
      },
    },
    {
      def: { id: 'markdown.togglePreview', label: 'Toggle Markdown Preview', category: 'Markdown' },
      handler: () => getCtx().toggleMarkdownPreview(),
    },
  ]
}
