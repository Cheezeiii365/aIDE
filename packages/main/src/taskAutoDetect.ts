/**
 * Task auto-detection.
 *
 * Scans a project root for known build/config files and generates
 * a starter set of AideTask definitions. Does NOT auto-create tasks.json —
 * instead returns the detected tasks so the UI can offer to generate the file.
 */

import { existsSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { AideTask, AideTasksFile } from '@aide/shared'

interface DetectedProject {
  type: string
  configFile: string
}

/**
 * Identify project types present in a directory by checking for well-known configuration files.
 *
 * @param rootPath - The directory path to scan for project config files
 * @returns An array of `DetectedProject` objects for each matched config file; each entry contains the detected project `type` and the matching `configFile`
 */
function detectProjects(rootPath: string): DetectedProject[] {
  const projects: DetectedProject[] = []
  const check = (file: string, type: string) => {
    if (existsSync(join(rootPath, file))) {
      projects.push({ type, configFile: file })
    }
  }

  check('package.json', 'node')
  check('Cargo.toml', 'rust')
  check('go.mod', 'go')
  check('pyproject.toml', 'python-pyproject')
  check('requirements.txt', 'python')
  check('Makefile', 'make')
  check('docker-compose.yml', 'docker')
  check('docker-compose.yaml', 'docker')
  check('Gemfile', 'ruby')
  check('justfile', 'just')

  return projects
}

/**
 * Generate AideTask entries from npm scripts declared in the project's package.json.
 *
 * Each script becomes a task whose label and command incorporate the detected package manager
 * (`pnpm` if pnpm-lock.yaml exists, else `yarn` if yarn.lock exists, else `npm run`).
 * Task grouping, background status, and additional properties are derived from the script name and content:
 * - scripts with names containing `dev`, `start`, `serve`, or `watch` are marked as background tasks and get `autoRestart: false`;
 * - names containing `build`, `test`, or `lint` are placed into the `build`, `test`, or `lint` groups respectively;
 * - if the script text includes `tsc`, the task gets `problemMatcher: 'tsc'`.
 *
 * @returns An array of generated tasks, or an empty array if `package.json` is missing, unreadable, or contains no `scripts`.
 */
async function generateNodeTasks(rootPath: string): Promise<AideTask[]> {
  const pkgPath = join(rootPath, 'package.json')
  try {
    const raw = await readFile(pkgPath, 'utf-8')
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> }
    if (!pkg.scripts) return []

    const tasks: AideTask[] = []
    const pmCmd = existsSync(join(rootPath, 'pnpm-lock.yaml'))
      ? 'pnpm'
      : existsSync(join(rootPath, 'yarn.lock'))
        ? 'yarn'
        : 'npm run'

    for (const [name, script] of Object.entries(pkg.scripts)) {
      const isBackground = /\b(dev|start|serve|watch)\b/.test(name)
      const group = /\bbuild\b/.test(name)
        ? 'build' as const
        : /\btest\b/.test(name)
          ? 'test' as const
          : /\blint\b/.test(name)
            ? 'lint' as const
            : isBackground
              ? 'dev' as const
              : undefined

      tasks.push({
        id: name,
        label: `${name} (${pmCmd})`,
        command: `${pmCmd} ${name}`,
        group,
        isBackground,
        ...(isBackground ? { autoRestart: false } : {}),
        ...(script.includes('tsc') ? { problemMatcher: 'tsc' } : {}),
      })
    }

    return tasks
  } catch {
    return []
  }
}

/**
 * Create AideTask entries for common Cargo commands.
 *
 * @returns An array of tasks for `cargo build`, `cargo test`, `cargo run`, and `cargo clippy`
 */
function generateRustTasks(): AideTask[] {
  return [
    { id: 'cargo:build', label: 'Cargo Build', command: 'cargo build', group: 'build' },
    { id: 'cargo:test', label: 'Cargo Test', command: 'cargo test', group: 'test' },
    { id: 'cargo:run', label: 'Cargo Run', command: 'cargo run', group: 'dev' },
    { id: 'cargo:clippy', label: 'Cargo Clippy', command: 'cargo clippy', group: 'lint' },
  ]
}

/**
 * Generate a set of predefined tasks for Go projects.
 *
 * @returns An array of tasks for common Go workflows: `build`, `test`, and `run` (runs the current file).
 */
function generateGoTasks(): AideTask[] {
  return [
    { id: 'go:build', label: 'Go Build', command: 'go build ./...', group: 'build', problemMatcher: 'go' },
    { id: 'go:test', label: 'Go Test', command: 'go test ./...', group: 'test', problemMatcher: 'go' },
    { id: 'go:run', label: 'Go Run Current File', command: 'go run ${file}', group: 'dev' },
  ]
}

/**
 * Generate task definitions for a Python project.
 *
 * @param type - 'python' to use plain Python commands, 'python-pyproject' to use Poetry (prefixes commands with `poetry run` and includes a Poetry install task)
 * @returns An array of `AideTask` entries for running tests, running the current file, and — when `type` is `'python-pyproject'` — installing dependencies with Poetry. The run task uses `${file}` for Poetry projects and `${fileRelative}` for plain Python projects.
 */
function generatePythonTasks(type: 'python' | 'python-pyproject'): AideTask[] {
  const prefix = type === 'python-pyproject' ? 'poetry run ' : ''
  return [
    { id: 'python:test', label: 'Run Tests', command: `${prefix}pytest -v`, group: 'test', problemMatcher: 'pytest' },
    { id: 'python:run', label: 'Run Current File', command: `${prefix}python ${type === 'python-pyproject' ? '${file}' : '${fileRelative}'}`, group: 'dev' },
    ...(type === 'python-pyproject'
      ? [{ id: 'python:install', label: 'Poetry Install', command: 'poetry install', group: 'build' as const }]
      : []),
  ]
}

/**
 * Provide common Aide tasks for Ruby projects.
 *
 * @returns An array of AideTask objects for `bundle install`, `bundle exec rake`, and `bundle exec rspec`
 */
function generateRubyTasks(): AideTask[] {
  return [
    { id: 'ruby:install', label: 'Bundle Install', command: 'bundle install', group: 'build' },
    { id: 'ruby:rake', label: 'Bundle Rake', command: 'bundle exec rake', group: 'build' },
    { id: 'ruby:rspec', label: 'Bundle RSpec', command: 'bundle exec rspec', group: 'test' },
  ]
}

/**
 * Provide standard Aide tasks for Docker Compose workflows.
 *
 * @returns An array of `AideTask` objects for common docker-compose commands:
 * - `docker:up` — `docker-compose up` (group `dev`, background task)
 * - `docker:down` — `docker-compose down` (group `clean`)
 * - `docker:build` — `docker-compose build` (group `build`)
 */
function generateDockerTasks(): AideTask[] {
  return [
    { id: 'docker:up', label: 'Docker Compose Up', command: 'docker-compose up', group: 'dev', isBackground: true },
    { id: 'docker:down', label: 'Docker Compose Down', command: 'docker-compose down', group: 'clean' },
    { id: 'docker:build', label: 'Docker Compose Build', command: 'docker-compose build', group: 'build' },
  ]
}

/**
 * Detects project types in the given root directory and generates matching AideTask entries.
 *
 * Does not write any files (for example, it does not create a tasks.json); persisting the returned tasks is the caller's responsibility.
 *
 * @param rootPath - Path to the project root to scan for known build/config files.
 * @returns An array of generated AideTask objects; `[]` if no supported projects are detected.
 */
export async function detectTasks(rootPath: string): Promise<AideTask[]> {
  const projects = detectProjects(rootPath)
  if (projects.length === 0) return []

  const allTasks: AideTask[] = []

  for (const project of projects) {
    switch (project.type) {
      case 'node':
        allTasks.push(...await generateNodeTasks(rootPath))
        break
      case 'rust':
        allTasks.push(...generateRustTasks())
        break
      case 'go':
        allTasks.push(...generateGoTasks())
        break
      case 'python':
      case 'python-pyproject':
        allTasks.push(...generatePythonTasks(project.type))
        break
      case 'ruby':
        allTasks.push(...generateRubyTasks())
        break
      case 'docker':
        allTasks.push(...generateDockerTasks())
        break
      // make, just: could parse targets but skipping for now
    }
  }

  return allTasks
}

/**
 * Write a `.aide/tasks.json` file in the given project root containing the provided tasks.
 *
 * @param rootPath - Filesystem path to the project root where `.aide/tasks.json` will be created
 * @param tasks - Array of task definitions to serialize into the tasks file
 * @returns An object `{ success: true }` when the file was written successfully, or `{ error: string }` with a descriptive message if the file already exists or writing failed
 */
export async function generateTasksFile(
  rootPath: string,
  tasks: AideTask[],
): Promise<{ success: true } | { error: string }> {
  const tasksPath = join(rootPath, '.aide', 'tasks.json')
  if (existsSync(tasksPath)) {
    return { error: 'tasks.json already exists' }
  }

  const tasksFile: AideTasksFile = {
    version: 1,
    tasks,
  }

  try {
    await writeFile(tasksPath, JSON.stringify(tasksFile, null, 2), 'utf-8')
    return { success: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to write tasks.json' }
  }
}

/**
 * Determine whether a project already has a `.aide/tasks.json` file.
 *
 * @param rootPath - The project root directory to inspect
 * @returns `true` if `.aide/tasks.json` exists under the given `rootPath`, `false` otherwise
 */
export function hasTasksFile(rootPath: string): boolean {
  return existsSync(join(rootPath, '.aide', 'tasks.json'))
}
