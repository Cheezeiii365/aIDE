import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { buildComposerContext } from '@main/chat/chatComposerContext'

describe('buildComposerContext', () => {
  let rootPath: string | null = null

  afterEach(async () => {
    if (rootPath) {
      await rm(rootPath, { recursive: true, force: true })
      rootPath = null
    }
  })

  it('adds slash-command instructions and referenced file contents', async () => {
    rootPath = await mkdtemp(join(tmpdir(), 'aide-chat-composer-'))
    await writeFile(join(rootPath, 'notes.txt'), 'hello from context', 'utf-8')

    const result = await buildComposerContext(
      {
        text: 'fix this flow',
        rawText: '/fix fix this flow',
        mentionedFiles: ['notes.txt'],
        commandId: 'fix',
      },
      rootPath,
    )

    expect(result.commandId).toBe('fix')
    expect(result.mentionedFiles).toEqual(['notes.txt'])
    expect(result.contextualContent).toContain('Requested mode: /fix')
    expect(result.contextualContent).toContain('Referenced files:')
    expect(result.contextualContent).toContain('hello from context')
    expect(result.contextualContent).toContain('fix this flow')
  })

  it('drops mentioned files that escape the workspace root', async () => {
    rootPath = await mkdtemp(join(tmpdir(), 'aide-chat-composer-'))

    const result = await buildComposerContext(
      {
        text: 'explain the issue',
        mentionedFiles: ['../secret.txt', 'safe.ts'],
      },
      rootPath,
    )

    expect(result.mentionedFiles).toEqual(['safe.ts'])
    expect(result.contextualContent).toContain('safe.ts')
    expect(result.contextualContent).not.toContain('secret.txt')
  })
})
