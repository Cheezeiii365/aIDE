/**
 * OpenCodeServerHost — per-workspace persistent OpenCode server.
 *
 * Owns one `opencode serve` child process per workspace and a shared SSE
 * subscription that is fanned out to per-session listener bags. Adapters
 * (one per turn) attach to the host, get a client + a per-session event
 * subscription, run their turn, and detach — the server stays running for
 * the workspace's lifetime.
 *
 * Lifecycle:
 *   - `start()`        → idempotent; spawns + waits for "listening"
 *   - `subscribe(id)`  → returns an unsubscribe fn; emits opencode events
 *                        whose sessionID matches `id` (or null sessionID for
 *                        broadcast events like installation.*)
 *   - `respondPermission(sessionId, permissionId, response)` → POSTs
 *   - `dispose()`      → kills the process, aborts SSE, clears listeners
 *   - `setPath(path)`  → swap the binary used on next (re)start
 *
 * Multi-workspace parallelism is the default: each workspace's CliAgentManager
 * owns its own host instance; ports are reserved fresh per host so two hosts
 * never collide.
 */

import { spawn, type ChildProcess } from 'child_process'
import { createServer } from 'net'
import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { execFileSync } from 'child_process'
import { createOpencodeClient } from '@opencode-ai/sdk/client'

type OpencodeClient = ReturnType<typeof createOpencodeClient>

export type OpenCodeHostMode = 'auto' | 'external'

export interface OpenCodeHostOptions {
  workspaceRoot: string
  /** Explicit binary path; if set, "external" mode is forced. */
  explicitPath?: string
}

export interface OpenCodeServerInfoSnapshot {
  url: string
  mode: 'bundled' | 'external'
  pid?: number
  startedAt: number
}

type EventListener = (event: unknown) => void

interface SubscriberEntry {
  sessionId: string | null
  listener: EventListener
}

export class OpenCodeServerHost {
  private workspaceRoot: string
  private explicitPath: string

  private startPromise: Promise<void> | null = null
  private url: string | null = null
  private serverProc: ChildProcess | null = null
  private startedAt = 0
  private mode: 'bundled' | 'external' = 'bundled'
  private client: OpencodeClient | null = null
  private resolvedPath: string | null = null

  private subscribers = new Set<SubscriberEntry>()
  private sseAbort: AbortController | null = null
  private sseTask: Promise<void> | null = null
  private disposed = false

  constructor(options: OpenCodeHostOptions) {
    this.workspaceRoot = options.workspaceRoot
    this.explicitPath = options.explicitPath ?? ''
  }

  /** Returns the OpencodeClient (starts the host on first call). */
  async getClient(): Promise<OpencodeClient> {
    await this.start()
    if (!this.client) throw new Error('OpenCodeServerHost: client unavailable after start()')
    return this.client
  }

  /** Idempotent start. Re-entrant calls return the same promise. */
  async start(): Promise<void> {
    if (this.disposed) throw new Error('OpenCodeServerHost has been disposed')
    if (this.startPromise) return this.startPromise
    this.startPromise = this.doStart().catch((error) => {
      this.startPromise = null
      throw error
    })
    return this.startPromise
  }

  private async doStart(): Promise<void> {
    const binaryPath = this.resolveBinaryPath()
    if (!binaryPath) {
      throw new Error(
        'OpenCode CLI not found. Install opencode (npm i -g opencode-ai) or set agent.opencodePath in settings.',
      )
    }
    this.resolvedPath = binaryPath
    this.mode = this.explicitPath ? 'external' : 'bundled'

    const port = await reservePort()
    const url = `http://127.0.0.1:${port}`
    const proc = spawn(binaryPath, ['serve', '--hostname=127.0.0.1', `--port=${port}`], {
      env: {
        ...process.env,
        OPENCODE_CONFIG_CONTENT: JSON.stringify({}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    if (!proc) throw new Error('Failed to spawn OpenCode server process')

    try {
      await waitForOpenCodeServer(proc, url)
    } catch (error) {
      proc.kill('SIGTERM')
      throw error
    }

    this.serverProc = proc
    this.url = url
    this.startedAt = Date.now()

    this.client = createOpencodeClient({
      baseUrl: url,
      directory: this.workspaceRoot,
      responseStyle: 'data',
      throwOnError: true,
    } as Parameters<typeof createOpencodeClient>[0])

    proc.once('exit', (code, signal) => {
      if (this.disposed) return
      // Server crashed unexpectedly — clear state so the next call re-spawns.
      this.handleServerExit(`server exited (code=${code} signal=${signal})`)
    })

    // Start the shared SSE stream.
    this.beginSse()
  }

  private beginSse(): void {
    if (this.sseAbort) return
    if (!this.client) return
    this.sseAbort = new AbortController()
    const signal = this.sseAbort.signal
    const directory = this.workspaceRoot
    this.sseTask = (async () => {
      try {
        // Use `/event` (Event.subscribe) — it yields the unwrapped Event union
        // (`{ type, properties }`) directly and accepts a `directory` query
        // filter so we only receive events for this workspace's server.
        //
        // The previous implementation used `client.global.event()` which yields
        // `GlobalEvent = { directory, payload: Event }`; that wrapping caused
        // every dispatched event to look like `{ type: undefined }` and the
        // adapter would never observe `session.idle`, so OpenCode chats never
        // replied.
        const sse = await (this.client as unknown as {
          event: {
            subscribe: (opts: {
              query?: { directory?: string }
              signal?: AbortSignal
            }) => Promise<{ stream: AsyncIterable<unknown> }>
          }
        }).event.subscribe({ query: { directory }, signal })
        for await (const rawEvent of sse.stream) {
          if (signal.aborted) break
          this.dispatchEvent(rawEvent)
        }
      } catch (error) {
        if (signal.aborted || this.disposed) return
        // SSE crashed — surface as a synthetic event so listeners can react.
        this.dispatchEvent({
          type: 'sse.error',
          properties: {
            error: error instanceof Error ? error.message : String(error),
          },
        })
      }
    })()
  }

  private dispatchEvent(rawEvent: unknown): void {
    const event = rawEvent as { type?: string; properties?: Record<string, unknown> }
    const props = (event?.properties ?? {}) as Record<string, unknown>
    const explicitSessionID =
      typeof props.sessionID === 'string'
        ? (props.sessionID as string)
        : typeof (props.info as { sessionID?: string } | undefined)?.sessionID === 'string'
          ? ((props.info as { sessionID?: string }).sessionID as string)
          : typeof (props.part as { sessionID?: string } | undefined)?.sessionID === 'string'
            ? ((props.part as { sessionID?: string }).sessionID as string)
            : null

    for (const sub of this.subscribers) {
      if (sub.sessionId === null || explicitSessionID === null || sub.sessionId === explicitSessionID) {
        try {
          sub.listener(rawEvent)
        } catch {
          // Listener errors must not break the SSE pump.
        }
      }
    }
  }

  /**
   * Subscribe to events for a particular sessionId. Returns an unsubscribe fn.
   * Pass `null` to receive every event (used by diagnostics surfaces).
   */
  subscribe(sessionId: string | null, listener: EventListener): () => void {
    const entry: SubscriberEntry = { sessionId, listener }
    this.subscribers.add(entry)
    return () => {
      this.subscribers.delete(entry)
    }
  }

  /**
   * Respond to an OpenCode permission request. Wraps the SDK's
   * `postSessionIdPermissionsPermissionId` call so callers don't need to
   * worry about its long name.
   */
  async respondPermission(
    sessionId: string,
    permissionId: string,
    response: 'always' | 'once' | 'reject',
  ): Promise<void> {
    const client = await this.getClient()
    await (client as unknown as {
      postSessionIdPermissionsPermissionId: (opts: {
        path: { id: string; permissionID: string }
        body: { response: 'always' | 'once' | 'reject' }
      }) => Promise<unknown>
    }).postSessionIdPermissionsPermissionId({
      path: { id: sessionId, permissionID: permissionId },
      body: { response },
    })
  }

  getInfo(): OpenCodeServerInfoSnapshot | null {
    if (!this.url || !this.serverProc) return null
    return {
      url: this.url,
      mode: this.mode,
      pid: this.serverProc.pid,
      startedAt: this.startedAt,
    }
  }

  /** Update the explicit path used on next (re)start. Doesn't restart automatically. */
  setPath(explicitPath: string): void {
    this.explicitPath = explicitPath
    this.resolvedPath = null
  }

  /**
   * Restart the host: dispose current process and re-start. Subscribers are
   * preserved across restarts (they'll receive events from the new server).
   */
  async restart(): Promise<void> {
    await this.shutdownProcess('restart requested')
    this.disposed = false
    await this.start()
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await this.shutdownProcess('disposed')
    this.subscribers.clear()
  }

  private async shutdownProcess(reason: string): Promise<void> {
    void reason
    this.startPromise = null
    if (this.sseAbort) {
      try {
        this.sseAbort.abort()
      } catch {
        /* ignore */
      }
      this.sseAbort = null
    }
    if (this.sseTask) {
      try {
        await this.sseTask
      } catch {
        /* ignore */
      }
      this.sseTask = null
    }
    if (this.serverProc) {
      try {
        this.serverProc.kill('SIGTERM')
      } catch {
        /* ignore */
      }
      this.serverProc = null
    }
    this.client = null
    this.url = null
  }

  private handleServerExit(reason: string): void {
    void reason
    this.startPromise = null
    this.serverProc = null
    this.client = null
    this.url = null
    if (this.sseAbort) {
      try {
        this.sseAbort.abort()
      } catch {
        /* ignore */
      }
      this.sseAbort = null
    }
    this.sseTask = null
  }

  private resolveBinaryPath(): string | null {
    if (this.resolvedPath) return this.resolvedPath

    if (this.explicitPath && existsSync(this.explicitPath)) {
      return this.explicitPath
    }

    const candidates: string[] = []
    if (app.isPackaged) {
      candidates.push(
        join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '.bin', 'opencode'),
      )
    }
    candidates.push(
      join(app.getAppPath(), 'node_modules', '.bin', 'opencode'),
      join(this.workspaceRoot, 'node_modules', '.bin', 'opencode'),
    )

    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate
    }

    try {
      const result = execFileSync('which', ['opencode'], { encoding: 'utf-8' }).trim()
      if (result) return result
    } catch {
      // not on PATH
    }
    return null
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
      cleanup()
      reject(new Error('Timeout waiting for OpenCode server to start'))
    }, 8000)

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
