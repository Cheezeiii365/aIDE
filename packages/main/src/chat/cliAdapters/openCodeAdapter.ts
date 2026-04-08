import { randomUUID } from 'crypto'
import { spawn, type ChildProcess } from 'child_process'
import { createServer } from 'net'
import { createOpencodeClient } from '@opencode-ai/sdk/client'
import type { CliBackendAdapter, CliBackendRun, CliBackendTurnContext } from './types'

interface OpenCodeAdapterOptions {
  executablePath: string
}

export function createOpenCodeAdapter(options: OpenCodeAdapterOptions): CliBackendAdapter {
  return {
    backend: 'opencode',
    startTurn(context, emit) {
      let serverProc: ChildProcess | null = null
      let currentSessionId = context.backendState.sessionId
      let closed = false

      const completed = (async () => {
        const startedAt = Date.now()
        const port = await reservePort()
        const url = `http://127.0.0.1:${port}`
        serverProc = spawn(
          options.executablePath,
          ['serve', '--hostname=127.0.0.1', `--port=${port}`],
          {
            env: {
              ...process.env,
              OPENCODE_CONFIG_CONTENT: JSON.stringify({}),
            },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        )

        if (!serverProc) throw new Error('Failed to start OpenCode server process')
        await waitForOpenCodeServer(serverProc, url)

        const client = createOpencodeClient({
          baseUrl: url,
          directory: context.cwd,
          responseStyle: 'data',
          throwOnError: true,
        })

        if (!currentSessionId) {
          const created = await client.session.create({ responseStyle: 'data', throwOnError: true })
          currentSessionId = created.data.id
          emit({ type: 'backend-state', patch: { sessionId: created.data.id } })
        }

        if (!currentSessionId) {
          throw new Error('Failed to initialize OpenCode session')
        }

        const sse = await client.global.event({ signal: undefined })
        const textByMessageId = new Map<string, string>()
        const timestampByMessageId = new Map<string, number>()
        const emittedAssistantIds = new Set<string>()
        const seenToolStates = new Map<string, string>()
        const costByMessageId = new Map<string, number>()
        let totalCostUsd = 0
        let failedError: string | null = null
        let promptSubmitted = false

        const streamTask = (async () => {
          for await (const rawEvent of sse.stream) {
            const event = rawEvent as Record<string, any>
            const type = typeof event.type === 'string' ? event.type : ''
            const props = asRecord(event.properties)

            if (type === 'message.updated' && props?.info) {
              const info = props.info as Record<string, any>
              const sessionId = asString(info.sessionID)
              if (!sessionId || sessionId !== currentSessionId) continue

              const messageId = asString(info.id) ?? randomUUID()
              if (info.role === 'assistant') {
                const model =
                  [asString(info.providerID), asString(info.modelID)].filter(Boolean).join('/') ||
                  undefined
                const createdAt =
                  typeof info.time?.created === 'number' ? info.time.created : Date.now()
                timestampByMessageId.set(messageId, createdAt)
                emit({ type: 'session-meta', model })
                emit({ type: 'backend-state', patch: { sessionId, model } })

                const nextCost = typeof info.cost === 'number' ? info.cost : 0
                const prevCost = costByMessageId.get(messageId) ?? 0
                totalCostUsd += Math.max(0, nextCost - prevCost)
                costByMessageId.set(messageId, nextCost)

                const errorText = renderOpenCodeError(info.error)
                if (errorText) {
                  failedError = errorText
                }
              }
              continue
            }

            if (type === 'message.part.updated' && props?.part) {
              const part = props.part as Record<string, any>
              if (asString(part.sessionID) !== currentSessionId) continue
              const partType = asString(part.type)

              if (partType === 'text') {
                const messageId = asString(part.messageID) ?? randomUUID()
                const delta = asString(props.delta)
                if (delta) {
                  const prior = textByMessageId.get(messageId) ?? ''
                  textByMessageId.set(messageId, prior + delta)
                  emit({ type: 'stream-delta', messageId, delta })
                } else {
                  textByMessageId.set(messageId, asString(part.text) ?? '')
                }
                continue
              }

              if (partType === 'tool') {
                const partId = asString(part.id) ?? randomUUID()
                const state = asRecord(part.state)
                const status = asString(state?.status) ?? 'pending'
                const priorStatus = seenToolStates.get(partId)
                if (priorStatus === status) continue
                seenToolStates.set(partId, status)

                const toolName = asString(part.tool) ?? 'tool'
                if (status === 'pending' || status === 'running') {
                  emit({
                    type: 'message',
                    message: {
                      id: partId,
                      type: 'tool_use',
                      content: `Running ${toolName}...`,
                      timestamp: Date.now(),
                      toolName,
                      toolUseId: asString(part.callID),
                    },
                  })
                } else if (status === 'completed') {
                  emit({
                    type: 'message',
                    message: {
                      id: partId,
                      type: 'tool_result',
                      content:
                        asString(state?.output) ??
                        asString(state?.title) ??
                        `${toolName} completed`,
                      timestamp: Date.now(),
                      toolName,
                      toolUseId: asString(part.callID),
                    },
                  })
                } else if (status === 'error') {
                  emit({
                    type: 'message',
                    message: {
                      id: partId,
                      type: 'error',
                      content: asString(state?.error) ?? `${toolName} failed`,
                      timestamp: Date.now(),
                      toolName,
                      toolUseId: asString(part.callID),
                    },
                  })
                }
              }
              continue
            }

            if (type === 'session.error' && props) {
              if (
                currentSessionId &&
                asString(props.sessionID) &&
                asString(props.sessionID) !== currentSessionId
              ) {
                continue
              }
              failedError = renderOpenCodeError(props.error) ?? 'OpenCode session failed'
              continue
            }

            if (
              type === 'session.idle' &&
              asString(props?.sessionID) === currentSessionId &&
              promptSubmitted
            ) {
              break
            }
          }
        })()

        await client.session.promptAsync({
          responseStyle: 'data',
          throwOnError: true,
          path: { id: currentSessionId },
          body: {
            parts: [{ type: 'text', text: context.prompt }],
          },
        })
        promptSubmitted = true

        await streamTask

        for (const [messageId, text] of textByMessageId) {
          if (!text || emittedAssistantIds.has(messageId)) continue
          emittedAssistantIds.add(messageId)
          emit({
            type: 'message',
            message: {
              id: messageId,
              type: 'assistant',
              content: text,
              timestamp: timestampByMessageId.get(messageId) ?? Date.now(),
            },
          })
        }

        if (failedError) {
          emit({
            type: 'message',
            message: {
              id: randomUUID(),
              type: 'error',
              content: failedError,
              timestamp: Date.now(),
            },
          })
          emit({
            type: 'result',
            durationMs: Date.now() - startedAt,
            totalCostUsd,
            isSuccess: false,
          })
          return
        }

        emit({
          type: 'message',
          message: {
            id: randomUUID(),
            type: 'result',
            content: `Completed in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
            timestamp: Date.now(),
            totalCostUsd,
            isSuccess: true,
          },
        })
        emit({
          type: 'result',
          durationMs: Date.now() - startedAt,
          totalCostUsd,
          isSuccess: true,
        })
      })().finally(() => {
        if (!closed) {
          serverProc?.kill('SIGTERM')
        }
      })

      return {
        close() {
          closed = true
          serverProc?.kill('SIGTERM')
        },
        completed,
      } satisfies CliBackendRun
    },
  }
}

async function reservePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : null
      server.close((error) => {
        if (error) reject(error)
        else if (typeof port === 'number') resolve(port)
        else reject(new Error('Failed to reserve OpenCode port'))
      })
    })
  })
}

async function waitForOpenCodeServer(proc: ChildProcess, url: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timeout waiting for OpenCode server to start'))
    }, 5000)

    let output = ''
    const onData = (chunk: Buffer) => {
      output += chunk.toString()
      if (output.includes(url) || output.includes('opencode server listening')) {
        cleanup()
        resolve()
      }
    }
    const onExit = (code: number | null) => {
      cleanup()
      reject(new Error(`OpenCode server exited with code ${code}${output ? `\n${output}` : ''}`))
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const cleanup = () => {
      clearTimeout(timeout)
      proc.stdout?.off('data', onData)
      proc.stderr?.off('data', onData)
      proc.off('exit', onExit)
      proc.off('error', onError)
    }

    proc.stdout?.on('data', onData)
    proc.stderr?.on('data', onData)
    proc.once('exit', onExit)
    proc.once('error', onError)
  })
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' ? (value as Record<string, any>) : null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function renderOpenCodeError(value: unknown): string | null {
  const error = asRecord(value)
  const data = asRecord(error?.data)
  const message = asString(data?.message)
  return message ?? null
}
