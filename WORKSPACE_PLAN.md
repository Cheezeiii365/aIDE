# Workspace System — Development Plan

> **Created:** March 26, 2026
> **Status:** Planning
> **Depends on:** Command registry + ShortcutManager (2.6), partially on Find in Files (2.4)

---

## 1. Overview

The workspace system is the core multi-project infrastructure in aIDE. Each workspace represents a single project/codebase with its own pane layout, open files, terminal sessions, and (eventually) LSP servers, browser panes, and agent state.

This plan covers:
- The `.aide` per-project folder (git-committable project settings)
- Workspace initialization with security-first defaults
- Workspace CRUD and state persistence
- Workspace switching with full state save/restore
- Ribbon UI integration

---

## 2. The `.aide` Project Folder

### 2.1 Purpose

Like `.vscode` or `.cursor`, the `.aide` folder lives at the root of a project and stores project-level settings that are safe to commit. This means collaborators who also use aIDE get a shared configuration out of the box.

### 2.2 Folder Structure

```
project-root/
  .aide/
    settings.json        # Project-level editor/IDE preferences (committable)
    extensions.json      # Recommended language packs / plugins (committable)
    tasks.json           # Project-specific run/build/test tasks (committable)
    launch.json          # Debug configurations (committable, future)
    .gitignore           # Ignores local-only files within .aide/
    local/               # Machine-specific state (git-ignored via .aide/.gitignore)
      state.json         # Layout, open tabs, scroll positions, cursor — per-machine
      terminals.json     # Terminal session restore info (cwd, shell, env overrides)
      workspace.json     # Workspace metadata (id, ribbon position, icon, color)
```

### 2.3 What Gets Committed vs Ignored

**Committed (shared with collaborators):**
| File | Purpose |
|---|---|
| `settings.json` | Tab size, font size, word wrap, rulers, file associations, format-on-save |
| `extensions.json` | Recommended language packs (e.g., `"python"`, `"typescript"`) — prompts collaborators to install |
| `tasks.json` | Named shell commands: `"dev"` → `pnpm dev`, `"test"` → `pytest -x`, etc. Surfaced in command palette |

**Git-ignored (machine-local):**
| File | Purpose |
|---|---|
| `local/state.json` | Dockview layout JSON, open tab states (file path, cursor, scroll, folds, dirty flag) |
| `local/terminals.json` | Terminal restore: cwd, shell override, env vars, last command history pointer |
| `local/workspace.json` | Workspace UUID, ribbon order position, icon/color, `lastOpenedAt` timestamp |

### 2.4 `.aide/.gitignore`

Auto-generated on init:
```gitignore
# Machine-local state — not shared
local/
```

### 2.5 Settings Cascade

Settings resolve with this priority (highest wins):
1. `.aide/settings.json` (project-level, committed)
2. App-level settings in `electron-store` (user global preferences)
3. Built-in defaults

This matches the `.vscode` model: project settings override user settings override defaults.

### 2.6 `settings.json` Schema

```typescript
interface AideProjectSettings {
  // Editor
  tabSize?: number;                    // default: 2
  insertSpaces?: boolean;              // default: true
  wordWrap?: 'off' | 'on' | 'bounded';
  rulers?: number[];                   // e.g., [80, 120]
  fontSize?: number;
  fontFamily?: string;
  formatOnSave?: boolean;

  // File handling
  filesExclude?: Record<string, boolean>;  // glob patterns to hide in file tree
  searchExclude?: Record<string, boolean>; // additional globs to skip in find-in-files

  // Language-specific overrides
  languageOverrides?: Record<string, Partial<AideProjectSettings>>;
  // e.g., { "[python]": { tabSize: 4 } }
}
```

### 2.7 Task System (`.aide/tasks.json`)

The task system turns `.aide/tasks.json` into a project-level command runner — committed to git so every collaborator gets the same dev/build/test/deploy commands without reading a README.

#### 2.7.1 Core Schema

```typescript
interface AideTasksFile {
  version: 1;
  tasks: AideTask[];
  compounds?: CompoundTask[];          // Run multiple tasks together
  inputs?: TaskInput[];                // Prompted user inputs (reusable across tasks)
  defaults?: Partial<AideTaskDefaults>; // Shared defaults for all tasks in this file
}

interface AideTask {
  id: string;                          // Unique identifier, e.g., "dev", "test:unit"
  label: string;                       // Display name in command palette: "Task: <label>"
  command: string;                     // Shell command or template with ${input:name} placeholders
  args?: string[];                     // Arguments appended to command (avoids shell escaping issues)
  cwd?: string;                        // Relative to project root, default: "."
  env?: Record<string, string>;        // Additional env vars merged with shell environment
  envFile?: string;                    // Relative path to a .env file to load (e.g., ".env.dev")
  shell?: string;                      // Override shell (e.g., "/bin/zsh", "bash", "fish")
  group?: TaskGroup;
  keybinding?: string;                 // Optional shortcut, e.g., "Cmd+Shift+B"
  dependsOn?: string[];               // Task IDs that must complete (exit 0) before this one starts
  runOn?: TaskTrigger;                 // Auto-run triggers
  problemMatcher?: string | string[];  // Regex patterns to extract errors from output (see 2.7.6)
  isBackground?: boolean;             // Long-running process (dev server, watcher) — doesn't "complete"
  autoRestart?: boolean;              // Restart if process exits unexpectedly (for background tasks)
  presentation?: TaskPresentation;
  promptBefore?: string;              // Confirmation message before running (e.g., "Deploy to production?")
  timeout?: number;                   // Kill task after N milliseconds, 0 = no timeout
  os?: {                              // Platform-specific command overrides
    darwin?: Partial<AideTask>;
    linux?: Partial<AideTask>;
    win32?: Partial<AideTask>;
  };
}

type TaskGroup = 'build' | 'test' | 'dev' | 'deploy' | 'lint' | 'clean' | 'custom';

interface TaskTrigger {
  event: 'workspaceOpen' | 'fileSave' | 'preCommit';
  filePattern?: string;               // Glob — only trigger on matching files (for fileSave)
  delay?: number;                     // Debounce in ms (for fileSave, prevents rapid re-runs)
}

interface TaskPresentation {
  reveal?: 'always' | 'silent' | 'never';   // Whether to focus the terminal pane
  panel?: 'shared' | 'dedicated' | 'new';   // Terminal reuse strategy
  clear?: boolean;                           // Clear terminal before running (default: true for shared)
  showReuseMessage?: boolean;                // "Terminal will be reused..." banner (default: false)
  close?: boolean;                           // Auto-close terminal on success (default: false)
  echo?: boolean;                            // Print the command before running (default: true)
  group?: string;                            // Group name — tasks with same group share a split terminal
}

interface TaskDefaults {
  // Defaults applied to all tasks unless overridden
  shell?: string;
  env?: Record<string, string>;
  presentation?: Partial<TaskPresentation>;
}
```

#### 2.7.2 Compound Tasks

Run multiple tasks in parallel or sequence with a single command.

```typescript
interface CompoundTask {
  id: string;
  label: string;                       // e.g., "Full Stack Dev"
  tasks: string[];                     // Task IDs to run
  mode: 'parallel' | 'sequence';      // parallel: all at once, sequence: one after another
  keybinding?: string;
  presentation?: {
    reveal?: 'always' | 'silent';
    group?: string;                    // Split terminal group for parallel tasks
  };
}
```

**Example:** Start frontend and backend dev servers together:
```json
{
  "compounds": [
    {
      "id": "fullstack",
      "label": "Full Stack Dev",
      "tasks": ["dev:frontend", "dev:backend"],
      "mode": "parallel",
      "keybinding": "Cmd+Shift+D",
      "presentation": { "group": "dev-servers" }
    }
  ]
}
```
Both terminals appear as splits in the same pane, labeled "dev:frontend" and "dev:backend".

#### 2.7.3 User Inputs (Prompted Variables)

Tasks can reference `${input:name}` placeholders that prompt the user before execution.

```typescript
interface TaskInput {
  id: string;                          // Referenced as ${input:id} in task commands
  type: 'text' | 'pick' | 'confirm';
  description: string;                 // Prompt shown to user
  default?: string;                    // Pre-filled value for text, pre-selected for pick
  options?: string[];                  // For type: 'pick' — list of choices
}
```

**Example:** Deploy to a user-selected environment:
```json
{
  "inputs": [
    {
      "id": "deployTarget",
      "type": "pick",
      "description": "Deploy to which environment?",
      "options": ["staging", "production"],
      "default": "staging"
    }
  ],
  "tasks": [
    {
      "id": "deploy",
      "label": "Deploy",
      "command": "./scripts/deploy.sh ${input:deployTarget}",
      "promptBefore": "This will deploy to ${input:deployTarget}. Continue?",
      "group": "deploy"
    }
  ]
}
```

#### 2.7.4 Built-in Variables

Tasks can reference these variables in `command`, `args`, `cwd`, and `env` values:

| Variable | Resolves To |
|---|---|
| `${workspaceRoot}` | Absolute path to project root |
| `${workspaceName}` | Project folder name |
| `${file}` | Absolute path of the currently active editor file |
| `${fileRelative}` | Relative path of current file from workspace root |
| `${fileBasename}` | Filename without directory (e.g., `index.ts`) |
| `${fileExtname}` | File extension (e.g., `.ts`) |
| `${fileDirname}` | Directory of current file |
| `${selectedText}` | Currently selected text in the editor |
| `${lineNumber}` | Current cursor line number |
| `${branch}` | Current git branch name |
| `${input:id}` | Prompted user input (see 2.7.3) |
| `${env:NAME}` | System environment variable |
| `${datetime}` | ISO 8601 timestamp |

**Example:** Run the current test file:
```json
{
  "id": "test:current",
  "label": "Test Current File",
  "command": "pytest ${fileRelative} -v",
  "keybinding": "Cmd+Shift+T",
  "group": "test"
}
```

#### 2.7.5 Auto-Run Triggers

Tasks can be configured to run automatically on workspace events.

**`workspaceOpen`** — Run when the workspace is activated (switched to or app launches):
```json
{
  "id": "dev",
  "label": "Dev Server",
  "command": "pnpm dev",
  "isBackground": true,
  "autoRestart": true,
  "runOn": { "event": "workspaceOpen" },
  "presentation": { "reveal": "silent", "panel": "dedicated" }
}
```
The dev server starts silently in the background every time you switch to this workspace.

**`fileSave`** — Run when a matching file is saved:
```json
{
  "id": "lint:fix",
  "label": "Lint Fix on Save",
  "command": "eslint --fix ${file}",
  "runOn": {
    "event": "fileSave",
    "filePattern": "**/*.{ts,tsx,js,jsx}",
    "delay": 500
  },
  "presentation": { "reveal": "never" }
}
```

**`preCommit`** — Run before git commits initiated from aIDE's git UI (future):
```json
{
  "id": "typecheck",
  "label": "Type Check",
  "command": "pnpm tsc --noEmit",
  "runOn": { "event": "preCommit" },
  "group": "lint"
}
```

#### 2.7.6 Problem Matchers

Problem matchers parse task output to extract file, line, column, and message — surfacing errors as editor diagnostics (underlines, gutter markers) without needing LSP.

```typescript
interface ProblemMatcher {
  name: string;
  pattern: {
    regexp: string;           // Regex with capture groups
    file: number;             // Capture group index for file path
    line: number;             // Capture group index for line number
    column?: number;          // Capture group index for column
    severity?: number;        // Capture group index for error/warning/info
    message: number;          // Capture group index for the message text
  };
  filePrefix?: string;        // Prepended to captured file paths (e.g., "${workspaceRoot}/")
  severity?: 'error' | 'warning' | 'info';  // Default severity if not captured
  background?: {
    activeOnStart?: boolean;
    beginsPattern?: string;   // Regex — marks start of a new problem-emitting cycle
    endsPattern?: string;     // Regex — marks end (clears stale problems from previous cycle)
  };
}
```

**Built-in matchers** (referenced by name string):
| Name | Matches |
|---|---|
| `"tsc"` | TypeScript compiler output (`file(line,col): error TS...`) |
| `"eslint-compact"` | ESLint compact format |
| `"python"` | Python tracebacks (`File "path", line N`) |
| `"gcc"` | GCC/Clang format (`file:line:col: error:`) |
| `"go"` | Go compiler output |
| `"pytest"` | Pytest failure output |
| `"generic"` | Catch-all `file:line:col: message` pattern |

**Example:** TypeScript watch mode with background problem matcher:
```json
{
  "id": "tsc:watch",
  "label": "TypeScript Watch",
  "command": "pnpm tsc --watch --noEmit",
  "isBackground": true,
  "problemMatcher": "tsc",
  "presentation": { "reveal": "silent", "panel": "dedicated" }
}
```
Errors show up as red underlines in the editor in real-time, without LSP.

#### 2.7.7 Command Palette & Keyboard Integration

All tasks are surfaced through the command palette and can be bound to shortcuts:

- **`Cmd+Shift+P` → type "task"** — Shows all registered tasks with their group prefix (e.g., "Task: Dev Server", "Task: Test Current File")
- **`Cmd+Shift+B`** — Default keybinding for the `build` group. If multiple build tasks exist, shows a picker
- **Group shortcuts** — Each group can have a default keybinding:
  - `build` → `Cmd+Shift+B`
  - `test` → `Cmd+Shift+T` (when not conflicting with "new terminal")
  - `dev` → unbound by default
  - `deploy` → unbound by default (dangerous — intentionally requires manual invocation or explicit binding)
- **"Run Last Task"** — `Cmd+Shift+R` re-runs the most recently executed task
- **"Terminate Task"** — `Cmd+Shift+X` shows a picker of running tasks to kill

#### 2.7.8 Task Status & UI

Running tasks surface status in multiple places:

- **Status bar:** Shows running task count + spinner. Click to see task list
- **Terminal tab:** Each task terminal shows the task label as tab title + status icon (spinner while running, checkmark on success, X on failure)
- **Notification toast:** On task completion — success (green) or failure (red, with "Show Output" action)
- **[Future] Ribbon badge:** Task failures in background workspaces surface as a badge on the workspace tab

#### 2.7.9 Auto-Detection & Scaffolding

On workspace init (Section 3), aIDE scans for known project files and offers to generate a starter `tasks.json`:

| Detected File | Generated Tasks |
|---|---|
| `package.json` with `scripts` | One task per npm script (dev, build, test, lint, start, etc.) |
| `Makefile` | One task per make target |
| `pyproject.toml` (Poetry) | `poetry install`, `poetry run pytest`, `poetry run python ${file}` |
| `Cargo.toml` | `cargo build`, `cargo test`, `cargo run`, `cargo clippy` |
| `go.mod` | `go build ./...`, `go test ./...`, `go run ${file}` |
| `docker-compose.yml` | `docker-compose up`, `docker-compose down`, `docker-compose build` |
| `Gemfile` | `bundle install`, `bundle exec rake`, `bundle exec rspec` |
| `justfile` | One task per just recipe |

**Behavior:**
- On first init, show toast: "Detected package.json scripts. [Generate tasks.json]"
- Clicking generates the file and opens it in the editor for review
- Never overwrites an existing `tasks.json`
- Tasks are generated with sensible defaults (dev servers get `isBackground: true`, test commands get `group: "test"`, etc.)

#### 2.7.10 Example: Full `tasks.json` for a Next.js + Python Backend Project

```json
{
  "version": 1,
  "defaults": {
    "presentation": { "echo": true, "clear": true }
  },
  "inputs": [
    {
      "id": "testPath",
      "type": "text",
      "description": "Test file or directory to run",
      "default": "."
    },
    {
      "id": "deployEnv",
      "type": "pick",
      "description": "Deploy environment",
      "options": ["staging", "production"],
      "default": "staging"
    }
  ],
  "tasks": [
    {
      "id": "dev:frontend",
      "label": "Frontend Dev Server",
      "command": "pnpm dev",
      "cwd": "frontend",
      "group": "dev",
      "isBackground": true,
      "autoRestart": true,
      "problemMatcher": "tsc",
      "runOn": { "event": "workspaceOpen" },
      "presentation": { "reveal": "silent", "panel": "dedicated" }
    },
    {
      "id": "dev:backend",
      "label": "Backend Dev Server",
      "command": "uvicorn main:app --reload --port 8000",
      "cwd": "backend",
      "env": { "PYTHONPATH": "${workspaceRoot}/backend" },
      "envFile": ".env.dev",
      "group": "dev",
      "isBackground": true,
      "autoRestart": true,
      "problemMatcher": "python",
      "runOn": { "event": "workspaceOpen" },
      "presentation": { "reveal": "silent", "panel": "dedicated" }
    },
    {
      "id": "build",
      "label": "Build Frontend",
      "command": "pnpm build",
      "cwd": "frontend",
      "group": "build",
      "keybinding": "Cmd+Shift+B",
      "dependsOn": ["typecheck"],
      "problemMatcher": "tsc"
    },
    {
      "id": "typecheck",
      "label": "Type Check",
      "command": "pnpm tsc --noEmit",
      "cwd": "frontend",
      "group": "lint",
      "problemMatcher": "tsc"
    },
    {
      "id": "test:frontend",
      "label": "Test Frontend",
      "command": "pnpm vitest run ${input:testPath}",
      "cwd": "frontend",
      "group": "test"
    },
    {
      "id": "test:backend",
      "label": "Test Backend",
      "command": "pytest ${input:testPath} -v",
      "cwd": "backend",
      "group": "test",
      "problemMatcher": "pytest"
    },
    {
      "id": "test:current",
      "label": "Test Current File",
      "command": "pytest ${fileRelative} -v",
      "group": "test",
      "keybinding": "Cmd+Shift+T",
      "presentation": { "reveal": "always", "panel": "dedicated" }
    },
    {
      "id": "lint:fix",
      "label": "Lint Fix on Save",
      "command": "eslint --fix ${file}",
      "cwd": "frontend",
      "runOn": {
        "event": "fileSave",
        "filePattern": "frontend/**/*.{ts,tsx}",
        "delay": 500
      },
      "presentation": { "reveal": "never" }
    },
    {
      "id": "deploy",
      "label": "Deploy",
      "command": "./scripts/deploy.sh ${input:deployEnv}",
      "group": "deploy",
      "promptBefore": "Deploy to ${input:deployEnv}? This will affect live users.",
      "dependsOn": ["build", "test:frontend", "test:backend"]
    }
  ],
  "compounds": [
    {
      "id": "dev",
      "label": "Full Stack Dev",
      "tasks": ["dev:frontend", "dev:backend"],
      "mode": "parallel",
      "presentation": { "group": "dev-servers" }
    },
    {
      "id": "test:all",
      "label": "Run All Tests",
      "tasks": ["test:frontend", "test:backend"],
      "mode": "parallel"
    }
  ]
}
```

---

## 3. Workspace Initialization

When aIDE opens a folder that has no `.aide` directory, it runs the initialization flow.

### 3.1 Init Steps

```
1. Create `.aide/` directory
2. Create `.aide/.gitignore` (ignores `local/`)
3. Create `.aide/local/` directory
4. Generate workspace UUID → write to `.aide/local/workspace.json`
5. Auto-detect project type (see 3.2)
6. Run security audit on project .gitignore (see 3.3)
7. Write default `settings.json` based on detected project type
8. Register workspace in app-level electron-store
```

### 3.2 Project Type Detection

Scan the workspace root for signals:

| Signal | Detected Type | Default Settings |
|---|---|---|
| `package.json` | Node.js / JavaScript | `tabSize: 2`, recommend `typescript` language pack |
| `tsconfig.json` | TypeScript | `tabSize: 2`, recommend `typescript` language pack |
| `requirements.txt` / `pyproject.toml` / `setup.py` | Python | `tabSize: 4`, recommend `python` language pack |
| `Cargo.toml` | Rust | `tabSize: 4` |
| `go.mod` | Go | `tabSize: 4`, `insertSpaces: false` |
| `.claude/` / `CLAUDE.md` | Claude Code project | Note in workspace metadata |
| `Gemfile` | Ruby | `tabSize: 2` |

Multiple signals can fire (e.g., `package.json` + `tsconfig.json`). Most specific wins for defaults.

### 3.3 Security-First `.gitignore` Audit

On workspace init (and optionally on-demand via command palette), aIDE checks the project's root `.gitignore` for common security patterns. If critical patterns are missing, it surfaces a notification with a one-click fix.

**Required patterns checked:**

```
# Environment & secrets
.env
.env.*
.env.local
.env.*.local

# Private keys & certificates
*.pem
*.key
*.p12
*.keystore
*.pfx

# Credentials files
credentials.json
secrets.json
serviceAccountKey.json
**/service-account*.json

# Cloud provider
.aws/
.gcp/
terraform.tfstate
terraform.tfstate.backup
*.tfvars

# IDE local state (optional but recommended)
.aide/local/

# OS artifacts
.DS_Store
Thumbs.db
```

**Behavior:**
- **Non-intrusive:** Shows a toast notification: "Found 3 missing .gitignore patterns for sensitive files. [Review & Add]"
- **Review modal:** Lists each missing pattern with a checkbox (all checked by default). User can uncheck patterns they don't want. "Add Selected" appends to `.gitignore`.
- **Never auto-modifies `.gitignore`** without user confirmation
- **Tracks dismissal:** If user dismisses, don't nag again for this project (store in `.aide/local/workspace.json`)
- **Re-audit command:** "aIDE: Audit .gitignore Security" in command palette for manual re-check

### 3.4 First-Open UX Flow

```
User opens folder without .aide/
  → aIDE creates .aide/ structure silently
  → Toast: "Initialized aIDE workspace for <project-name>"
  → If .gitignore audit finds issues:
      → Second toast: "Missing .gitignore patterns for sensitive files. [Review]"
  → Workspace appears in ribbon
  → Default layout loads (editor + terminal)
```

---

## 4. Workspace Data Model

### 4.1 App-Level State (electron-store)

The app-level store tracks which workspaces exist and their ordering. It does NOT store layout or editor state — that lives in `.aide/local/`.

```typescript
interface AppWorkspaceRegistry {
  workspaces: Record<string, WorkspaceEntry>;  // id → entry
  workspaceOrder: string[];                     // ribbon ordering
  activeWorkspaceId: string | null;
  lastSessionWorkspaces: string[];              // re-open on app launch
}

interface WorkspaceEntry {
  id: string;              // uuid v4
  name: string;            // display name (default: folder name)
  rootPath: string;        // absolute path to project root
  icon?: string;           // emoji
  color?: string;          // hex color for ribbon accent
  createdAt: number;       // unix ms
  lastOpenedAt: number;    // unix ms
}
```

### 4.2 Per-Project State (`.aide/local/state.json`)

```typescript
interface AideLocalState {
  layout: SerializedDockviewLayout | null;  // from dockviewApi.toJSON()
  openTabs: TabState[];
  activeTabPath: string | null;             // last focused file
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  sidebarSections: Record<string, boolean>; // section id → collapsed state
}

interface TabState {
  filePath: string;         // relative to project root for portability
  scrollTop: number;
  cursorLine: number;
  cursorColumn: number;
  foldedRanges: [number, number][];
  isDirty: boolean;
  dirtyContent?: string;    // unsaved buffer content if dirty
}
```

### 4.3 Per-Project Terminal State (`.aide/local/terminals.json`)

```typescript
interface AideLocalTerminals {
  terminals: TerminalState[];
  activeTerminalId: string | null;
}

interface TerminalState {
  id: string;
  cwd: string;               // relative to project root
  shell?: string;             // override, otherwise use system default
  env?: Record<string, string>;
  title?: string;             // user-set tab title
}
```

---

## 5. Workspace Switching

### 5.1 `switchTo(targetId)` Flow

```
1. SAVE current workspace
   a. Serialize Dockview layout → .aide/local/state.json
   b. Serialize editor tab states (cursor, scroll, folds, dirty buffers)
   c. Record active terminal cwd(s) → .aide/local/terminals.json
   d. Update lastOpenedAt in app-level store
   e. [Future] SIGSTOP LSP servers
   f. [Future] Hide WebContentsView browser overlays

2. CLEAR current UI
   a. Close all Dockview panels (but don't dispose — just clear the layout)
   b. Detach file tree watcher
   c. Clear editor state cache

3. LOAD target workspace
   a. Read .aide/local/state.json from target project root
   b. Start file tree watcher on target rootPath
   c. Restore Dockview layout via fromJSON() (fallback: default layout)
   d. Restore editor tab states (reopen files, restore cursors/scroll)
   e. Restore terminal sessions (spawn new PTYs at saved cwds)
   f. Update ribbon active indicator
   g. Update status bar (branch, language, etc.)
   h. [Future] SIGCONT LSP servers
   i. [Future] Reposition + show WebContentsView browser overlays

4. FOCUS
   a. Focus the previously-active pane in target workspace
   b. Update activeWorkspaceId in app-level store
```

### 5.2 Switch Performance Target

Workspace switch should feel instant (<200ms perceived). Strategy:
- Save is fire-and-forget (write to disk async, don't block UI)
- Layout restore is the critical path — `fromJSON()` is synchronous
- File contents are lazy-loaded (only read from disk when tab becomes active)
- Terminal spawn is async (show shell prompt placeholder, PTY connects in background)

### 5.3 Edge Cases

| Scenario | Behavior |
|---|---|
| Unsaved files in current workspace | Save dirty buffer content to `TabState.dirtyContent`, restore on switch back. Do NOT prompt — switching is non-destructive |
| Target `.aide/local/state.json` missing | First open of this workspace on this machine — use default layout |
| Target rootPath no longer exists | Show error toast, offer to remove from ribbon or re-link to new path |
| Same folder opened as two workspaces | Allowed but discouraged. File watchers deduplicate. State files are per-machine anyway |
| Rapid switching (Cmd+1, Cmd+2, Cmd+3 fast) | Debounce: cancel in-flight save/load if a new switch arrives within 100ms |

### 5.4 File Watcher Scoping (Implemented)

The file watcher system is already built with workspace-scoped multi-root support. Key design:

- **Scoped watcher map:** `activeScopes: Map<scopeId, { roots: string[]; watchers: FSWatcher[] }>` — each scope can watch multiple roots independently.
- **`scopeId` on events:** Every `FsWatchEvent` includes a `scopeId` field, so the renderer can filter events by active workspace.
- **Current state:** All watchers use `'default'` as the sole scope ID. Worktree switching watches both repo root and active worktree simultaneously.
- **Editor integration:** `EditorPane` subscribes to `onFsWatchEvent` and auto-reloads clean files, prompts for dirty files, and detects external deletions.

**When workspaces land (Phase C/D):**
- Each workspace gets its own scope (e.g., `workspace-{uuid}`).
- `WorkspaceManager.switchTo()` calls `startWatchers(workspaceId, roots)` instead of tearing down and rebuilding.
- Inactive workspace watchers can be paused (analogous to `SIGSTOP` for LSP servers) or kept alive for workspaces with active background agents/tasks.
- The renderer filters events by `scopeId` matching the active workspace — no wasted processing of events from inactive workspaces.
- The `startWatchers` diff algorithm (close removed roots, start new, leave existing) means workspace switching only touches changed roots, not the full set.

**Cross-workspace agent scenario:** When agents run in background workspaces (each with their own worktrees), those workspaces keep their watcher scopes alive. The agent's file mutations are detected and queued. When the user switches back, the editor reloads from disk using the already-delivered events.

---

## 6. Ribbon UI

### 6.1 Workspace Tabs

The ribbon already exists from Phase 1. Updates needed:

- Each workspace gets a tab showing: icon/color dot + name (truncated) + status indicator
- Active workspace tab gets accent highlight
- `Cmd+1–9` switches to workspace by ribbon position
- `Cmd+Shift+[` / `Cmd+Shift+]` cycles through workspaces
- Click tab to switch
- Drag tabs to reorder (updates `workspaceOrder`)
- Right-click context menu: Rename, Change Icon/Color, Reveal in Finder, Close Workspace, Remove Workspace

### 6.2 "New Workspace" Flow

- `+` button at end of workspace tabs (or command palette: "aIDE: New Workspace")
- Opens folder picker dialog
- If folder has `.aide/local/workspace.json`, reattach existing workspace
- If folder has no `.aide/`, run full init (Section 3)
- If folder has `.aide/` but no `local/workspace.json`, create local state only (collaborator first-open)
- New workspace appears in ribbon, auto-switches to it

### 6.3 "Close Workspace" vs "Remove Workspace"

- **Close:** Removes from ribbon for this session. Workspace data preserved in `.aide/`. Can re-open via "Open Folder."
- **Remove:** Closes AND deletes the entry from app-level `electron-store`. Does NOT delete `.aide/` from disk — that belongs to the project.

---

## 7. App Lifecycle

### 7.1 App Launch

```
1. Read app-level store → get lastSessionWorkspaces[]
2. For each workspace in lastSessionWorkspaces:
   a. Verify rootPath still exists
   b. Add to ribbon in saved order
3. Switch to activeWorkspaceId (or first in list)
4. If no workspaces exist, show welcome screen with "Open Folder" button
```

### 7.2 App Quit

```
1. Save current workspace state (same as step 1 of switchTo)
2. Record current workspace list → lastSessionWorkspaces
3. Record activeWorkspaceId
4. Write app-level store
5. Kill all PTY processes
6. [Future] Kill all LSP servers
```

### 7.3 Crash Recovery

If the app crashes or is force-quit, the last persisted state may be stale. On next launch:
- Detect dirty shutdown (set a `cleanShutdown: false` flag on launch, set `true` on quit)
- If dirty, show toast: "aIDE recovered from an unexpected shutdown. Some recent changes may not have been saved."
- Restore from last persisted state (best effort)

---

## 8. Implementation Order

This workspace system is built incrementally, interleaved with the command system work:

### Phase A: `.aide` Folder Infrastructure
1. `.aide` directory creation utilities (`aideInit.ts` in main process)
2. `.aide/.gitignore` auto-generation
3. `.aide/local/` directory + `workspace.json` creation
4. Project type detection (scan for `package.json`, `pyproject.toml`, etc.)
5. Default `settings.json` generation based on project type
6. Settings cascade resolver (project → user → defaults)

### Phase B: Gitignore Security Audit
1. Gitignore parser — read and parse existing `.gitignore` patterns
2. Security pattern checklist (the required patterns list)
3. Diff missing patterns
4. Toast notification + review modal UI
5. Append-to-gitignore IPC handler
6. Dismissal tracking in `workspace.json`
7. Command palette command: "aIDE: Audit .gitignore Security"

### Phase B.5: Task System
1. `tasks.json` file reader + schema validator in main process
2. Task runner engine: spawn shell process, manage lifecycle (start, kill, restart)
3. Built-in variable resolver (`${workspaceRoot}`, `${file}`, `${branch}`, etc.)
4. User input prompts (text, pick, confirm) — reuse command palette overlay
5. `dependsOn` graph resolution + sequential/parallel execution
6. Compound task runner (parallel splits, sequential chains)
7. Task terminal integration — dedicated/shared/new panel strategies
8. Problem matcher engine — parse output, extract diagnostics, surface in editor
9. Built-in problem matchers (tsc, eslint, python, gcc, go, pytest, generic)
10. Auto-run triggers (`workspaceOpen`, `fileSave`, `preCommit`)
11. Auto-detection scaffolding (scan `package.json` scripts, `Makefile`, `Cargo.toml`, etc.)
12. Command palette integration ("Task: ...", "Run Last Task", "Terminate Task")
13. Status bar task indicator (running count + spinner, click for task list)
14. Platform-specific `os` overrides

### Phase C: Workspace CRUD + Ribbon
1. `WorkspaceManager` class in main process (create, open, close, remove)
2. App-level `electron-store` schema for workspace registry
3. Ribbon workspace tabs (click to switch, drag to reorder)
4. "New Workspace" flow (folder picker → init → add to ribbon)
5. Right-click context menu (rename, icon/color, close, remove, reveal in Finder)
6. `Cmd+1–9` workspace switching via command registry

### Phase D: State Persistence + Switching
1. State serializer: Dockview layout + editor tabs → `.aide/local/state.json`
2. State deserializer: `.aide/local/state.json` → restore layout + tabs
3. Terminal state save/restore (cwd, not full scrollback)
4. `WorkspaceSwitcher.switchTo(id)` — full save/clear/load/focus cycle (file watcher scoping infrastructure already exists — call `startWatchers(workspaceId, roots)` per Section 5.4)
5. Debounced rapid-switch handling
6. Auto-save on interval (every 30s write state to disk as crash safety net)

### Phase E: App Lifecycle
1. App launch: read last session, restore workspace list, switch to active
2. App quit: save all state, clean shutdown flag
3. Crash recovery detection + toast
4. Welcome screen (no workspaces state)

---

## 9. Open Questions

| # | Question | Notes |
|---|---|---|
| W1 | **Should `.aide/settings.json` be created on init or only when user changes a setting?** | Leaning toward on-init with detected defaults — makes the file discoverable and editable immediately |
| W2 | **Terminal scrollback persistence?** | Saving full scrollback is expensive and potentially sensitive. Current plan: save only cwd and re-spawn fresh shell on restore. Revisit if users want history |
| W3 | **Workspace templates?** | e.g., "Python Data Science" workspace with specific layout (editor + terminal + notebook pane). Interesting but v2+ |
| W4 | **Max workspaces?** | No hard limit, but ribbon gets crowded past ~10. Consider overflow menu or scrollable ribbon at that point |
| W5 | **Should gitignore audit run on every open or only on first init?** | First init + on-demand via command palette. Re-auditing every open is annoying |
| W6 | **Task output persistence across sessions?** | Currently tasks re-run from scratch on workspace open. Saving output logs (`.aide/local/task-logs/`) could help debug issues that happened overnight, but adds disk usage |
| W7 | **Task system API for plugins?** | When the plugin system lands (Phase 6), plugins should be able to register custom task types, problem matchers, and auto-detection rules. Design the task runner with this extension point in mind |
| W8 | **Agent-initiated tasks?** | Should AI agents be able to trigger tasks from `tasks.json`? e.g., agent runs "build" to verify its changes compile. Powerful but needs guardrails — ties into the agent permission system (v2 `.agentconfig`) |
| W9 | **`tasks.json` live reload?** | If the user edits `tasks.json` while the IDE is open, should changes take effect immediately? Leaning yes — watch the file and re-parse on change, same as `settings.json` |

---

*This document is a living reference. Update as implementation progresses.*
