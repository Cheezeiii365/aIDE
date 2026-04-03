# Multi-Workspace Runtime Architecture

Status: draft working note
Date: April 1, 2026
Scope: detailed record of Phase 0 and implementation plan for Phase 1 from [`docs/multiwork.md`](./multiwork.md)

## Purpose

This document exists to do two things:

1. record what Phase 0 actually accomplished in the codebase
2. define Phase 1 precisely enough that implementation decisions stop drifting back toward the old "single active runtime" model

`docs/multiwork.md` is the product and architecture plan. This file is the implementation-focused companion for the first two phases.

## Context

The current app already presents a multi-workspace shell in the renderer, but the Electron main process is still fundamentally modeled around one active backend runtime at a time.

That old model shows up as module-level singletons in [`packages/main/src/index.ts`](../packages/main/src/index.ts):

- `taskRunner`
- `agentManager`
- `cliAgentManager`
- `conversationStore`
- `nativeSessionWatcher`
- `nativeSessionCache`

Those services are tied to whichever workspace was most recently activated. Switching workspaces reinitializes them around the new workspace root.

The refactor goal is different:

- one `WorkspaceRuntime` per workspace
- workspace switch = focus change
- runtime destruction only on explicit workspace close or app shutdown

That distinction is the core architectural boundary.

## Phase 0 Summary

Phase 0 was about defining the boundary before migrating behavior.

### What landed

The following new files now exist:

- [`packages/main/src/workspace/runtimeTypes.ts`](../packages/main/src/workspace/runtimeTypes.ts)
- [`packages/main/src/workspace/WorkspaceRuntime.ts`](../packages/main/src/workspace/WorkspaceRuntime.ts)
- [`packages/main/src/workspace/WorkspaceRuntimeRegistry.ts`](../packages/main/src/workspace/WorkspaceRuntimeRegistry.ts)

The following global state was introduced in main:

- `runtimeRegistry = new WorkspaceRuntimeRegistry()`

The following logic moved off process-global ad hoc state and into `WorkspaceRuntime`:

- activation sequencing
- workspace-open task scheduling debounce state
- foreground/background/stop timestamps
- runtime identity and metadata snapshot state

The following shape is now explicit in code:

- a runtime has a stable `workspaceId`
- runtimes are created and looked up by a registry
- activation uses `runtimeRegistry.getOrCreate(entry)` rather than only raw workspace data
- focus is represented separately from workspace registry membership

### Why Phase 0 matters

Before this change, there was no concrete implementation boundary for "the backend for one workspace". There was only "whatever `index.ts` has currently pointed at one root path".

Phase 0 creates a named object for that responsibility. That matters because future migrations can move one service at a time behind `WorkspaceRuntime` without re-arguing the architectural shape each time.

### What Phase 0 did not do

Phase 0 did not make multi-runtime behavior real yet.

The code still destroys and recreates the actual long-lived services on workspace activation. The runtime object exists, but it is still mostly a shell around lifecycle metadata rather than the owner of running services.

This is expected for Phase 0. It is not sufficient for Phase 1.

## Phase 0 Inventory

### App-global state that should stay global

These are app-shell concerns, not per-workspace runtime concerns:

- Electron `app`
- `store`
- `mainWindow`
- `contentView`
- top-level menu
- `browserPaneManager` if browser panes remain globally hosted in this pass
- `workspaceRegistry` as the persisted/open-workspace list
- `runtimeRegistry` as the in-memory runtime supervisor

### Active-workspace singleton state that must become runtime-owned

These are the current violations of the target architecture:

- `taskRunner`
- `agentManager`
- `cliAgentManager`
- `conversationStore`
- `nativeSessionWatcher`
- `nativeSessionCache`
- file watcher instance state hidden behind `startWatchers` / `stopWatcher`
- git polling instance state hidden behind `startGitPolling` / `stopGitPolling`
- worktree polling instance state hidden behind `startWorktreePolling` / `stopWorktreePolling`

### Boundary decision already made

The architectural unit is:

- `WorkspaceRuntime`

Not:

- one Electron process per workspace

Runtime hosting stays in the main process for now. Process isolation is a later policy decision, not part of Phase 1.

## Current Gaps After Phase 0

This section is important because it defines what Phase 1 must fix.

### Gap 1: switching still destroys backend services

Current activation flow still does this:

- clear focused runtime
- destroy active singleton services
- recreate services for the newly selected workspace
- focus that runtime

That means the app can hold multiple `WorkspaceRuntime` objects in memory, but it cannot hold multiple live workspace backends.

This is the main reason Phase 1 is not complete yet.

### Gap 2: runtime state and runtime status are not observable enough outside the runtime object

`WorkspaceRuntime` can produce a snapshot, but the renderer is not yet consuming runtime snapshots. `WORKSPACE_REGISTRY_CHANGED` still reflects workspace entries, not runtime status or runtime state.

Phase 1 must make both concepts explicit and externally visible.

### Gap 3: state and lifecycle were previously collapsed into one enum

`docs/multiwork.md` defines:

- runtime status:
  - `starting`
  - `running`
  - `stopping`
  - `stopped`
  - `error`
- runtime state:
  - `foreground`
  - `backgrounded`
  - `asleep`
  - optional `blocked`

The old implementation used one mixed enum:

- `idle`
- `activating`
- `focused`
- `background`
- `disposed`
Those names mixed lifecycle and posture into a single concept. The code now separates them, and the docs should treat that split as canonical.

### Gap 4: service ownership has not moved

The new runtime has `services` slots, but they are placeholders. The actual service objects still live at module scope in `index.ts`.

That is acceptable for the boundary phase. It is not acceptable once Phase 1 claims the runtime boundary is real.

## Phase 1 Goal

Phase 1 must change the main process from:

- one live service graph plus several inert runtime records

to:

- one live service graph per open workspace runtime

That does not mean every subsystem must be fully migrated to the final event model in one shot. It does mean this core rule must become true:

- switching workspaces must no longer inherently tear down the previously active runtime

If that rule is not true, Phase 1 is not done.

## Phase 1 Non-Goals

Phase 1 should not try to finish later phases early.

It should not:

- redesign every IPC contract around `workspaceId`
- solve every renderer aggregation problem
- move runtimes into child processes
- fully redesign browser-pane ownership unless it blocks runtime persistence
- rebuild task, agent, git, and watcher modules all at once

Phase 1 is specifically about ownership and lifecycle.

## Phase 1 Design Principles

### Keep the critical architectural truth simple

A `WorkspaceRuntime` should be the only owner of long-lived backend services for one workspace.

Anything that needs a workspace root, manages long-running work, emits runtime events, or has lifecycle beyond a single request belongs either:

- inside `WorkspaceRuntime`, or
- behind an adapter owned by `WorkspaceRuntime`

### Preserve additive migration

We do not need a perfect final architecture in one pass. We do need to stop making `index.ts` the hidden owner of runtime behavior.

The practical migration rule is:

- move construction and disposal under `WorkspaceRuntime` first
- improve IPC/event routing after ownership is correct

### Distinguish runtime state from runtime status

The code currently mixes these concerns. Phase 1 should split them.

Canonical model:

- runtime status: `starting | running | stopping | stopped | error`
- runtime state: `foreground | backgrounded | asleep | blocked`

Why this split matters:

- runtime status answers whether the runtime exists and is healthy
- runtime state answers resource policy and user-visible posture

This mirrors the distinctions already described in [`docs/multiwork.md`](./multiwork.md).

## Proposed Phase 1 Target Model

### `WorkspaceRuntimeRegistry`

The registry should become the supervisor for all live runtimes.

Minimum responsibilities:

- create runtime for a workspace entry if missing
- return existing runtime if present
- track the foreground workspace id
- transition prior foreground runtime to `backgrounded` instead of destroying it
- expose runtime snapshots for all live runtimes
- destroy one runtime on explicit close
- destroy all runtimes on app quit

Suggested API shape:

- `get(id)`
- `getOrCreate(entry)`
- `focus(id)`
- `background(id)`
- `delete(id)`
- `list()`
- `snapshotAll()`
- `disposeAll()`

`list()` or `snapshotAll()` is important because lifecycle must be observable.

### `WorkspaceRuntime`

A runtime should become a composition root with explicit lifecycle methods.

Minimum responsibilities:

- own `workspaceId`, root path, metadata, and effective root
- own service instances for that workspace
- initialize services once
- transition between `foreground`, `backgrounded`, and `asleep`
- dispose its own services
- expose a serializable snapshot

Suggested methods:

- `start()`
- `enterForeground()`
- `enterBackground()`
- `enterSleep()` or `recomputeState()`
- `updateEntry(entry)`
- `dispose()`
- `snapshot()`

Suggested owned service bag:

- `taskRunner`
- `agentManager`
- `cliAgentManager`
- `conversationStore`
- `nativeSessionWatcher`
- watcher adapter
- git polling adapter
- worktree polling adapter

The runtime should own both the service objects and their lifecycle operations. `index.ts` should stop directly calling `destroy`, `stopGitPolling`, `stopWatcher`, and similar workspace-level teardown operations except through the runtime.

## Phase 1 Service Strategy

Trying to move every subsystem at once will create unnecessary breakage. The safer approach is to move ownership first and preserve existing internal module behavior where possible.

### Step 1: move service references into `WorkspaceRuntime`

First pass:

- keep existing concrete service classes
- instantiate them from the runtime
- store them on the runtime
- have runtime teardown call their cleanup paths

This already eliminates the biggest architectural problem: `index.ts` no longer owns the active workspace backend directly.

### Step 2: introduce runtime-owned adapters for module-singleton subsystems

Watcher and polling code likely still hides singleton internals behind module functions.

Phase 1 should introduce thin adapters so runtime ownership becomes explicit even if the underlying subsystem still needs refactoring.

Examples:

- `FileWatcherHandle`
- `GitPollingHandle`
- `WorktreePollingHandle`

Each handle should support at least:

- `start(...)`
- `stop()`
- `snapshot()` if useful

That creates a seam so Phase 3 can replace hidden singletons without changing the runtime contract again.

### Step 3: make activation a focus operation, not a reconstruction path

The current `activateWorkspace(id)` function should stop being "destroy old services, build new services".

It should become approximately:

1. resolve target runtime from registry
2. ensure target runtime has been started
3. transition current foreground runtime to `backgrounded`
4. transition target runtime to `foreground`
5. update app-global active workspace pointers that are truly UI-oriented
6. broadcast runtime snapshots

The critical point is that step 3 must not destroy the old runtime.

## Recommended Runtime State Model For Phase 1

Phase 1 does not need to implement every future optimization, but it should align to the canonical terms now.

### Runtime status

- `starting`
- `running`
- `stopping`
- `stopped`
- `error`

### Runtime state

- `foreground`
- `backgrounded`
- `asleep`
- `blocked`

### Initial simplification

To keep implementation manageable, Phase 1 can treat `asleep` as a deferred policy state and initially use:

- `foreground`
- `backgrounded`
- `blocked`

with the rule:

- a non-foreground runtime remains `backgrounded` unless a later sleep policy explicitly moves it to `asleep`

That preserves vocabulary consistency without forcing early optimization work.

## Observability Plan

Runtime lifecycle must become visible to the rest of the app.

### Minimum observability requirement

The main process should be able to produce a runtime snapshot for every live runtime containing:

- `workspaceId`
- root path
- runtime status
- runtime state
- whether the runtime is initialized
- whether services are attached
- coarse workload flags:
  - agents running
  - tasks running
  - pending approval
  - pending user input

Not every field must be perfect in the first pass, but the shape must exist.

### Transport

There are two acceptable approaches for Phase 1:

1. extend `WORKSPACE_REGISTRY_CHANGED` to include runtime snapshot fields
2. add a new runtime-focused IPC event such as `WORKSPACE_RUNTIME_SNAPSHOTS_CHANGED`

Option 2 is cleaner because it avoids overloading the persisted/open-workspace registry with runtime lifecycle concerns.

### Why this matters now

Without runtime snapshots, the renderer cannot distinguish:

- workspace exists but runtime not started
- runtime running in background
- runtime blocked on approval
- runtime failed

That blocks truthful UI and makes debugging the migration harder.

## `index.ts` After Phase 1

The desired direction is for `packages/main/src/index.ts` to act as an app supervisor, not a workspace backend.

It should own:

- Electron app/window/bootstrap
- global settings store
- global registries
- IPC registration
- app shutdown flow

It should not own:

- per-workspace task runner lifecycle
- per-workspace agent lifecycle
- per-workspace conversation-store lifecycle
- per-workspace watcher/polling lifecycle

A useful review rule for this phase:

- if a variable in `index.ts` would have different values for Workspace A and Workspace B at the same time, it probably belongs in `WorkspaceRuntime`

## Concrete Implementation Plan

### 1. Stabilize the type model

Update runtime types so they reflect the architecture instead of temporary implementation names.

Actions:

- keep runtime status separate from runtime state
- keep canonical runtime-state names: `foreground`, `backgrounded`, `asleep`, `blocked`
- keep canonical runtime-status names: `starting`, `running`, `stopping`, `stopped`, `error`
- keep timestamps and activation sequence if they remain useful

### 2. Make runtime snapshots first-class

Actions:

- add registry enumeration and snapshot methods
- expose runtime snapshots through IPC
- broadcast runtime changes on create, start, foreground, background, and stop

### 3. Move service ownership into the runtime

Actions:

- add owned service fields to `WorkspaceRuntime`
- add `start()` and `dispose()` methods that encapsulate construction and cleanup
- move current `cleanupActiveWorkspaceServices()` logic into runtime disposal logic
- remove module-level singleton ownership from `index.ts`

### 4. Change workspace activation semantics

Actions:

- background current runtime instead of destroying it
- start target runtime if needed
- foreground target runtime
- stop rewriting activation as global teardown plus rebuild

### 5. Keep app-global state honest

Actions:

- retain `workspaceRegistry.setActive(id)` for UI focus semantics
- stop using `store.get('workspaceRoot')` as an implicit backend routing primitive where runtime context should be explicit
- keep app-global persisted pointers only for app restore and UI defaults

## Risks And Tradeoffs

### Memory and CPU will increase

Keeping more than one runtime alive means more resident state and more background work. That is not a bug. It is the explicit product requirement.

The right response is:

- make runtime state visible
- add a later sleep policy

Not:

- collapse back to one live runtime

### Polling and watcher modules may resist runtime ownership

Those modules probably assumed singleton process-wide ownership. If they are awkward to migrate directly, wrap them in runtime-owned handles first.

The boundary is more important than perfectly elegant internals in this phase.

### Some IPC handlers will remain focused-runtime based temporarily

That is acceptable for a short period if ownership is already correct and the limitation is explicit.

It is not acceptable for handlers that claim to be workspace-specific while silently reading focused-runtime state.

## Phase 1 Acceptance Criteria

Phase 1 should only be marked complete when all of these are true:

- main process can hold multiple live `WorkspaceRuntime` instances at once
- switching workspaces does not destroy the previously running runtime
- `WorkspaceRuntime` owns the long-lived backend services for its workspace, even if some are still thin wrappers
- runtime status and runtime state are observable from outside the runtime object
- `index.ts` is no longer the hidden owner of per-workspace service instances
- the team can explain exactly what happens on:
  - workspace create
  - first activation
  - switch away
  - switch back
  - close
  - app quit

## Immediate Next Steps

The next implementation pass should be:

1. revise runtime type vocabulary to align with `docs/multiwork.md`
2. add runtime snapshot broadcasting from the registry
3. move `taskRunner`, `agentManager`, `cliAgentManager`, `conversationStore`, and `nativeSessionWatcher` ownership into `WorkspaceRuntime`
4. change activation so the previous runtime becomes `backgrounded` instead of being torn down
5. leave full `workspaceId` IPC migration to the next phase unless a handler is currently incorrect or misleading

That sequence keeps the migration incremental while making the architecture actually true.
