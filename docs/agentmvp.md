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
- `packages/main/src/llmClient.ts` — provider-agnostic LLM client orchestrator
- `packages/main/src/providers/anthropicProvider.ts` — Anthropic Messages API adapter
- `packages/main/src/providers/openAiCompatibleProvider.ts` — OpenAI/Ollama/Together/Groq adapter
- `packages/main/src/providers/sseParser.ts` — shared SSE stream parser
- `packages/shared/src/agentTypes.ts` — shared types for tools, messages, sessions
- `packages/shared/src/llmTypes.ts` — provider-agnostic LLM types + wire format types

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
│   ├── llmClient.ts          # Provider-agnostic LLM client orchestrator
│   ├── providers/
│   │   ├── sseParser.ts      # Shared SSE stream parser
│   │   ├── anthropicProvider.ts     # Anthropic Messages API adapter
│   │   └── openAiCompatibleProvider.ts  # OpenAI/Ollama/Together/Groq adapter
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
    ├── agentTypes.ts         # Shared types: ChatMessage, ToolCall, etc.
    └── llmTypes.ts           # Provider-agnostic LLM types + wire formats
```

**Files to modify:**
- `packages/shared/src/index.ts` — add IPC channels + WindowApi methods
- `packages/main/src/preload.ts` — expose chat + MCP APIs
- `packages/main/src/index.ts` — register IPC handlers, init agentManager + mcpManager
- `packages/renderer/src/components/DockviewContainer.tsx` — register `chatPane` type
- `packages/renderer/src/lib/workspaceSwitcher.ts` — include chat pane in default layout

---

## Implementation Order

### Step 1: Types + IPC plumbing ✅
Add all shared types (`agentTypes.ts`), IPC channels, and WindowApi surface. No UI, no logic — just the contract.

### Step 2: LLM client ✅
Provider-agnostic streaming LLM client using adapter pattern. `LlmClient` orchestrator delegates to provider adapters (`AnthropicProvider`, `OpenAiCompatibleProvider`). Shared SSE parser, `${env:VAR}` API key interpolation, AbortController-based cancellation. New providers added by implementing `LlmProvider` interface. Uses Node.js v22 native `fetch()`, no external deps.

### Step 3: Built-in tools + registry ✅
`agentTools.ts` — 8 built-in tools (`file_read`, `file_write`, `file_list`, `terminal_exec`, `search_files`, `git_status`, `git_diff`, `browser_read`) with JSON Schema input definitions and direct main-process executors (no IPC round-trips). `terminal_exec` uses `child_process.execFile` with timeout/ANSI stripping. `search_files` spawns ripgrep independently to avoid singleton conflicts. `toolRegistry.ts` — `ToolRegistry` class provides mode-filtered tool listing (`getTools(mode)`), LLM-ready conversion (`toLlmTools()`), unified `execute()` dispatch with error wrapping, and dynamic `registerTool()`/`unregisterSource()` for MCP tools (Step 7). Exported `fetchGitStatus` from `gitStatus.ts`, added `getPageContent()` to `BrowserPaneManager`.

### Step 4: Agent loop ✅
`agentManager.ts` — `AgentManager` class orchestrates the full agent loop: session management, prompt building, LLM streaming via `LlmClient`, tool execution with Promise-based approval gates, retry tracking (5 per tool), turn limits, and chat persistence to `.aide/local/chat.json`. IPC handlers registered in `index.ts` for all `CHAT_*` channels. "Confirm everything" permission tier (Step 6 adds tiers). Fire-and-forget loop design — `sendMessage` returns immediately, streams events to renderer asynchronously.

### Step 5: Chat UI ✅
`ChatPane.tsx` Dockview pane with 6 child components: `ModeSelector` (Ask/Edit/Agent segmented control), `MessageList` (sticky auto-scroll, status line), `MessageBubble` (markdown rendering via shared `markdownRenderer.ts`, streaming cursor), `ToolCallCard` (inline approval with Allow/Deny), `ChatInput` (auto-resize textarea, Enter to send, stop button), `WorkingSetPicker` (file chips with type-to-filter dropdown). `useChat` hook manages all IPC subscriptions with rAF-throttled streaming. Refactored `MarkdownPreviewPane` to share renderer. Default layout updated from placeholder to `chatPane`.

### Step 6: Permission system ✅
Three-tier permission system (`confirm`, `auto-approve`, `autopilot`) with per-tool overrides. `shouldAutoApprove()` in `AgentManager` checks per-tool overrides first, then falls back to tier logic (autopilot→all, auto-approve→read-only tools, confirm→none). Pattern matching for `terminal_exec` with allow/deny glob patterns. Settings UI: enum dropdown for tier + `ToolPermissionsEditor` table for per-tool overrides. Auto-approved tool calls show "auto" badge in `ToolCallCard`. Live settings updates via `updatePermissions()`.

### Step 7: CLI Agent Wrappers (Claude Code, Codex)
Wrap external CLI agents (Claude Code, Codex) as monitored sessions inside the IDE. This is a **separate track** from the built-in agent (Steps 1–5) — the two coexist, and the user picks "built-in", "Claude Code", or "Codex" as their agent backend per workspace.

**Why before MCP/polish:** Claude Code and Codex are mature, battle-tested agents. Wrapping them gives powerful agent sessions immediately without needing more built-in agent infrastructure. The built-in agent is good for lightweight Ask/Edit workflows; CLI wrappers handle heavy autonomous coding.

**Architecture:**

```
AgentTerminalPane (or mode on existing TerminalPane)
    ↓
Spawn CLI: `claude --output-format stream-json` or `codex --full-auto`
    ↓
StructuredOutputParser (reads newline-delimited JSON from stdout)
    ↓
Extract: status, tool calls, file edits, thinking, errors
    ↓
Surface to: AgentStatusDot on workspace tab, chat-like overlay, approval interception
```

**Components:**
- `packages/main/src/cliAgentManager.ts` — spawn CLI agents, manage lifecycle, parse structured JSON output stream
- `packages/renderer/src/components/panes/AgentTerminalPane.tsx` — terminal pane with agent status overlay (shows current action, file edits, progress)
- `packages/shared/src/cliAgentTypes.ts` — types for CLI agent sessions, structured output events
- Settings: `agent.backend` enum ('builtin' | 'claude-code' | 'codex'), `agent.claudeCodePath`, `agent.codexPath`

**Key behaviors:**
- Raw terminal visible underneath (user can scroll back, see full output)
- Status overlay extracts and surfaces: current phase (thinking/editing/running), files being modified, tool calls in progress
- `AgentStatusDot` on workspace tab reflects CLI agent state (not just built-in agent)
- Permission interception via `--permission-prompt-tool` (see below)
- Session persistence: CLI agent can be stopped/restarted, scrollback preserved

**Permission interception for CLI agents:**

Claude Code CLI supports `--permission-prompt-tool <mcp-tool-name>`. When set, the CLI calls that MCP tool instead of handling permissions internally. aIDE runs a local MCP server per CLI session and injects this flag at spawn time. Flow:

```
Claude Code CLI needs permission
    ↓
Calls aide_permission_prompt MCP tool (stdio to cliPermissionServer.ts)
    ↓
cliPermissionServer emits IpcChannels.CLI_AGENT_PERMISSION_REQUEST to renderer
    ↓
Renderer pushes a 'permission_request' CliAgentMessage into message list
    ↓
CliPermissionCard shown (same shape as ToolCallCard — tool name, inputs, Allow/Deny)
    ↓
User clicks Allow/Deny → renderer invokes CLI_AGENT_PERMISSION_RESPONSE
    ↓
cliPermissionServer resolves its pending Promise → returns { approved } to Claude Code
    ↓
CLI resumes or aborts the tool call
```

New files for this:
- `packages/main/src/cliPermissionServer.ts` — lightweight MCP stdio server per session; blocks on a Promise until renderer resolves via IPC; manages one pending approval at a time
- `packages/renderer/src/components/chat/CliPermissionCard.tsx` — approval card for CLI sessions, mirrors ToolCallCard UI

Changes for this:
- `cliAgentManager.ts` — instantiate `cliPermissionServer` per session; inject `--permission-prompt-tool aide_permission_prompt` into spawn args
- `cliAgentTypes.ts` — add `type: 'permission_request'` to `CliAgentMessage`, add `permissionInput?: Record<string,unknown>`
- `shared/src/index.ts` — add `CLI_AGENT_PERMISSION_REQUEST` and `CLI_AGENT_PERMISSION_RESPONSE` IPC channels
- `main/src/index.ts` — handle `CLI_AGENT_PERMISSION_RESPONSE` → resolve pending Promise in `cliPermissionServer`
- `MessageList.tsx` — render `CliPermissionCard` for `permission_request` message type

**IPC channels:**
```typescript
CLI_AGENT_START:               'cli-agent:start'               // renderer → main (spawn agent)
CLI_AGENT_STOP:                'cli-agent:stop'                // renderer → main (kill/interrupt)
CLI_AGENT_STATUS:              'cli-agent:status'              // main → renderer (parsed status updates)
CLI_AGENT_EVENT:               'cli-agent:event'               // main → renderer (structured output events)
CLI_AGENT_PERMISSION_REQUEST:  'cli-agent:permission-request'  // main → renderer (show approval UI)
CLI_AGENT_PERMISSION_RESPONSE: 'cli-agent:permission-response' // renderer → main (user decision)
```

### Step 8: MCP support (all servers in one step)
Build all MCP infrastructure together: `mcpManager.ts` (spawn stdio servers, JSON-RPC lifecycle, tool list caching, crash restart), `toolRegistry.ts` dynamic registration, and the `cliPermissionServer.ts` MCP server for CLI permission interception (designed in Step 7). All three share the same MCP stdio transport layer — implement it once, use it for external servers and the internal permission server. Merge MCP tools into the registry so the agent sees them alongside built-ins.

### Step 9: Polish + persistence
Chat history save/restore. Mode switching. Working set UI for edit mode. Stop button. Error states.
