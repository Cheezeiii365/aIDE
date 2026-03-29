import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { BUILTIN_TOOLS, type ToolContext } from '@main/agentTools'

// ─── Test fixtures ──────────────────────────────────────────────────

const TEST_DIR = join(tmpdir(), `agentTools-test-${Date.now()}`)

const defaultContext: ToolContext = {
  workspaceRoot: TEST_DIR,
}

function findTool(name: string) {
  const tool = BUILTIN_TOOLS.find((t) => t.definition.name === name)
  if (!tool) throw new Error(`Tool not found: ${name}`)
  return tool
}

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true })
  writeFileSync(join(TEST_DIR, 'test.txt'), 'line1\nline2\nline3\nline4\nline5')
  writeFileSync(join(TEST_DIR, 'binary.dat'), Buffer.from([0x48, 0x65, 0x6c, 0x00, 0x6f]))
  mkdirSync(join(TEST_DIR, 'subdir'))
  writeFileSync(join(TEST_DIR, 'subdir', 'nested.txt'), 'nested content')
})

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true })
})

// ─── Structural Tests ───────────────────────────────────────────────

describe('BUILTIN_TOOLS', () => {
  it('exports exactly 8 built-in tools', () => {
    expect(BUILTIN_TOOLS).toHaveLength(8)
  })

  it('every tool has a unique name', () => {
    const names = BUILTIN_TOOLS.map((t) => t.definition.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('every tool has source "builtin"', () => {
    for (const tool of BUILTIN_TOOLS) {
      expect(tool.definition.source).toBe('builtin')
    }
  })

  it('every tool has a non-empty description', () => {
    for (const tool of BUILTIN_TOOLS) {
      expect(tool.definition.description.length).toBeGreaterThan(0)
    }
  })

  it('every tool has a valid JSON Schema inputSchema with type "object"', () => {
    for (const tool of BUILTIN_TOOLS) {
      expect(tool.definition.inputSchema.type).toBe('object')
      expect(tool.definition.inputSchema.properties).toBeDefined()
    }
  })

  it('every tool has at least one allowed mode', () => {
    for (const tool of BUILTIN_TOOLS) {
      expect(tool.modes.length).toBeGreaterThan(0)
    }
  })

  it('every tool has an execute function', () => {
    for (const tool of BUILTIN_TOOLS) {
      expect(typeof tool.execute).toBe('function')
    }
  })
})

// ─── Mode Assignments ───────────────────────────────────────────────

describe('mode assignments', () => {
  it('file_read is available in all modes', () => {
    expect(findTool('file_read').modes).toEqual(['ask', 'edit', 'agent'])
  })

  it('file_write is only available in edit and agent', () => {
    expect(findTool('file_write').modes).toEqual(['edit', 'agent'])
  })

  it('terminal_exec is only available in agent', () => {
    expect(findTool('terminal_exec').modes).toEqual(['agent'])
  })

  it('search_files is available in all modes', () => {
    expect(findTool('search_files').modes).toEqual(['ask', 'edit', 'agent'])
  })

  it('git_status is available in all modes', () => {
    expect(findTool('git_status').modes).toEqual(['ask', 'edit', 'agent'])
  })

  it('git_diff is available in all modes', () => {
    expect(findTool('git_diff').modes).toEqual(['ask', 'edit', 'agent'])
  })

  it('browser_read is available in all modes', () => {
    expect(findTool('browser_read').modes).toEqual(['ask', 'edit', 'agent'])
  })
})

// ─── file_read executor ─────────────────────────────────────────────

describe('file_read executor', () => {
  it('reads file content', async () => {
    const result = await findTool('file_read').execute(
      { path: join(TEST_DIR, 'test.txt') },
      defaultContext,
    )
    expect(result).toBe('line1\nline2\nline3\nline4\nline5')
  })

  it('supports offset and limit', async () => {
    const result = await findTool('file_read').execute(
      { path: join(TEST_DIR, 'test.txt'), offset: 2, limit: 2 },
      defaultContext,
    )
    expect(result).toBe('line2\nline3')
  })

  it('rejects non-file paths', async () => {
    await expect(
      findTool('file_read').execute({ path: join(TEST_DIR, 'subdir') }, defaultContext),
    ).rejects.toThrow('Not a file')
  })

  it('rejects binary files', async () => {
    await expect(
      findTool('file_read').execute({ path: join(TEST_DIR, 'binary.dat') }, defaultContext),
    ).rejects.toThrow('Binary file')
  })

  it('throws on nonexistent file', async () => {
    await expect(
      findTool('file_read').execute({ path: join(TEST_DIR, 'nope.txt') }, defaultContext),
    ).rejects.toThrow()
  })
})

// ─── file_write executor ────────────────────────────────────────────

describe('file_write executor', () => {
  it('writes content to a file', async () => {
    const outPath = join(TEST_DIR, 'out.txt')
    const result = await findTool('file_write').execute(
      { path: outPath, content: 'hello world' },
      defaultContext,
    )
    expect(result).toContain('File written successfully')
    const { readFileSync } = await import('fs')
    expect(readFileSync(outPath, 'utf-8')).toBe('hello world')
  })

  it('creates parent directories when requested', async () => {
    const outPath = join(TEST_DIR, 'deep', 'nested', 'file.txt')
    await findTool('file_write').execute(
      { path: outPath, content: 'deep content', createDirectories: true },
      defaultContext,
    )
    const { readFileSync } = await import('fs')
    expect(readFileSync(outPath, 'utf-8')).toBe('deep content')
  })
})

// ─── file_list executor ─────────────────────────────────────────────

describe('file_list executor', () => {
  it('lists directory contents', async () => {
    const result = await findTool('file_list').execute(
      { path: TEST_DIR },
      defaultContext,
    )
    expect(result).toContain('subdir')
    expect(result).toContain('test.txt')
  })

  it('shows directories with [dir] prefix', async () => {
    const result = await findTool('file_list').execute(
      { path: TEST_DIR },
      defaultContext,
    )
    expect(result).toContain('[dir] ')
  })
})

// ─── terminal_exec executor ─────────────────────────────────────────

describe('terminal_exec executor', () => {
  it('executes a simple command', async () => {
    const result = await findTool('terminal_exec').execute(
      { command: 'echo "hello agent"' },
      defaultContext,
    )
    expect(result).toContain('Exit code: 0')
    expect(result).toContain('hello agent')
  })

  it('reports non-zero exit codes', async () => {
    const result = await findTool('terminal_exec').execute(
      { command: 'exit 42' },
      defaultContext,
    )
    expect(result).toContain('42')
  })
})

// ─── browser_read executor ──────────────────────────────────────────

describe('browser_read executor', () => {
  it('returns message when no browser pane manager', async () => {
    const result = await findTool('browser_read').execute({}, defaultContext)
    expect(result).toContain('No browser pane manager available')
  })

  it('returns message when no pane is open', async () => {
    const context: ToolContext = {
      ...defaultContext,
      browserPaneManager: { getPageContent: vi.fn().mockResolvedValue(null) } as any,
    }
    const result = await findTool('browser_read').execute({}, context)
    expect(result).toContain('No browser pane is currently open')
  })

  it('returns page content', async () => {
    const context: ToolContext = {
      ...defaultContext,
      browserPaneManager: { getPageContent: vi.fn().mockResolvedValue('Page text here') } as any,
    }
    const result = await findTool('browser_read').execute({}, context)
    expect(result).toBe('Page text here')
  })
})

// ─── Input Schema Validation ────────────────────────────────────────

describe('input schemas', () => {
  it('file_read requires path', () => {
    const schema = findTool('file_read').definition.inputSchema
    expect(schema.required).toContain('path')
  })

  it('file_write requires path and content', () => {
    const schema = findTool('file_write').definition.inputSchema
    expect(schema.required).toContain('path')
    expect(schema.required).toContain('content')
  })

  it('terminal_exec requires command', () => {
    const schema = findTool('terminal_exec').definition.inputSchema
    expect(schema.required).toContain('command')
  })

  it('search_files requires query', () => {
    const schema = findTool('search_files').definition.inputSchema
    expect(schema.required).toContain('query')
  })

  it('file_list requires path', () => {
    const schema = findTool('file_list').definition.inputSchema
    expect(schema.required).toContain('path')
  })

  it('git_status has no required fields', () => {
    const schema = findTool('git_status').definition.inputSchema
    expect(schema.required).toBeUndefined()
  })

  it('git_diff has no required fields', () => {
    const schema = findTool('git_diff').definition.inputSchema
    expect(schema.required).toBeUndefined()
  })

  it('browser_read has no required fields', () => {
    const schema = findTool('browser_read').definition.inputSchema
    expect(schema.required).toBeUndefined()
  })
})
