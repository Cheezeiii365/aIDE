import { randomUUID } from 'crypto'
import { spawn } from 'child_process'
import { createInterface } from 'readline'
import type { CliBackendAdapter, CliBackendRun, CliBackendTurnContext } from './types'

interface CodexAdapterOptions {
  executablePath: string
}

export function createCodexAdapter(options: CodexAdapterOptions): CliBackendAdapter {
  return {
    backend: 'codex',
    startTurn(context, emit) {
      const args = context.backendState.sessionId
        ? [
            'exec',
            'resume',
            '--json',
            '--skip-git-repo-check',
            context.backendState.sessionId,
            context.prompt,
          ]
        : ['exec', '--json', '--skip-git-repo-check', context.prompt]

      const proc = spawn(options.executablePath, args, {
        cwd: context.cwd,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      const completed = (async () => {
        const startedAt = Date.now()
        let stderr = ''
        let sawResult = false

        proc.stderr?.on('data', (chunk) => {
          stderr += chunk.toString()
        })

        if (proc.stdout) {
          const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity })
          for await (const line of rl) {
            const trimmed = line.trim()
            if (!trimmed) continue
            let event: Record<string, unknown>
            try {
              event = JSON.parse(trimmed) as Record<string, unknown>
            } catch {
              continue
            }

            const type = typeof event.type === 'string' ? event.type : ''
            if (type === 'thread.started' && typeof event.thread_id === 'string') {
              emit({ type: 'backend-state', patch: { sessionId: event.thread_id } })
              continue
            }

            if (type === 'item.started') {
              const item = asRecord(event.item)
              if (item?.type === 'command_execution') {
                emit({
                  type: 'message',
                  message: {
                    id: asString(item.id) ?? randomUUID(),
                    type: 'tool_use',
                    content: `Running command: ${asString(item.command) ?? 'shell command'}`,
                    timestamp: Date.now(),
                    toolName: 'shell',
                  },
                })
              }
              continue
            }

            if (type === 'item.completed') {
              const item = asRecord(event.item)
              if (!item) continue
              if (item.type === 'agent_message') {
                emit({
                  type: 'message',
                  message: {
                    id: asString(item.id) ?? randomUUID(),
                    type: 'assistant',
                    content: asString(item.text) ?? '',
                    timestamp: Date.now(),
                    raw: event,
                  },
                })
                continue
              }

              if (item.type === 'command_execution') {
                const output = asString(item.aggregated_output)?.trim()
                const command = asString(item.command) ?? 'shell command'
                const exitCode = typeof item.exit_code === 'number' ? item.exit_code : null
                emit({
                  type: 'message',
                  message: {
                    id: asString(item.id) ?? randomUUID(),
                    type: 'tool_result',
                    content:
                      output || `${command}${exitCode === null ? '' : `\n(exit ${exitCode})`}`,
                    timestamp: Date.now(),
                    toolName: 'shell',
                  },
                })
              }
              continue
            }

            if (type === 'turn.completed') {
              sawResult = true
              const usage = asRecord(event.usage)
              const outputTokens =
                typeof usage?.output_tokens === 'number' ? usage.output_tokens : 0
              emit({
                type: 'message',
                message: {
                  id: randomUUID(),
                  type: 'result',
                  content: `Completed in ${((Date.now() - startedAt) / 1000).toFixed(1)}s${outputTokens > 0 ? ` (${outputTokens} output tokens)` : ''}`,
                  timestamp: Date.now(),
                  isSuccess: true,
                },
              })
              emit({
                type: 'result',
                durationMs: Date.now() - startedAt,
                totalCostUsd: 0,
                isSuccess: true,
              })
            }
          }
        }

        const exitCode = await new Promise<number | null>((resolve, reject) => {
          proc.once('error', reject)
          proc.once('close', resolve)
        })

        if ((exitCode ?? 0) !== 0 && !sawResult) {
          throw new Error(stderr.trim() || `Codex exited with code ${exitCode}`)
        }
      })()

      return {
        close() {
          proc.kill('SIGTERM')
        },
        completed,
      } satisfies CliBackendRun
    },
  }
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' ? (value as Record<string, any>) : null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
