/**
 * Anthropic Messages API provider adapter.
 *
 * Transforms canonical LlmMessage format to Anthropic wire format,
 * makes streaming requests, and maps SSE events to LlmStreamEvent.
 */

import type {
  LlmProvider, LlmStreamEvent, StreamParams,
  LlmMessage, LlmContentBlock, LlmToolDefinition,
  AnthropicRequest, AnthropicMessage, AnthropicContentBlock, AnthropicTool,
  AnthropicStreamEvent,
} from '@aide/shared'
import { parseSseStream } from './sseParser'

const DEFAULT_BASE_URL = 'https://api.anthropic.com'
const API_VERSION = '2023-06-01'

// ─── Format Transformation ──────────────────────────────────────────

export function toAnthropicMessages(messages: LlmMessage[]): AnthropicMessage[] {
  return messages.map((msg) => ({
    role: msg.role,
    content: msg.content.map(toAnthropicBlock),
  }))
}

function toAnthropicBlock(block: LlmContentBlock): AnthropicContentBlock {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text }
    case 'tool_use':
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input }
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: block.toolUseId,
        content: block.content,
        ...(block.isError ? { is_error: true } : {}),
      }
  }
}

export function toAnthropicTools(tools: LlmToolDefinition[]): AnthropicTool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }))
}

// ─── Provider Implementation ────────────────────────────────────────

export class AnthropicProvider implements LlmProvider {
  async *stream(
    params: StreamParams,
    config: { apiKey: string; baseUrl?: string; model: string; maxTokens: number },
    signal: AbortSignal,
  ): AsyncGenerator<LlmStreamEvent> {
    const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL
    const body: AnthropicRequest = {
      model: params.model ?? config.model,
      max_tokens: params.maxTokens ?? config.maxTokens,
      messages: toAnthropicMessages(params.messages),
      stream: true,
      ...(params.system ? { system: params.system } : {}),
      ...(params.tools?.length ? { tools: toAnthropicTools(params.tools) } : {}),
    }

    const url = `${baseUrl}/v1/messages`
    console.log('[AnthropicProvider] Sending request', {
      url,
      model: body.model,
      maxTokens: body.max_tokens,
      messageCount: body.messages.length,
      toolCount: body.tools?.length ?? 0,
      hasSystem: !!body.system,
      hasApiKey: !!config.apiKey,
      apiKeyPrefix: config.apiKey ? config.apiKey.slice(0, 12) + '...' : '(empty)',
    })

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': API_VERSION,
        },
        body: JSON.stringify(body),
        signal,
      })
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return
      console.error('[AnthropicProvider] Network error:', err)
      yield { type: 'error', error: `Network error: ${err instanceof Error ? err.message : String(err)}` }
      return
    }

    console.log('[AnthropicProvider] Response', { status: response.status, ok: response.ok })

    if (!response.ok) {
      let errorBody = ''
      try { errorBody = await response.text() } catch { /* ignore */ }
      console.error('[AnthropicProvider] API error', { status: response.status, body: errorBody })
      yield { type: 'error', error: `Anthropic API error (${response.status}): ${errorBody}` }
      return
    }

    if (!response.body) {
      yield { type: 'error', error: 'No response body received' }
      return
    }

    // Track content block indices to correlate tool_use deltas
    const blockIndex = new Map<number, { type: string; id?: string }>()
    let inputTokens = 0

    try {
      for await (const sse of parseSseStream(response.body)) {
        let event: AnthropicStreamEvent
        try {
          event = JSON.parse(sse.data) as AnthropicStreamEvent
        } catch {
          yield { type: 'error', error: `Failed to parse SSE data: ${sse.data}` }
          continue
        }

        switch (event.type) {
          case 'message_start':
            inputTokens = event.message.usage?.input_tokens ?? 0
            yield { type: 'message_start', messageId: event.message.id }
            break

          case 'content_block_start':
            blockIndex.set(event.index, {
              type: event.content_block.type,
              id: 'id' in event.content_block ? event.content_block.id : undefined,
            })
            if (event.content_block.type === 'tool_use') {
              yield { type: 'tool_use_start', id: event.content_block.id, name: event.content_block.name }
            }
            break

          case 'content_block_delta':
            if (event.delta.type === 'text_delta') {
              yield { type: 'text_delta', text: event.delta.text }
            } else if (event.delta.type === 'input_json_delta') {
              const block = blockIndex.get(event.index)
              if (block?.id) {
                yield { type: 'tool_use_delta', id: block.id, partialJson: event.delta.partial_json }
              }
            }
            break

          case 'content_block_stop': {
            const block = blockIndex.get(event.index)
            if (block?.type === 'tool_use' && block.id) {
              yield { type: 'tool_use_end', id: block.id }
            }
            blockIndex.delete(event.index)
            break
          }

          case 'message_delta':
            yield {
              type: 'message_end',
              stopReason: event.delta.stop_reason,
              usage: {
                inputTokens,
                outputTokens: event.usage.output_tokens,
              },
            }
            break

          case 'error':
            yield { type: 'error', error: `${event.error.type}: ${event.error.message}` }
            break

          case 'ping':
          case 'message_stop':
            // Ignored
            break
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return
      yield { type: 'error', error: `Stream error: ${err instanceof Error ? err.message : String(err)}` }
    }
  }
}
