import type { ToolDefinition, ToolResult, ChatMode } from '@aide/shared'
import type { LlmToolDefinition } from '@aide/shared'
import { BUILTIN_TOOLS, type ToolContext, type BuiltinTool } from './agentTools'

// ─── Types ──────────────────────────────────────────────────────────

type ToolExecutor = (input: Record<string, unknown>, context: ToolContext) => Promise<string>

interface RegisteredTool {
  definition: ToolDefinition
  modes: ChatMode[]
  executor: ToolExecutor
}

// ─── Registry ───────────────────────────────────────────────────────

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>()
  private context: ToolContext

  constructor(context: ToolContext) {
    this.context = { ...context }
  }

  /** Register all built-in tools from agentTools.ts. */
  registerBuiltins(): void {
    for (const tool of BUILTIN_TOOLS) {
      this.tools.set(tool.definition.name, {
        definition: tool.definition,
        modes: tool.modes,
        executor: tool.execute,
      })
    }
  }

  /** Register an external tool (e.g. from an MCP server). */
  registerTool(
    definition: ToolDefinition,
    modes: ChatMode[],
    executor: ToolExecutor,
  ): void {
    this.tools.set(definition.name, { definition, modes, executor })
  }

  /** Remove a tool by name. */
  unregisterTool(name: string): void {
    this.tools.delete(name)
  }

  /** Remove all tools from a given source (e.g. when an MCP server disconnects). */
  unregisterSource(source: string): void {
    for (const [name, tool] of this.tools) {
      if (tool.definition.source === source) {
        this.tools.delete(name)
      }
    }
  }

  /** Get tool definitions, optionally filtered by chat mode. */
  getTools(mode?: ChatMode): ToolDefinition[] {
    const result: ToolDefinition[] = []
    for (const tool of this.tools.values()) {
      if (!mode || tool.modes.includes(mode)) {
        result.push(tool.definition)
      }
    }
    return result
  }

  /** Get tools in the LLM-ready format (no `source` field). */
  toLlmTools(mode?: ChatMode): LlmToolDefinition[] {
    return this.getTools(mode).map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }))
  }

  /** Execute a tool by name, returning a ToolResult. */
  async execute(
    toolCallId: string,
    name: string,
    input: Record<string, unknown>,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name)
    if (!tool) {
      return { toolCallId, output: `Unknown tool: ${name}`, isError: true }
    }
    try {
      const output = await tool.executor(input, this.context)
      return { toolCallId, output, isError: false }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return { toolCallId, output: message, isError: true }
    }
  }

  /** Update the tool context (e.g. when workspace changes). */
  updateContext(partial: Partial<ToolContext>): void {
    Object.assign(this.context, partial)
  }
}
