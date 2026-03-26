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
 * Detect project types by scanning for known config files.
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
 * Extract npm scripts from package.json and generate tasks.
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
 * Generate tasks for Rust/Cargo projects.
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
 * Generate tasks for Go projects.
 */
function generateGoTasks(): AideTask[] {
  return [
    { id: 'go:build', label: 'Go Build', command: 'go build ./...', group: 'build', problemMatcher: 'go' },
    { id: 'go:test', label: 'Go Test', command: 'go test ./...', group: 'test', problemMatcher: 'go' },
    { id: 'go:run', label: 'Go Run Current File', command: 'go run ${file}', group: 'dev' },
  ]
}

/**
 * Generate tasks for Python projects.
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
 * Generate tasks for Ruby projects.
 */
function generateRubyTasks(): AideTask[] {
  return [
    { id: 'ruby:install', label: 'Bundle Install', command: 'bundle install', group: 'build' },
    { id: 'ruby:rake', label: 'Bundle Rake', command: 'bundle exec rake', group: 'build' },
    { id: 'ruby:rspec', label: 'Bundle RSpec', command: 'bundle exec rspec', group: 'test' },
  ]
}

/**
 * Generate tasks for Docker Compose projects.
 */
function generateDockerTasks(): AideTask[] {
  return [
    { id: 'docker:up', label: 'Docker Compose Up', command: 'docker-compose up', group: 'dev', isBackground: true },
    { id: 'docker:down', label: 'Docker Compose Down', command: 'docker-compose down', group: 'clean' },
    { id: 'docker:build', label: 'Docker Compose Build', command: 'docker-compose build', group: 'build' },
  ]
}

/**
 * Detect tasks for a project and return the generated task list.
 * Does NOT create tasks.json — that's up to the caller.
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
 * Generate a tasks.json file from detected tasks. Returns error if file already exists.
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
 * Check if tasks.json already exists for this project.
 */
export function hasTasksFile(rootPath: string): boolean {
  return existsSync(join(rootPath, '.aide', 'tasks.json'))
}
