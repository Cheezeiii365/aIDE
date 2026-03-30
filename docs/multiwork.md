# Multi-Workspace Runtime Refactor Plan

## Vocabulary

Use these terms precisely throughout this refactor.

- `WorkspaceRuntime`
  - the logical backend instance for one workspace
  - owns the long-lived services and state for that workspace
  - examples: agents, CLI agent sessions, task runner, watchers, git/worktree services, conversation binding, runtime lifecycle state
- `process`
  - an operating-system execution boundary
  - examples in Electron: main process, renderer process, spawned child process
  - a process may host one runtime or many runtimes
- `RuntimeHost`
  - the place where a runtime executes
  - initial recommendation for this app: host all workspace runtimes in the Electron main process
  - future option: move some runtimes into dedicated child processes if isolation or resource control requires it
- `workspace switch`
  - a UI focus change between workspaces
  - should not imply runtime destruction
- `foreground`
  - workspace is visible or actively selected in the UI
- `backgrounded`
  - workspace is not visible, but still has active work or needs prompt user attention
- `asleep`
  - workspace is not visible and has no active work; runtime remains present but runs in a reduced-activity mode
- `blocked`
  - optional explicit runtime state for waiting on user approval or input; operationally distinct from asleep because it still needs visible status

Important distinction:

- `runtime` is the architectural unit
- `process` is the operating-system container that may host one or more runtimes

For this app, the first goal is:

- one `WorkspaceRuntime` per workspace

Not:

- one OS process per workspace

## Goal

Shift aIDE from:

- a multi-workspace renderer shell backed by a single active main-process runtime

to:

- a multi-workspace system where each workspace owns an independent runtime that can stay alive while the user works elsewhere

This refactor is required for the product to behave like a real multi-agent IDE. The key architectural change is:

- `Workspace` becomes the backend runtime boundary
- `workspace switch` becomes a focus change, not a teardown/recreate cycle

## Current Problem

Today the renderer already behaves like a multi-workspace shell, but the main process still swaps singleton services when the active workspace changes. That causes these failures:

- background agents are killed on workspace switch
- tasks are killed on workspace switch and are not addressable by workspace
- watcher and git/worktree services are effectively active-workspace singletons
- permission prompts and completion signals are tied to mounted chat UI instead of a global runtime notification layer
- unsaved editor state is not durable across workspace switches
- active worktree state is global instead of per workspace

The result is a false multi-workspace model: the UI suggests concurrency, but only one workspace has a live backend runtime.

## Refactor Principles

- Treat each workspace as an isolated runtime with its own lifecycle
- Make every long-lived backend service workspace-scoped
- Make every runtime event workspace-addressable
- Decouple visibility from liveness: hidden or unfocused workspaces must keep running
- Decouple document state from pane/component lifetime
- Move global UI concerns into explicit global services instead of panel-local listeners
- Prefer additive migration over a one-shot rewrite

## Runtime State Machine

The runtime model should explicitly separate UI focus, backend liveness, and resource policy.

### Primary states

- `foreground`
  - workspace is open, selected, or actively edited by the user
  - full responsiveness
  - normal polling, watcher behavior, and immediate event delivery
- `backgrounded`
  - workspace is not currently visible, but work is still running or the user needs to be notified soon
  - examples:
    - an agent is still running
    - a task is still running
    - a permission request or input request is pending
    - a recent completion/error still needs global surfacing
- `asleep`
  - workspace is not visible and has no active work
  - runtime still exists, but monitoring and background activity should be reduced to conserve CPU/memory
  - examples:
    - slower polling
    - minimal watchers or reduced watcher handling
    - durable state retained for quick wake-up

### Optional explicit states

- `blocked`
  - waiting on user approval or other required input
  - should not be treated the same as asleep, because it still needs prominent status and notification handling
- `error`
  - runtime is unhealthy and may require recovery, restart, or user intervention
- `starting`, `stopping`, `stopped`, `degraded`
  - internal lifecycle states that may still be useful for supervision and telemetry

### Transition rules

- user opens or selects a workspace -> `foreground`
- user leaves a workspace, but an agent or task is still active -> `backgrounded`
- workspace is not visible and no active work remains -> `asleep`
- permission or user input is requested while workspace is not visible -> `backgrounded` or `blocked`, not `asleep`
- user returns to a backgrounded or asleep workspace -> `foreground`

### Sleep policy

Do not sleep a workspace just because an agent finished. A workspace should only enter `asleep` when all of the following are true:

- it is not in the foreground
- no agents are running
- no tasks are running
- no approvals are pending
- no user-input requests are pending
- no immediate follow-up work is queued

### Architectural implication

The runtime state machine is more important than the eventual process model. Get the runtime lifecycle correct first. Process isolation, if needed later, should be an implementation detail behind the `RuntimeHost` boundary.

## Target Architecture

### Main process

The main process should act as a supervisor for many workspace runtimes.

Core concepts:

- `WorkspaceRuntimeRegistry`
  - owns all live runtimes
  - keyed by `workspaceId`
  - starts, looks up, transitions, suspends, resumes, and destroys runtimes
- `WorkspaceRuntime`
  - owns the services for exactly one workspace
  - exposes lifecycle and status
  - is the only place that knows the effective repo root / active worktree / live agents / live tasks for that workspace
- `RuntimeHost`
  - initially the Electron main process
  - may later be replaced or extended with child-process hosting if justified
- `WorkspaceRuntimeServices`
  - agent manager
  - CLI agent manager
  - conversation store binding
  - task runner
  - file watchers
  - git polling
  - worktree polling
  - future LSPs and other background services

### Renderer

The renderer should remain the multi-workspace shell, but it needs explicit global coordination layers:

- workspace shell and layout host
- document store for open/dirty buffers
- global notification center
- global approval inbox
- workspace status aggregation layer
- truthful workspace ribbon indicators

### Shared contracts

All runtime-facing IPC payloads and events should become workspace-scoped.

Examples:

- agent status
- tool approval requests
- tool progress/results
- task execution and diagnostics
- git status and branch changes
- worktree changes
- watcher events
- runtime lifecycle transitions

## Desired User-Visible Behavior

After this refactor:

- an agent started in Workspace A keeps running after switching to Workspace B
- a task can run in Workspace A while editing in Workspace B
- permission requests and completions appear globally even if the originating chat pane is closed
- workspace ribbon badges reflect real runtime state
- unsaved editors survive workspace switches without reloading from disk
- each workspace remembers its own active worktree
- closing a workspace explicitly tears down its runtime; switching does not

## Implementation Phases

### Phase 0: Define the Boundary

Objective:

- lock in the new architecture before moving code

Deliverables:

- a written `WorkspaceRuntime` definition
- a written vocabulary section distinguishing runtime, process, and runtime host
- a written runtime lifecycle model
- a written runtime state machine for `foreground`, `backgrounded`, `asleep`, and optional `blocked`
- an inventory of current singleton services and where they move
- a canonical list of all events that must carry `workspaceId`

Decisions to make:

- lifecycle states: `starting`, `running`, `degraded`, `paused`, `stopping`, `stopped`, `error`
- runtime states: `foreground`, `backgrounded`, `asleep`, and whether `blocked` is modeled explicitly
- whether inactive runtimes are always live or can be suspended further under resource pressure
- whether browser panes and PTYs remain globally managed or become runtime-owned adapters
- whether any service truly requires its own OS process in the first pass

Acceptance criteria:

- there is one documented owner for every background service
- there is no ambiguous shared global state for workspace runtime concerns
- the team can explain what happens on `create`, `activate`, `deactivate`, `close`, and `app quit`
- the team can explain what runtime state transitions happen when the user switches away, an agent keeps running, an approval is pending, or work finishes

### Phase 1: Introduce `WorkspaceRuntimeRegistry`

Objective:

- stop modeling the main process around one active runtime

Work:

- create a registry keyed by `workspaceId`
- add a `WorkspaceRuntime` class or equivalent composition root
- move runtime creation/destruction behind the registry
- make workspace activation fetch or foreground an existing runtime instead of rebuilding global singletons

Important constraint:

- do not migrate every subsystem at once; first create the registry shell and move ownership boundaries
- do not commit to one OS process per workspace in the first pass unless a clear constraint forces it

Acceptance criteria:

- main process can hold more than one runtime object at a time
- switching workspaces no longer inherently destroys runtime instances
- runtime lifecycle is explicit and observable

### Phase 2: Make the Event Model Workspace-Scoped

Objective:

- make renderer and main communicate in terms of workspace runtimes, not “whatever is currently active”

Work:

- add `workspaceId` to every runtime event and payload that does not already have it
- audit existing shared types and IPC contracts
- add routing and aggregation in the renderer for background events
- separate “active workspace” UI state from runtime event delivery

Key rule:

- if an event can originate from a background service, it must be workspace-addressable

Acceptance criteria:

- the renderer can receive and process events from multiple workspaces simultaneously
- no background event depends on the active workspace singleton to be understood
- no listener assumes the emitting workspace is currently focused

### Phase 3: Migrate Long-Lived Services Into Each Runtime

Objective:

- move actual behavior behind the new runtime boundary

Recommended migration order:

1. conversation store binding and agent session ownership
2. built-in agent manager
3. CLI agent manager
4. task runner
5. file watchers
6. git polling
7. worktree polling

For each migrated service:

- remove singleton ownership from `packages/main/src/index.ts`
- move service construction into `WorkspaceRuntime`
- expose start/stop/status through runtime lifecycle methods
- ensure emitted events include `workspaceId`

Acceptance criteria:

- an agent in one workspace survives activation of another workspace
- task execution continues when the workspace is unfocused
- watcher and git/worktree updates can arrive concurrently from multiple workspaces

### Phase 4: Build a Global Runtime Notification Layer

Objective:

- stop tying runtime visibility to mounted chat panes

Work:

- create a renderer-level notification center for:
  - permission requests
  - agent completions
  - task completions/failures
  - runtime errors
- create a global approval inbox with durable pending state
- connect workspace ribbon indicators to aggregated runtime state
- ensure CLI and built-in agent completions both surface here

Important rule:

- approval state must outlive pane unmounts, layout changes, and workspace switches
- a runtime waiting on user input should not disappear into the asleep state

Acceptance criteria:

- a permission request remains visible and actionable when its pane is closed
- background completion is surfaced without needing the originating panel mounted
- workspace ribbon status reflects live runtime state, not placeholders

### Phase 5: Separate Document State From Editor Pane Lifetime

Objective:

- eliminate the data-loss class around unsaved editors

Work:

- create a workspace-scoped document/session store
- treat open documents as domain state, not transient component state
- persist:
  - clean baseline
  - dirty content
  - selection/cursor state
  - conflict markers such as “changed on disk while dirty”
- make workspace switching serialize/restore document state without forcing disk reload for dirty buffers

Architectural rule:

- `EditorPane` renders document state; it does not own document truth

Acceptance criteria:

- dirty buffers survive workspace switches
- restoring a workspace does not silently discard unsaved text
- external file-change handling respects workspace and document identity

### Phase 6: Normalize Per-Workspace Worktree and Effective Root State

Objective:

- stop sharing mutable repo context globally

Work:

- move active worktree selection into workspace-local persisted state
- derive effective root inside each `WorkspaceRuntime`
- make worktree watcher/polling state runtime-owned
- ensure git/task/agent operations resolve against the correct workspace context

Acceptance criteria:

- each workspace remembers its own active worktree
- switching workspaces does not reset or corrupt worktree context
- git- and task-related actions resolve against the workspace’s own effective root

### Phase 7: Promote Tasks to First-Class Workspace Workloads

Objective:

- make tasks part of the same runtime model as agents

Work:

- add `workspaceId` to task execution models and status events
- keep independent execution registries per runtime
- let renderer observe tasks from unfocused workspaces
- define how agents invoke tasks through the runtime boundary instead of shell-only workarounds

Acceptance criteria:

- tasks can run in multiple workspaces concurrently
- task status, diagnostics, and completion are attributable to the correct workspace
- the system can support “run task in workspace X while I work in Y”

### Phase 8: Cleanup and Policy

Objective:

- remove transitional architecture and make lifecycle rules explicit

Work:

- remove old active-workspace teardown paths
- remove remaining singleton assumptions from main and renderer
- define runtime shutdown/suspension policy
- define app-quit persistence and recovery behavior
- document which resources are global by design and why

Acceptance criteria:

- workspace switching is a UI focus operation
- runtime destruction only happens on explicit close, app shutdown, or defined suspension policy
- the old architecture cannot be accidentally reintroduced through convenience globals

## Cross-Cutting Design Rules

These rules should be enforced during every phase:

- No background service should be owned directly by `index.ts` if it is logically per-workspace
- No runtime event should be emitted without workspace identity
- No renderer feature should require a visible pane to keep backend work alive
- No dirty document should rely on component-local memory for survival
- No per-workspace repo/worktree state should be stored in a single global app key

## Suggested File/Module Direction

This is not a required final shape, but it is a useful direction:

- `packages/main/src/workspace/workspaceRuntimeRegistry.ts`
- `packages/main/src/workspace/workspaceRuntime.ts`
- `packages/main/src/workspace/runtimeTypes.ts`
- `packages/main/src/workspace/runtimeEventBus.ts`
- `packages/renderer/src/lib/workspace/runtimeStore.ts`
- `packages/renderer/src/lib/workspace/notificationCenter.ts`
- `packages/renderer/src/lib/editor/documentStore.ts`

The point is not the exact filenames. The point is to create explicit architectural homes for runtime ownership, runtime events, and document state.

## Delivery Strategy

Do this incrementally, behind stable interfaces.

Recommended approach:

- first add the runtime registry without changing visible behavior
- then migrate one service at a time behind the runtime boundary
- then move renderer UX to global status/approval handling
- then fix document persistence
- then remove the old activation teardown path

Avoid:

- mixing document-state redesign with runtime-registry introduction in one step
- migrating all services at once without a common lifecycle abstraction
- solving notification problems only inside chat hooks
- conflating runtime boundaries with process boundaries before the runtime model is stable

## Milestones

### Milestone 1: Multiple runtime objects exist

Success means:

- registry exists
- activation no longer implies destruction
- event model work has started

### Milestone 2: Background agents survive switching

Success means:

- built-in and CLI agents live inside workspace runtimes
- permission and completion flow is no longer pane-local

### Milestone 3: Background tasks and watchers are real

Success means:

- tasks are workspace-addressable
- watchers/git/worktree services are runtime-owned
- concurrent background activity is possible

### Milestone 4: Workspace switching is safe

Success means:

- dirty documents survive
- worktree context persists per workspace
- ribbon status is truthful

## Risks

- Partial migration can leave you with two ownership models at once. Minimize this by making `WorkspaceRuntime` the only allowed entry point for migrated services.
- Event-schema churn can create temporary renderer/main mismatch. Mitigate by updating shared types first and migrating consumers immediately after.
- Document-state redesign can sprawl. Keep it focused on ownership and persistence, not editor feature expansion.
- Resource usage will increase when multiple runtimes stay alive. Plan an explicit suspension policy later, but do not block correctness on premature optimization.
- A premature move to one OS process per workspace would increase supervision and IPC complexity before the ownership model is stable. Treat that as a later optimization/isolation decision, not a first-pass requirement.

## Non-Goals for the First Pass

- solving runtime suspension/resource optimization perfectly
- redesigning browser panes or PTY architecture unless needed for runtime ownership consistency
- adding new end-user features beyond what is required to make multi-workspace behavior correct
- deep LSP architecture work unless it blocks the runtime model

## Definition of Done

This refactor is complete when all of the following are true:

- switching workspaces does not kill agents, tasks, or other per-workspace background services
- all runtime events are attributable to a workspace
- approvals and completions surface globally and durably
- dirty documents survive workspace switches without silent disk reload
- worktree state is per workspace
- the old active-workspace singleton runtime model has been removed

## Immediate Next Step

Start with Phase 0 and Phase 1 together:

- define `WorkspaceRuntime`
- define the vocabulary: `WorkspaceRuntime`, `process`, and `RuntimeHost`
- define runtime lifecycle and service ownership
- define runtime states and transition rules
- create `WorkspaceRuntimeRegistry`
- change activation from “destroy old, create new” to “lookup or start runtime, then focus it”

Everything else becomes cleaner once that boundary exists.
