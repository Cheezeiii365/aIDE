import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * AgentManager tests.
 *
 * We test the pure-logic methods (buildLlmMessages, buildSystemPrompt)
 * directly, and test the approval gate / loop behavior with mocked
 * dependencies.
 */

// ─── Mock LlmClient & ToolRegistry before importing AgentManager ───

vi.mock('@main/llmClient', () => ({
  LlmClient: vi.fn().mockImplementation(() => ({
    stream: vi.fn(),
    abort: vi.fn(),
    abortAll: vi.fn(),
    updateConfig: vi.fn(),
  })),
}))

vi.mock('@main/toolRegistry', () => ({
  ToolRegistry: vi.fn().mockImplementation(() => ({
    registerBuiltins: vi.fn(),
    toLlmTools: vi.fn().mockReturnValue([]),
    execute: vi.fn().mockResolvedValue({ toolCallId: 'tc1', output: 'ok', isError: false }),
    updateContext: vi.fn(),
  })),
}))

import { AgentManager } from '@main/chat/agentManager'
import type { ChatSession, ChatMessage, LlmProviderConfig } from '@aide/shared'

// ─── Helpers ───────────────────────────────────────────────────────

const defaultConfig: LlmProviderConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  apiKey: 'test-key',
  maxTurns: 25,
  maxTokens: 8192,
}

function createManager(): AgentManager {
  return new AgentManager({
    config: defaultConfig,
    workspaceRoot: '/tmp/test-workspace',
    getWebContents: () => null,
  })
}

// ─── buildLlmMessages ──────────────────────────────────────────────

describe('AgentManager.buildLlmMessages', () => {
  let manager: AgentManager

  beforeEach(() => {
    manager = createManager()
  })

  it('converts a user message to LlmMessage', async () => {
    const session = await manager.getHistory('ws1')
    session.messages.push({
      id: 'msg1',
      role: 'user',
      content: 'Hello',
      timestamp: Date.now(),
    })

    const result = manager.buildLlmMessages(session)
    expect(result).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }])
  })

  it('prefers contextualContent for user messages', async () => {
    const session = await manager.getHistory('ws1')
    session.messages.push({
      id: 'msg1',
      role: 'user',
      content: '/plan fix the bug',
      contextualContent: 'Requested mode: /plan\n\nFix the bug.',
      timestamp: Date.now(),
    })

    const result = manager.buildLlmMessages(session)
    expect(result).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Requested mode: /plan\n\nFix the bug.' }] },
    ])
  })

  it('converts an assistant message with text', async () => {
    const session = await manager.getHistory('ws1')
    session.messages.push({
      id: 'msg1',
      role: 'assistant',
      content: 'Hi there',
      timestamp: Date.now(),
    })

    const result = manager.buildLlmMessages(session)
    expect(result).toEqual([{ role: 'assistant', content: [{ type: 'text', text: 'Hi there' }] }])
  })

  it('converts an assistant message with tool calls', async () => {
    const session = await manager.getHistory('ws1')
    session.messages.push({
      id: 'msg1',
      role: 'assistant',
      content: 'Let me read that file.',
      timestamp: Date.now(),
      toolCalls: [
        { id: 'tc1', name: 'file_read', input: { path: '/tmp/test.ts' }, status: 'completed' },
      ],
    })

    const result = manager.buildLlmMessages(session)
    expect(result).toHaveLength(1)
    expect(result[0].role).toBe('assistant')
    expect(result[0].content).toHaveLength(2)
    expect(result[0].content[0]).toEqual({ type: 'text', text: 'Let me read that file.' })
    expect(result[0].content[1]).toEqual({
      type: 'tool_use',
      id: 'tc1',
      name: 'file_read',
      input: { path: '/tmp/test.ts' },
    })
  })

  it('converts tool_result messages to user role with tool_result blocks', async () => {
    const session = await manager.getHistory('ws1')
    session.messages.push({
      id: 'msg1',
      role: 'tool_result',
      content: '',
      timestamp: Date.now(),
      toolResults: [{ toolCallId: 'tc1', output: 'file contents here', isError: false }],
    })

    const result = manager.buildLlmMessages(session)
    expect(result).toHaveLength(1)
    expect(result[0].role).toBe('user')
    expect(result[0].content).toEqual([
      { type: 'tool_result', toolUseId: 'tc1', content: 'file contents here', isError: undefined },
    ])
  })

  it('handles a full conversation with tool use cycle', async () => {
    const session = await manager.getHistory('ws1')
    session.messages.push(
      { id: '1', role: 'user', content: 'Read test.ts', timestamp: 1 },
      {
        id: '2',
        role: 'assistant',
        content: '',
        timestamp: 2,
        toolCalls: [
          { id: 'tc1', name: 'file_read', input: { path: 'test.ts' }, status: 'completed' },
        ],
      },
      {
        id: '3',
        role: 'tool_result',
        content: '',
        timestamp: 3,
        toolResults: [{ toolCallId: 'tc1', output: 'console.log("hi")', isError: false }],
      },
      { id: '4', role: 'assistant', content: 'The file logs "hi".', timestamp: 4 },
    )

    const result = manager.buildLlmMessages(session)
    expect(result).toHaveLength(4)
    expect(result[0].role).toBe('user')
    expect(result[1].role).toBe('assistant')
    expect(result[2].role).toBe('user') // tool_result maps to user
    expect(result[3].role).toBe('assistant')
  })

  it('skips empty assistant messages', async () => {
    const session = await manager.getHistory('ws1')
    session.messages.push({
      id: 'msg1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    })

    const result = manager.buildLlmMessages(session)
    expect(result).toHaveLength(0)
  })

  it('skips tool_result messages with no results', async () => {
    const session = await manager.getHistory('ws1')
    session.messages.push({
      id: 'msg1',
      role: 'tool_result',
      content: '',
      timestamp: Date.now(),
      toolResults: [],
    })

    const result = manager.buildLlmMessages(session)
    expect(result).toHaveLength(0)
  })
})

// ─── buildSystemPrompt ─────────────────────────────────────────────

describe('AgentManager.buildSystemPrompt', () => {
  let manager: AgentManager

  beforeEach(() => {
    manager = createManager()
  })

  it('includes workspace root and mode', async () => {
    const session = await manager.getHistory('ws1')
    session.mode = 'agent'

    const prompt = manager.buildSystemPrompt(session)
    expect(prompt).toContain('/tmp/test-workspace')
    expect(prompt).toContain('AGENT mode')
  })

  it('describes ask mode as read-only', async () => {
    const session = await manager.getHistory('ws1')
    session.mode = 'ask'

    const prompt = manager.buildSystemPrompt(session)
    expect(prompt).toContain('ASK mode')
    expect(prompt).toContain('cannot modify')
  })

  it('shows working set in edit mode', async () => {
    const session = await manager.getHistory('ws1')
    session.mode = 'edit'
    session.workingSet = ['src/index.ts', 'src/app.tsx']

    const prompt = manager.buildSystemPrompt(session)
    expect(prompt).toContain('EDIT mode')
    expect(prompt).toContain('src/index.ts')
    expect(prompt).toContain('src/app.tsx')
    expect(prompt).toContain('working set')
  })

  it('includes the current date', async () => {
    const session = await manager.getHistory('ws1')
    const today = new Date().toISOString().split('T')[0]
    const prompt = manager.buildSystemPrompt(session)
    expect(prompt).toContain(today)
  })
})

// ─── Session Management ────────────────────────────────────────────

describe('AgentManager session management', () => {
  let manager: AgentManager

  beforeEach(() => {
    manager = createManager()
  })

  it('creates a new session for a workspace', async () => {
    const session = await manager.getHistory('ws1')
    expect(session.workspaceId).toBe('ws1')
    expect(session.mode).toBe('agent')
    expect(session.messages).toEqual([])
    expect(session.status).toBe('idle')
  })

  it('returns the same session on repeated calls', async () => {
    const s1 = await manager.getHistory('ws1')
    const s2 = await manager.getHistory('ws1')
    expect(s1.id).toBe(s2.id)
  })

  it('setMode updates the session mode', async () => {
    const session = await manager.getHistory('ws1')
    await manager.setMode(session.id, 'ask')
    expect(session.mode).toBe('ask')
  })

  it('setWorkingSet updates the session working set', async () => {
    const session = await manager.getHistory('ws1')
    await manager.setWorkingSet(session.id, ['file1.ts', 'file2.ts'])
    expect(session.workingSet).toEqual(['file1.ts', 'file2.ts'])
  })

  it('sendMessage fails for unknown session', async () => {
    const result = await manager.sendMessage('nonexistent', 'hello')
    expect(result).toEqual({ error: 'Session not found: nonexistent' })
  })
})

// ─── Approval Gate ─────────────────────────────────────────────────

describe('AgentManager approval gate', () => {
  let manager: AgentManager

  beforeEach(() => {
    manager = createManager()
  })

  it('approveToolCall resolves the pending approval as true', async () => {
    const session = await manager.getHistory('ws1')

    // Access private method via type cast for testing
    const mgr = manager as any
    const approvalPromise = mgr.waitForApproval({
      id: 'tc1',
      name: 'file_read',
      input: {},
      status: 'pending',
    })

    // Approve it
    manager.approveToolCall(session.id, 'tc1')

    const result = await approvalPromise
    expect(result).toBe(true)
  })

  it('rejectToolCall resolves the pending approval as false', async () => {
    const session = await manager.getHistory('ws1')

    const mgr = manager as any
    const approvalPromise = mgr.waitForApproval({
      id: 'tc2',
      name: 'file_write',
      input: {},
      status: 'pending',
    })

    manager.rejectToolCall(session.id, 'tc2')

    const result = await approvalPromise
    expect(result).toBe(false)
  })

  it('stop resolves all pending approvals as false', async () => {
    const session = await manager.getHistory('ws1')

    const mgr = manager as any
    const p1 = mgr.waitForApproval({ id: 'tc1', name: 'file_read', input: {}, status: 'pending' })
    const p2 = mgr.waitForApproval({ id: 'tc2', name: 'file_write', input: {}, status: 'pending' })

    manager.stop(session.id)

    expect(await p1).toBe(false)
    expect(await p2).toBe(false)
  })
})

// ─── Destroy ───────────────────────────────────────────────────────

describe('AgentManager.destroy', () => {
  it('clears all sessions and state', async () => {
    const manager = createManager()
    await manager.getHistory('ws1')
    await manager.getHistory('ws2')

    manager.destroy()

    // After destroy, getHistory should create fresh sessions
    const session = await manager.getHistory('ws1')
    expect(session.messages).toEqual([])
  })
})
