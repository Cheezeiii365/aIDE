import { useState, useMemo } from 'react'
import { getAllCommands } from '../../lib/CommandRegistry'
import { getAllKeybindingRules } from '../../lib/KeybindingService'
import { formatKeybinding } from '../../lib/formatKeybinding'
import { useKeybindingOverrides } from '../../hooks/useKeybindingOverrides'
import { KeybindingRecorder } from './KeybindingRecorder'

interface ShortcutRow {
  commandId: string
  label: string
  category: string
  key: string
  when: string
  source: 'default' | 'user'
  overrideIndex: number // index in user overrides array, or -1 for defaults
}

export function KeyboardShortcutsTable() {
  const { overrides, loading, addOverride, removeOverride } = useKeybindingOverrides()
  const [searchQuery, setSearchQuery] = useState('')
  const [recordingRowKey, setRecordingRowKey] = useState<string | null>(null)

  const rows = useMemo((): ShortcutRow[] => {
    const commands = getAllCommands()
    const commandMap = new Map(commands.map((c) => [c.id, c]))
    const rules = getAllKeybindingRules()

    // Build rows from keybinding rules
    const ruleRows: ShortcutRow[] = rules.map((entry, _index) => {
      const cmd = commandMap.get(entry.rule.command)
      // Determine override index: find this rule in the user overrides array
      let overrideIndex = -1
      if (entry.source === 'user') {
        overrideIndex = overrides.findIndex(
          (o) => o.key === entry.rule.key && o.command === entry.rule.command && o.when === entry.rule.when,
        )
      }
      return {
        commandId: entry.rule.command,
        label: cmd?.label ?? entry.rule.command,
        category: cmd?.category ?? '',
        key: entry.rule.key,
        when: entry.rule.when ?? '',
        source: entry.source,
        overrideIndex,
      }
    })

    // Also include commands with no keybinding (palette-only)
    const boundCommands = new Set(rules.map((r) => r.rule.command))
    const unboundRows: ShortcutRow[] = commands
      .filter((cmd) => !boundCommands.has(cmd.id))
      .map((cmd) => ({
        commandId: cmd.id,
        label: cmd.label,
        category: cmd.category ?? '',
        key: '',
        when: '',
        source: 'default' as const,
        overrideIndex: -1,
      }))

    return [...ruleRows, ...unboundRows].sort((a, b) => {
      if (a.key && !b.key) return -1
      if (!a.key && b.key) return 1
      return a.label.localeCompare(b.label)
    })
  }, [overrides])

  const filteredRows = useMemo(() => {
    if (!searchQuery) return rows
    const lower = searchQuery.toLowerCase()
    return rows.filter(
      (row) =>
        row.label.toLowerCase().includes(lower) ||
        row.commandId.toLowerCase().includes(lower) ||
        row.key.toLowerCase().includes(lower) ||
        row.when.toLowerCase().includes(lower) ||
        row.category.toLowerCase().includes(lower),
    )
  }, [rows, searchQuery])

  if (loading) {
    return (
      <div className="settings-placeholder">
        <p>Loading keyboard shortcuts...</p>
      </div>
    )
  }

  return (
    <div className="shortcuts-table-container">
      <div className="shortcuts-search">
        <input
          type="text"
          className="settings-header__search-input"
          placeholder="Search keybindings..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button
            className="settings-header__search-clear"
            onClick={() => setSearchQuery('')}
          >
            ✕
          </button>
        )}
      </div>

      <div className="shortcuts-table-wrapper">
        <table className="shortcuts-table">
          <thead>
            <tr>
              <th className="shortcuts-th shortcuts-th--command">Command</th>
              <th className="shortcuts-th shortcuts-th--keybinding">Keybinding</th>
              <th className="shortcuts-th shortcuts-th--when">When</th>
              <th className="shortcuts-th shortcuts-th--source">Source</th>
              <th className="shortcuts-th shortcuts-th--actions"></th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row, idx) => (
              <tr
                key={`${row.commandId}-${row.key}-${idx}`}
                className={`shortcuts-row ${row.source === 'user' ? 'shortcuts-row--modified' : ''}`}
              >
                <td className="shortcuts-td shortcuts-td--command">
                  <span className="shortcuts-command-label">{row.label}</span>
                  {row.category && (
                    <span className="shortcuts-command-category">{row.category}</span>
                  )}
                </td>
                <td className="shortcuts-td shortcuts-td--keybinding">
                  {recordingRowKey === `${row.commandId}-${row.key}-${idx}` ? (
                    <KeybindingRecorder
                      commandId={row.commandId}
                      onRecord={(kb) => {
                        addOverride({ key: kb, command: row.commandId, when: row.when })
                        setRecordingRowKey(null)
                      }}
                      onCancel={() => setRecordingRowKey(null)}
                    />
                  ) : (
                    <button
                      className="shortcuts-keybinding-button"
                      onClick={() => setRecordingRowKey(`${row.commandId}-${row.key}-${idx}`)}
                      title="Click to change keybinding"
                    >
                      {row.key ? (
                        <kbd className="shortcuts-kbd">{formatKeybinding(row.key)}</kbd>
                      ) : (
                        <span className="shortcuts-kbd--empty">—</span>
                      )}
                    </button>
                  )}
                </td>
                <td className="shortcuts-td shortcuts-td--when">
                  {row.when && <code className="shortcuts-when">{row.when}</code>}
                </td>
                <td className="shortcuts-td shortcuts-td--source">
                  <span className={`shortcuts-source shortcuts-source--${row.source}`}>
                    {row.source === 'user' ? 'User' : 'Default'}
                  </span>
                </td>
                <td className="shortcuts-td shortcuts-td--actions">
                  {row.source === 'user' && row.overrideIndex >= 0 && (
                    <button
                      className="settings-row__reset"
                      onClick={() => removeOverride(row.overrideIndex)}
                      title="Reset to default"
                    >
                      ↩
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filteredRows.length === 0 && (
          <div className="settings-placeholder">
            <p>No matching keyboard shortcuts.</p>
          </div>
        )}
      </div>
    </div>
  )
}
