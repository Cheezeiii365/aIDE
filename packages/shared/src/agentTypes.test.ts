import { describe, it, expect } from 'vitest'
import { IpcChannels } from './index'
import type {
  ChatMode, ChatSessionStatus, ToolCallStatus,
  ToolCall, ToolResult, ChatMessage, ChatSession,
  ChatStreamChunk, ChatStreamEnd, ChatToolCallPayload,
  ToolDefinition,
  McpServerConfig, McpServerConnectionStatus, McpServerStatus,
  PermissionTier, ToolPermissionConfig, AgentPermissionSettings,
  LlmProviderConfig,
} from './agentTypes'

describe('Agent IPC channels', () => {
  it('defines all chat channels', () => {
    expect(IpcChannels.CHAT_SEND_MESSAGE).toBe('chat:send-message')
    expect(IpcChannels.CHAT_STREAM_CHUNK).toBe('chat:stream-chunk')
    expect(IpcChannels.CHAT_STREAM_END).toBe('chat:stream-end')
    expect(IpcChannels.CHAT_TOOL_CALL).toBe('chat:tool-call')
    expect(IpcChannels.CHAT_TOOL_APPROVE).toBe('chat:tool-approve')
    expect(IpcChannels.CHAT_TOOL_REJECT).toBe('chat:tool-reject')
    expect(IpcChannels.CHAT_STOP).toBe('chat:stop')
    expect(IpcChannels.CHAT_SET_MODE).toBe('chat:set-mode')
    expect(IpcChannels.CHAT_SET_WORKING_SET).toBe('chat:set-working-set')
    expect(IpcChannels.CHAT_GET_HISTORY).toBe('chat:get-history')
  })

  it('defines all MCP channels', () => {
    expect(IpcChannels.MCP_LIST_SERVERS).toBe('mcp:list-servers')
    expect(IpcChannels.MCP_SERVER_STATUS).toBe('mcp:server-status')
    expect(IpcChannels.MCP_RESTART_SERVER).toBe('mcp:restart-server')
    expect(IpcChannels.MCP_LIST_TOOLS).toBe('mcp:list-tools')
  })

  it('has no duplicate channel values across all channels', () => {
    const values = Object.values(IpcChannels)
    const uniqueValues = new Set(values)
    expect(uniqueValues.size).toBe(values.length)
  })

  it('agent channels follow namespace:action naming convention', () => {
    const agentChannelKeys = Object.keys(IpcChannels).filter(
      (k) => k.startsWith('CHAT_') || k.startsWith('MCP_'),
    ) as (keyof typeof IpcChannels)[]

    for (const key of agentChannelKeys) {
      const value = IpcChannels[key]
      expect(value).toMatch(/^[a-z]+:[a-z-]+$/)
    }
  })
})

describe('Agent type structures', () => {
  it('ChatSession satisfies interface with minimal valid object', () => {
    const session: ChatSession = {
      id: 'session-1',
      workspaceId: 'ws-1',
      mode: 'ask',
      messages: [],
      workingSet: [],
      status: 'idle',
    }
    expect(session.id).toBe('session-1')
    expect(session.mode).toBe('ask')
    expect(session.status).toBe('idle')
  })

  it('ChatMessage supports optional tool fields', () => {
    const withoutTools: ChatMessage = {
      id: 'msg-1',
      role: 'user',
      content: 'Hello',
      timestamp: Date.now(),
    }
    expect(withoutTools.toolCalls).toBeUndefined()
    expect(withoutTools.toolResults).toBeUndefined()

    const toolCall: ToolCall = {
      id: 'tc-1',
      name: 'file_read',
      input: { path: '/foo.ts' },
      status: 'completed',
    }
    const toolResult: ToolResult = {
      toolCallId: 'tc-1',
      output: 'file contents',
      isError: false,
    }
    const withTools: ChatMessage = {
      id: 'msg-2',
      role: 'assistant',
      content: 'Reading file...',
      timestamp: Date.now(),
      toolCalls: [toolCall],
      toolResults: [toolResult],
    }
    expect(withTools.toolCalls).toHaveLength(1)
    expect(withTools.toolResults).toHaveLength(1)
  })

  it('ChatStreamChunk carries session and message context', () => {
    const chunk: ChatStreamChunk = {
      sessionId: 'session-1',
      messageId: 'msg-1',
      delta: 'partial text',
    }
    expect(chunk.delta).toBe('partial text')
  })

  it('ChatStreamEnd supports all stop reasons', () => {
    const stopReasons: ChatStreamEnd['stopReason'][] = [
      'end_turn', 'tool_use', 'max_tokens', 'stop', 'error',
    ]
    for (const reason of stopReasons) {
      const end: ChatStreamEnd = {
        sessionId: 's-1',
        messageId: 'm-1',
        stopReason: reason,
      }
      expect(end.stopReason).toBe(reason)
    }
  })

  it('ToolDefinition supports both builtin and MCP sources', () => {
    const builtin: ToolDefinition = {
      name: 'file_read',
      description: 'Read a file',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      source: 'builtin',
    }
    const mcp: ToolDefinition = {
      name: 'github_create_issue',
      description: 'Create a GitHub issue',
      inputSchema: { type: 'object' },
      source: 'github',
    }
    expect(builtin.source).toBe('builtin')
    expect(mcp.source).toBe('github')
  })

  it('McpServerConfig supports stdio type', () => {
    const config: McpServerConfig = {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_TOKEN: '${env:GITHUB_TOKEN}' },
    }
    expect(config.type).toBe('stdio')
    expect(config.args).toHaveLength(2)
  })

  it('McpServerStatus tracks connection state', () => {
    const statuses: McpServerConnectionStatus[] = [
      'disconnected', 'connecting', 'connected', 'error',
    ]
    for (const status of statuses) {
      const server: McpServerStatus = {
        name: 'test-server',
        status,
        toolCount: 0,
      }
      expect(server.status).toBe(status)
    }
  })

  it('AgentPermissionSettings supports boolean and pattern overrides', () => {
    const settings: AgentPermissionSettings = {
      permissionTier: 'auto-approve',
      autoApprove: {
        file_read: true,
        search_files: true,
        terminal_exec: {
          allowPatterns: ['npm test', 'npm run build'],
          denyPatterns: ['rm -rf', 'sudo *'],
        },
      },
    }
    expect(settings.permissionTier).toBe('auto-approve')
    expect(settings.autoApprove.file_read).toBe(true)
    const termConfig = settings.autoApprove.terminal_exec as ToolPermissionConfig
    expect(termConfig.allowPatterns).toHaveLength(2)
    expect(termConfig.denyPatterns).toHaveLength(2)
  })

  it('LlmProviderConfig supports anthropic and openai-compatible', () => {
    const anthropic: LlmProviderConfig = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      apiKey: '${env:ANTHROPIC_API_KEY}',
      maxTurns: 25,
      maxTokens: 8192,
    }
    const openai: LlmProviderConfig = {
      provider: 'openai-compatible',
      model: 'gpt-4o',
      apiKey: '${env:OPENAI_API_KEY}',
      baseUrl: 'https://api.openai.com/v1',
      maxTurns: 25,
      maxTokens: 4096,
    }
    expect(anthropic.provider).toBe('anthropic')
    expect(openai.baseUrl).toBeDefined()
  })

  it('ChatMode covers all three modes', () => {
    const modes: ChatMode[] = ['ask', 'edit', 'agent']
    expect(modes).toHaveLength(3)
  })

  it('PermissionTier covers all three tiers', () => {
    const tiers: PermissionTier[] = ['confirm', 'auto-approve', 'autopilot']
    expect(tiers).toHaveLength(3)
  })

  it('ToolCallStatus covers all four states', () => {
    const statuses: ToolCallStatus[] = ['pending', 'approved', 'rejected', 'completed']
    expect(statuses).toHaveLength(4)
  })

  it('ChatSessionStatus covers all four states', () => {
    const statuses: ChatSessionStatus[] = ['idle', 'thinking', 'tool_running', 'awaiting_approval']
    expect(statuses).toHaveLength(4)
  })
})
