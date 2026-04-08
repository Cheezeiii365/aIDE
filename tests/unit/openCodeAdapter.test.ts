import { describe, expect, it, vi } from 'vitest'
import type { OpenCodeServerHost } from '@main/chat/openCodeServerHost'
import { createOpenCodeAdapter } from '@main/chat/cliAdapters/openCodeAdapter'

interface MockHost {
  getClient: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
  respondPermission: ReturnType<typeof vi.fn>
  /** Internal: every subscriber that has been registered. */
  _listeners: Array<(event: unknown) => void>
  /** Helper for tests: emit an event to all subscribers. */
  emit(event: unknown): void
}

function makeMockHost(client: unknown): MockHost {
  const listeners: Array<(event: unknown) => void> = []
  return {
    _listeners: listeners,
    emit(event: unknown) {
      for (const l of listeners) l(event)
    },
    getClient: vi.fn().mockResolvedValue(client),
    subscribe: vi.fn((_sessionId: string | null, listener: (e: unknown) => void) => {
      listeners.push(listener)
      return () => {
        const idx = listeners.indexOf(listener)
        if (idx >= 0) listeners.splice(idx, 1)
      }
    }),
    respondPermission: vi.fn().mockResolvedValue(undefined),
  }
}

describe('createOpenCodeAdapter (host-driven)', () => {
  it('creates a session, sends prompt, and emits text + result', async () => {
    const client = {
      session: {
        create: vi.fn().mockResolvedValue({ id: 'oc-session-1' }),
        promptAsync: vi.fn().mockImplementation(async () => {
          // After the prompt is accepted, emit a streaming text part then idle.
          setTimeout(() => {
            host.emit({
              type: 'message.updated',
              properties: {
                info: {
                  id: 'msg-1',
                  sessionID: 'oc-session-1',
                  role: 'assistant',
                  time: { created: 123 },
                  cost: 0.001,
                  tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
                },
              },
            })
            host.emit({
              type: 'message.part.updated',
              properties: {
                delta: 'hello from opencode',
                part: {
                  type: 'text',
                  sessionID: 'oc-session-1',
                  messageID: 'msg-1',
                  text: 'hello from opencode',
                },
              },
            })
            host.emit({
              type: 'session.idle',
              properties: { sessionID: 'oc-session-1' },
            })
          })
        }),
      },
    }
    const host = makeMockHost(client)

    const adapter = createOpenCodeAdapter({
      host: host as unknown as OpenCodeServerHost,
      getPermissionSettings: () => ({ tier: 'confirm', autoApprove: {} }),
    })

    const events: unknown[] = []
    const run = adapter.startTurn(
      {
        conversationId: 'conv-1',
        cwd: '/workspace',
        prompt: 'hello',
        backendState: {},
      },
      (event) => events.push(event),
    )
    await run.completed

    // Created a new opencode session
    expect(client.session.create).toHaveBeenCalled()
    expect(events).toContainEqual({
      type: 'backend-state',
      patch: { sessionId: 'oc-session-1' },
    })

    // Streamed text delta + final result event
    const streamDelta = events.find(
      (e) => (e as { type?: string }).type === 'stream-delta',
    )
    expect(streamDelta).toMatchObject({ delta: 'hello from opencode' })

    const result = events.find((e) => (e as { type?: string }).type === 'result')
    expect(result).toMatchObject({
      isSuccess: true,
      totalCostUsd: 0.001,
      tokens: { input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    })
  })

  it('reuses an existing sessionId from backendState', async () => {
    const client = {
      session: {
        create: vi.fn(),
        promptAsync: vi.fn().mockImplementation(async () => {
          setTimeout(() => {
            host.emit({ type: 'session.idle', properties: { sessionID: 'preexisting' } })
          })
        }),
      },
    }
    const host = makeMockHost(client)
    const adapter = createOpenCodeAdapter({
      host: host as unknown as OpenCodeServerHost,
      getPermissionSettings: () => ({ tier: 'autopilot', autoApprove: {} }),
    })

    await adapter
      .startTurn(
        {
          conversationId: 'conv-x',
          cwd: '/workspace',
          prompt: 'hi',
          backendState: { sessionId: 'preexisting' },
        },
        () => {},
      )
      .completed

    expect(client.session.create).not.toHaveBeenCalled()
    expect(client.session.promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({ path: { id: 'preexisting' } }),
    )
  })

  it('passes provider/model/agent/system/tools overrides on the prompt body', async () => {
    const client = {
      session: {
        create: vi.fn(),
        promptAsync: vi.fn().mockImplementation(async () => {
          setTimeout(() => {
            host.emit({ type: 'session.idle', properties: { sessionID: 's1' } })
          })
        }),
      },
    }
    const host = makeMockHost(client)
    const adapter = createOpenCodeAdapter({
      host: host as unknown as OpenCodeServerHost,
      getPermissionSettings: () => ({ tier: 'autopilot', autoApprove: {} }),
    })

    await adapter
      .startTurn(
        {
          conversationId: 'conv-x',
          cwd: '/workspace',
          prompt: 'hi',
          backendState: {
            sessionId: 's1',
            providerID: 'anthropic',
            modelID: 'claude-sonnet-4-5',
            agent: 'build',
            systemPromptOverride: 'be terse',
            toolToggles: { web_search: false },
          },
        },
        () => {},
      )
      .completed

    expect(client.session.promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: 's1' },
        body: expect.objectContaining({
          parts: [{ type: 'text', text: 'hi' }],
          model: { providerID: 'anthropic', modelID: 'claude-sonnet-4-5' },
          agent: 'build',
          system: 'be terse',
          tools: { web_search: false },
        }),
      }),
    )
  })

  it('auto-approves permission events under autopilot tier without prompting', async () => {
    const client = {
      session: {
        create: vi.fn().mockResolvedValue({ id: 's1' }),
        promptAsync: vi.fn().mockImplementation(async () => {
          setTimeout(() => {
            host.emit({
              type: 'permission.updated',
              properties: {
                id: 'perm-1',
                sessionID: 's1',
                type: 'edit',
                title: 'Edit foo.ts',
                pattern: 'foo.ts',
                metadata: {},
                time: { created: 0 },
              },
            })
            host.emit({ type: 'session.idle', properties: { sessionID: 's1' } })
          })
        }),
      },
    }
    const host = makeMockHost(client)
    const adapter = createOpenCodeAdapter({
      host: host as unknown as OpenCodeServerHost,
      getPermissionSettings: () => ({ tier: 'autopilot', autoApprove: {} }),
    })

    const events: unknown[] = []
    await adapter
      .startTurn(
        { conversationId: 'c', cwd: '/w', prompt: 'p', backendState: {} },
        (e) => events.push(e),
      )
      .completed

    expect(host.respondPermission).toHaveBeenCalledWith('s1', 'perm-1', 'always')
    // No permission-request emitted to the manager since it was auto-decided.
    expect(events.find((e) => (e as { type?: string }).type === 'permission-request')).toBeUndefined()
  })

  it('forwards permission events under confirm tier as permission-request', async () => {
    const client = {
      session: {
        create: vi.fn().mockResolvedValue({ id: 's1' }),
        promptAsync: vi.fn().mockImplementation(async () => {
          setTimeout(() => {
            host.emit({
              type: 'permission.updated',
              properties: {
                id: 'perm-2',
                sessionID: 's1',
                type: 'bash',
                title: 'Run rm -rf',
                pattern: 'rm -rf /',
                metadata: {},
                time: { created: 0 },
              },
            })
            host.emit({ type: 'session.idle', properties: { sessionID: 's1' } })
          })
        }),
      },
    }
    const host = makeMockHost(client)
    const adapter = createOpenCodeAdapter({
      host: host as unknown as OpenCodeServerHost,
      getPermissionSettings: () => ({ tier: 'confirm', autoApprove: {} }),
    })

    const events: unknown[] = []
    const run = adapter.startTurn(
      { conversationId: 'c', cwd: '/w', prompt: 'p', backendState: {} },
      (e) => {
        events.push(e)
        // Auto-resolve any permission-request as 'reject' so the run can finish.
        if ((e as { type?: string }).type === 'permission-request') {
          ;(e as { resolve: (r: 'reject') => void }).resolve('reject')
        }
      },
    )
    await run.completed

    const permRequest = events.find(
      (e) => (e as { type?: string }).type === 'permission-request',
    )
    expect(permRequest).toBeDefined()
    // The test's inline resolver (called from the emit callback) routes
    // through the adapter's resolve closure which POSTs to the host.
    expect(host.respondPermission).toHaveBeenCalledWith('s1', 'perm-2', 'reject')
  })
})
