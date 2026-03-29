/**
 * LLM Client — provider-agnostic orchestrator.
 *
 * Manages provider adapters, resolves API keys with ${env:VAR} interpolation,
 * handles request lifecycle and cancellation. Delegates streaming to the
 * appropriate provider adapter based on config.
 */

import type { LlmProviderConfig } from '@aide/shared'
import type { LlmProvider, LlmStreamEvent, StreamParams } from '@aide/shared'
import { AnthropicProvider } from './providers/anthropicProvider'
import { OpenAiCompatibleProvider } from './providers/openAiCompatibleProvider'

const ENV_VAR_RE = /\$\{([^}]+)\}/g

/**
 * Resolve `${env:VAR}` placeholders in a string.
 * Returns the original string if no placeholders are present.
 */
export function resolveEnvVars(input: string): string {
  return input.replace(ENV_VAR_RE, (_match, name: string) => {
    if (name.startsWith('env:')) {
      return process.env[name.slice(4)] ?? ''
    }
    return ''
  })
}

export class LlmClient {
  private providers = new Map<string, LlmProvider>()
  private config: LlmProviderConfig
  private resolvedApiKey: string
  private activeAbortControllers = new Map<string, AbortController>()

  constructor(config: LlmProviderConfig) {
    this.config = config
    this.resolvedApiKey = resolveEnvVars(config.apiKey)

    // Register built-in providers
    this.providers.set('anthropic', new AnthropicProvider())
    this.providers.set('openai-compatible', new OpenAiCompatibleProvider())
  }

  /** Register a custom provider adapter (e.g., for Google, Bedrock, etc.) */
  registerProvider(name: string, provider: LlmProvider): void {
    this.providers.set(name, provider)
  }

  /** Update configuration (e.g., when user changes settings). */
  updateConfig(config: LlmProviderConfig): void {
    this.config = config
    this.resolvedApiKey = resolveEnvVars(config.apiKey)
  }

  /**
   * Stream a completion from the configured provider.
   * Yields provider-agnostic LlmStreamEvent objects.
   */
  async *stream(params: StreamParams): AsyncGenerator<LlmStreamEvent> {
    const provider = this.providers.get(this.config.provider)
    if (!provider) {
      yield { type: 'error', error: `Unknown provider: ${this.config.provider}` }
      return
    }

    const controller = new AbortController()
    this.activeAbortControllers.set(params.requestId, controller)

    try {
      yield* provider.stream(params, {
        apiKey: this.resolvedApiKey,
        baseUrl: this.config.baseUrl,
        model: this.config.model,
        maxTokens: this.config.maxTokens,
      }, controller.signal)
    } finally {
      this.activeAbortControllers.delete(params.requestId)
    }
  }

  /** Cancel a specific in-flight request. */
  abort(requestId: string): void {
    this.activeAbortControllers.get(requestId)?.abort()
    this.activeAbortControllers.delete(requestId)
  }

  /** Cancel all in-flight requests. */
  abortAll(): void {
    for (const controller of this.activeAbortControllers.values()) {
      controller.abort()
    }
    this.activeAbortControllers.clear()
  }
}
