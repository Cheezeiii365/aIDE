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

/**
 * Compute the filesystem path to the workspace's .aide/local directory.
 *
 * @param rootPath - The workspace root directory path
 * @returns The path to the `.aide/local` directory inside `rootPath`
 */
function localDir(rootPath: string): string {
  return join(rootPath, '.aide', 'local')
}

/**
 * Write data to the target file atomically to avoid partial-file corruption.
 *
 * @param filePath - Destination file path
 * @param data - File contents to write as UTF-8
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
 * Persist the given workspace layout and editor state to the workspace's local state file.
 *
 * @param rootPath - Workspace root directory used to locate the `.aide/local` folder
 * @param state - State object to serialize and write to the state file
 */
export async function saveWorkspaceState(
  rootPath: string,
  state: AideLocalState,
): Promise<void> {
  const filePath = join(localDir(rootPath), STATE_FILE)
  await atomicWrite(filePath, JSON.stringify(state, null, 2))
}

/**
 * Load the workspace's persisted layout and editor state from the workspace local state file.
 *
 * @param rootPath - The workspace root directory used to locate the `.aide/local/state.json` file
 * @returns The parsed `AideLocalState`, or `null` if the file is missing or cannot be read or parsed
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
 * Persist terminal session state into the workspace's .aide/local/terminals.json file.
 *
 * Writes the provided `state` as formatted JSON to the local terminals file, replacing the existing file atomically.
 *
 * @param rootPath - The workspace root directory where `.aide/local/` is located
 * @param state - Terminal session state to save
 */
export async function saveTerminalState(
  rootPath: string,
  state: AideLocalTerminals,
): Promise<void> {
  const filePath = join(localDir(rootPath), TERMINALS_FILE)
  await atomicWrite(filePath, JSON.stringify(state, null, 2))
}

/**
 * Load the saved terminal session state for the workspace from .aide/local/terminals.json.
 *
 * @param rootPath - The workspace root directory containing the `.aide/local` folder
 * @returns The parsed `AideLocalTerminals` object, or `null` if the file is missing or cannot be read or parsed
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
