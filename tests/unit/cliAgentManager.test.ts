import { beforeEach, describe, it, expect, vi } from 'vitest'
import type { CliAgentMessage } from '@aide/shared'

const mocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  spawn: vi.fn(),
  existsSync: vi.fn(),
  query: vi.fn(),
  createOpencodeClient: vi.fn(),
}))

vi.mock('child_process', () => ({
  default: {
    execFileSync: mocks.execFileSync,
    spawn: mocks.spawn,
  },
  execFileSync: mocks.execFileSync,
  spawn: mocks.spawn,
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

vi.mock('@opencode-ai/sdk/client', () => ({
  createOpencodeClient: mocks.createOpencodeClient,
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

    await manager.send(started.sessionId, {
      text: 'hello from test',
      rawText: 'hello from test',
      mentionedFiles: [],
    })

    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'hello from test',
        options: expect.objectContaining({
          pathToClaudeCodeExecutable: expectedCliPath,
        }),
      }),
    )
  })

  it('switches backend and persists the active backend', async () => {
    const store = makeStore()
    const manager = new CliAgentManager({
      workspaceRoot: '/workspace',
      getWebContents: () => null,
      conversationStore: store as never,
    })

    const started = await manager.start('ws-1', 'claude-code', 'conv-switch')
    if ('error' in started) throw new Error(started.error)

    const result = await manager.switchBackend(started.sessionId, 'codex')

    expect(result).toEqual({ success: true })
    expect(manager.getSessionById(started.sessionId)?.backend).toBe('codex')
    expect(store.saveMessages).toHaveBeenCalledWith(
      'conv-switch',
      expect.objectContaining({ activeBackend: 'codex' }),
    )
    expect(store.updateMeta).toHaveBeenCalledWith(
      'conv-switch',
      expect.objectContaining({ backend: 'codex' }),
    )
  })

  it('updateSessionConfig persists per-backend overrides', async () => {
    const store = makeStore()
    const manager = new CliAgentManager({
      workspaceRoot: '/workspace',
      getWebContents: () => null,
      conversationStore: store as never,
    })
    const started = await manager.start('ws-1', 'opencode', 'conv-config')
    if ('error' in started) throw new Error(started.error)

    const result = await manager.updateSessionConfig(started.sessionId, {
      providerID: 'anthropic',
      modelID: 'claude-sonnet-4-5',
      agent: 'build',
      systemPromptOverride: 'be helpful',
      toolToggles: { web_search: false },
    })

    expect('error' in result).toBe(false)
    const session = manager.getSessionById(started.sessionId)
    expect(session?.backendStates?.['opencode']?.providerID).toBe('anthropic')
    expect(session?.backendStates?.['opencode']?.modelID).toBe('claude-sonnet-4-5')
    expect(session?.backendStates?.['opencode']?.agent).toBe('build')
    expect(session?.backendStates?.['opencode']?.systemPromptOverride).toBe('be helpful')
    expect(session?.backendStates?.['opencode']?.toolToggles).toEqual({ web_search: false })
  })

  it('hot-swap preserves per-backend state across switches', async () => {
    const store = makeStore()
    const manager = new CliAgentManager({
      workspaceRoot: '/workspace',
      getWebContents: () => null,
      conversationStore: store as never,
    })
    const started = await manager.start('ws-1', 'opencode', 'conv-swap')
    if ('error' in started) throw new Error(started.error)

    await manager.updateSessionConfig(started.sessionId, {
      providerID: 'anthropic',
      modelID: 'claude-sonnet-4-5',
    })

    // Switch to claude-code, then back.
    await manager.switchBackend(started.sessionId, 'claude-code')
    await manager.switchBackend(started.sessionId, 'opencode')

    const session = manager.getSessionById(started.sessionId)
    // OpenCode-specific overrides survive the round trip.
    expect(session?.backendStates?.['opencode']?.providerID).toBe('anthropic')
    expect(session?.backendStates?.['opencode']?.modelID).toBe('claude-sonnet-4-5')
  })

  it('updatePermissions changes the manager tier without restart', () => {
    const manager = new CliAgentManager({
      workspaceRoot: '/workspace',
      getWebContents: () => null,
      permissionTier: 'confirm',
      autoApprove: {},
    })
    // No public getter; just verify the method doesn't throw and accepts both args.
    expect(() => manager.updatePermissions('autopilot', { file_write: true })).not.toThrow()
  })

  it('getWorkspaceCostSummary aggregates across sessions', async () => {
    const store = makeStore()
    const manager = new CliAgentManager({
      workspaceRoot: '/workspace',
      workspaceId: 'ws-cost',
      getWebContents: () => null,
      conversationStore: store as never,
    })
    await manager.start('ws-cost', 'opencode', 'conv-a')
    await manager.start('ws-cost', 'opencode', 'conv-b')

    const summary = manager.getWorkspaceCostSummary()
    expect(summary.workspaceId).toBe('ws-cost')
    expect(summary.sessionCount).toBe(2)
    expect(summary.totalCostUsd).toBe(0)
    expect(summary.totalTokens).toEqual({
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
    })
  })

  it('ToolApprovalOwner methods are no-ops when no permission is pending', () => {
    const manager = new CliAgentManager({
      workspaceRoot: '/workspace',
      getWebContents: () => null,
    })
    expect(manager.ownsToolCall('nonexistent')).toBe(false)
    expect(manager.getPendingApprovalCount()).toBe(0)
    expect(() => manager.approveToolCall('s', 'nonexistent')).not.toThrow()
    expect(() => manager.rejectToolCall('s', 'nonexistent')).not.toThrow()
  })
})
