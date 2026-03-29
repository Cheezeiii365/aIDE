/**
 * OpenAI-compatible Chat Completions API provider adapter.
 *
 * Covers OpenAI, Ollama, Together, Groq, and any other provider
 * that implements the OpenAI Chat Completions streaming API.
 *
 * Transforms canonical LlmMessage format to OpenAI wire format,
 * makes streaming requests, and maps SSE chunks to LlmStreamEvent.
 */

import type {
  LlmProvider, LlmStreamEvent, StreamParams,
  LlmMessage, LlmContentBlock, LlmToolDefinition,
  OpenAiRequest, OpenAiMessage, OpenAiToolCall, OpenAiTool,
  OpenAiStreamChunk, OpenAiStreamToolCall,
} from '@aide/shared'
import { parseSseStream } from './sseParser'

// ─── Format Transformation ──────────────────────────────────────────

export function toOpenAiMessages(messages: LlmMessage[], system?: string): OpenAiMessage[] {
  const result: OpenAiMessage[] = []

  if (system) {
    result.push({ role: 'system', content: system })
  }

  for (const msg of messages) {
    if (msg.role === 'user') {
      // Check for tool_result blocks — they become separate tool messages
      const toolResults = msg.content.filter((b): b is Extract<LlmContentBlock, { type: 'tool_result' }> => b.type === 'tool_result')
      const textBlocks = msg.content.filter((b): b is Extract<LlmContentBlock, { type: 'text' }> => b.type === 'text')

      for (const tr of toolResults) {
        result.push({
          role: 'tool',
          content: tr.content,
          tool_call_id: tr.toolUseId,
        })
      }

      if (textBlocks.length > 0) {
        result.push({
          role: 'user',
          content: textBlocks.map((b) => b.text).join('\n'),
        })
      }
    } else if (msg.role === 'assistant') {
      const textBlocks = msg.content.filter((b): b is Extract<LlmContentBlock, { type: 'text' }> => b.type === 'text')
      const toolUseBlocks = msg.content.filter((b): b is Extract<LlmContentBlock, { type: 'tool_use' }> => b.type === 'tool_use')

      const oaiMsg: OpenAiMessage = {
        role: 'assistant',
        content: textBlocks.length > 0 ? textBlocks.map((b) => b.text).join('\n') : null,
      }

      if (toolUseBlocks.length > 0) {
        oaiMsg.tool_calls = toolUseBlocks.map(toOpenAiToolCall)
      }

      result.push(oaiMsg)
    }
  }

  return result
}

function toOpenAiToolCall(block: Extract<LlmContentBlock, { type: 'tool_use' }>): OpenAiToolCall {
  return {
    id: block.id,
    type: 'function',
    function: {
      name: block.name,
      arguments: JSON.stringify(block.input),
    },
  }
}

export function toOpenAiTools(tools: LlmToolDefinition[]): OpenAiTool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }))
}

// ─── Provider Implementation ────────────────────────────────────────

export class OpenAiCompatibleProvider implements LlmProvider {
  async *stream(
    params: StreamParams,
    config: { apiKey: string; baseUrl?: string; model: string; maxTokens: number },
    signal: AbortSignal,
  ): AsyncGenerator<LlmStreamEvent> {
    if (!config.baseUrl) {
      yield { type: 'error', error: 'OpenAI-compatible provider requires a baseUrl' }
      return
    }

    const body: OpenAiRequest = {
      model: params.model ?? config.model,
      max_tokens: params.maxTokens ?? config.maxTokens,
      messages: toOpenAiMessages(params.messages, params.system),
      stream: true,
      stream_options: { include_usage: true },
      ...(params.tools?.length ? { tools: toOpenAiTools(params.tools) } : {}),
    }

    let response: Response
    try {
      response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      })
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return
      yield { type: 'error', error: `Network error: ${err instanceof Error ? err.message : String(err)}` }
      return
    }

    if (!response.ok) {
      let errorBody = ''
      try { errorBody = await response.text() } catch { /* ignore */ }
      yield { type: 'error', error: `API error (${response.status}): ${errorBody}` }
      return
    }

    if (!response.body) {
      yield { type: 'error', error: 'No response body received' }
      return
    }

    // Track active tool calls by index
    const activeToolCalls = new Map<number, { id: string; name: string }>()
    let messageId = ''
    let totalPromptTokens = 0
    let totalCompletionTokens = 0

    try {
      for await (const sse of parseSseStream(response.body)) {
        let chunk: OpenAiStreamChunk
        try {
          chunk = JSON.parse(sse.data) as OpenAiStreamChunk
        } catch {
          yield { type: 'error', error: `Failed to parse SSE data: ${sse.data}` }
          continue
        }

        // Track message ID from first chunk
        if (!messageId && chunk.id) {
          messageId = chunk.id
          yield { type: 'message_start', messageId }
        }

        // Track usage if provided
        if (chunk.usage) {
          totalPromptTokens = chunk.usage.prompt_tokens
          totalCompletionTokens = chunk.usage.completion_tokens
        }

        const choice = chunk.choices?.[0]
        if (!choice) continue

        // Text content
        if (choice.delta.content) {
          yield { type: 'text_delta', text: choice.delta.content }
        }

        // Tool calls
        if (choice.delta.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            yield* this.handleToolCallDelta(tc, activeToolCalls)
          }
        }

        // Finish
        if (choice.finish_reason) {
          // Close any open tool calls
          for (const [idx, tc] of activeToolCalls) {
            yield { type: 'tool_use_end', id: tc.id }
            activeToolCalls.delete(idx)
          }

          yield {
            type: 'message_end',
            stopReason: mapFinishReason(choice.finish_reason),
            usage: {
              inputTokens: totalPromptTokens,
              outputTokens: totalCompletionTokens,
            },
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return
      yield { type: 'error', error: `Stream error: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  private *handleToolCallDelta(
    tc: OpenAiStreamToolCall,
    activeToolCalls: Map<number, { id: string; name: string }>,
  ): Generator<LlmStreamEvent> {
    if (tc.id && tc.function.name) {
      // First chunk for this tool call — start event
      activeToolCalls.set(tc.index, { id: tc.id, name: tc.function.name })
      yield { type: 'tool_use_start', id: tc.id, name: tc.function.name }
      if (tc.function.arguments) {
        yield { type: 'tool_use_delta', id: tc.id, partialJson: tc.function.arguments }
      }
    } else {
      // Subsequent chunk — delta with argument fragments
      const active = activeToolCalls.get(tc.index)
      if (active && tc.function.arguments) {
        yield { type: 'tool_use_delta', id: active.id, partialJson: tc.function.arguments }
      }
    }
  }
}

function mapFinishReason(reason: string): string {
  switch (reason) {
    case 'stop': return 'end_turn'
    case 'tool_calls': return 'tool_use'
    case 'length': return 'max_tokens'
    default: return reason
  }
}
