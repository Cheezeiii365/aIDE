import { describe, it, expect } from 'vitest'
import {
  convertOpenCodePart,
  createConvertContext,
  extractTokens,
  sumTokens,
} from '@main/chat/cliAdapters/openCodePartConverter'

describe('convertOpenCodePart', () => {
  it('text part with delta returns isTextDelta true and no message', () => {
    const ctx = createConvertContext()
    const result = convertOpenCodePart(
      { id: 'p1', type: 'text', text: 'hi', messageID: 'm1' },
      'hi',
      ctx,
    )
    expect(result.isTextDelta).toBe(true)
    expect(result.delta).toBe('hi')
    expect(result.messages).toEqual([])
  })

  it('reasoning part emits a reasoning message once per partId', () => {
    const ctx = createConvertContext()
    const part = { id: 'r1', type: 'reasoning', text: 'thinking…' }
    const first = convertOpenCodePart(part, undefined, ctx)
    const second = convertOpenCodePart(part, undefined, ctx)
    expect(first.messages[0]?.type).toBe('reasoning')
    expect(second.messages).toHaveLength(0)
  })

  it('tool part dedupes repeated statuses but emits on transitions', () => {
    const ctx = createConvertContext()
    const base = { id: 't1', type: 'tool', tool: 'bash', callID: 'c1' }
    const pending1 = convertOpenCodePart(
      { ...base, state: { status: 'pending' } },
      undefined,
      ctx,
    )
    const pending2 = convertOpenCodePart(
      { ...base, state: { status: 'pending' } },
      undefined,
      ctx,
    )
    const running = convertOpenCodePart({ ...base, state: { status: 'running' } }, undefined, ctx)
    const completed = convertOpenCodePart(
      { ...base, state: { status: 'completed', output: 'ok' } },
      undefined,
      ctx,
    )
    expect(pending1.messages[0]?.type).toBe('tool_use')
    // Repeated pending → no new message
    expect(pending2.messages).toHaveLength(0)
    // pending → running transition → another tool_use message
    expect(running.messages[0]?.type).toBe('tool_use')
    expect(completed.messages[0]?.type).toBe('tool_result')
  })

  it('patch part captures hash + files', () => {
    const ctx = createConvertContext()
    const result = convertOpenCodePart(
      { id: 'p1', type: 'patch', hash: 'abc123def', files: ['a.ts', 'b.ts'] },
      undefined,
      ctx,
    )
    expect(result.messages[0]).toMatchObject({
      type: 'patch',
      patchHash: 'abc123def',
      patchFiles: ['a.ts', 'b.ts'],
    })
  })

  it('step-finish carries cost + tokens', () => {
    const ctx = createConvertContext()
    const result = convertOpenCodePart(
      {
        id: 's1',
        type: 'step-finish',
        reason: 'turn complete',
        cost: 0.0021,
        tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 5, write: 2 } },
      },
      undefined,
      ctx,
    )
    const msg = result.messages[0]!
    expect(msg.type).toBe('step')
    expect(msg.stepPhase).toBe('finish')
    expect(msg.costUsd).toBe(0.0021)
    expect(msg.tokens).toEqual({
      input: 100,
      output: 50,
      reasoning: 0,
      cacheRead: 5,
      cacheWrite: 2,
    })
  })

  it('snapshot / retry / compaction / agent / subtask all map to their type', () => {
    const ctx = createConvertContext()
    expect(
      convertOpenCodePart({ id: '1', type: 'snapshot', snapshot: 'h' }, undefined, ctx).messages[0]
        ?.type,
    ).toBe('snapshot')
    expect(
      convertOpenCodePart(
        { id: '2', type: 'retry', attempt: 2, error: { data: { message: 'oops' } } },
        undefined,
        ctx,
      ).messages[0]?.type,
    ).toBe('retry')
    expect(
      convertOpenCodePart({ id: '3', type: 'compaction', auto: true }, undefined, ctx).messages[0]
        ?.type,
    ).toBe('compaction')
    expect(
      convertOpenCodePart({ id: '4', type: 'agent', name: 'build' }, undefined, ctx).messages[0]
        ?.type,
    ).toBe('agent_change')
    expect(
      convertOpenCodePart(
        { id: '5', type: 'subtask', prompt: 'do x', description: 'd', agent: 'a' },
        undefined,
        ctx,
      ).messages[0]?.type,
    ).toBe('subtask')
  })

  it('unknown part type falls back to system', () => {
    const ctx = createConvertContext()
    const result = convertOpenCodePart({ id: '?', type: 'mystery' }, undefined, ctx)
    expect(result.messages[0]?.type).toBe('system')
    expect(result.messages[0]?.content).toContain('mystery')
  })
})

describe('extractTokens', () => {
  it('extracts a non-empty token usage record', () => {
    expect(
      extractTokens({ input: 10, output: 5, reasoning: 0, cache: { read: 2, write: 0 } }),
    ).toEqual({
      input: 10,
      output: 5,
      reasoning: 0,
      cacheRead: 2,
      cacheWrite: 0,
    })
  })

  it('returns undefined when all fields are zero / missing', () => {
    expect(extractTokens(undefined)).toBeUndefined()
    expect(extractTokens({ input: 0, output: 0 })).toBeUndefined()
  })
})

describe('sumTokens', () => {
  it('sums two records', () => {
    expect(
      sumTokens(
        { input: 1, output: 2, reasoning: 3, cacheRead: 4, cacheWrite: 5 },
        { input: 10, output: 20, reasoning: 30, cacheRead: 40, cacheWrite: 50 },
      ),
    ).toEqual({ input: 11, output: 22, reasoning: 33, cacheRead: 44, cacheWrite: 55 })
  })

  it('handles undefined operands', () => {
    expect(sumTokens(undefined, { input: 1, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }))
      .toEqual({ input: 1, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 })
  })
})
