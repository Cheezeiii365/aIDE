import type { ChatComposerSubmission } from '@aide/shared'

export interface ChatAutocompleteCommand {
  id: string
  label: string
  description: string
  promptHint: string
}

export interface ComposerTriggerMatch {
  kind: 'file' | 'command'
  query: string
  start: number
  end: number
}

export const CHAT_AUTOCOMPLETE_COMMANDS: readonly ChatAutocompleteCommand[] = [
  {
    id: 'plan',
    label: '/plan',
    description: 'Plan before coding',
    promptHint: 'Create a short implementation plan before making changes.',
  },
  {
    id: 'explain',
    label: '/explain',
    description: 'Explain code or behavior',
    promptHint: 'Focus on explaining the relevant code and behavior clearly.',
  },
  {
    id: 'fix',
    label: '/fix',
    description: 'Focus on bug fixing',
    promptHint: 'Focus on identifying the root cause and implementing a fix.',
  },
  {
    id: 'tests',
    label: '/tests',
    description: 'Focus on tests',
    promptHint: 'Focus on adding or updating the smallest useful tests for this work.',
  },
] as const

function scoreMatch(query: string, value: string): number | null {
  if (!query) return 0
  const q = query.toLowerCase()
  const v = value.toLowerCase()
  const direct = v.indexOf(q)
  if (direct >= 0) return direct

  let qi = 0
  let score = 0
  for (let vi = 0; vi < v.length && qi < q.length; vi++) {
    if (v[vi] === q[qi]) {
      score += vi === 0 || v[vi - 1] === '/' || v[vi - 1] === '-' || v[vi - 1] === '_' ? 2 : 1
      qi += 1
    }
  }
  return qi === q.length ? 1000 - score : null
}

export function getComposerTrigger(text: string, cursor: number): ComposerTriggerMatch | null {
  const beforeCursor = text.slice(0, cursor)
  const token = /(^|\s)([@/])([^\s@]*)$/.exec(beforeCursor)
  if (!token) return null

  const marker = token[2]
  const query = token[3] ?? ''
  const start = cursor - query.length - 1
  if (start < 0) return null
  if (marker === '/' && query.includes('/')) return null
  if (marker === '/' && start !== 0) return null

  return {
    kind: marker === '@' ? 'file' : 'command',
    query,
    start,
    end: cursor,
  }
}

export function filterFileSuggestions(files: string[], query: string, limit = 8): string[] {
  return files
    .map((file) => ({
      file,
      score: scoreMatch(query, `${file.split('/').pop() ?? file} ${file}`),
    }))
    .filter((entry): entry is { file: string; score: number } => entry.score !== null)
    .sort((a, b) => a.score - b.score || a.file.localeCompare(b.file))
    .slice(0, limit)
    .map((entry) => entry.file)
}

export function filterCommandSuggestions(
  commands: readonly ChatAutocompleteCommand[],
  query: string,
  limit = 6,
): ChatAutocompleteCommand[] {
  return commands
    .map((command) => ({
      command,
      score: scoreMatch(query, `${command.id} ${command.label} ${command.description}`),
    }))
    .filter(
      (entry): entry is { command: ChatAutocompleteCommand; score: number } => entry.score !== null,
    )
    .sort((a, b) => a.score - b.score || a.command.label.localeCompare(b.command.label))
    .slice(0, limit)
    .map((entry) => entry.command)
}

export function buildComposerSubmission(
  text: string,
  mentionedFiles: string[],
): ChatComposerSubmission {
  const rawText = text.trim()
  const commandMatch = /^\/(\w+)\b\s*/.exec(rawText)
  const commandId = commandMatch?.[1]
  const normalizedText = commandMatch ? rawText.slice(commandMatch[0].length).trim() : rawText
  return {
    text: normalizedText,
    rawText,
    mentionedFiles: Array.from(new Set(mentionedFiles)),
    commandId,
  }
}
