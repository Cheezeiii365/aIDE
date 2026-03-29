import type { SettingsScope } from '@aide/shared'

export type SettingType = 'boolean' | 'number' | 'string' | 'enum' | 'password'

export interface SettingDescriptor {
  key: string
  label: string
  description: string
  type: SettingType
  enumValues?: { value: string; label: string }[]
  min?: number
  max?: number
  category: string
  scope: SettingsScope | 'both'
}

export interface SettingsCategory {
  id: string
  label: string
  children?: SettingsCategory[]
}

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  {
    id: 'textEditor',
    label: 'Text Editor',
    children: [
      { id: 'textEditor.cursor', label: 'Cursor' },
      { id: 'textEditor.font', label: 'Font' },
      { id: 'textEditor.formatting', label: 'Formatting' },
      { id: 'textEditor.minimap', label: 'Minimap' },
      { id: 'textEditor.suggestions', label: 'Suggestions' },
    ],
  },
  {
    id: 'workbench',
    label: 'Workbench',
    children: [
      { id: 'workbench.appearance', label: 'Appearance' },
      { id: 'workbench.layout', label: 'Layout' },
    ],
  },
  { id: 'window', label: 'Window' },
  {
    id: 'features',
    label: 'Features',
    children: [
      { id: 'features.terminal', label: 'Terminal' },
      { id: 'features.browser', label: 'Browser Panes' },
      { id: 'features.explorer', label: 'Explorer' },
    ],
  },
  {
    id: 'agent',
    label: 'Agent',
    children: [
      { id: 'agent.llm', label: 'LLM Configuration' },
    ],
  },
  { id: 'extensions', label: 'Extensions' },
  { id: 'keyboardShortcuts', label: 'Keyboard Shortcuts' },
]

export const SETTINGS_DESCRIPTORS: SettingDescriptor[] = [
  // Text Editor > Font
  {
    key: 'fontSize',
    label: 'Font Size',
    description: 'Controls the font size in pixels for the editor.',
    type: 'number',
    min: 8,
    max: 72,
    category: 'textEditor.font',
    scope: 'both',
  },
  {
    key: 'fontFamily',
    label: 'Font Family',
    description: 'Controls the font family for the editor.',
    type: 'string',
    category: 'textEditor.font',
    scope: 'both',
  },

  // Text Editor > Formatting
  {
    key: 'tabSize',
    label: 'Tab Size',
    description: 'The number of spaces a tab is equal to.',
    type: 'number',
    min: 1,
    max: 16,
    category: 'textEditor.formatting',
    scope: 'both',
  },
  {
    key: 'insertSpaces',
    label: 'Insert Spaces',
    description: 'Insert spaces when pressing Tab.',
    type: 'boolean',
    category: 'textEditor.formatting',
    scope: 'both',
  },
  {
    key: 'wordWrap',
    label: 'Word Wrap',
    description: 'Controls how lines should wrap.',
    type: 'enum',
    enumValues: [
      { value: 'off', label: 'Off' },
      { value: 'on', label: 'On' },
      { value: 'bounded', label: 'Bounded' },
    ],
    category: 'textEditor.formatting',
    scope: 'both',
  },
  {
    key: 'formatOnSave',
    label: 'Format On Save',
    description: 'Format a file on save.',
    type: 'boolean',
    category: 'textEditor.formatting',
    scope: 'both',
  },

  // Agent > LLM Configuration
  {
    key: 'agent.provider',
    label: 'Provider',
    description: 'LLM provider to use for agent requests.',
    type: 'enum',
    enumValues: [
      { value: 'anthropic', label: 'Anthropic' },
      { value: 'openai-compatible', label: 'OpenAI Compatible' },
    ],
    category: 'agent.llm',
    scope: 'both',
  },
  {
    key: 'agent.model',
    label: 'Model',
    description: 'Model identifier (e.g. claude-sonnet-4-20250514, gpt-4o, llama-3.3-70b).',
    type: 'string',
    category: 'agent.llm',
    scope: 'both',
  },
  {
    key: 'agent.apiKey',
    label: 'API Key',
    description: 'API key for the selected provider. Supports ${env:VAR_NAME} to read from environment variables.',
    type: 'password',
    category: 'agent.llm',
    scope: 'user',
  },
  {
    key: 'agent.baseUrl',
    label: 'Base URL',
    description: 'Custom API endpoint for OpenAI-compatible providers (e.g. http://localhost:11434/v1). Leave empty for default.',
    type: 'string',
    category: 'agent.llm',
    scope: 'both',
  },
  {
    key: 'agent.maxTurns',
    label: 'Max Turns',
    description: 'Maximum number of agent loop iterations per message before stopping.',
    type: 'number',
    min: 1,
    max: 100,
    category: 'agent.llm',
    scope: 'both',
  },
  {
    key: 'agent.maxTokens',
    label: 'Max Tokens',
    description: 'Maximum tokens per LLM response.',
    type: 'number',
    min: 256,
    max: 65536,
    category: 'agent.llm',
    scope: 'both',
  },
]

/** Get all descriptors that belong to a given category */
export function getDescriptorsForCategory(categoryId: string): SettingDescriptor[] {
  return SETTINGS_DESCRIPTORS.filter((d) => d.category === categoryId)
}

/** Get all category IDs that have at least one setting descriptor */
export function getCategoriesWithSettings(): Set<string> {
  return new Set(SETTINGS_DESCRIPTORS.map((d) => d.category))
}

/** Flatten all category IDs (including parent + children) */
export function flattenCategoryIds(categories: SettingsCategory[]): string[] {
  const ids: string[] = []
  for (const cat of categories) {
    ids.push(cat.id)
    if (cat.children) {
      ids.push(...flattenCategoryIds(cat.children))
    }
  }
  return ids
}
