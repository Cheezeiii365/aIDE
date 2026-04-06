import { describe, it, expect, vi } from 'vitest'
import type { CliAgentMessage } from '@aide/shared'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/app',
  },
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}))

import { CliAgentManager } from '@main/chat/cliAgentManager'

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
})
