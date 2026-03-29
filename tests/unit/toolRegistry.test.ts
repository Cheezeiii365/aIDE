import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ToolRegistry } from '@main/toolRegistry'
import type { ToolDefinition, ToolResult } from '@shared/agentTypes'
import type { ToolContext } from '@main/agentTools'

// ─── Helpers ────────────────────────────────────────────────────────

const defaultContext: ToolContext = {
  workspaceRoot: '/tmp/test-workspace',
}

function createRegistry(): ToolRegistry {
  const registry = new ToolRegistry(defaultContext)
  registry.registerBuiltins()
  return registry
}

// ─── Registration ───────────────────────────────────────────────────

describe('ToolRegistry registration', () => {
  it('registers all 8 built-in tools', () => {
    const registry = createRegistry()
    expect(registry.getTools()).toHaveLength(8)
  })

  it('registers an external tool', () => {
    const registry = createRegistry()
    const def: ToolDefinition = {
      name: 'mcp_test_tool',
      description: 'A test MCP tool',
      inputSchema: { type: 'object', properties: {} },
      source: 'test-server',
    }
    registry.registerTool(def, ['ask', 'edit', 'agent'], async () => 'ok')
    expect(registry.getTools()).toHaveLength(9)
  })

  it('unregisters a tool by name', () => {
    const registry = createRegistry()
    registry.unregisterTool('file_read')
    const names = registry.getTools().map((t) => t.name)
    expect(names).not.toContain('file_read')
    expect(registry.getTools()).toHaveLength(7)
  })

  it('unregisters all tools from a source', () => {
    const registry = createRegistry()
    for (let i = 0; i < 3; i++) {
      registry.registerTool(
        { name: `mcp_tool_${i}`, description: '', inputSchema: { type: 'object', properties: {} }, source: 'github' },
        ['ask', 'edit', 'agent'],
        async () => 'ok',
      )
    }
    expect(registry.getTools()).toHaveLength(11)
    registry.unregisterSource('github')
    expect(registry.getTools()).toHaveLength(8)
  })

  it('unregisterSource does not remove tools from other sources', () => {
    const registry = createRegistry()
    registry.registerTool(
      { name: 'slack_post', description: '', inputSchema: { type: 'object', properties: {} }, source: 'slack' },
      ['agent'],
      async () => 'ok',
    )
    registry.unregisterSource('github')
    expect(registry.getTools().map((t) => t.name)).toContain('slack_post')
  })
})

// ─── Mode Filtering ─────────────────────────────────────────────────

describe('ToolRegistry mode filtering', () => {
  it('getTools with no mode returns all tools', () => {
    const registry = createRegistry()
    expect(registry.getTools()).toHaveLength(8)
  })

  it('ask mode excludes file_write and terminal_exec', () => {
    const registry = createRegistry()
    const askTools = registry.getTools('ask')
    const names = askTools.map((t) => t.name)
    expect(names).not.toContain('file_write')
    expect(names).not.toContain('terminal_exec')
    expect(names).toContain('file_read')
    expect(names).toContain('search_files')
    expect(names).toContain('git_status')
  })

  it('edit mode excludes terminal_exec but includes file_write', () => {
    const registry = createRegistry()
    const editTools = registry.getTools('edit')
    const names = editTools.map((t) => t.name)
    expect(names).not.toContain('terminal_exec')
    expect(names).toContain('file_write')
    expect(names).toContain('file_read')
  })

  it('agent mode includes all tools', () => {
    const registry = createRegistry()
    const agentTools = registry.getTools('agent')
    expect(agentTools).toHaveLength(8)
  })
})

// ─── toLlmTools ─────────────────────────────────────────────────────

describe('ToolRegistry toLlmTools', () => {
  it('returns tools without the source field', () => {
    const registry = createRegistry()
    const llmTools = registry.toLlmTools()
    for (const tool of llmTools) {
      expect(tool).toHaveProperty('name')
      expect(tool).toHaveProperty('description')
      expect(tool).toHaveProperty('inputSchema')
      expect(tool).not.toHaveProperty('source')
    }
  })

  it('respects mode filtering', () => {
    const registry = createRegistry()
    const askTools = registry.toLlmTools('ask')
    const names = askTools.map((t) => t.name)
    expect(names).not.toContain('terminal_exec')
    expect(names).not.toContain('file_write')
  })

  it('has same count as getTools for same mode', () => {
    const registry = createRegistry()
    expect(registry.toLlmTools('agent').length).toBe(registry.getTools('agent').length)
    expect(registry.toLlmTools('ask').length).toBe(registry.getTools('ask').length)
  })
})

// ─── Execute ────────────────────────────────────────────────────────

describe('ToolRegistry execute', () => {
  it('returns error for unknown tool', async () => {
    const registry = createRegistry()
    const result = await registry.execute('call-1', 'nonexistent_tool', {})
    expect(result.isError).toBe(true)
    expect(result.output).toContain('Unknown tool')
    expect(result.toolCallId).toBe('call-1')
  })

  it('dispatches to the correct executor', async () => {
    const registry = new ToolRegistry(defaultContext)
    const executor = vi.fn().mockResolvedValue('result text')
    registry.registerTool(
      { name: 'test_tool', description: '', inputSchema: { type: 'object', properties: {} }, source: 'test' },
      ['agent'],
      executor,
    )

    const result = await registry.execute('call-2', 'test_tool', { key: 'value' })
    expect(result.isError).toBe(false)
    expect(result.output).toBe('result text')
    expect(result.toolCallId).toBe('call-2')
    expect(executor).toHaveBeenCalledWith({ key: 'value' }, expect.objectContaining({ workspaceRoot: '/tmp/test-workspace' }))
  })

  it('wraps executor errors into ToolResult', async () => {
    const registry = new ToolRegistry(defaultContext)
    registry.registerTool(
      { name: 'failing_tool', description: '', inputSchema: { type: 'object', properties: {} }, source: 'test' },
      ['agent'],
      async () => { throw new Error('something broke') },
    )

    const result = await registry.execute('call-3', 'failing_tool', {})
    expect(result.isError).toBe(true)
    expect(result.output).toBe('something broke')
    expect(result.toolCallId).toBe('call-3')
  })

  it('handles non-Error throws', async () => {
    const registry = new ToolRegistry(defaultContext)
    registry.registerTool(
      { name: 'weird_throw', description: '', inputSchema: { type: 'object', properties: {} }, source: 'test' },
      ['agent'],
      async () => { throw 'string error' },
    )

    const result = await registry.execute('call-4', 'weird_throw', {})
    expect(result.isError).toBe(true)
    expect(result.output).toBe('Unknown error')
  })
})

// ─── updateContext ──────────────────────────────────────────────────

describe('ToolRegistry updateContext', () => {
  it('updates workspace root and passes it to executors', async () => {
    const registry = new ToolRegistry({ workspaceRoot: '/old/path' })
    const executor = vi.fn().mockResolvedValue('ok')
    registry.registerTool(
      { name: 'ctx_tool', description: '', inputSchema: { type: 'object', properties: {} }, source: 'test' },
      ['agent'],
      executor,
    )

    registry.updateContext({ workspaceRoot: '/new/path' })
    await registry.execute('call-5', 'ctx_tool', {})

    expect(executor).toHaveBeenCalledWith({}, expect.objectContaining({ workspaceRoot: '/new/path' }))
  })
})
