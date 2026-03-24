import type { ITheme } from '@xterm/xterm'

function css(prop: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(prop).trim()
}

export function getXtermTheme(): ITheme {
  return {
    background: css('--bg-sunken'),
    foreground: css('--text-primary'),
    cursor: css('--text-primary'),
    cursorAccent: css('--bg-sunken'),
    selectionBackground: css('--bg-selection'),
    black: css('--bg-sunken'),
    red: css('--syntax-tag'),
    green: css('--syntax-string'),
    yellow: css('--syntax-number'),
    blue: css('--syntax-fn'),
    magenta: css('--syntax-keyword'),
    cyan: css('--text-info'),
    white: css('--text-primary'),
    brightBlack: css('--text-muted'),
    brightRed: css('--text-error'),
    brightGreen: css('--text-success'),
    brightYellow: css('--text-warning'),
    brightBlue: css('--accent'),
    brightMagenta: css('--syntax-keyword'),
    brightCyan: css('--text-info'),
    brightWhite: css('--text-selected'),
  }
}
