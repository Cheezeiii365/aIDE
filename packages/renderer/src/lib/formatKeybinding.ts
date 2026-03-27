/**
 * Normalize a keyboard shortcut string for compact, user-facing display.
 *
 * Cmd → ⌘, Shift → ⇧, Alt/Opt → ⌥, Ctrl → ⌃
 * Removes `+` separators and collapses whitespace.
 */
export function formatKeybinding(kb: string): string {
  return kb
    .replace(/Cmd/gi, '\u2318')
    .replace(/Ctrl/gi, '\u2303')
    .replace(/Shift/gi, '\u21E7')
    .replace(/Alt|Opt/gi, '\u2325')
    .replace(/\+/g, '')
    .replace(/\s+/g, ' ')
}
