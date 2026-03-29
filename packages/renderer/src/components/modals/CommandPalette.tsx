import { useMemo } from 'react'
import { SearchPanel, type SearchPanelItem } from '../layout/SearchPanel'
import { getAllCommands, getRecentlyUsed, isEnabled, executeCommand } from '../../lib/commands/CommandRegistry'
import { getKeybindingsForCommand } from '../../lib/commands/KeybindingService'
import { formatKeybinding } from '../../lib/commands/formatKeybinding'

interface CommandPaletteProps {
  onClose: () => void
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

    return sorted.map((cmd) => {
      const bindings = getKeybindingsForCommand(cmd.id)
      const primaryKey = bindings.length > 0 ? bindings[bindings.length - 1].key : undefined
      return {
        id: cmd.id,
        label: cmd.category ? `${cmd.category}: ${cmd.label}` : cmd.label,
        description: primaryKey ? formatKeybinding(primaryKey) : undefined,
        searchText: `${cmd.category ? `${cmd.category} ` : ''}${cmd.label} ${cmd.id}`,
      }
    })
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
