# Phase 1 Runtime Ownership And Observability Verification

Date: April 1, 2026

## Verification Summary

Commands run:

- `pnpm typecheck`
- `pnpm build`
- `pnpm test`
- `pnpm lint`

Results:

- `pnpm typecheck`: passed
- `pnpm build`: passed
- `pnpm test`: failed
- `pnpm lint`: failed

Conclusion:

Phase 1 is not fully built correctly against the requested scope. The code compiles and production build succeeds, but the runtime ownership contract is only partially implemented and the verification suite is not green.

## Findings

### 1. Watcher and polling ownership is still process-global, not runtime-owned

Severity: high

This is the main architectural miss relative to the Phase 1 goal.

`activateWorkspace()` still starts watcher and polling infrastructure directly from `index.ts` instead of through `WorkspaceRuntime`, and those modules still operate as singletons:

- `packages/main/src/index.ts:296-317`
- `packages/main/src/git/gitStatus.ts:6-10`
- `packages/main/src/git/gitStatus.ts:88-148`
- `packages/main/src/workspace/worktreeManager.ts:275-316`
- `packages/main/src/workspace/fileWatcher.ts:153-243`

Why this is a problem:

- `WorkspaceRuntime` is supposed to own watcher handle, git polling handle, and worktree polling handle in this pass.
- Backgrounding the previously focused runtime is supposed to keep its runtime alive.
- `startGitPolling()` and `startWorktreePolling()` both call their corresponding stop functions before starting a new root, so there is still only one live poller.
- `activateWorkspace()` still binds filesystem watching to a shared `'default'` scope rather than a workspace-specific runtime scope.

Net effect:

- The runtime registry can report multiple live runtimes.
- The actual watcher/git/worktree infrastructure still follows only one workspace at a time.
- That means the runtime snapshot model overstates what the background runtime still owns.

### 2. Runtime service slots for watcher and polling handles are declared but never attached

Severity: medium

The runtime service bag declares:

- `fileWatcher`
- `gitStatus`
- `worktreeManager`

Reference:

- `packages/main/src/workspace/runtimeTypes.ts:28-38`

But the runtime service construction path never assigns any of those slots:

- `packages/main/src/index.ts:355-418`

Why this matters:

- The requested Phase 1 snapshot contract includes `servicesAttached` and runtime truth for ownership.
- Right now the runtime can only reflect task/chat/native-session ownership, not watcher/polling ownership.
- The renderer ribbon therefore does not have truthful runtime visibility for those services.

### 3. The implementation does not satisfy the explicit Phase 1 foreground/background constraint

Severity: high

The required constraint was:

- backgrounding the old runtime must not stop its agents, tasks, watchers, git polling, worktree polling, or conversation store

The current code preserves agents/tasks/conversation state better than before, but watcher and polling behavior still remains focus-bound due to the singleton infrastructure above. That means the implementation does not meet the stated validation requirement in full.

Affected activation path:

- `packages/main/src/index.ts:296-317`
- `packages/main/src/workspace/WorkspaceRuntimeRegistry.ts:29-40`

### 4. Test suite is not updated for the new runtime snapshot preload API

Severity: medium

`pnpm test` currently fails because renderer tests still use an older `window.api` mock that does not include the new runtime snapshot methods:

- `window.api.getWorkspaceRuntimeSnapshots`
- `window.api.onWorkspaceRuntimeSnapshotsChanged`

Observed failure:

- `tests/unit/app.test.tsx` throws `TypeError: window.api.getWorkspaceRuntimeSnapshots is not a function`

This means the implementation is not verified end-to-end in the existing unit suite yet.

### 5. Lint is not clean, including a new runtime-types lint failure

Severity: low

`pnpm lint` fails for a number of existing issues, and this change set adds at least one new one in the runtime boundary code:

- `packages/main/src/workspace/runtimeTypes.ts:24` reports `@typescript-eslint/no-empty-object-type`

The branch should not be considered cleanly verified while lint is red.

## Passing Checks

- Shared IPC names for runtime snapshots were added.
- Preload exposes the runtime snapshot getter and subscription API.
- Renderer workspace state now loads and subscribes to runtime snapshots.
- Ribbon status is runtime-driven instead of using only the static idle fallback.
- High-risk handler fixes were partially addressed:
  - `CHAT_GET_HISTORY` now resolves by `workspaceId`
  - `CLI_AGENT_LOAD_MESSAGES` now resolves by `workspaceId`
  - `TASK_FILE_SAVED` now resolves a runtime from the file path

## Recommended Next Step

Complete the runtime ownership boundary for watcher, git, and worktree infrastructure before treating Phase 1 as done. After that, update the test mocks and re-run `pnpm test` and `pnpm lint` so the verification record is actually green.

## Resolution (2026-04-01)

**Finding 4 (test mocks):** Fixed — added `getWorkspaceRuntimeSnapshots` and `onWorkspaceRuntimeSnapshotsChanged` to `tests/unit/app.test.tsx` mock.

**Finding 5 (lint):** Fixed — replaced empty `RuntimeSnapshot` interface with type alias in `runtimeTypes.ts`.

**Finding 2 (empty service slots):** Annotated as Phase 3 scope. The slots are intentionally unpopulated per the Phase 1 additive-only rule (`IDE_BUILD_PLAN.md` line 1421) and the service ownership inventory (lines 1344-1346).

**Findings 1 & 3 (watcher/polling ownership):** Deferred to Phase 3. These describe migrating global singletons behind runtime ownership, which is explicitly Phase 3 scope in `multiwork.md` (lines 301-328). Phase 2 (workspace-scoped event model) is prerequisite — concurrent watchers from multiple runtimes require workspace-addressable event routing before they can be enabled.
