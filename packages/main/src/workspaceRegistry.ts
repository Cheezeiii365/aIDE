/**
 * Workspace registry.
 *
 * Manages the collection of IDE workspaces using a dedicated electron-store.
 * Each workspace maps to a project folder and tracks metadata for the ribbon UI.
 * Separate from AppSettings to keep concerns clean.
 */

import { existsSync } from 'fs'
import { randomUUID } from 'crypto'
import Store from 'electron-store'
import type { WorkspaceEntry, AppWorkspaceRegistry } from '@aide/shared'

const DEFAULT_REGISTRY: AppWorkspaceRegistry = {
  workspaces: {},
  workspaceOrder: [],
  activeWorkspaceId: null,
  lastSessionWorkspaces: [],
}

export class WorkspaceRegistry {
  private store: Store<AppWorkspaceRegistry>

  constructor() {
    this.store = new Store<AppWorkspaceRegistry>({
      name: 'workspace-registry',
      defaults: DEFAULT_REGISTRY,
    })
  }

  /**
   * Create a new workspace entry for a folder. If a workspace with the same
   * rootPath already exists, returns the existing one instead.
   */
  create(rootPath: string): WorkspaceEntry {
    const workspaces = this.store.get('workspaces')

    // Check for existing workspace with same path
    const existing = Object.values(workspaces).find((w) => w.rootPath === rootPath)
    if (existing) {
      existing.lastOpenedAt = Date.now()
      workspaces[existing.id] = existing
      this.store.set('workspaces', workspaces)
      return existing
    }

    const entry: WorkspaceEntry = {
      id: randomUUID(),
      name: rootPath.split('/').pop() ?? rootPath,
      rootPath,
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
    }

    workspaces[entry.id] = entry
    this.store.set('workspaces', workspaces)

    // Add to ordering
    const order = this.store.get('workspaceOrder')
    order.push(entry.id)
    this.store.set('workspaceOrder', order)

    // Add to session
    const session = this.store.get('lastSessionWorkspaces')
    if (!session.includes(entry.id)) {
      session.push(entry.id)
      this.store.set('lastSessionWorkspaces', session)
    }

    return entry
  }

  /**
   * Create a blank workspace with no folder. Named "Untitled", "Untitled 2", etc.
   */
  createBlank(): WorkspaceEntry {
    const workspaces = this.store.get('workspaces')

    // Generate unique "Untitled" name
    const existingNames = new Set(Object.values(workspaces).map((w) => w.name))
    let name = 'Untitled'
    let counter = 2
    while (existingNames.has(name)) {
      name = `Untitled ${counter++}`
    }

    const entry: WorkspaceEntry = {
      id: randomUUID(),
      name,
      rootPath: null,
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
    }

    workspaces[entry.id] = entry
    this.store.set('workspaces', workspaces)

    const order = this.store.get('workspaceOrder')
    order.push(entry.id)
    this.store.set('workspaceOrder', order)

    const session = this.store.get('lastSessionWorkspaces')
    if (!session.includes(entry.id)) {
      session.push(entry.id)
      this.store.set('lastSessionWorkspaces', session)
    }

    return entry
  }

  /**
   * Set the rootPath on an existing workspace (e.g. opening a folder in a blank workspace).
   */
  setRoot(id: string, rootPath: string): void {
    const workspaces = this.store.get('workspaces')
    const entry = workspaces[id]
    if (!entry) return

    entry.rootPath = rootPath
    entry.name = rootPath.split('/').pop() ?? rootPath
    workspaces[id] = entry
    this.store.set('workspaces', workspaces)
  }

  /**
   * Remove a workspace from the registry entirely.
   * Does NOT delete .aide/ from disk.
   */
  remove(id: string): void {
    const workspaces = this.store.get('workspaces')
    const remainingWorkspaces = Object.fromEntries(
      Object.entries(workspaces).filter(([workspaceId]) => workspaceId !== id),
    )
    this.store.set('workspaces', remainingWorkspaces)

    // Remove from ordering
    const order = this.store.get('workspaceOrder').filter((wid) => wid !== id)
    this.store.set('workspaceOrder', order)

    // Remove from session
    const session = this.store.get('lastSessionWorkspaces').filter((wid) => wid !== id)
    this.store.set('lastSessionWorkspaces', session)

    // Clear active if this was it
    if (this.store.get('activeWorkspaceId') === id) {
      this.store.set('activeWorkspaceId', order[0] ?? null)
    }
  }

  /**
   * Close a workspace for this session (remove from ribbon).
   * Keeps it in the registry for future re-open.
   */
  close(id: string): void {
    const session = this.store.get('lastSessionWorkspaces').filter((wid) => wid !== id)
    this.store.set('lastSessionWorkspaces', session)

    if (this.store.get('activeWorkspaceId') === id) {
      this.store.set('activeWorkspaceId', session[0] ?? null)
    }
  }

  /**
   * Get all workspaces in ribbon order, filtered to session workspaces only.
   */
  getAll(): WorkspaceEntry[] {
    const workspaces = this.store.get('workspaces')
    const order = this.store.get('workspaceOrder')
    const session = new Set(this.store.get('lastSessionWorkspaces'))

    return order
      .filter((id) => session.has(id) && workspaces[id])
      .map((id) => workspaces[id])
  }

  /**
   * Get a workspace by ID.
   */
  get(id: string): WorkspaceEntry | null {
    return this.store.get('workspaces')[id] ?? null
  }

  /**
   * Update workspace metadata (name, icon, color).
   */
  update(id: string, patch: Partial<Pick<WorkspaceEntry, 'name' | 'icon' | 'color'>>): void {
    const workspaces = this.store.get('workspaces')
    const entry = workspaces[id]
    if (!entry) return

    Object.assign(entry, patch)
    workspaces[id] = entry
    this.store.set('workspaces', workspaces)
  }

  /**
   * Reorder workspaces by providing the full ordered list of IDs.
   */
  reorder(ids: string[]): void {
    this.store.set('workspaceOrder', ids)
  }

  /**
   * Get the active workspace ID.
   */
  getActiveId(): string | null {
    return this.store.get('activeWorkspaceId')
  }

  /**
   * Set the active workspace and update lastOpenedAt.
   */
  setActive(id: string): void {
    this.store.set('activeWorkspaceId', id)

    const workspaces = this.store.get('workspaces')
    const entry = workspaces[id]
    if (entry) {
      entry.lastOpenedAt = Date.now()
      workspaces[id] = entry
      this.store.set('workspaces', workspaces)
    }

    // Ensure it's in the session
    const session = this.store.get('lastSessionWorkspaces')
    if (!session.includes(id)) {
      session.push(id)
      this.store.set('lastSessionWorkspaces', session)
    }
  }

  /**
   * Get the session workspaces (for app restore).
   */
  getSessionWorkspaces(): string[] {
    return this.store.get('lastSessionWorkspaces')
  }

  /**
   * Set the session workspaces list.
   */
  setSessionWorkspaces(ids: string[]): void {
    this.store.set('lastSessionWorkspaces', ids)
  }

  /**
   * Validate all session workspaces — remove any whose rootPath no longer exists.
   * Returns the IDs that were removed.
   */
  validatePaths(): string[] {
    const workspaces = this.store.get('workspaces')
    const removed: string[] = []

    for (const [id, entry] of Object.entries(workspaces)) {
      if (entry.rootPath && !existsSync(entry.rootPath)) {
        removed.push(id)
      }
    }

    return removed
  }
}
