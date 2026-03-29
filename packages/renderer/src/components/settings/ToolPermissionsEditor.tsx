import { useState } from 'react'
import type { ToolPermissionConfig } from '@aide/shared'

interface Props {
  value: Record<string, boolean | ToolPermissionConfig>
  onChange: (value: Record<string, boolean | ToolPermissionConfig>) => void
}

const KNOWN_TOOLS = [
  { name: 'file_read', label: 'Read Files' },
  { name: 'file_write', label: 'Write Files' },
  { name: 'file_list', label: 'List Directory' },
  { name: 'search_files', label: 'Search Files' },
  { name: 'git_status', label: 'Git Status' },
  { name: 'git_diff', label: 'Git Diff' },
  { name: 'terminal_exec', label: 'Terminal Execute' },
  { name: 'browser_read', label: 'Browser Read' },
] as const

type OverrideState = 'default' | 'always-approve' | 'always-confirm' | 'patterns'

function getOverrideState(value: boolean | ToolPermissionConfig | undefined): OverrideState {
  if (value === undefined) return 'default'
  if (value === true) return 'always-approve'
  if (value === false) return 'always-confirm'
  return 'patterns'
}

export function ToolPermissionsEditor({ value, onChange }: Props) {
  const [expandedTool, setExpandedTool] = useState<string | null>(null)

  function handleSelectChange(toolName: string, state: OverrideState) {
    const next = { ...value }
    if (state === 'default') {
      delete next[toolName]
    } else if (state === 'always-approve') {
      next[toolName] = true
    } else if (state === 'always-confirm') {
      next[toolName] = false
    } else if (state === 'patterns') {
      next[toolName] = { allowPatterns: [], denyPatterns: [] }
      setExpandedTool(toolName)
    }
    onChange(next)
  }

  function handlePatternsChange(toolName: string, field: 'allowPatterns' | 'denyPatterns', text: string) {
    const patterns = text.split('\n').map((s) => s.trim()).filter(Boolean)
    const existing = typeof value[toolName] === 'object' ? value[toolName] as ToolPermissionConfig : {}
    const next = { ...value, [toolName]: { ...existing, [field]: patterns } }
    onChange(next)
  }

  return (
    <div className="tool-permissions-editor">
      <div className="settings-row__info" style={{ marginBottom: 8 }}>
        <span className="settings-row__description">
          Override the permission tier for individual tools. "Default" inherits the tier setting above.
        </span>
      </div>
      <table className="tool-permissions-table">
        <thead>
          <tr>
            <th>Tool</th>
            <th>Permission</th>
          </tr>
        </thead>
        <tbody>
          {KNOWN_TOOLS.map((tool) => {
            const state = getOverrideState(value[tool.name])
            const showPatterns = state === 'patterns' || (expandedTool === tool.name && state === 'patterns')
            const patternConfig = typeof value[tool.name] === 'object' ? value[tool.name] as ToolPermissionConfig : {}

            return (
              <tr key={tool.name}>
                <td className="tool-permissions-table__name">
                  <code>{tool.name}</code>
                  <span className="tool-permissions-table__label">{tool.label}</span>
                </td>
                <td className="tool-permissions-table__control">
                  <select
                    className="settings-input settings-input--select"
                    value={state}
                    onChange={(e) => handleSelectChange(tool.name, e.target.value as OverrideState)}
                  >
                    <option value="default">Default (use tier)</option>
                    <option value="always-approve">Always auto-approve</option>
                    <option value="always-confirm">Always ask</option>
                    {tool.name === 'terminal_exec' && (
                      <option value="patterns">Custom patterns</option>
                    )}
                  </select>
                  {showPatterns && (
                    <div className="tool-permissions-patterns">
                      <label>
                        <span className="tool-permissions-patterns__label">Allow patterns (one per line)</span>
                        <textarea
                          className="settings-input settings-input--textarea"
                          rows={3}
                          placeholder="npm test&#10;npm run build"
                          value={(patternConfig.allowPatterns ?? []).join('\n')}
                          onChange={(e) => handlePatternsChange(tool.name, 'allowPatterns', e.target.value)}
                        />
                      </label>
                      <label>
                        <span className="tool-permissions-patterns__label">Deny patterns (one per line)</span>
                        <textarea
                          className="settings-input settings-input--textarea"
                          rows={3}
                          placeholder="rm -rf *&#10;sudo *"
                          value={(patternConfig.denyPatterns ?? []).join('\n')}
                          onChange={(e) => handlePatternsChange(tool.name, 'denyPatterns', e.target.value)}
                        />
                      </label>
                    </div>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
