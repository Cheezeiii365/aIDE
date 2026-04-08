import { randomUUID } from 'crypto'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Query } from '@anthropic-ai/claude-agent-sdk'
import type { CliAgentTokenUsage } from '@aide/shared'
import type {
  CliBackendAdapter,
  CliBackendEvent,
  CliBackendRun,
  CliBackendTurnContext,
} from './types'

interface ClaudeCodeAdapterOptions {
  executablePath: string
}

export function createClaudeCodeAdapter(options: ClaudeCodeAdapterOptions): CliBackendAdapter {
  return {
    backend: 'claude-code',
    startTurn(context, emit) {
      const abortController = new AbortController()
      const stderrChunks: string[] = []
      let queryInstance: Query | null = null

      const completed = (async () => {
        const startedAt = Date.now()
        const queryOptions: Record<string, unknown> = {
          cwd: context.cwd,
          abortController,
          includePartialMessages: true,
          pathToClaudeCodeExecutable: options.executablePath,
          permissionMode: 'default' as const,
          settingSources: ['user', 'project', 'local'],
          systemPrompt: { type: 'preset', preset: 'claude_code' },
          stderr: (data: string) => {
            stderrChunks.push(data)
          },
        }

        if (context.backendState.sessionId) {
          queryOptions.resume = context.backendState.sessionId
        }

        try {
          queryInstance = query({
            prompt: context.prompt,
            options: queryOptions as Parameters<typeof query>[0]['options'],
          })
        } catch (error) {
          throw new Error(renderClaudeError(error, stderrChunks))
        }

        let totalCostUsd = 0
        let totalTokens: CliAgentTokenUsage | undefined = undefined
        let sawResult = false
        for await (const message of queryInstance) {
          const events = normalizeClaudeMessage(message)
          for (const event of events) {
            if (event.type === 'result') {
              totalCostUsd += event.totalCostUsd
              if (event.tokens) {
                totalTokens = sumClaudeTokens(totalTokens, event.tokens)
              }
              sawResult = true
            }
            emit(event)
          }
        }

        if (!sawResult) {
          emit({
            type: 'result',
            durationMs: Date.now() - startedAt,
            totalCostUsd,
            tokens: totalTokens,
            isSuccess: true,
          })
        }
      })()

      return {
        close() {
          abortController.abort()
          queryInstance?.close()
        },
        completed,
      } satisfies CliBackendRun
    },
  }
}

function renderClaudeError(error: unknown, stderrChunks: string[]): string {
  const message = error instanceof Error ? error.message : String(error)
  const stderrText = stderrChunks.join('').trim()
  if (!stderrText) return message
  return `${message}\n\nstderr output:\n${stderrText.slice(-2000)}`
}

function normalizeClaudeMessage(message: any): CliBackendEvent[] {
  const type = message.type as string
  const subtype = message.subtype as string | undefined

  if (type === 'system') {
    if (subtype === 'init') {
      const sessionId = message.session_id as string | undefined
      const model = (message.model as string) ?? undefined
      const tools = Array.isArray(message.tools) ? (message.tools as string[]) : undefined
      if (sessionId) {
        return [
          {
            type: 'backend-state',
            patch: { sessionId, model },
          },
          {
            type: 'session-meta',
            model,
            tools,
          },
        ]
      }
      return [
        {
          type: 'session-meta',
          model,
          tools,
        },
      ]
    }

    if (subtype === 'status') {
      return [
        {
          type: 'message',
          message: {
            id: (message.uuid as string) ?? randomUUID(),
            type: 'status',
            content: String(message.status ?? message.message ?? 'status update'),
            timestamp: Date.now(),
          },
        },
      ]
    }

    return []
  }

  if (type === 'assistant') {
    const betaMessage = message.message
    if (!betaMessage || !Array.isArray(betaMessage.content)) return []

    let text = ''
    const events: CliBackendEvent[] = []
    for (const block of betaMessage.content) {
      if (block.type === 'text') {
        text += block.text ?? ''
      }
      if (block.type === 'tool_use') {
        events.push({
          type: 'message',
          message: {
            id: (block.id as string) ?? randomUUID(),
            type: 'tool_use',
            content: `Running ${block.name ?? 'tool'}...`,
            timestamp: Date.now(),
            toolName: block.name as string,
            toolUseId: block.id as string,
          },
        })
      }
    }

    if (text) {
      events.push({
        type: 'message',
        message: {
          id: (message.uuid as string) ?? randomUUID(),
          type: 'assistant',
          content: text,
          timestamp: Date.now(),
          raw: message,
        },
      })
    }

    return events
  }

  if (type === 'stream_event') {
    const event = message.event
    if (event?.type !== 'content_block_delta' || event.delta?.type !== 'text_delta') return []
    const text = (event.delta.text as string) ?? ''
    if (!text) return []
    return [
      {
        type: 'stream-delta',
        messageId: (message.uuid as string) ?? randomUUID(),
        delta: text,
      },
    ]
  }

  if (type === 'tool_progress') {
    return [
      {
        type: 'message',
        message: {
          id: (message.uuid as string) ?? randomUUID(),
          type: 'tool_use',
          content: `Running ${message.tool_name ?? 'tool'}...`,
          timestamp: Date.now(),
          toolName: (message.tool_name as string) ?? undefined,
          toolUseId: (message.tool_use_id as string) ?? undefined,
        },
      },
    ]
  }

  if (type === 'tool_use_summary') {
    return [
      {
        type: 'message',
        message: {
          id: (message.uuid as string) ?? randomUUID(),
          type: 'tool_result',
          content: (message.summary as string) ?? 'Tool completed',
          timestamp: Date.now(),
        },
      },
    ]
  }

  if (type === 'rate_limit_event') {
    return [
      {
        type: 'message',
        message: {
          id: randomUUID(),
          type: 'status',
          content: 'Rate limited',
          timestamp: Date.now(),
        },
      },
    ]
  }

  if (type === 'result') {
    const isSuccess = subtype === 'success'
    const durationMs = (message.duration_ms as number) ?? 0
    const totalCostUsd = (message.total_cost_usd as number) ?? 0
    const sessionId = message.session_id as string | undefined
    const errors = Array.isArray(message.errors) ? (message.errors as string[]) : []
    const errorDetail = errors.length > 0 ? errors.join('\n') : ''
    const tokens = extractClaudeTokens(message.usage)
    const events: CliBackendEvent[] = []

    if (sessionId) {
      events.push({
        type: 'backend-state',
        patch: { sessionId },
      })
    }

    events.push({
      type: 'message',
      message: {
        id: (message.uuid as string) ?? randomUUID(),
        type: isSuccess ? 'result' : 'error',
        content: isSuccess
          ? `Completed in ${(durationMs / 1000).toFixed(1)}s`
          : `Failed: ${subtype ?? 'unknown error'}${errorDetail ? `\n\n${errorDetail}` : ''}`,
        timestamp: Date.now(),
        durationMs,
        totalCostUsd,
        tokens,
        isSuccess,
        raw: message,
      },
    })

    events.push({
      type: 'result',
      durationMs,
      totalCostUsd,
      tokens,
      isSuccess,
    })

    return events
  }

  return []
}

/** Extract Claude SDK usage block (input_tokens / output_tokens / cache_*) into our shared shape. */
function extractClaudeTokens(usage: unknown): CliAgentTokenUsage | undefined {
  if (!usage || typeof usage !== 'object') return undefined
  const u = usage as Record<string, unknown>
  const input = numberOr(u.input_tokens, 0)
  const output = numberOr(u.output_tokens, 0)
  const cacheRead = numberOr(u.cache_read_input_tokens, 0)
  const cacheWrite = numberOr(u.cache_creation_input_tokens, 0)
  if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0) return undefined
  return {
    input,
    output,
    reasoning: 0,
    cacheRead,
    cacheWrite,
  }
}

function sumClaudeTokens(
  a: CliAgentTokenUsage | undefined,
  b: CliAgentTokenUsage | undefined,
): CliAgentTokenUsage | undefined {
  if (!a) return b
  if (!b) return a
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback
}
