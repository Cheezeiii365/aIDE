/**
 * Watches ~/.claude/projects/<slug>/ with fs.watch.
 * Reads history.jsonl (when present) for session titles.
 * Emits ConversationMeta[] with source: 'claude-native' via the provided callback.
 * Tails per-session *.jsonl files to keep messageCount / updatedAt live.
 */

import { watch, createReadStream, type FSWatcher } from 'fs'
import { open, stat, readdir, realpath } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { createInterface } from 'readline'
import { randomUUID } from 'crypto'
import type { CliAgentMessage, ConversationMeta } from '@aide/shared'
import { deriveTitle } from '@aide/shared'

const UUID_JSONL =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i

const DEBOUNCE_MS = 150

export interface ClaudeNativeSessionWatcherOptions {
  /** Resolved workspace root (project path on disk). */
  workspaceRoot: string
  workspaceId: string
  /** Called whenever the native session list or stats change. */
  emit: (conversations: ConversationMeta[]) => void
}

interface SessionScan {
  sessionId: string
  messageCount: number
  updatedAt: number
  createdAt: number
  firstMessage?: string
}

interface TailState {
  size: number
  partial: string
}

/** Encode a project path the same way Claude Code stores under ~/.claude/projects/ */
export function encodeClaudeProjectSlug(resolvedPath: string): string {
  const normalized = resolvedPath.replace(/\\/g, '/')
  const trimmed = normalized.replace(/\/+$/, '') || '/'
  return trimmed.replace(/\//g, '-')
}

function parseJsonlTimestamp(raw: unknown): number | null {
  if (raw == null) return null
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string') {
    const t = Date.parse(raw)
    return Number.isNaN(t) ? null : t
  }
  return null
}

function isConversationLine(obj: Record<string, unknown>): boolean {
  const t = obj.type
  return t === 'user' || t === 'assistant'
}

function shouldSkipJsonlContentBlock(b: Record<string, unknown>): boolean {
  const t = b.type
  if (t === 'thinking' || t === 'redacted_thinking') return true
  if (t === 'file_history_snapshot' || t === 'file-history-snapshot') return true
  if (typeof t === 'string' && t.toLowerCase().includes('file_history')) return true
  return false
}

function mapJsonlUserLine(obj: Record<string, unknown>, lineUuid: string, ts: number): CliAgentMessage[] {
  const msg = obj.message
  if (!msg || typeof msg !== 'object') return []
  const m = msg as Record<string, unknown>
  const content = m.content
  const out: CliAgentMessage[] = []

  if (typeof content === 'string') {
    if (content) out.push({ id: lineUuid, type: 'user', content, timestamp: ts })
    return out
  }

  if (!Array.isArray(content)) return out

  let textBuf = ''
  const flushText = () => {
    if (!textBuf) return
    out.push({ id: lineUuid, type: 'user', content: textBuf, timestamp: ts })
    textBuf = ''
  }

  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown>
    if (shouldSkipJsonlContentBlock(b)) continue
    if (b.type === 'text') {
      textBuf += String(b.text ?? '')
    } else if (b.type === 'tool_result') {
      flushText()
      const toolUseId = typeof b.tool_use_id === 'string' ? b.tool_use_id : undefined
      out.push({
        id: toolUseId ?? randomUUID(),
        type: 'tool_result',
        content:
          typeof b.content === 'string'
            ? b.content
            : b.content != null
              ? JSON.stringify(b.content)
              : '',
        timestamp: ts,
        toolUseId,
      })
    }
  }
  flushText()
  return out
}

function mapJsonlAssistantLine(obj: Record<string, unknown>, lineUuid: string, ts: number): CliAgentMessage[] {
  const msg = obj.message
  if (!msg || typeof msg !== 'object') return []
  const m = msg as Record<string, unknown>
  const content = m.content
  if (!Array.isArray(content)) return []

  const out: CliAgentMessage[] = []
  let textBuf = ''
  let textSeg = 0

  const flushText = () => {
    if (!textBuf) return
    out.push({
      id: textSeg === 0 ? lineUuid : `${lineUuid}:t${textSeg}`,
      type: 'assistant',
      content: textBuf,
      timestamp: ts,
    })
    textSeg++
    textBuf = ''
  }

  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown>
    if (shouldSkipJsonlContentBlock(b)) continue

    if (b.type === 'text') {
      textBuf += String(b.text ?? '')
    } else if (b.type === 'tool_use') {
      flushText()
      const toolUseId = typeof b.id === 'string' ? b.id : randomUUID()
      const name = typeof b.name === 'string' ? b.name : 'tool'
      out.push({
        id: toolUseId,
        type: 'tool_use',
        content: `Running ${name}...`,
        timestamp: ts,
        toolName: name,
        toolUseId,
      })
    }
  }
  flushText()
  return out
}

function extractUserPreview(msg: Record<string, unknown>): string | undefined {
  const m = msg.message
  if (!m || typeof m !== 'object') return undefined
  const role = (m as { role?: string }).role
  if (role !== 'user') return undefined
  const content = (m as { content?: unknown }).content
  if (typeof content === 'string') return content.slice(0, 100)
  if (Array.isArray(content)) {
    const parts = content
      .map((p) => {
        if (typeof p === 'object' && p && 'text' in p && typeof (p as { text: unknown }).text === 'string') {
          return (p as { text: string }).text
        }
        return ''
      })
      .join('')
    return parts.slice(0, 100)
  }
  return undefined
}

async function readHistoryTitleMap(historyPath: string): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  try {
    await stat(historyPath)
  } catch {
    return map
  }

  const stream = createReadStream(historyPath, { encoding: 'utf8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })

  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const row = JSON.parse(trimmed) as Record<string, unknown>
      const sid =
        typeof row.sessionId === 'string'
          ? row.sessionId
          : typeof row.session_id === 'string'
            ? row.session_id
            : undefined
      const titleRaw =
        typeof row.title === 'string'
          ? row.title
          : typeof row.display === 'string'
            ? row.display
            : typeof row.name === 'string'
              ? row.name
              : undefined
      if (sid && titleRaw) map.set(sid, titleRaw)
    } catch {
      // skip bad lines
    }
  }
  return map
}

/** Full scan of a session JSONL (initial load or after truncate). */
async function scanSessionFile(filePath: string, sessionId: string): Promise<SessionScan> {
  let messageCount = 0
  let updatedAt = 0
  let createdAt = Number.POSITIVE_INFINITY
  let firstMessage: string | undefined
  let firstUserPreview: string | undefined

  const st = await stat(filePath)
  if (createdAt === Number.POSITIVE_INFINITY) {
    createdAt = st.birthtimeMs || st.mtimeMs
  }

  const stream = createReadStream(filePath, { encoding: 'utf8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })

  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      continue
    }
    if (!isConversationLine(obj)) continue

    messageCount++
    const ts = parseJsonlTimestamp(obj.timestamp)
    if (ts != null) {
      if (ts < createdAt) createdAt = ts
      if (ts > updatedAt) updatedAt = ts
    }

    const preview = extractUserPreview(obj)
    if (preview !== undefined && firstUserPreview === undefined) {
      firstUserPreview = preview
    }
  }

  if (createdAt === Number.POSITIVE_INFINITY) {
    createdAt = st.mtimeMs
  }
  if (updatedAt === 0) {
    updatedAt = st.mtimeMs
  }

  if (firstUserPreview !== undefined) {
    firstMessage = firstUserPreview
  }

  return { sessionId, messageCount, updatedAt, createdAt, firstMessage }
}

/** Apply appended bytes to existing scan stats (tail). */
function applyAppendedLines(
  base: SessionScan,
  text: string,
): SessionScan {
  const lines = text.split('\n')
  let messageCount = base.messageCount
  let updatedAt = base.updatedAt
  let createdAt = base.createdAt
  let firstMessage = base.firstMessage

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      continue
    }
    if (!isConversationLine(obj)) continue

    messageCount++
    const ts = parseJsonlTimestamp(obj.timestamp)
    if (ts != null) {
      if (ts < createdAt) createdAt = ts
      if (ts > updatedAt) updatedAt = ts
    }

    const preview = extractUserPreview(obj)
    if (preview !== undefined && firstMessage === undefined) {
      firstMessage = preview
    }
  }

  return { ...base, messageCount, updatedAt, createdAt, firstMessage }
}

async function readAppendTail(filePath: string, state: TailState): Promise<string> {
  const st = await stat(filePath)
  if (st.size <= state.size) return ''

  const fh = await open(filePath, 'r')
  try {
    const len = st.size - state.size
    const buf = Buffer.alloc(len)
    await fh.read(buf, 0, len, state.size)
    state.size = st.size
    return buf.toString('utf8')
  } finally {
    await fh.close()
  }
}

export class ClaudeNativeSessionWatcher {
  private readonly opts: ClaudeNativeSessionWatcherOptions
  private projectDir: string
  private dirWatcher: FSWatcher | null = null
  private parentWatcher: FSWatcher | null = null
  private debounce: ReturnType<typeof setTimeout> | null = null
  private titleMap: Map<string, string> = new Map()
  private sessionScans = new Map<string, SessionScan>()
  private tailState = new Map<string, TailState>()

  constructor(opts: ClaudeNativeSessionWatcherOptions) {
    this.opts = opts
    const slug = encodeClaudeProjectSlug(opts.workspaceRoot)
    this.projectDir = join(homedir(), '.claude', 'projects', slug)
  }

  private async resolveProjectDir(): Promise<string> {
    let root: string
    try {
      root = await realpath(this.opts.workspaceRoot)
    } catch {
      root = this.opts.workspaceRoot
    }
    const slug = encodeClaudeProjectSlug(root)
    this.projectDir = join(homedir(), '.claude', 'projects', slug)
    return this.projectDir
  }

  async start(): Promise<void> {
    await this.resolveProjectDir()

    await this.refreshTitleMap()
    await this.bootstrapSessions()
    this.emitNow()

    this.attachDirWatch()
  }

  stop(): void {
    if (this.debounce) {
      clearTimeout(this.debounce)
      this.debounce = null
    }
    this.dirWatcher?.close()
    this.dirWatcher = null
    this.parentWatcher?.close()
    this.parentWatcher = null
    this.sessionScans.clear()
    this.tailState.clear()
  }

  private scheduleRefresh(): void {
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = setTimeout(() => {
      this.debounce = null
      void this.runDebouncedRefresh()
    }, DEBOUNCE_MS)
  }

  private async runDebouncedRefresh(): Promise<void> {
    await this.refreshTitleMap()
    await this.syncSessionsFromDisk()
    this.emitNow()
  }

  private attachDirWatch(): void {
    const projectsRoot = join(homedir(), '.claude', 'projects')

    const tryProjectWatch = (): void => {
      try {
        this.dirWatcher?.close()
        this.dirWatcher = watch(this.projectDir, () => this.scheduleRefresh())
      } catch {
        this.dirWatcher = null
      }
    }

    tryProjectWatch()

    if (!this.dirWatcher) {
      try {
        this.parentWatcher?.close()
        this.parentWatcher = watch(projectsRoot, () => {
          try {
            this.dirWatcher?.close()
            this.dirWatcher = watch(this.projectDir, () => this.scheduleRefresh())
            this.parentWatcher?.close()
            this.parentWatcher = null
            void this.runDebouncedRefresh()
          } catch {
            // project dir still missing
          }
        })
      } catch {
        this.parentWatcher = null
      }
    }
  }

  private async refreshTitleMap(): Promise<void> {
    const historyPath = join(this.projectDir, 'history.jsonl')
    this.titleMap = await readHistoryTitleMap(historyPath)
  }

  private async bootstrapSessions(): Promise<void> {
    let names: string[]
    try {
      names = await readdir(this.projectDir)
    } catch {
      return
    }

    this.sessionScans.clear()
    this.tailState.clear()

    for (const name of names) {
      const m = name.match(UUID_JSONL)
      if (!m) continue
      const sessionId = m[1]
      const filePath = join(this.projectDir, name)
      const scan = await scanSessionFile(filePath, sessionId)
      this.sessionScans.set(sessionId, scan)
      const st = await stat(filePath)
      this.tailState.set(sessionId, { size: st.size, partial: '' })
    }
  }

  private async syncSessionsFromDisk(): Promise<void> {
    let names: string[]
    try {
      names = await readdir(this.projectDir)
    } catch {
      this.sessionScans.clear()
      this.tailState.clear()
      return
    }

    const seen = new Set<string>()

    for (const name of names) {
      const m = name.match(UUID_JSONL)
      if (!m) continue
      const sessionId = m[1]
      seen.add(sessionId)
      const filePath = join(this.projectDir, name)

      if (!this.sessionScans.has(sessionId)) {
        const scan = await scanSessionFile(filePath, sessionId)
        this.sessionScans.set(sessionId, scan)
        const st = await stat(filePath)
        this.tailState.set(sessionId, { size: st.size, partial: '' })
        continue
      }

      let tail = this.tailState.get(sessionId)
      if (!tail) {
        const st0 = await stat(filePath)
        tail = { size: st0.size, partial: '' }
        this.tailState.set(sessionId, tail)
      }

      try {
        const st = await stat(filePath)
        if (st.size < tail.size) {
          const scan = await scanSessionFile(filePath, sessionId)
          this.sessionScans.set(sessionId, scan)
          this.tailState.set(sessionId, { size: st.size, partial: '' })
          continue
        }

        const chunk = await readAppendTail(filePath, tail)
        if (chunk.length > 0) {
          const merged = tail.partial + chunk
          const lines = merged.split('\n')
          tail.partial = lines.pop() ?? ''
          const body = lines.length > 0 ? lines.join('\n') + '\n' : ''
          const prev = this.sessionScans.get(sessionId)!
          this.sessionScans.set(sessionId, applyAppendedLines(prev, body))
        }
      } catch {
        const scan = await scanSessionFile(filePath, sessionId)
        this.sessionScans.set(sessionId, scan)
        const st = await stat(filePath)
        this.tailState.set(sessionId, { size: st.size, partial: '' })
      }
    }

    for (const id of this.sessionScans.keys()) {
      if (!seen.has(id)) {
        this.sessionScans.delete(id)
        this.tailState.delete(id)
      }
    }
  }

  private buildMetas(): ConversationMeta[] {
    const { workspaceId } = this.opts
    const list: ConversationMeta[] = []

    for (const scan of this.sessionScans.values()) {
      const titled = this.titleMap.get(scan.sessionId)
      const preview = scan.firstMessage ?? ''
      const title =
        titled?.trim() ||
        (preview ? deriveTitle(preview) : `Chat ${scan.sessionId.slice(0, 8)}`)

      list.push({
        id: `claude-native:${scan.sessionId}`,
        workspaceId,
        backend: 'claude-code',
        title,
        autoTitled: !titled?.trim(),
        createdAt: scan.createdAt,
        updatedAt: scan.updatedAt,
        messageCount: scan.messageCount,
        firstMessage: scan.firstMessage,
        claudeSessionId: scan.sessionId,
        source: 'claude-native',
      })
    }

    list.sort((a, b) => b.updatedAt - a.updatedAt)
    return list
  }

  private emitNow(): void {
    this.opts.emit(this.buildMetas())
  }

  /**
   * Read ~/.claude/projects/<slug>/<sessionId>.jsonl and map user/assistant rows
   * to {@link CliAgentMessage} for CLI pane hydration.
   */
  async loadMessages(sessionId: string): Promise<CliAgentMessage[]> {
    const projectDir = await this.resolveProjectDir()
    const filePath = join(projectDir, `${sessionId}.jsonl`)
    try {
      await stat(filePath)
    } catch {
      return []
    }

    const out: CliAgentMessage[] = []
    const stream = createReadStream(filePath, { encoding: 'utf8' })
    const rl = createInterface({ input: stream, crlfDelay: Infinity })

    for await (const line of rl) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let obj: Record<string, unknown>
      try {
        obj = JSON.parse(trimmed) as Record<string, unknown>
      } catch {
        continue
      }
      if (obj.isSidechain === true) continue
      const topType = obj.type
      if (topType !== 'user' && topType !== 'assistant') continue

      const ts = parseJsonlTimestamp(obj.timestamp) ?? Date.now()
      const lineUuid = typeof obj.uuid === 'string' ? obj.uuid : randomUUID()

      if (topType === 'user') {
        out.push(...mapJsonlUserLine(obj, lineUuid, ts))
      } else {
        out.push(...mapJsonlAssistantLine(obj, lineUuid, ts))
      }
    }

    return out
  }
}
