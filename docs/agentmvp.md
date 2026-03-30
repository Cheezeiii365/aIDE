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

### Step 7: CLI Agent Wrappers (Claude Code, Codex) ✅
Wrap external CLI agents (Claude Code, Codex) as monitored sessions inside the IDE. This is a separate track from the built-in agent (Steps 1-6): both backends coexist, and the user picks `built-in`, `claude-code`, or `codex` per workspace.

**Why before full MCP/polish:** Claude Code and Codex are mature agents already. Wrapping them gives aIDE a strong autonomous coding path immediately, while the built-in agent remains the simpler Ask/Edit flow.

**Architecture (current — being replaced in Step 8):**

```
CliAgentPane
    ↓
CliAgentManager
    ↓
Spawn CLI: `claude -p --output-format stream-json` or future `codex`
    ↓
StructuredOutputParser (newline-delimited JSON on stdout)
    ↓
Normalize to CliAgentMessage / CliAgentStatusPayload
    ↓
Surface to renderer: transcript, streaming deltas, status, errors
```

**Scope for this step:**
- Keep the current one-shot-per-send Claude Code model (`-p` + `--resume`) for normal chat turns
- Preserve session history, status, and streaming in the IDE
- Do not assume permission gating is solved here; that is Step 8

**Core files:**
- `packages/main/src/chat/cliAgentManager.ts` — spawn CLI agents, manage lifecycle, parse structured JSON output
- `packages/renderer/src/components/panes/CliAgentPane.tsx` — pane for CLI-backed chat sessions
- `packages/renderer/src/hooks/useCliAgent.ts` — renderer hook for CLI session state
- `packages/shared/src/cliAgentTypes.ts` — shared types for CLI agent sessions, messages, and status

**Key behaviors:**
- Raw Claude/Codex output is normalized into IDE-friendly message types
- Streaming text appears in-panel instead of only at process exit
- Session history persists across tab reopen and workspace reload
- Stop cancels the active CLI process cleanly

### Step 8: Migrate to Claude Agent SDK + Permissions + MCP

**Why this replaces the old Step 8 plan:**

The original Step 8 was built around `--permission-prompt-tool` and a custom MCP stdio permission bridge. Research (2025-03-29) revealed:
- `--permission-prompt-tool` does not exist on the current CLI (v2.1.86)
- The CLI in `-p` mode with `stdin: 'ignore'` **hangs** on permission requests (no way to respond)
- `--input-format stream-json` (bidirectional stdin) is intentionally undocumented (GitHub issue #24594, closed as "not planned")
- The **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`, formerly `@anthropic-ai/claude-code`) is Anthropic's official programmatic embedding path

The Agent SDK wraps the CLI internally but exposes a structured API with:
- `canUseTool` callback for mid-run permission approval
- `AskUserQuestion` flowing through the same callback
- Async generator streaming (`for await...of`)
- Built-in session resume, MCP server management, and cancellation
- Uses Claude subscription billing (not API pricing)
- Bundles the full runtime (~48MB) — no external `claude` binary resolution needed

**Architecture (new):**

```
CliAgentPane
    ↓
CliAgentManager (refactored)
    ↓
@anthropic-ai/claude-agent-sdk query()
    ↓
canUseTool callback ←→ IPC ←→ Renderer approval/question cards
    ↓
Async generator yields SDKMessage stream
    ↓
Normalize to CliAgentMessage / CliAgentStatusPayload
    ↓
Surface to renderer: transcript, streaming deltas, status, permissions, questions
```

**SDK core API:**

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

const q = query({
  prompt: userMessage,
  options: {
    cwd: workspacePath,
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    settingSources: ['project'],            // loads CLAUDE.md
    includePartialMessages: true,           // streaming deltas
    allowedTools: ["Read", "Glob", "Grep"], // auto-approved (tier-dependent)
    abortController: controller,
    resume: previousSessionId,              // conversation continuity
    persistSession: true,

    canUseTool: async (toolName, input, { signal, toolUseID }) => {
      if (toolName === "AskUserQuestion") {
        const answer = await bridgeQuestionToRenderer(sessionId, input, toolUseID);
        return { behavior: "allow", updatedInput: { ...input, answers: answer } };
      }
      const approved = await bridgePermissionToRenderer(sessionId, toolName, input, toolUseID);
      if (approved) return { behavior: "allow" };
      return { behavior: "deny", message: "User rejected this action" };
    },

    mcpServers: parsedMcpJson.servers       // workspace MCP servers (replaces old Step 9)
  }
});

for await (const message of q) {
  // message.type: "system" | "assistant" | "user" | "stream_event" | "result"
  normalizeAndEmit(message);
}
```

**Key SDK types for reference:**

```typescript
type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    signal: AbortSignal;
    suggestions?: PermissionUpdate[];
    toolUseID: string;
    agentID?: string;
  }
) => Promise<PermissionResult>;

type PermissionResult =
  | { behavior: "allow"; updatedInput?: Record<string, unknown> }
  | { behavior: "deny"; message: string; interrupt?: boolean };

// AskUserQuestion input shape (received when toolName === "AskUserQuestion")
type AskUserQuestionInput = {
  questions: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description: string; preview?: string }>;
    multiSelect: boolean;
  }>;
};
// Respond by returning allow with updatedInput containing answers:
// { behavior: "allow", updatedInput: { questions: orig, answers: { "question text": "selected label" } } }

// Query object (returned by query())
interface Query extends AsyncGenerator<SDKMessage, void> {
  close(): void;                                      // kill the process
  interrupt(): Promise<void>;                          // graceful interrupt
  setPermissionMode(mode: PermissionMode): Promise<void>;
  setModel(model?: string): Promise<void>;
  setMcpServers(servers: Record<string, McpServerConfig>): Promise<McpSetServersResult>;
  mcpServerStatus(): Promise<McpServerStatus[]>;
  supportedModels(): Promise<ModelInfo[]>;
  rewindFiles(userMessageId: string): Promise<RewindFilesResult>;
}

type PermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk";
```

#### Step 8A: SDK Installation + Proof of Concept

1. Install: `pnpm add @anthropic-ai/claude-agent-sdk` in `packages/main`
2. Write a minimal test that calls `query()` with `canUseTool`, confirms:
   - Streaming events arrive via async generator
   - `canUseTool` fires for permission-requiring tools
   - `AskUserQuestion` flows through `canUseTool`
   - `AbortController` cancels cleanly
   - Session resume works via `resume: sessionId`
3. Verify it works from Electron's main process (spawns Node child processes internally)

**Gotchas to verify:**
- `settingSources` defaults to `[]` — CLAUDE.md won't load unless you pass `['project']`
- System prompt is minimal by default — must pass `systemPrompt: { type: 'preset', preset: 'claude_code' }`
- Extended thinking disables `stream_event` messages
- Package is ~48MB — verify acceptable app bundle impact

#### Step 8B: Refactor `cliAgentManager.ts`

Replace the `spawn()` + `StructuredOutputParser` flow with SDK's `query()`:

**Remove:**
- `child_process.spawn` usage for Claude Code backend
- `StructuredOutputParser` dependency (file can be deleted if no other consumers)
- Binary resolution: `resolveLaunch()`, `resolveBundledClaudeCliPath()`, `resolveNodeRuntime()` (~160 lines)
- CLI argument construction (`-p`, `--output-format`, `--verbose`, `--resume`)

**Add:**
- `query()` call in `send()` with full options object
- Async generator consumption loop that maps SDK messages to `CliAgentMessage`
- `canUseTool` callback that bridges to renderer via IPC (Promise-based gate)
- Store `Query` object on session for `stop()` → `query.close()`
- Session ID capture from `system.init` or `result` messages for resume

**Keep:**
- Session data model and persistence via `ConversationStore`
- IPC emission pattern (`emitMessage`, `emitStatus`, `emitStreamDelta`)
- Codex backend path (still uses `spawn()` if/when Codex is supported)

**Message type mapping:**

| SDK message type | Existing `CliAgentMessage.type` |
|-----------------|-------------------------------|
| `system` (subtype: `init`) | `system` |
| `assistant` | `assistant` |
| `user` (tool_result content) | `tool_result` |
| `stream_event` | stream delta (not a message, updates `streamingContent`) |
| `result` (subtype: `success`) | `result` |
| `result` (subtype: `error_*`) | `error` |

**Permission gate implementation:**

```typescript
// In cliAgentManager.ts
private pendingApprovals = new Map<string, {
  resolve: (result: PermissionResult) => void;
  sessionId: string;
}>();

// canUseTool callback stores a pending Promise
canUseTool: async (toolName, input, { toolUseID, signal }) => {
  return new Promise<PermissionResult>((resolve) => {
    this.pendingApprovals.set(toolUseID, { resolve, sessionId });
    this.emitMessage(sessionId, {
      type: toolName === 'AskUserQuestion' ? 'ask_user_question' : 'permission_request',
      toolUseId: toolUseID,
      toolName,
      permissionInput: input,
      status: 'pending'
    });
    signal.addEventListener('abort', () => {
      this.pendingApprovals.delete(toolUseID);
      resolve({ behavior: 'deny', message: 'Cancelled' });
    });
  });
};

// Called when renderer responds
respondToPermission(toolUseId: string, approved: boolean, updatedInput?: Record<string, unknown>) {
  const pending = this.pendingApprovals.get(toolUseId);
  if (!pending) return;
  this.pendingApprovals.delete(toolUseId);
  if (approved) {
    pending.resolve({ behavior: 'allow', updatedInput });
  } else {
    pending.resolve({ behavior: 'deny', message: 'User rejected this action' });
  }
}
```

#### Step 8C: IPC + Types

**New shared types** (add to `cliAgentTypes.ts`):

```typescript
// Extend CliAgentMessage.type
type: 'system' | 'assistant' | 'user' | 'tool_use' | 'tool_result'
     | 'status' | 'error' | 'result'
     | 'permission_request' | 'ask_user_question'  // NEW

// New fields on CliAgentMessage for permission/question rows
toolUseId?: string
toolName?: string
permissionInput?: Record<string, unknown>
permissionStatus?: 'pending' | 'approved' | 'rejected' | 'expired'
questionData?: {
  questions: Array<{
    question: string
    header: string
    options: Array<{ label: string; description: string }>
    multiSelect: boolean
  }>
}

// New process status
export type CliAgentProcessStatus =
  | 'stopped' | 'starting' | 'running' | 'rate_limited' | 'error' | 'stopping'
  | 'awaiting_permission' | 'awaiting_answer'  // NEW
```

**New IPC channels** (add to `shared/src/index.ts`):

```typescript
CLI_AGENT_PERMISSION_RESPONSE: 'cli-agent:permission-response'   // renderer → main
CLI_AGENT_QUESTION_RESPONSE:   'cli-agent:question-response'     // renderer → main
```

**Preload bridge** (add to `preload.ts`):

```typescript
cliAgentRespondToPermission: (toolUseId: string, approved: boolean) =>
  ipcRenderer.send(IpcChannels.CLI_AGENT_PERMISSION_RESPONSE, toolUseId, approved)

cliAgentRespondToQuestion: (toolUseId: string, answers: Record<string, string>) =>
  ipcRenderer.send(IpcChannels.CLI_AGENT_QUESTION_RESPONSE, toolUseId, answers)
```

#### Step 8D: Renderer UI

**`CliPermissionCard.tsx`** — inline approval card:
- Reuse visual language of existing `ToolCallCard`
- Show tool name, input summary, Allow/Deny buttons
- Disable buttons after resolution
- Show "auto" badge when auto-approved by tier

**`CliQuestionCard.tsx`** — inline question card:
- Render question text and selectable options
- Support single-select and multi-select
- Submit button sends selected answers back

**`useCliAgent.ts` additions:**
- Listen for `permission_request` and `ask_user_question` messages
- Expose `respondToPermission(toolUseId, approved)` action
- Expose `respondToQuestion(toolUseId, answers)` action
- Update session status to `awaiting_permission` / `awaiting_answer` when pending

**`CliAgentPane.tsx` additions:**
- Render permission cards and question cards inline in message stream
- Show distinct status indicator for awaiting states
- Stale pending cards expire on stop/destroy/workspace switch

#### Step 8E: Permission Tiers

Map aIDE's existing tier system to SDK options:

| aIDE Tier | SDK `permissionMode` | SDK `allowedTools` | `canUseTool` |
|-----------|---------------------|-------------------|--------------|
| **Confirm** | `"default"` | `[]` | All tools go through callback → renderer approval |
| **Auto-approve** | `"acceptEdits"` | `["Read", "Glob", "Grep", "search_files", "git_status"]` | Writes + terminal go through callback |
| **Autopilot** | `"bypassPermissions"` + `allowDangerouslySkipPermissions: true` | N/A | No callback needed |

Per-tool overrides from `.aide/settings.json` map to `allowedTools` / `disallowedTools`:
- `"terminal_exec": { "allowPatterns": ["npm test"] }` → `allowedTools: ["Bash(npm test:*)"]`
- `"denyPatterns": ["rm -rf"]` → `disallowedTools: ["Bash(rm -rf:*)"]`

#### Step 8F: Workspace MCP Support (formerly Step 9)

The SDK has built-in MCP support — this collapses into SDK config:

1. Read `.aide/mcp.json` on session start
2. Pass servers directly to `query()`:
   ```typescript
   mcpServers: {
     "github": { type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { ... } },
     "postgres": { type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-postgres"], env: { ... } }
   }
   ```
3. MCP tools automatically appear in Claude's tool list
4. Dynamic management via `query.setMcpServers()` and `query.mcpServerStatus()`
5. Expose `MCP_LIST_SERVERS` / `MCP_SERVER_STATUS` IPC using `query.mcpServerStatus()`
6. SDK supports `stdio`, `sse`, and `http` transports (not just stdio)

No custom `mcpManager.ts` or `mcpStdioTransport.ts` needed — the SDK handles all of this.

#### Step 8G: Built-in Agent Audit

Do not redesign built-in agent permissions here. Only verify existing behavior still works:
- Confirm tier still shows approval cards
- Auto-approve still behaves correctly
- Autopilot still behaves correctly
- Edit mode working set still constrains writes
- Stop still cancels in-flight work

Fix only regressions or blockers.

#### Step 8H: Documentation and Hygiene

When Step 8 lands:
- Update `IDE_BUILD_PLAN.md`
- Remove `structuredOutputParser.ts` if no longer used
- Remove binary resolution code from `cliAgentManager.ts`
- Update settings schema: `agent.claudeCodePath` may no longer be needed (SDK bundles runtime)

### Step 9: Polish + Persistence
- Chat history save/restore
- Mode switching cleanup
- Working set UI for Edit mode
- Stop button and error states
- Stale permission request expiration on reload/destroy
- Model selection UI (SDK exposes `query.supportedModels()`)
- File rewind support (SDK exposes `query.rewindFiles()` with `enableFileCheckpointing: true`)

---

## SDK Reference Notes

**Package:** `@anthropic-ai/claude-agent-sdk` (renamed from `@anthropic-ai/claude-code`)
**Dependencies:** `@anthropic-ai/sdk` >=0.74.0, `@modelcontextprotocol/sdk` >=1.27.1
**Size:** ~48MB (bundles full Claude Code runtime)
**Billing:** Uses Claude subscription (Max/Pro/Team/Enterprise), not API pricing
**Process model:** Each `query()` spawns a child process; sessions persist via `.jsonl` files on disk

**Known gotchas:**
1. `settingSources` defaults to `[]` — must pass `['project']` to load CLAUDE.md
2. System prompt is minimal by default — must pass `systemPrompt: { type: 'preset', preset: 'claude_code' }`
3. Extended thinking (`maxThinkingTokens`) disables `stream_event` messages
4. `AskUserQuestion` is not available in subagents
5. `bypassPermissions` cannot run as root on Unix

**Session utilities:**
```typescript
import { listSessions, getSessionMessages, getSessionInfo, renameSession, tagSession }
  from "@anthropic-ai/claude-agent-sdk";
```

**V2 Preview (unstable, do not use yet):**
```typescript
import { unstable_v2_createSession, unstable_v2_prompt } from "@anthropic-ai/claude-agent-sdk";
```

---

## Resolved Questions

The following questions from the original Step 8 spike are now answered by the SDK approach:

1. **Mid-run permission blocking?** — Yes, via `canUseTool` async callback. The SDK handles the process communication internally.
2. **Permission payload shape?** — `canUseTool(toolName, input, options)` → `{ behavior: "allow" }` or `{ behavior: "deny", message }`.
3. **Does deny continue the run?** — Yes, Claude sees the denial message and can adjust. Set `interrupt: true` to stop entirely.
4. **Clarifying questions?** — `AskUserQuestion` flows through `canUseTool` when `toolName === "AskUserQuestion"`. Respond with `{ behavior: "allow", updatedInput: { questions, answers } }`.
5. **Can permissions and questions share UI?** — They use the same `canUseTool` callback but need separate card components (approval vs. multi-choice).
6. **MCP integration?** — Built into SDK via `options.mcpServers`. No custom transport needed.
7. **`--permission-prompt-tool`?** — Does not exist on current CLI. The SDK's `canUseTool` is the replacement.
8. **`--input-format stream-json`?** — Intentionally undocumented. Not needed with SDK.
9. **`--ide` flag?** — Exists but underdocumented. SDK is the better integration path.
10. **Persistent "always allow"?** — Map to `allowedTools` in SDK options. aIDE controls the tier/override logic, SDK enforces it.
