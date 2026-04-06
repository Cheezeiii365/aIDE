# Workspace Resource Telemetry Plan

## Motivation

aIDE's workspace lifecycle has solid state management and cleanup-on-dispose, but no **proactive visibility** into resource consumption. Before building lifecycle optimizations (SIGSTOP/SIGCONT on LSP, workspace hibernation, background eviction), we need real usage data to know where the pain points are and what thresholds make sense.

## Goals

1. Give the user (and ourselves) real-time visibility into per-workspace resource usage
2. Establish baselines for memory/CPU under normal usage patterns
3. Inform future lifecycle management policies (hibernation thresholds, eviction triggers)
4. Surface resource data in the UI for debugging and awareness

## Current State

### What exists

- **Workspace state machine**: `foreground` / `backgrounded` / `blocked` / `asleep` — already distinguishes active vs inactive workspaces
- **Lifecycle cleanup**: All services (PTYs, agents, watchers, pollers) are disposed on workspace close and app exit
- **Scoped resource limits**: Terminal scrollback capped at 200K chars, editor state LRU capped at 64 entries
- **Subscription hygiene**: All listeners return unsubscribe functions; all timers explicitly cleared

### What's missing

- No per-workspace memory tracking
- No CPU usage monitoring
- No process-level resource attribution (which PTY/agent is expensive?)
- No UI surface for resource data
- No SIGSTOP/SIGCONT for LSP (LSP not yet implemented — see `LSPPLAN.md`)
- No automatic background workspace eviction under memory pressure
- No heap size or GC pressure monitoring

## Architecture

### Phase 1: Main Process Monitor

A lightweight polling service in the main process that collects per-workspace resource snapshots.

#### Data Model

```typescript
interface WorkspaceResourceSnapshot {
  workspaceId: string;
  timestamp: number;

  // Main process memory (from process.memoryUsage())
  mainProcess: {
    heapUsed: number;    // bytes
    heapTotal: number;   // bytes
    rss: number;         // bytes
    external: number;    // bytes
  };

  // Renderer process memory (from webContents.getProcessMemoryInfo())
  renderer: {
    private: number;     // KB — memory not shared with other processes
    shared: number;      // KB
  };

  // Per-workspace resource counts
  resources: {
    ptyCount: number;
    agentProcessCount: number;
    cliAgentProcessCount: number;
    fileWatcherCount: number;
    activePollers: number;          // git + worktree polling intervals
    documentSessionCount: number;
    cachedEditorStates: number;
  };

  // Per-process detail (optional, for drill-down)
  processes: ProcessSnapshot[];
}

interface ProcessSnapshot {
  type: 'pty' | 'agent' | 'cli-agent' | 'utility';
  id: string;
  pid?: number;
  memoryKB?: number;   // from process.getProcessMemoryInfo() where available
}
```

#### Collection Strategy

- **Poll interval**: 5 seconds (configurable)
- **Retention**: Keep last 60 snapshots in-memory (5 minutes of history) per workspace
- **Collection source**: Each `WorkspaceRuntime` exposes a `getResourceSnapshot()` method that aggregates counts from its services
- **Main process memory**: `process.memoryUsage()` — cheap, no IPC needed
- **Renderer memory**: `webContents.getProcessMemoryInfo()` — async, returns Promise
- **Child process memory**: `process.getProcessMemoryInfo()` where available on UtilityProcess; for PTYs, use `pidusage` or `/proc/{pid}/status` parsing

#### Implementation Location

```
packages/main/src/telemetry/
  resourceMonitor.ts    — polling loop, snapshot collection, history ring buffer
  types.ts              — shared type definitions (also in packages/shared/)
```

### Phase 2: IPC Channel & Renderer Access

Expose resource data to the renderer for UI consumption.

#### IPC Channels

```typescript
// Main → Renderer (push on each poll)
RESOURCE_SNAPSHOT_CHANGED: (snapshots: Map<workspaceId, WorkspaceResourceSnapshot>) => void

// Renderer → Main (pull on demand)
GET_RESOURCE_SNAPSHOTS: () => Map<workspaceId, WorkspaceResourceSnapshot>
GET_RESOURCE_HISTORY: (workspaceId: string) => WorkspaceResourceSnapshot[]
```

#### Renderer Hook

```typescript
// packages/renderer/src/hooks/useResourceMonitor.ts
function useResourceMonitor(workspaceId?: string): {
  current: WorkspaceResourceSnapshot | null;
  history: WorkspaceResourceSnapshot[];
  totals: { totalRss: number; totalPtyCount: number; /* ... */ };
}
```

### Phase 3: UI Surface

#### Status Bar Widget

Minimal always-visible indicator in the bottom status bar:
- Memory usage for active workspace (e.g., "148 MB")
- Warning color when above threshold (e.g., > 500 MB)
- Click to expand detail panel

#### Resource Panel (Debug/Dev)

A dockview panel (or modal) showing:
- Per-workspace resource table (memory, PTY count, agent count, watcher count)
- Sparkline or mini chart of memory over last 5 minutes
- Process list with individual memory attribution
- Workspace state indicator (foreground/backgrounded/blocked/asleep)

This panel is primarily a development tool — can be gated behind a dev mode flag initially.

## Future: Lifecycle Policies (Post-Telemetry)

Once we have baseline data, build these policies:

| Policy | Trigger | Action |
|--------|---------|--------|
| **LSP suspend** | Workspace backgrounded for > 30s | SIGSTOP LSP processes |
| **LSP resume** | Workspace enters foreground | SIGCONT LSP processes |
| **Workspace hibernate** | Backgrounded + no workload for > 5min | Dispose non-essential services, keep state on disk |
| **Memory pressure eviction** | Total app RSS > threshold | Hibernate least-recently-used backgrounded workspace |
| **Agent timeout** | Agent idle (no messages) for > 10min | Warn user, optionally terminate |

These thresholds should be informed by real telemetry data, not guessed upfront.

## Implementation Order

1. `resourceMonitor.ts` — polling loop with `WorkspaceRuntime.getResourceSnapshot()`
2. `getResourceSnapshot()` method on `WorkspaceRuntime` (aggregates from services)
3. IPC channel + `useResourceMonitor` hook
4. Status bar memory indicator
5. Resource debug panel (dev mode)
6. Collect data for 1-2 weeks, then design lifecycle policies

## Dependencies

- `WorkspaceRuntime` — needs `getResourceSnapshot()` method
- `ptyManager` — needs count/list by workspace
- `AgentManager` / `CliAgentManager` — needs active session count
- `fileWatcher` — needs watcher count per scope
- `documentStore` — needs session count per workspace (renderer-side, may need IPC)

## Open Questions

- Should we use `pidusage` (npm package) for cross-platform CPU% per child process, or keep it simple with memory-only initially?
- Should snapshots be persisted to disk for longer-term analysis, or is 5 minutes of in-memory history enough for now?
- Should the status bar widget be always visible or only when a threshold is exceeded?
