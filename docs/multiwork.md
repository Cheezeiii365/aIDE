Findings

  - The backend is still fundamentally single active workspace, not truly multi-workspace. On every switch, packages/main/src/index.ts:267 resets workspaceRoot and
    activeWorktree, kills the current packages/main/src/index.ts:277, stops git/worktree polling and file watching (packages/main/src/index.ts:279, packages/main/src/
    index.ts:281), then destroys and recreates both agent managers (packages/main/src/index.ts:312, packages/main/src/index.ts:347).
  - A background agent in another workspace cannot stay alive today. Built-in agent loops are aborted during packages/main/src/chat/agentManager.ts:294, and CLI agent
    processes are killed during packages/main/src/chat/cliAgentManager.ts:347. What survives is conversation history on disk, not a live runtime.
  - Task execution is also single-workspace. The switch path kills all running tasks via packages/main/src/index.ts:277, and the task payloads are not workspace-
    addressable because packages/shared/src/index.ts:622 has no workspaceId. There is also no built-in agent tool for “run aIDE task”; the agent tool surface is file/
    shell/search/browser oriented (packages/main/src/chat/agentTools.ts:73, packages/main/src/chat/agentTools.ts:208).
  - Notification/status plumbing is not prepared for background workspace agents. Built-in permission requests are only surfaced through a mounted useChat session
    listener (packages/renderer/src/hooks/useChat.ts:152); if that panel is gone, there is no global notification layer. CLI completion does emit packages/main/src/
    chat/cliAgentManager.ts:683, but I could not find a renderer consumer for it. The workspace ribbon status dot is effectively fake right now: it renders idle unless
    a custom color is set (packages/renderer/src/components/layout/WorkspaceRibbon.tsx:117).
  - There is a real data-model bug around unsaved editors across workspace switches. The switcher clears editor cache and dirty state before panel teardown (packages/
    renderer/src/lib/workspace/workspaceSwitcher.ts:63), the editor restore path only reuses cached selection and always reloads the document from disk (packages/
    renderer/src/components/panes/EditorPane.tsx:105, packages/renderer/src/components/panes/EditorPane.tsx:183), and the serializer explicitly says dirty files re-read
    from disk on restore (packages/renderer/src/lib/workspace/workspaceStateSerializer.ts:69). That means unsaved content is not actually preserved the way the
    workspace design intends.
  - The watcher architecture is only half-migrated. FsWatchEvent already carries a packages/shared/src/index.ts:266, and the watcher backend supports scoped roots
    (packages/main/src/workspace/fileWatcher.ts:8, packages/main/src/workspace/fileWatcher.ts:153), but the app always uses the 'default' scope on workspace activation
    (packages/main/src/index.ts:288) and the editor ignores scopeId entirely when processing file events (packages/renderer/src/components/panes/EditorPane.tsx:287).
  - Worktree state is global, not per workspace. Switching workspace forcibly clears activeWorktree (packages/main/src/index.ts:274), and the worktree manager stores it
    in a single app-level key (packages/main/src/workspace/worktreeManager.ts:223). So each workspace does not retain its own selected worktree.

  Direct answers

  - Backend support for multi-workspace editing: decent for registry, layout persistence, browser session isolation, and terminal reattachment; weak for concurrent
    runtime services. It is not a multi-workspace backend in the “multiple active agents/tasks/watchers at once” sense.
  - What gets torn down on switch: task runner, running tasks, git polling, worktree polling, file watchers, conversation store binding, built-in agent manager, CLI
    agent manager, Claude native watcher, active worktree selection, and all visible Dockview panels.
  - What does not necessarily get torn down on switch: regular PTYs and browser views. PTYs are keyed globally and can be reattached (packages/main/src/terminal/
    ptyManager.ts:56, packages/renderer/src/components/panes/TerminalPane.tsx:114). Browser panes are preserved during switch and only destroyed on explicit close/
    remove (packages/renderer/src/components/layout/AppShell.tsx:658, packages/main/src/browserPaneManager.ts:221).
  - Can an agent in another workspace stay alive: no.
  - Can you notify the user when that agent requests permissions or finishes: not reliably with the current architecture. There is no global workspace-level
    notification/status system for that path.
  - Can an agent call aIDE tasks from an unfocused workspace: no. The task runner is active-workspace singleton, and the agent toolset has no task API. A CLI agent
    could manually run shell commands in its cwd, but that is not the aIDE task system.
  - What else you’re missing: per-workspace runtime registries, workspace-scoped event payloads, durable pending approval state, real workspace status badges, per-
    workspace worktree persistence, and proper unsaved-buffer preservation.

  Current architecture
  The renderer is already modeled like a multi-workspace shell: it keeps a workspace registry, snapshots UI/runtime state, clears the Dockview tree on switch, and
  restores the target workspace layout (packages/renderer/src/lib/workspace/workspaceSwitcher.ts:41, packages/renderer/src/components/layout/AppShell.tsx:171). The main
  process is not modeled that way. It owns one active workspace runtime at a time and swaps singleton managers underneath the shell (packages/main/src/index.ts:267).

  That split is the core architectural problem. You have a multi-workspace UI over a single-workspace backend, with two exceptions: browser panes and normal PTYs are
  already global/multi-tenant. If your goal is “agents keep working while I switch elsewhere”, you need workspace-keyed service registries in main, not taskRunner/
  agentManager/cliAgentManager/conversationStore singletons that are replaced on every activation.