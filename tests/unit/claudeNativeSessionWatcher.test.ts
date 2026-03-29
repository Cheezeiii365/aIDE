import { beforeEach, describe, expect, it, vi } from 'vitest'

const fileContents = new Map<string, string>()
const statMock = vi.fn(async (filePath: string) => {
  if (!fileContents.has(filePath)) {
    throw new Error(`ENOENT: ${filePath}`)
  }
  return { birthtimeMs: 1, mtimeMs: 1, size: Buffer.byteLength(fileContents.get(filePath) ?? '', 'utf8') }
})
const realpathMock = vi.fn(async (filePath: string) => filePath)

vi.mock('os', () => ({
  homedir: () => '/Users/test',
  default: {
    homedir: () => '/Users/test',
  },
}))

vi.mock('fs/promises', () => ({
  stat: (filePath: string) => statMock(filePath),
  realpath: (filePath: string) => realpathMock(filePath),
  readdir: vi.fn(),
  open: vi.fn(),
  default: {
    stat: (filePath: string) => statMock(filePath),
    realpath: (filePath: string) => realpathMock(filePath),
    readdir: vi.fn(),
    open: vi.fn(),
  },
}))

vi.mock('fs', () => ({
  watch: vi.fn(),
  createReadStream: (filePath: string) => ({ filePath }),
  default: {
    watch: vi.fn(),
    createReadStream: (filePath: string) => ({ filePath }),
  },
}))

vi.mock('readline', () => ({
  createInterface: ({ input }: { input: { filePath: string } }) => {
    const text = fileContents.get(input.filePath) ?? ''
    return {
      async *[Symbol.asyncIterator]() {
        for (const line of text.split('\n')) {
          if (line) yield line
        }
      },
    }
  },
  default: {
    createInterface: ({ input }: { input: { filePath: string } }) => {
      const text = fileContents.get(input.filePath) ?? ''
      return {
        async *[Symbol.asyncIterator]() {
          for (const line of text.split('\n')) {
            if (line) yield line
          }
        },
      }
    },
  },
}))

import { ClaudeNativeSessionWatcher } from '@main/agents/claudeNativeSessionWatcher'

describe('ClaudeNativeSessionWatcher', () => {
  beforeEach(() => {
    fileContents.clear()
    statMock.mockClear()
    realpathMock.mockClear()
  })

  it('loads messages from the realpath-derived Claude project directory', async () => {
    realpathMock.mockResolvedValue('/real/workspace')

    const watcher = new ClaudeNativeSessionWatcher({
      workspaceRoot: '/symlink/workspace',
      workspaceId: 'ws-1',
      emit: vi.fn(),
    })

    const sessionId = '11111111-1111-1111-1111-111111111111'
    const filePath = '/Users/test/.claude/projects/-real-workspace/11111111-1111-1111-1111-111111111111.jsonl'
    fileContents.set(filePath, JSON.stringify({
      type: 'assistant',
      uuid: 'assistant-1',
      timestamp: '2026-03-29T12:00:00.000Z',
      message: {
        content: [{ type: 'text', text: 'Recovered from native history' }],
      },
    }))

    const messages = await watcher.loadMessages(sessionId)

    expect(realpathMock).toHaveBeenCalledWith('/symlink/workspace')
    expect(messages.map((message) => message.content)).toEqual(['Recovered from native history'])
  })
})
