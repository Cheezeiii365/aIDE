import { useMemo } from 'react'
import { SearchPanel, type SearchPanelItem } from './SearchPanel'
import { getAllCommands, getRecentlyUsed, isEnabled, executeCommand } from '../lib/CommandRegistry'

interface CommandPaletteProps {
  onClose: () => void
}

/**
 * Normalize a keyboard shortcut string for compact, user-facing display.
 *
 * @param kb - The raw keybinding string (for example, "Cmd+Shift+P")
 * @returns The formatted keybinding where `Cmd` → `⌘`, `Shift` → `⇧`, `Alt`/`Opt` → `⌥`, `+` characters are removed, and consecutive whitespace is collapsed to a single space
 */
function formatKeybinding(kb: string): string {
  // Normalise for display: Cmd → ⌘, Shift → ⇧, Alt → ⌥
  return kb
    .replace(/Cmd/gi, '\u2318')
    .replace(/Shift/gi, '\u21E7')
    .replace(/Alt|Opt/gi, '\u2325')
    .replace(/\+/g, '')
    .replace(/\s+/g, ' ')
}

/**
 * Render a command search panel that lists enabled commands and prioritizes recently used ones.
 *
 * The panel shows each command with an optional category-prefixed label and a formatted keybinding.
 *
 * @param onClose - Callback invoked when the palette is closed or after a command is selected
 * @returns A React element rendering a searchable list of enabled commands where recently used commands appear first, labels are prefixed by category when present, and keybindings are normalized for display
 */
export function CommandPalette({ onClose }: CommandPaletteProps) {
  const items = useMemo((): SearchPanelItem[] => {
    const commands = getAllCommands().filter((c) => isEnabled(c.id))
    const recent = new Set(getRecentlyUsed())

    // Sort: recently-used first, then alphabetical
    const sorted = [...commands].sort((a, b) => {
      const aRecent = recent.has(a.id)
      const bRecent = recent.has(b.id)
      if (aRecent && !bRecent) return -1
      if (!aRecent && bRecent) return 1
      return a.label.localeCompare(b.label)
    })

    return sorted.map((cmd) => ({
      id: cmd.id,
      label: cmd.category ? `${cmd.category}: ${cmd.label}` : cmd.label,
      description: cmd.keybinding ? formatKeybinding(cmd.keybinding) : undefined,
    }))
  }, [])

  return (
    <SearchPanel
      placeholder="Type a command..."
      items={items}
      onSelect={(item) => {
        executeCommand(item.id)
        onClose()
      }}
      onClose={onClose}
      emptyMessage="No matching commands"
    />
  )
}
