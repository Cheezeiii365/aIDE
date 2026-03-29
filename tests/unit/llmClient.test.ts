import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { LlmClient, resolveEnvVars } from '@main/llmClient'
import type { LlmProviderConfig, LlmProvider, LlmStreamEvent } from '@shared/index'

// ─── Helpers ────────────────────────────────────────────────────────

async function collectEvents(gen: AsyncGenerator<LlmStreamEvent>): Promise<LlmStreamEvent[]> {
  const events: LlmStreamEvent[] = []
  for await (const e of gen) events.push(e)
  return events
}

const defaultConfig: LlmProviderConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  apiKey: 'sk-test-key',
  maxTurns: 25,
  maxTokens: 8192,
}

// ─── resolveEnvVars Tests ───────────────────────────────────────────

describe('resolveEnvVars', () => {
  beforeEach(() => {
    vi.stubEnv('TEST_API_KEY', 'resolved-key-123')
    vi.stubEnv('ANOTHER_VAR', 'another-value')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('resolves ${env:VAR} from process.env', () => {
    expect(resolveEnvVars('${env:TEST_API_KEY}')).toBe('resolved-key-123')
  })

  it('returns raw string when no placeholders present', () => {
    expect(resolveEnvVars('sk-plain-key')).toBe('sk-plain-key')
  })

  it('returns empty string for missing env var', () => {
    expect(resolveEnvVars('${env:NONEXISTENT_VAR}')).toBe('')
  })

  it('resolves multiple placeholders', () => {
    expect(resolveEnvVars('${env:TEST_API_KEY}-${env:ANOTHER_VAR}')).toBe('resolved-key-123-another-value')
  })

  it('ignores non-env placeholders', () => {
    expect(resolveEnvVars('${workspace:name}')).toBe('')
  })
})

// ─── LlmClient Tests ───────────────────────────────────────────────

describe('LlmClient', () => {
  it('delegates to the correct provider', async () => {
    const mockProvider: LlmProvider = {
      async *stream() {
        yield { type: 'message_start', messageId: 'mock-1' }
        yield { type: 'message_end', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } }
      },
    }

    const client = new LlmClient(defaultConfig)
    client.registerProvider('anthropic', mockProvider)

    const events = await collectEvents(
      client.stream({
        requestId: 'r-1',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
      }),
    )

    expect(events[0]).toEqual({ type: 'message_start', messageId: 'mock-1' })
    expect(events[1]).toEqual({ type: 'message_end', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } })
  })

  it('yields error for unknown provider', async () => {
    const client = new LlmClient({ ...defaultConfig, provider: 'unknown-provider' })

    const events = await collectEvents(
      client.stream({
        requestId: 'r-2',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
      }),
    )

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ type: 'error', error: 'Unknown provider: unknown-provider' })
  })

  it('supports custom registered providers', async () => {
    const customProvider: LlmProvider = {
      async *stream() {
        yield { type: 'text_delta', text: 'Custom response' }
        yield { type: 'message_end', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } }
      },
    }

    const client = new LlmClient({ ...defaultConfig, provider: 'custom' })
    client.registerProvider('custom', customProvider)

    const events = await collectEvents(
      client.stream({
        requestId: 'r-3',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
      }),
    )

    expect(events[0]).toEqual({ type: 'text_delta', text: 'Custom response' })
  })

  it('abort cancels a specific request', async () => {
    let aborted = false
    const slowProvider: LlmProvider = {
      async *stream(_params, _config, signal) {
        signal.addEventListener('abort', () => { aborted = true })
        // Simulate a long-running request
        yield { type: 'message_start', messageId: 'slow-1' }
        // The abort should prevent further yields in real usage
      },
    }

    const client = new LlmClient(defaultConfig)
    client.registerProvider('anthropic', slowProvider)

    // Start consuming but abort after first event
    const gen = client.stream({
      requestId: 'r-abort',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
    })

    await gen.next() // get message_start
    client.abort('r-abort')
    expect(aborted).toBe(true)
  })

  it('abortAll cancels all requests', async () => {
    let abortCount = 0
    const provider: LlmProvider = {
      async *stream(_params, _config, signal) {
        signal.addEventListener('abort', () => { abortCount++ })
        yield { type: 'message_start', messageId: 'x' }
      },
    }

    const client = new LlmClient(defaultConfig)
    client.registerProvider('anthropic', provider)

    const gen1 = client.stream({
      requestId: 'r-a1',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
    })
    const gen2 = client.stream({
      requestId: 'r-a2',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
    })

    await gen1.next()
    await gen2.next()
    client.abortAll()
    expect(abortCount).toBe(2)
  })

  it('abort on unknown requestId is a no-op', () => {
    const client = new LlmClient(defaultConfig)
    expect(() => client.abort('nonexistent')).not.toThrow()
  })

  it('updateConfig changes the active provider and API key', async () => {
    const anthropicProvider: LlmProvider = {
      async *stream() {
        yield { type: 'text_delta', text: 'anthropic' }
      },
    }
    const openaiProvider: LlmProvider = {
      async *stream() {
        yield { type: 'text_delta', text: 'openai' }
      },
    }

    const client = new LlmClient(defaultConfig)
    client.registerProvider('anthropic', anthropicProvider)
    client.registerProvider('openai-compatible', openaiProvider)

    let events = await collectEvents(
      client.stream({ requestId: 'r-1', messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }] }),
    )
    expect((events[0] as { type: 'text_delta'; text: string }).text).toBe('anthropic')

    client.updateConfig({ ...defaultConfig, provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1' })

    events = await collectEvents(
      client.stream({ requestId: 'r-2', messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }] }),
    )
    expect((events[0] as { type: 'text_delta'; text: string }).text).toBe('openai')
  })

  it('resolves env vars in API key on construction', () => {
    vi.stubEnv('MY_KEY', 'secret-123')
    const client = new LlmClient({ ...defaultConfig, apiKey: '${env:MY_KEY}' })

    // Verify by checking that the provider receives the resolved key
    let receivedKey = ''
    const spyProvider: LlmProvider = {
      async *stream(_params, config) {
        receivedKey = config.apiKey
      },
    }
    client.registerProvider('anthropic', spyProvider)

    // Drain the generator
    const gen = client.stream({ requestId: 'r-env', messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }] })
    gen.next().then(() => gen.return(undefined))

    // Check after microtask
    return gen.next().then(() => {
      expect(receivedKey).toBe('secret-123')
      vi.unstubAllEnvs()
    })
  })
})
