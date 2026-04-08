import { describe, expect, it } from 'vitest'
import {
  buildComposerSubmission,
  CHAT_AUTOCOMPLETE_COMMANDS,
  filterCommandSuggestions,
  filterFileSuggestions,
  getComposerTrigger,
} from '@renderer/lib/chatComposer'

describe('chatComposer helpers', () => {
  it('detects @file triggers at the cursor', () => {
    expect(getComposerTrigger('inspect @src/Cha', 'inspect @src/Cha'.length)).toEqual({
      kind: 'file',
      query: 'src/Cha',
      start: 8,
      end: 16,
    })
  })

  it('detects slash commands only at the start of the prompt', () => {
    expect(getComposerTrigger('/pl', 3)).toEqual({
      kind: 'command',
      query: 'pl',
      start: 0,
      end: 3,
    })
    expect(getComposerTrigger('please /pl', 'please /pl'.length)).toBeNull()
  })

  it('builds a structured submission from slash-command text and mentioned files', () => {
    expect(buildComposerSubmission('/plan fix the broken tests', ['src/app.tsx'])).toEqual({
      text: 'fix the broken tests',
      rawText: '/plan fix the broken tests',
      mentionedFiles: ['src/app.tsx'],
      commandId: 'plan',
    })
  })

  it('filters file suggestions by basename and path', () => {
    expect(filterFileSuggestions(['src/components/ChatInput.tsx', 'src/App.tsx'], 'chat')).toEqual([
      'src/components/ChatInput.tsx',
    ])
  })

  it('filters command suggestions from the shared command list', () => {
    expect(filterCommandSuggestions(CHAT_AUTOCOMPLETE_COMMANDS, 'tes')[0]?.id).toBe('tests')
  })
})
