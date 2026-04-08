import type { GetCommandContext } from '../context'
import type { CommandSpec } from './types'

export function collectThemeCommands(getCtx: GetCommandContext): CommandSpec[] {
  return [
    {
      def: { id: 'theme.select', label: 'Select Color Theme', category: 'Preferences' },
      handler: () => getCtx().openThemePicker('active'),
    },
    {
      def: { id: 'theme.toggle', label: 'Toggle Color Theme', category: 'Preferences' },
      handler: () => getCtx().toggleTheme(),
    },
    {
      def: {
        id: 'theme.setDefaultDark',
        label: 'Set Default Dark Theme',
        category: 'Preferences',
      },
      handler: () => getCtx().openThemePicker('dark'),
    },
    {
      def: {
        id: 'theme.setDefaultLight',
        label: 'Set Default Light Theme',
        category: 'Preferences',
      },
      handler: () => getCtx().openThemePicker('light'),
    },
    {
      def: { id: 'theme.reload', label: 'Reload Themes', category: 'Preferences' },
      handler: () => {
        void getCtx().reloadThemes()
      },
    },
    {
      def: { id: 'theme.openFolder', label: 'Open Themes Folder', category: 'Preferences' },
      handler: () => {
        void getCtx().openThemesDirectory()
      },
    },
  ]
}
