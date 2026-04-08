# CLI Agent Backend Hotswap Report

## Goal

Support `claude-code`, `opencode`, and `codex` as first-class agent-chat backends, with backend hot swapping inside the same CLI agent chat pane.

This report covers:

- what backend work will be done
- what data and IPC contracts will change
- what requires frontend changes from the separate frontend agent

## Current state

The current implementation is not a generic CLI-agent backend. It is a Claude-specific manager with a Codex stub.

### Current backend limitations

- `packages/shared/src/cliAgentTypes.ts`
  - `AgentBackend` only includes `built-in | claude-code | codex`
  - there is no `opencode`
- `packages/main/src/chat/cliAgentManager.ts`
  - hard-coded to `@anthropic-ai/claude-agent-sdk`
  - stores a single `claudeSessionId`
  - normalizes only Claude SDK message shapes
  - returns `Codex integration coming soon.` for `codex`
- `packages/shared/src/conversationTypes.ts`
  - `ConversationMeta` stores `claudeSessionId`, not generic per-backend session state
  - `source` only models `claude-native`
- `packages/main/src/index.ts`
  - settings updates only push `agent.claudeCodePath` and `agent.codexPath`
- renderer code is hard-coded around only two external backends
  - `CliAgentPane.tsx`
  - `ChatHistoryPane.tsx`
  - `AppShell.tsx`
  - `workspaceSwitcher.ts`
  - `commands/domains/agent.ts`

### Hot swapping is not possible today

The current `cliAgentStart()` path assumes a single fixed backend per pane/session. If the same conversation is reopened with a different backend, the backend-specific session semantics are wrong:

- Claude resume uses `claudeSessionId`
- OpenCode and Codex will need their own resume/session state
- mixed-backend transcripts have no per-message backend attribution

## Backend work I will do

### 1. Introduce a real external-agent backend abstraction

I will split the current Claude-specific manager into:

- `CliAgentManager`
  - session lifecycle
  - persistence
  - IPC emission
  - backend switching
- backend adapters
  - `ClaudeCodeAdapter`
  - `OpenCodeAdapter`
  - `CodexAdapter`

Each adapter will be responsible for:

- executable or SDK resolution
- creating a run for a prompt
- streaming normalized events back to the manager
- stop/cancel behavior
- per-backend resume/session token handling

### 2. Make session persistence generic instead of Claude-only

I will replace the single Claude-only resume field with generic per-backend external session state.

Planned shape:

```ts
type ExternalCliBackend = 'claude-code' | 'opencode' | 'codex'

interface ExternalBackendState {
  sessionId?: string
  model?: string
}

type ExternalBackendStateMap = Partial<Record<ExternalCliBackend, ExternalBackendState>>
```

This will be stored with the conversation transcript so a single conversation can switch between backends and still resume correctly when switched back later.

### 3. Add OpenCode as a first-class backend

I will wire `opencode` into the same external-agent pipeline as Claude and Codex.

OpenCode has a solid direct SDK story, so this backend will use the official `@opencode-ai/sdk` route instead of treating OpenCode as a raw terminal/TUI integration.

Planned integration shape:

- use `createOpencode()` when aIDE needs to spin up and own the OpenCode server process
- use `createOpencodeClient()` when connecting to an already-running OpenCode instance
- talk to OpenCode over the SDK's HTTP client surface rather than scraping terminal output
- normalize OpenCode session/message events into the same `CliAgentMessage` stream used by the pane

Backend additions:

- add `opencode` to `AgentBackend`
- add `agent.opencodePath` setting support alongside existing path settings
- add backend label helpers and path update plumbing
- add OpenCode adapter resolution and startup logic

What I will not use for the initial backend pass:

- `@opencode-ai/plugin`
  - useful for extending OpenCode with custom tools/hooks, but not required just to embed OpenCode as a selectable backend in aIDE
- ACP
  - useful for editor-native embedding over stdio/JSON-RPC, but the direct SDK client route is the cleaner fit for the current Electron main-process architecture

### 4. Add Codex as a real backend instead of a stub

I will replace the current stub with a real adapter.

Important constraint:

- if Codex exposes a stable machine-readable stream/protocol, I will normalize that into the existing message model
- if Codex only exposes an interactive TUI path, I will need to bridge it through a dedicated process transport instead of the current Claude-style message flow

Either way, the backend manager will be refactored so Codex is no longer hard-coded as unsupported.

### 5. Add backend hot swap support to the manager and IPC

I will add explicit backend switching support rather than overloading `start()`.

Planned behavior:

- one CLI conversation can keep a single transcript
- each turn runs on the currently selected backend
- switching backends preserves prior transcript and per-backend external session state
- if a backend has never seen the conversation before, the manager will seed it from the existing conversation transcript instead of using a native resume token

Backend/API work:

- add a new `cliAgentSwitchBackend(sessionId, backend)` IPC path
- expose the active backend in `CliAgentSession`
- preserve per-backend state in persisted conversation data
- prevent or explicitly stop active runs before switching

### 6. Attribute messages to the backend that produced them

I will add backend attribution to normalized CLI messages so mixed-backend chats remain understandable.

Planned shape:

```ts
interface CliAgentMessage {
  ...
  backend?: 'claude-code' | 'opencode' | 'codex'
}
```

This is required once a single conversation can contain output from multiple external backends.

### 7. Migrate existing stored conversations safely

I will add a backward-compatible lazy migration path so existing Claude conversations continue to work.

Migration plan:

- existing `claudeSessionId` will be read and copied into generic backend state for `claude-code`
- existing conversation metadata with `backend: 'claude-code'` remains valid
- `claude-native` mirrored sessions remain Claude-only and stay separate from generic external session state

## Backend files I expect to change

Shared types / contracts:

- `packages/shared/src/cliAgentTypes.ts`
- `packages/shared/src/conversationTypes.ts`
- `packages/shared/src/index.ts`

Main process:

- `packages/main/src/chat/cliAgentManager.ts`
- `packages/main/src/chat/conversationStore.ts`
- `packages/main/src/index.ts`
- `packages/main/src/preload.ts`
- `packages/main/src/workspace/settingsResolver.ts`

Likely new backend adapter files:

- `packages/main/src/chat/cliAdapters/claudeCodeAdapter.ts`
- `packages/main/src/chat/cliAdapters/openCodeAdapter.ts`
- `packages/main/src/chat/cliAdapters/codexAdapter.ts`
- `packages/main/src/chat/cliAdapters/types.ts`

Tests:

- `tests/unit/cliAgentManager.test.ts`
- new adapter-focused unit tests

## Frontend changes required

These changes are required for the backend work to be fully usable in the UI.

### 1. Add `opencode` everywhere backend choices are rendered

Required files:

- `packages/renderer/src/lib/settingsSchema.ts`
- `packages/renderer/src/components/panes/CliAgentPane.tsx`
- `packages/renderer/src/components/panes/ChatHistoryPane.tsx`
- `packages/renderer/src/components/layout/AppShell.tsx`
- `packages/renderer/src/lib/workspace/workspaceSwitcher.ts`
- `packages/renderer/src/commands/domains/agent.ts`

The current renderer hard-codes only Claude and Codex labels/branches.

### 2. Add a backend switcher UI in the CLI agent pane

Required UI behavior:

- show current backend in the pane header
- allow switching between `claude-code`, `opencode`, and `codex`
- disable the switcher while a turn is actively running, or require stop-first behavior
- call the new backend switch IPC instead of reopening a new pane

This is the key frontend requirement for hot swapping.

### 3. Render mixed-backend transcripts clearly

Once one conversation can contain responses from multiple backends, the pane should show that clearly.

Minimum required UI change:

- display a backend badge on assistant/tool/result/error messages when the conversation contains more than one backend

Without this, hot-swapped conversations will be confusing.

### 4. Update history and new-chat affordances

Current limitations:

- `ChatHistoryPane` only exposes `+` for built-in conversations
- renderer routing logic assumes exact backend values instead of generic external-agent semantics

Required frontend changes:

- optionally allow creating a new CLI conversation from history UI with backend selection
- treat `opencode` as a CLI backend
- route any external CLI conversation to `cliAgentPane`

### 5. Update settings UI for the new backend path

Required UI/settings additions:

- add `agent.opencodePath`
- adjust descriptions so backend settings no longer imply only Claude/Codex exist

## Frontend contract changes to expect

The frontend agent should expect these shared contract changes.

### Shared type changes

- `AgentBackend` will include `opencode`
- `CliAgentMessage` will likely gain `backend?: AgentBackend`
- `CliAgentSession` will likely gain `activeBackend` and generic backend-state data
- `ConversationMeta.backend` should be treated as the last-used or primary backend, not as the only backend that has ever touched the conversation

### New or changed preload/window API calls

Expected additions:

```ts
cliAgentSwitchBackend: (sessionId: string, backend: AgentBackend) =>
  Promise<{ success: true } | { error: string }>
```

Possible session shape update:

```ts
interface CliAgentSession {
  ...
  activeBackend: 'claude-code' | 'opencode' | 'codex'
}
```

## Risks and open questions

### Codex transport risk

Codex appears to be primarily exposed as a CLI package. If it does not expose a stable non-interactive structured stream, it will require a different adapter strategy than Claude/OpenCode.

This does not block the manager refactor, but it may affect how deep Codex parity can go in the first backend pass.

### Conversation semantics after a switch

The backend implementation will preserve one transcript across all external backends. That means:

- native resume is backend-specific
- cross-backend continuity is transcript-based, not native-session-based

This is the correct model for hot swapping, but the frontend should present it as "switch backend for future turns" rather than "move the same vendor session between providers".

## Recommended work split

### Backend work owned here

- adapter abstraction
- Claude adapter extraction
- OpenCode adapter wiring
- Codex adapter wiring
- generic persistence/session-state migration
- switch-backend IPC and session behavior
- tests and migrations

### Frontend work for the separate agent

- backend selector UI in `CliAgentPane`
- `opencode` labels and routing everywhere a backend is rendered
- message badges for mixed-backend transcripts
- settings UI for `agent.opencodePath`
- any create-new-chat UX that should expose CLI backend choice

## Suggested frontend handoff summary

Frontend should prepare for:

1. `opencode` becoming a valid `AgentBackend`
2. a new `window.api.cliAgentSwitchBackend()` call
3. `CliAgentMessage.backend` being present on external-agent messages
4. `CliAgentSession.activeBackend` becoming the source of truth for the pane header
5. a conversation transcript containing output from more than one external backend
