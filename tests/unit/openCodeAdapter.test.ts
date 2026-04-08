import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createServer: vi.fn(),
  spawn: vi.fn(),
  createOpencodeClient: vi.fn(),
}))

vi.mock('net', () => ({
  default: {
    createServer: mocks.createServer,
  },
  createServer: mocks.createServer,
}))

vi.mock('child_process', () => ({
  default: {
    spawn: mocks.spawn,
  },
  spawn: mocks.spawn,
}))

vi.mock('@opencode-ai/sdk/client', () => ({
  createOpencodeClient: mocks.createOpencodeClient,
}))

import { createOpenCodeAdapter } from '../../packages/main/src/chat/cliAdapters/openCodeAdapter'

function makePortServer() {
  return {
    once: vi.fn(),
    listen: vi.fn((_: number, __: string, onListen?: () => void) => onListen?.()),
    address: vi.fn(() => ({ port: 43123 })),
    close: vi.fn((onClose?: (error?: Error) => void) => onClose?.()),
  }
}

function makeChildProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    kill: ReturnType<typeof vi.fn>
  }
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.kill = vi.fn()
  queueMicrotask(() => {
    proc.stdout.emit('data', Buffer.from('opencode server listening'))
  })
  return proc
}

describe('createOpenCodeAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.createServer.mockImplementation(() => makePortServer())
    mocks.spawn.mockImplementation(() => makeChildProcess())
  })

  it('accepts direct Session responses from session.create with responseStyle=data', async () => {
    mocks.createOpencodeClient.mockReturnValue({
      session: {
        create: vi.fn().mockResolvedValue({ id: 'oc-session-1' }),
        promptAsync: vi.fn().mockResolvedValue(undefined),
      },
      global: {
        event: vi.fn().mockResolvedValue({
          stream: (async function* () {
            yield {
              directory: '/workspace',
              payload: {
                type: 'message.updated',
                properties: {
                  info: {
                    id: 'msg-1',
                    sessionID: 'oc-session-1',
                    role: 'assistant',
                    time: { created: 123 },
                  },
                },
              },
            }
            yield {
              directory: '/workspace',
              payload: {
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
              },
            }
          })(),
        }),
      },
    })

    const adapter = createOpenCodeAdapter({ executablePath: '/tmp/opencode' })
    const events: unknown[] = []
    const run = adapter.startTurn(
      {
        conversationId: 'conv-1',
        cwd: '/workspace',
        prompt: 'hello',
        backendState: {},
      },
      (event: unknown) => events.push(event),
    )

    await run.completed

    expect(events).toContainEqual({
      type: 'backend-state',
      patch: { sessionId: 'oc-session-1' },
    })
    expect(events).toContainEqual({
      type: 'message',
      message: {
        id: 'msg-1',
        type: 'assistant',
        content: 'hello from opencode',
        timestamp: 123,
      },
    })
  })
})
