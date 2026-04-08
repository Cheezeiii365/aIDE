/**
 * Conversation store — manages multi-conversation persistence on disk.
 *
 * Storage layout:
 *   .aide/local/conversations/
 *     index.json                 # ConversationMeta[]
 *     {conversationId}.json      # Full message data per conversation
 *
 * The index is lightweight (loaded on workspace switch). Individual
 * conversation message files are loaded on-demand when a tab opens.
 */

import { existsSync } from 'fs'
import { readFile, writeFile, rename, mkdir, unlink, rm } from 'fs/promises'
import { join, dirname } from 'path'
import { randomUUID } from 'crypto'
import type { ConversationMeta, ConversationCreateOpts } from '@aide/shared'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function atomicWrite(filePath: string, data: string): Promise<void> {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
  }
  const tmpPath = join(dir, `.tmp-${randomUUID()}.json`)
  await writeFile(tmpPath, data, 'utf-8')
  await rename(tmpPath, filePath)
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    if (!existsSync(filePath)) return null
    const raw = await readFile(filePath, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// ConversationStore
// ---------------------------------------------------------------------------

export class ConversationStore {
  private workspaceRoot: string
  private cachedIndex: ConversationMeta[] | null = null
  private mutationQueue: Promise<unknown> = Promise.resolve()

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot
  }

  /**
   * Serialize index read-modify-write operations to prevent races where
   * concurrent calls observe stale state and produce duplicate or lost
   * entries. The cached index array is shared by reference, so any mutation
   * path must run inside this queue.
   */
  private withIndexLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(fn, fn)
    this.mutationQueue = next.catch(() => {})
    return next
  }

  private get conversationsDir(): string {
    return join(this.workspaceRoot, '.aide', 'local', 'conversations')
  }

  private get indexPath(): string {
    return join(this.conversationsDir, 'index.json')
  }

  private messagePath(conversationId: string): string {
    return join(this.conversationsDir, `${conversationId}.json`)
  }

  // ─── Index Operations ────────────────────────

  async loadIndex(): Promise<ConversationMeta[]> {
    if (this.cachedIndex) return this.cachedIndex

    // Attempt V1 migration first
    await this.migrateV1()

    const index = await readJson<ConversationMeta[]>(this.indexPath)
    this.cachedIndex = index ?? []
    return this.cachedIndex
  }

  async saveIndex(metas: ConversationMeta[]): Promise<void> {
    this.cachedIndex = metas
    await atomicWrite(this.indexPath, JSON.stringify(metas, null, 2))
  }

  // ─── CRUD ────────────────────────────────────

  async create(opts: ConversationCreateOpts): Promise<ConversationMeta> {
    return this.withIndexLock(async () => {
      const index = await this.loadIndex()
      const now = Date.now()

      const meta: ConversationMeta = {
        id: randomUUID(),
        workspaceId: opts.workspaceId,
        backend: opts.backend,
        title: opts.title ?? 'New Chat',
        autoTitled: !opts.title,
        createdAt: now,
        updatedAt: now,
        messageCount: 0,
        worktreePath: opts.worktreePath,
        worktreeBranch: opts.worktreeBranch,
      }

      index.unshift(meta) // newest first
      await this.saveIndex(index)
      return meta
    })
  }

  async ensure(conversationId: string, opts: ConversationCreateOpts): Promise<ConversationMeta> {
    return this.withIndexLock(async () => {
      const index = await this.loadIndex()
      const existing = index.find((c) => c.id === conversationId)
      if (existing) return existing

      const now = Date.now()
      const meta: ConversationMeta = {
        id: conversationId,
        workspaceId: opts.workspaceId,
        backend: opts.backend,
        title: opts.title ?? 'New Chat',
        autoTitled: !opts.title,
        createdAt: now,
        updatedAt: now,
        messageCount: 0,
        worktreePath: opts.worktreePath,
        worktreeBranch: opts.worktreeBranch,
      }

      index.unshift(meta)
      await this.saveIndex(index)
      return meta
    })
  }

  async delete(conversationId: string): Promise<void> {
    await this.withIndexLock(async () => {
      const index = await this.loadIndex()
      const filtered = index.filter((c) => c.id !== conversationId)
      await this.saveIndex(filtered)
    })

    // Remove message file
    const msgPath = this.messagePath(conversationId)
    try {
      if (existsSync(msgPath)) await unlink(msgPath)
    } catch {
      // Ignore cleanup errors
    }
  }

  async get(conversationId: string): Promise<ConversationMeta | null> {
    const index = await this.loadIndex()
    return index.find((c) => c.id === conversationId) ?? null
  }

  async updateMeta(
    conversationId: string,
    patch: Partial<
      Pick<
        ConversationMeta,
        | 'backend'
        | 'title'
        | 'autoTitled'
        | 'updatedAt'
        | 'messageCount'
        | 'firstMessage'
        | 'claudeSessionId'
        | 'worktreePath'
      >
    >,
  ): Promise<void> {
    await this.withIndexLock(async () => {
      const index = await this.loadIndex()
      const entry = index.find((c) => c.id === conversationId)
      if (!entry) return

      Object.assign(entry, patch)
      await this.saveIndex(index)
    })
  }

  /**
   * Get the most recent conversation for a workspace with a given backend.
   * Returns null if no conversations exist.
   */
  async getMostRecent(workspaceId: string, backend?: string): Promise<ConversationMeta | null> {
    const index = await this.loadIndex()
    // Index is sorted newest-first
    if (backend) {
      return index.find((c) => c.workspaceId === workspaceId && c.backend === backend) ?? null
    }
    return index.find((c) => c.workspaceId === workspaceId) ?? null
  }

  // ─── Message Data ────────────────────────────

  async loadMessages(conversationId: string): Promise<unknown | null> {
    return readJson(this.messagePath(conversationId))
  }

  async saveMessages(conversationId: string, data: unknown): Promise<void> {
    await atomicWrite(this.messagePath(conversationId), JSON.stringify(data, null, 2))
  }

  // ─── V1 Migration ───────────────────────────

  /**
   * Migrate the old single-session .aide/local/chat.json into the new
   * multi-conversation structure. Only runs once (marker file prevents re-run).
   */
  private async migrateV1(): Promise<void> {
    const markerPath = join(this.conversationsDir, '.migrated')
    if (existsSync(markerPath)) return

    const oldChatPath = join(this.workspaceRoot, '.aide', 'local', 'chat.json')
    if (!existsSync(oldChatPath)) {
      // No old data — just write marker
      if (!existsSync(this.conversationsDir)) {
        await mkdir(this.conversationsDir, { recursive: true })
      }
      await writeFile(markerPath, new Date().toISOString(), 'utf-8')
      return
    }

    try {
      const raw = await readFile(oldChatPath, 'utf-8')
      const oldSession = JSON.parse(raw) as {
        id: string
        workspaceId: string
        messages?: Array<{ role: string; content: string; timestamp?: number }>
      }

      if (!oldSession.id || !oldSession.workspaceId) {
        await writeFile(markerPath, new Date().toISOString(), 'utf-8')
        return
      }

      const messages = oldSession.messages ?? []
      const firstUserMsg = messages.find((m) => m.role === 'user')

      const meta: ConversationMeta = {
        id: oldSession.id,
        workspaceId: oldSession.workspaceId,
        backend: 'built-in',
        title: firstUserMsg
          ? firstUserMsg.content.trim().slice(0, 40).replace(/\n+/g, ' ')
          : 'Imported Chat',
        autoTitled: true,
        createdAt: messages[0]?.timestamp ?? Date.now(),
        updatedAt: messages[messages.length - 1]?.timestamp ?? Date.now(),
        messageCount: messages.length,
        firstMessage: firstUserMsg?.content.slice(0, 100),
      }

      // Write the messages file
      await this.saveMessages(oldSession.id, oldSession)

      // Write the index
      await this.saveIndex([meta])

      // Write marker
      await writeFile(markerPath, new Date().toISOString(), 'utf-8')

      console.log(`[ConversationStore] Migrated V1 chat session: ${meta.title}`)
    } catch (err) {
      console.warn('[ConversationStore] V1 migration failed:', err)
      // Write marker anyway to prevent retry loops
      if (!existsSync(this.conversationsDir)) {
        await mkdir(this.conversationsDir, { recursive: true })
      }
      await writeFile(markerPath, new Date().toISOString(), 'utf-8')
    }
  }
}
