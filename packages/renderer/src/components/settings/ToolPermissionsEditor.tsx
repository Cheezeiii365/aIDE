import { useState, useCallback } from 'react'
import type { ToolPermissionConfig } from '@aide/shared'

interface Props {
  value: Record<string, boolean | ToolPermissionConfig>
  onChange: (value: Record<string, boolean | ToolPermissionConfig>) => void
}

const KNOWN_TOOLS = [
  { name: 'file_read', label: 'Read Files', icon: '◻', category: 'read' },
  { name: 'file_list', label: 'List Directory', icon: '≡', category: 'read' },
  { name: 'search_files', label: 'Search Files', icon: '⌕', category: 'read' },
  { name: 'git_status', label: 'Git Status', icon: '⎇', category: 'read' },
  { name: 'git_diff', label: 'Git Diff', icon: '±', category: 'read' },
  { name: 'browser_read', label: 'Browser Read', icon: '◎', category: 'read' },
  { name: 'file_write', label: 'Write Files', icon: '◼', category: 'write' },
  { name: 'terminal_exec', label: 'Terminal Execute', icon: '>_', category: 'exec' },
] as const

type OverrideState = 'default' | 'always-approve' | 'always-confirm' | 'patterns'

function getOverrideState(value: boolean | ToolPermissionConfig | undefined): OverrideState {
  if (value === undefined) return 'default'
  if (value === true) return 'always-approve'
  if (value === false) return 'always-confirm'
  return 'patterns'
}

const STATE_META: Record<OverrideState, { label: string; shortLabel: string; className: string }> = {
  'default': { label: 'Default (use tier)', shortLabel: 'Default', className: 'default' },
  'always-approve': { label: 'Always auto-approve', shortLabel: 'Auto', className: 'approve' },
  'always-confirm': { label: 'Always ask', shortLabel: 'Ask', className: 'confirm' },
  'patterns': { label: 'Custom patterns', shortLabel: 'Custom', className: 'patterns' },
}

export function ToolPermissionsEditor({ value, onChange }: Props) {
  const [expandedTool, setExpandedTool] = useState<string | null>(null)

  const handleStateChange = useCallback((toolName: string, state: OverrideState) => {
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
  }, [value, onChange])

  const handlePatternsChange = useCallback((toolName: string, field: 'allowPatterns' | 'denyPatterns', text: string) => {
    const patterns = text.split('\n').map((s) => s.trim()).filter(Boolean)
    const existing = typeof value[toolName] === 'object' ? value[toolName] as ToolPermissionConfig : {}
    const next = { ...value, [toolName]: { ...existing, [field]: patterns } }
    onChange(next)
  }, [value, onChange])

  const toggleExpand = useCallback((toolName: string) => {
    setExpandedTool((prev) => prev === toolName ? null : toolName)
  }, [])

  // Group tools by category
  const readTools = KNOWN_TOOLS.filter((t) => t.category === 'read')
  const writeTools = KNOWN_TOOLS.filter((t) => t.category === 'write')
  const execTools = KNOWN_TOOLS.filter((t) => t.category === 'exec')

  return (
    <div className="tp-editor">
      <p className="tp-editor__desc">
        Override the permission tier for individual tools. "Default" inherits the tier setting above.
      </p>

      <div className="tp-editor__section">
        <div className="tp-editor__section-header">
          <span className="tp-editor__section-dot tp-editor__section-dot--read" />
          <span className="tp-editor__section-label">Read-only tools</span>
        </div>
        <div className="tp-editor__grid">
          {readTools.map((tool) => (
            <ToolCard
              key={tool.name}
              tool={tool}
              state={getOverrideState(value[tool.name])}
              patternConfig={typeof value[tool.name] === 'object' ? value[tool.name] as ToolPermissionConfig : undefined}
              expanded={expandedTool === tool.name}
              onStateChange={handleStateChange}
              onPatternsChange={handlePatternsChange}
              onToggleExpand={toggleExpand}
            />
          ))}
        </div>
      </div>

      <div className="tp-editor__section">
        <div className="tp-editor__section-header">
          <span className="tp-editor__section-dot tp-editor__section-dot--write" />
          <span className="tp-editor__section-label">Write tools</span>
        </div>
        <div className="tp-editor__grid">
          {writeTools.map((tool) => (
            <ToolCard
              key={tool.name}
              tool={tool}
              state={getOverrideState(value[tool.name])}
              patternConfig={typeof value[tool.name] === 'object' ? value[tool.name] as ToolPermissionConfig : undefined}
              expanded={expandedTool === tool.name}
              onStateChange={handleStateChange}
              onPatternsChange={handlePatternsChange}
              onToggleExpand={toggleExpand}
            />
          ))}
        </div>
      </div>

      <div className="tp-editor__section">
        <div className="tp-editor__section-header">
          <span className="tp-editor__section-dot tp-editor__section-dot--exec" />
          <span className="tp-editor__section-label">Execution tools</span>
        </div>
        <div className="tp-editor__grid">
          {execTools.map((tool) => (
            <ToolCard
              key={tool.name}
              tool={tool}
              state={getOverrideState(value[tool.name])}
              patternConfig={typeof value[tool.name] === 'object' ? value[tool.name] as ToolPermissionConfig : undefined}
              expanded={expandedTool === tool.name}
              onStateChange={handleStateChange}
              onPatternsChange={handlePatternsChange}
              onToggleExpand={toggleExpand}
              allowPatterns
            />
          ))}
        </div>
      </div>
    </div>
  )
}

interface ToolCardProps {
  tool: { name: string; label: string; icon: string; category: string }
  state: OverrideState
  patternConfig?: ToolPermissionConfig
  expanded: boolean
  onStateChange: (name: string, state: OverrideState) => void
  onPatternsChange: (name: string, field: 'allowPatterns' | 'denyPatterns', text: string) => void
  onToggleExpand: (name: string) => void
  allowPatterns?: boolean
}

function ToolCard({
  tool,
  state,
  patternConfig,
  expanded,
  onStateChange,
  onPatternsChange,
  onToggleExpand,
  allowPatterns,
}: ToolCardProps) {
  const meta = STATE_META[state]
  const showPatternEditor = state === 'patterns' && expanded

  return (
    <div className={`tp-card tp-card--${meta.className}`}>
      <div className="tp-card__row">
        <span className="tp-card__icon">{tool.icon}</span>
        <div className="tp-card__info">
          <span className="tp-card__name">{tool.name}</span>
          <span className="tp-card__label">{tool.label}</span>
        </div>
        <div className="tp-card__control">
          <div className="tp-card__segments">
            <button
              className={`tp-card__seg${state === 'default' ? ' tp-card__seg--active' : ''}`}
              onClick={() => onStateChange(tool.name, 'default')}
              title="Default (use tier)"
            >
              Tier
            </button>
            <button
              className={`tp-card__seg tp-card__seg--approve${state === 'always-approve' ? ' tp-card__seg--active' : ''}`}
              onClick={() => onStateChange(tool.name, 'always-approve')}
              title="Always auto-approve"
            >
              Auto
            </button>
            <button
              className={`tp-card__seg tp-card__seg--confirm${state === 'always-confirm' ? ' tp-card__seg--active' : ''}`}
              onClick={() => onStateChange(tool.name, 'always-confirm')}
              title="Always ask"
            >
              Ask
            </button>
            {allowPatterns && (
              <button
                className={`tp-card__seg tp-card__seg--patterns${state === 'patterns' ? ' tp-card__seg--active' : ''}`}
                onClick={() => {
                  onStateChange(tool.name, 'patterns')
                  onToggleExpand(tool.name)
                }}
                title="Custom patterns"
              >
                ✱
              </button>
            )}
          </div>
        </div>
      </div>

      {state === 'patterns' && !expanded && (
        <button className="tp-card__expand-trigger" onClick={() => onToggleExpand(tool.name)}>
          Edit patterns...
        </button>
      )}

      {showPatternEditor && (
        <div className="tp-card__patterns">
          <div className="tp-card__pattern-group">
            <label className="tp-card__pattern-label">
              <span className="tp-card__pattern-dot tp-card__pattern-dot--allow" />
              Allow patterns
            </label>
            <textarea
              className="tp-card__pattern-input"
              rows={3}
              placeholder={'npm test\nnpm run build'}
              value={(patternConfig?.allowPatterns ?? []).join('\n')}
              onChange={(e) => onPatternsChange(tool.name, 'allowPatterns', e.target.value)}
            />
          </div>
          <div className="tp-card__pattern-group">
            <label className="tp-card__pattern-label">
              <span className="tp-card__pattern-dot tp-card__pattern-dot--deny" />
              Deny patterns
            </label>
            <textarea
              className="tp-card__pattern-input"
              rows={3}
              placeholder={'rm -rf *\nsudo *'}
              value={(patternConfig?.denyPatterns ?? []).join('\n')}
              onChange={(e) => onPatternsChange(tool.name, 'denyPatterns', e.target.value)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
