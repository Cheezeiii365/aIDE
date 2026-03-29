/**
 * @fileoverview Browser pane commands: new pane (modal), back/forward/reload on the focused browser.
 *
 * Navigation IPC calls use the active browser pane id from context (kept in sync in AppShell).
 */

import type { GetCommandContext } from '../context'
import type { CommandSpec } from './types'

/**
 * @returns `browser.*` command specs.
 */
export function collectBrowserCommands(getCtx: GetCommandContext): CommandSpec[] {
  return [
    {
      def: { id: 'browser.new', label: 'New Browser Pane', category: 'Browser' },
      handler: () => {
        if (!getCtx().getActiveWorkspaceId()) return
        getCtx().openNewBrowserModal()
      },
    },
    {
      def: { id: 'browser.back', label: 'Browser Back', category: 'Browser' },
      handler: () => {
        const id = getCtx().getActiveBrowserPaneId()
        if (id) window.api.browserGoBack(id)
      },
    },
    {
      def: { id: 'browser.forward', label: 'Browser Forward', category: 'Browser' },
      handler: () => {
        const id = getCtx().getActiveBrowserPaneId()
        if (id) window.api.browserGoForward(id)
      },
    },
    {
      def: { id: 'browser.reload', label: 'Browser Reload', category: 'Browser' },
      handler: () => {
        const id = getCtx().getActiveBrowserPaneId()
        if (id) window.api.browserReload(id)
      },
    },
  ]
}
