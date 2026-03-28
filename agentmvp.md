# aIDE Agent MVP — Implementation Guide

## What Already Exists (foundation to build on)

| System | Status | Key Files |
|--------|--------|-----------|
| Terminal (xterm.js + node-pty) | Done | `ptyManager.ts`, `TerminalPane.tsx` |
| Task runner with problem matchers | Done | `taskRunner.ts`, `useTasks.ts` |
| File operations + watcher | Done | `fileWatcher.ts`, preload API |
| Git status + worktrees | Done | `gitStatus.ts`, `worktreeManager.ts` |
| Workspace switching + isolation | Done | `workspaceRegistry.ts`, `workspaceSwitcher.ts` |
| Settings cascade (user → workspace) | Done | `settingsResolver.ts` |
| IPC bridge (100+ channels) | Done | `shared/src/index.ts` |
| Dockview tiling layout | Done | `DockviewContainer.tsx` |
| Ripgrep search | Done | `@vscode/ripgrep` integration |
| `AgentStatusDot` placeholder | Stub | Not wired up |

---

## MVP Scope: 4 Features

The agent MVP is **four things** — a chat panel, an agent loop, MCP tool support, and a permission gate. Everything else (inline diffs, context references, test explorer, DAP) is post-MVP.

---

### Feature 1: Chat Panel

A new Dockview pane type (`chatPane`) that lives in any panel position. Each workspace gets its own independent chat instance with its own message history.

**Three modes:**

| Mode | What it does | File access |
|------|-------------|-------------|
| **Ask** | Read-only Q&A. Agent can read files, search, explain. Cannot write. | Read-only |
| **Edit** | Multi-file editing with a Working Set. User defines which files the agent can touch. Shows proposed diffs before applying. | Scoped write |
| **Agent** | Fully autonomous loop. Agent plans, edits, runs commands, reads diagnostics, self-corrects. Iterates until done or blocked. | Full (gated) |

**UI elements:**
- Mode selector (three toggle buttons at top)
- Message list (user messages + agent responses + tool call cards)
- Input area with submit (Enter or button)
- Working Set indicator (Edit mode) — shows which files are in scope
- Stop button (cancels in-flight agent work)
- Status indicator (idle / thinking / running tool / waiting for approval)

**Data model:**

```typescript
// packages/shared/src/index.ts

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool_result'
  content: string
  timestamp: number
  toolCalls?: ToolCall[]        // agent requested these
  toolResults?: ToolResult[]    // results of executed tools
}

interface ChatSession {
  id: string
  workspaceId: string
  mode: 'ask' | 'edit' | 'agent'
  messages: ChatMessage[]
  workingSet: string[]          // file paths (edit mode)
  status: 'idle' | 'thinking' | 'tool_running' | 'awaiting_approval'
}

interface ToolCall {
  id: string
  name: string                  // e.g. 'file_read', 'terminal_exec', 'file_write'
  input: Record<string, unknown>
  status: 'pending' | 'approved' | 'rejected' | 'completed'
}

interface ToolResult {
  toolCallId: string
  output: string
  isError: boolean
}
```

**IPC channels to add:**

```typescript
// Chat
CHAT_SEND_MESSAGE:    'chat:send-message'     // renderer → main
CHAT_STREAM_CHUNK:    'chat:stream-chunk'      // main → renderer (streaming response)
CHAT_STREAM_END:      'chat:stream-end'        // main → renderer
CHAT_TOOL_CALL:       'chat:tool-call'         // main → renderer (show approval UI)
CHAT_TOOL_APPROVE:    'chat:tool-approve'      // renderer → main
CHAT_TOOL_REJECT:     'chat:tool-reject'       // renderer → main
CHAT_STOP:            'chat:stop'              // renderer → main (cancel)
CHAT_SET_MODE:        'chat:set-mode'          // renderer → main
CHAT_SET_WORKING_SET: 'chat:set-working-set'   // renderer → main
CHAT_GET_HISTORY:     'chat:get-history'        // renderer → main
```

**Implementation:**
- `packages/renderer/src/components/panes/ChatPane.tsx` — the panel component
- `packages/renderer/src/components/chat/` — MessageList, MessageBubble, ToolCallCard, WorkingSetPicker, ModeSelector
- `packages/renderer/src/hooks/useChat.ts` — hook wrapping IPC
- `packages/main/src/agentManager.ts` — orchestrates LLM calls + tool execution
- Chat history persisted to `.aide/local/chat.json` per workspace

---

### Feature 2: Agent Loop (the core engine)

Runs in the main process. Receives user messages, calls the LLM, executes tool calls, feeds results back, loops until done.

**Architecture:**

```
User message
    ↓
AgentManager (main process)
    ↓
Build prompt: system rules → project instructions → workspace context → conversation history → user message
    ↓
Call LLM API (streaming)
    ↓
Parse response for tool_use blocks
    ↓
For each tool call:
    → Check permission tier
    → If needs approval: send to renderer, wait
    → If auto-approved: execute immediately
    → Collect result
    ↓
Feed tool results back to LLM
    ↓
Loop until: assistant responds with no tool calls, or user stops, or error limit hit
```

**Built-in tools the agent can call:**

| Tool | Maps to existing | Mode |
|------|-----------------|------|
| `file_read` | `window.api.readFile` | ask, edit, agent |
| `file_write` | `window.api.writeFile` | edit (working set only), agent |
| `file_list` | `window.api.readDir` | ask, edit, agent |
| `terminal_exec` | `window.api.ptyCreate` + `ptyWrite` | agent only |
| `search_files` | `window.api.searchStart` | ask, edit, agent |
| `git_status` | `window.api.getGitStatus` | ask, edit, agent |
| `git_diff` | new IPC — runs `git diff` | ask, edit, agent |
| `browser_read` | new IPC — reads page content from browser pane | ask, edit, agent |

These tools reuse the existing IPC infrastructure. The agent loop calls them via the main process directly (no round-trip to renderer for execution).

**Key files:**
- `packages/main/src/agentManager.ts` — the loop, prompt assembly, tool dispatch
- `packages/main/src/agentTools.ts` — built-in tool definitions + executors
- `packages/main/src/llmClient.ts` — HTTP client for LLM API (Anthropic Messages API, OpenAI-compatible)
- `packages/shared/src/agentTypes.ts` — shared types for tools, messages, sessions

**LLM provider config** (stored in `.aide/settings.json` or user settings):

```json
{
  "agent.provider": "anthropic",
  "agent.model": "claude-sonnet-4-20250514",
  "agent.apiKey": "${env:ANTHROPIC_API_KEY}",
  "agent.maxTurns": 25,
  "agent.maxTokens": 8192
}
```

Support `${env:VAR}` interpolation (you already have this pattern in the task system).

**Diagnostic feedback (self-correction):**
- Your task runner already emits `onTaskDiagnostics` via problem matchers
- When the agent runs a terminal command, capture stdout/stderr and feed it back as the tool result
- On failure (non-zero exit, diagnostic errors), the agent sees the error in context and can self-correct
- Cap self-correction loops at a configurable limit (default: 5 retries per tool)

---

### Feature 3: MCP Server Support

MCP (Model Context Protocol) lets users plug in external tools — GitHub, databases, Slack, etc. This is table stakes.

**Config file:** `.aide/mcp.json` (per workspace)

```json
{
  "servers": {
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "${env:GITHUB_TOKEN}"
      }
    },
    "postgres": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": {
        "DATABASE_URL": "${env:DATABASE_URL}"
      }
    }
  }
}
```

**Implementation:**
- `packages/main/src/mcpManager.ts` — lifecycle management for MCP server processes
  - Spawn stdio servers as child processes
  - JSON-RPC communication over stdin/stdout
  - Track available tools per server (via `tools/list` RPC)
  - Handle tool calls (via `tools/call` RPC)
  - Restart crashed servers
  - Shutdown on workspace close
- `packages/main/src/toolRegistry.ts` — unified registry for built-in + MCP tools
  - Each tool has: `name`, `description`, `inputSchema` (JSON Schema), `source` ('builtin' | server name)
  - Agent sees all tools uniformly — doesn't care if it's built-in or MCP
  - Tool list is dynamic (updates when MCP servers connect/disconnect)

**IPC channels:**

```typescript
MCP_LIST_SERVERS:     'mcp:list-servers'       // renderer → main
MCP_SERVER_STATUS:    'mcp:server-status'       // main → renderer
MCP_RESTART_SERVER:   'mcp:restart-server'      // renderer → main
MCP_LIST_TOOLS:       'mcp:list-tools'          // renderer → main (all tools from all sources)
```

**Scope:** MVP supports `stdio` transport only. SSE/streamable-HTTP transport is post-MVP.

---

### Feature 4: Permission System

Three tiers controlling what the agent can do without asking:

| Tier | Behavior | Use case |
|------|----------|----------|
| **Confirm** (default) | Every tool call shown to user, must click Approve | First time using agent, untrusted projects |
| **Auto-approve** | Reads auto-approved. Writes + terminal shown for approval | Trusted project, iterating quickly |
| **Autopilot** | Everything auto-approved. Agent runs until done or blocked | High trust, background tasks |

**Per-tool overrides** in `.aide/settings.json`:

```json
{
  "agent.permissionTier": "confirm",
  "agent.autoApprove": {
    "file_read": true,
    "search_files": true,
    "git_status": true,
    "terminal_exec": {
      "allowPatterns": ["npm test", "npm run build", "npx tsc --noEmit"],
      "denyPatterns": ["rm -rf", "sudo *"]
    }
  }
}
```

**Implementation:**
- Permission check happens in `agentManager.ts` before each tool execution
- If approval needed: emit `CHAT_TOOL_CALL` to renderer, wait for `CHAT_TOOL_APPROVE` or `CHAT_TOOL_REJECT`
- Renderer shows an inline approval card in the chat with tool name, inputs, and Approve/Reject buttons
- Rejected tools return an error result to the LLM ("User rejected this action")

---

## What's Explicitly NOT in MVP

| Feature | Why deferred |
|---------|-------------|
| Inline diff rendering | Requires CodeMirror decoration work; agent can describe changes in chat first |
| Context references (#file, #selection) | Nice-to-have UX; agent can read files via tools |
| When-clauses for keybindings | Useful but not agent-related |
| Git gutter decorations | Polish, not agent-related |
| Test explorer | Post-agent feature |
| DAP debugging | v2+ |
| Activity bar / icon sidebar | Layout polish |
| Settings profiles | Post-MVP |
| SSE/HTTP MCP transport | stdio covers 95% of MCP servers |
| Multi-agent coordination | Build single-agent first, then orchestrate |
| Workspace trust dialog | Add after agent is working |

---

## File Tree (new files to create)

```
packages/
├── main/src/
│   ├── agentManager.ts       # Agent loop: prompt → LLM → tools → loop
│   ├── agentTools.ts         # Built-in tool definitions + executors
│   ├── llmClient.ts          # LLM API client (Anthropic + OpenAI-compatible)
│   ├── mcpManager.ts         # MCP server lifecycle (spawn, communicate, restart)
│   └── toolRegistry.ts       # Unified tool registry (built-in + MCP)
├── renderer/src/
│   ├── components/
│   │   ├── panes/
│   │   │   └── ChatPane.tsx  # Dockview panel wrapper
│   │   └── chat/
│   │       ├── MessageList.tsx
│   │       ├── MessageBubble.tsx
│   │       ├── ToolCallCard.tsx
│   │       ├── ModeSelector.tsx
│   │       ├── WorkingSetPicker.tsx
│   │       └── ChatInput.tsx
│   └── hooks/
│       └── useChat.ts        # IPC hook for chat operations
└── shared/src/
    └── agentTypes.ts         # Shared types: ChatMessage, ToolCall, etc.
```

**Files to modify:**
- `packages/shared/src/index.ts` — add IPC channels + WindowApi methods
- `packages/main/src/preload.ts` — expose chat + MCP APIs
- `packages/main/src/index.ts` — register IPC handlers, init agentManager + mcpManager
- `packages/renderer/src/components/DockviewContainer.tsx` — register `chatPane` type
- `packages/renderer/src/lib/workspaceSwitcher.ts` — include chat pane in default layout

---

## Implementation Order

### Step 1: Types + IPC plumbing
Add all shared types (`agentTypes.ts`), IPC channels, and WindowApi surface. No UI, no logic — just the contract.

### Step 2: LLM client
`llmClient.ts` — streaming HTTP client for Anthropic Messages API. Support `tool_use` content blocks in responses. This is the foundation everything else depends on.

### Step 3: Built-in tools + registry
`agentTools.ts` + `toolRegistry.ts` — define the 8 built-in tools with JSON Schema inputs. Wire executors to existing IPC handlers (readFile, writeFile, ptyCreate, searchStart, etc.).

### Step 4: Agent loop
`agentManager.ts` — the core loop. Takes a message, builds prompt, calls LLM, dispatches tools, feeds results back, loops. Start with "confirm everything" permission tier.

### Step 5: Chat UI
`ChatPane.tsx` + child components. Render messages, stream chunks, show tool call cards with approve/reject. Wire to IPC. Register as Dockview pane.

### Step 6: Permission system
Add tier logic to agentManager. Add per-tool auto-approve config. Add the settings UI entries.

### Step 7: MCP support
`mcpManager.ts` — spawn stdio servers, parse tool lists, proxy tool calls. Merge MCP tools into the registry so the agent sees them alongside built-ins.

### Step 8: Polish + persistence
Chat history save/restore. Mode switching. Working set UI for edit mode. Stop button. Error states.
