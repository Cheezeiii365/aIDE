import { randomUUID } from 'crypto'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Query } from '@anthropic-ai/claude-agent-sdk'
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
        let sawResult = false
        for await (const message of queryInstance) {
          const events = normalizeClaudeMessage(message)
          for (const event of events) {
            if (event.type === 'result') {
              totalCostUsd += event.totalCostUsd
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
        isSuccess,
        raw: message,
      },
    })

    events.push({
      type: 'result',
      durationMs,
      totalCostUsd,
      isSuccess,
    })

    return events
  }

  return []
}
