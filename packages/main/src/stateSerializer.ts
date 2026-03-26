/**
 * Workspace state serializer.
 *
 * Reads and writes .aide/local/state.json and .aide/local/terminals.json.
 * Uses atomic writes (write to temp file, then rename) to prevent
 * corruption on crash.
 */

import { existsSync } from 'fs'
import { readFile, writeFile, rename, mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import { randomUUID } from 'crypto'
import type { AideLocalState, AideLocalTerminals } from '@aide/shared'

const STATE_FILE = 'state.json'
const TERMINALS_FILE = 'terminals.json'

function localDir(rootPath: string): string {
  return join(rootPath, '.aide', 'local')
}

/**
 * Atomic write: write to a temp file in the same directory, then rename.
 * This prevents partial writes from corrupting the state file on crash.
 */
async function atomicWrite(filePath: string, data: string): Promise<void> {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
  }
  const tmpPath = join(dir, `.tmp-${randomUUID()}.json`)
  await writeFile(tmpPath, data, 'utf-8')
  await rename(tmpPath, filePath)
}

/**
 * Save workspace layout and editor state to .aide/local/state.json.
 */
export async function saveWorkspaceState(
  rootPath: string,
  state: AideLocalState,
): Promise<void> {
  const filePath = join(localDir(rootPath), STATE_FILE)
  await atomicWrite(filePath, JSON.stringify(state, null, 2))
}

/**
 * Load workspace layout and editor state from .aide/local/state.json.
 * Returns null if the file doesn't exist or is corrupted.
 */
export async function loadWorkspaceState(
  rootPath: string,
): Promise<AideLocalState | null> {
  const filePath = join(localDir(rootPath), STATE_FILE)
  if (!existsSync(filePath)) return null

  try {
    const raw = await readFile(filePath, 'utf-8')
    return JSON.parse(raw) as AideLocalState
  } catch {
    return null
  }
}

/**
 * Save terminal session state to .aide/local/terminals.json.
 */
export async function saveTerminalState(
  rootPath: string,
  state: AideLocalTerminals,
): Promise<void> {
  const filePath = join(localDir(rootPath), TERMINALS_FILE)
  await atomicWrite(filePath, JSON.stringify(state, null, 2))
}

/**
 * Load terminal session state from .aide/local/terminals.json.
 * Returns null if the file doesn't exist or is corrupted.
 */
export async function loadTerminalState(
  rootPath: string,
): Promise<AideLocalTerminals | null> {
  const filePath = join(localDir(rootPath), TERMINALS_FILE)
  if (!existsSync(filePath)) return null

  try {
    const raw = await readFile(filePath, 'utf-8')
    return JSON.parse(raw) as AideLocalTerminals
  } catch {
    return null
  }
}
