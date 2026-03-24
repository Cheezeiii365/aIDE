import { Compartment } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { oneDark } from '@codemirror/theme-one-dark'
import type { ThemeName } from '@aide/shared'

export const themeCompartment = new Compartment()

const baseTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '13px',
    fontFamily: "'SF Mono', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
  },
  '.cm-scroller': {
    overflow: 'auto',
  },
})

export function getThemeExtension(themeName: ThemeName): Extension {
  if (themeName === 'one-dark') {
    return [baseTheme, oneDark]
  }
  // Light theme — use CodeMirror's default light styling + our base overrides
  return [baseTheme]
}
