import { beforeEach, describe, it, expect, vi } from 'vitest'
import type { CliAgentMessage } from '@aide/shared'

const mocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  existsSync: vi.fn(),
  query: vi.fn(),
}))

vi.mock('child_process', () => ({
  default: {
    execFileSync: mocks.execFileSync,
  },
  execFileSync: mocks.execFileSync,
}))

vi.mock('fs', () => ({
  default: {
    existsSync: mocks.existsSync,
  },
  existsSync: mocks.existsSync,
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/app',
  },
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: mocks.query,
}))

import { app } from 'electron'
import { CliAgentManager } from '@main/chat/cliAgentManager'

const existsSyncMock = vi.mocked(mocks.existsSync)
const execFileSyncMock = vi.mocked(mocks.execFileSync)
const queryMock = vi.mocked(mocks.query)
const appMock = app as { isPackaged: boolean; getAppPath: () => string }

function makeQueryStub() {
  return {
    close: vi.fn(),
    async *[Symbol.asyncIterator]() {
      return
    },
  }
}

function makeStore(overrides: Record<string, unknown> = {}) {
  return {
    get: vi.fn().mockResolvedValue(null),
    loadMessages: vi.fn().mockResolvedValue(null),
    ensure: vi.fn().mockResolvedValue(undefined),
    updateMeta: vi.fn().mockResolvedValue(undefined),
    saveMessages: vi.fn().mockResolvedValue(undefined),
    loadIndex: vi.fn().mockResolvedValue([]),
    ...overrides,
  }
}

describe('CliAgentManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    appMock.isPackaged = false
    existsSyncMock.mockReturnValue(false)
    execFileSyncMock.mockImplementation(() => {
      throw new Error('not found')
    })
    queryMock.mockReturnValue(makeQueryStub() as never)
    Object.defineProperty(process, 'resourcesPath', {
      value: '/resources',
      configurable: true,
    })
  })

  it('prefers fresher native Claude history over the stored shadow copy', async () => {
    const storedMessages: CliAgentMessage[] = [
      { id: 'u-1', type: 'user', content: 'old prompt', timestamp: 1 },
    ]
    const nativeMessages: CliAgentMessage[] = [
      { id: 'u-1', type: 'user', content: 'old prompt', timestamp: 1 },
      { id: 'a-1', type: 'assistant', content: 'newer native reply', timestamp: 2 },
    ]
    const store = makeStore({
      get: vi.fn().mockResolvedValue({ id: 'conv-1', claudeSessionId: 'claude-session-1' }),
      loadMessages: vi.fn().mockResolvedValue({
        messages: storedMessages,
        claudeSessionId: 'claude-session-1',
      }),
    })

    const manager = new CliAgentManager({
      workspaceRoot: '/workspace',
      getWebContents: () => null,
      conversationStore: store as never,
      loadClaudeHistory: vi.fn().mockResolvedValue(nativeMessages),
    })

    await manager.start('ws-1', 'claude-code', 'conv-1')

    expect(manager.getSessionById('conv-1')?.messages).toEqual(nativeMessages)
  })

  it('keeps the stored transcript when native history is not fresher', async () => {
    const storedMessages: CliAgentMessage[] = [
      { id: 'u-1', type: 'user', content: 'prompt', timestamp: 1 },
      { id: 'a-1', type: 'assistant', content: 'reply', timestamp: 2 },
      { id: 'r-1', type: 'result', content: 'Completed in 1.0s', timestamp: 3 },
    ]
    const nativeMessages: CliAgentMessage[] = [
      { id: 'u-1', type: 'user', content: 'prompt', timestamp: 1 },
      { id: 'a-1', type: 'assistant', content: 'reply', timestamp: 2 },
    ]
    const store = makeStore({
      get: vi.fn().mockResolvedValue({ id: 'conv-2', claudeSessionId: 'claude-session-2' }),
      loadMessages: vi.fn().mockResolvedValue({
        messages: storedMessages,
        claudeSessionId: 'claude-session-2',
      }),
    })

    const manager = new CliAgentManager({
      workspaceRoot: '/workspace',
      getWebContents: () => null,
      conversationStore: store as never,
      loadClaudeHistory: vi.fn().mockResolvedValue(nativeMessages),
    })

    await manager.start('ws-1', 'claude-code', 'conv-2')

    expect(manager.getSessionById('conv-2')?.messages).toEqual(storedMessages)
  })

  it('uses the unpacked Agent SDK cli in packaged builds', async () => {
    appMock.isPackaged = true
    const expectedCliPath =
      '/resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk/cli.js'
    existsSyncMock.mockImplementation((candidate) => candidate === expectedCliPath)

    const manager = new CliAgentManager({
      workspaceRoot: '/workspace',
      getWebContents: () => null,
    })

    const started = await manager.start('ws-1', 'claude-code')
    if ('error' in started) throw new Error(started.error)

    await manager.send(started.sessionId, 'hello from test')

    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'hello from test',
        options: expect.objectContaining({
          pathToClaudeCodeExecutable: expectedCliPath,
        }),
      }),
    )
  })
})
