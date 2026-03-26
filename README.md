# aIDE

A desktop IDE built for running multiple AI coding agents in parallel — one per project — while switching freely between them without losing context, browser sessions, or agent state.

## Getting Started

### Installation

aIDE requires macOS (Linux and Windows support coming later). To build from source:

```bash
# Clone the repository
git clone https://github.com/Cheezeiii365/aIDE.git
cd aIDE

# Install dependencies
pnpm install

# Run in development mode
pnpm dev
```

### Opening a Project

Open a folder to create a workspace. On first open, aIDE will:

1. Create a `.aide/` folder in your project root for settings
2. Detect your project type (Node.js, Python, Rust, Go, etc.) and set sensible defaults
3. Audit your `.gitignore` for common security patterns (missing `.env`, `*.pem`, etc.) and offer to fix them
4. Offer to generate a `tasks.json` from detected project files (`package.json` scripts, `Makefile` targets, etc.)

The `.aide/` folder splits into **shared** (committed to git) and **local** (git-ignored) config:

| Shared (`.aide/`) | Local (`.aide/local/`) |
|---|---|
| `settings.json` — editor preferences | `state.json` — layout, open tabs, scroll positions |
| `extensions.json` — recommended language packs | `terminals.json` — terminal session restore |
| `tasks.json` — project run/build/test commands | `workspace.json` — machine-local workspace metadata |

---

## Core Concepts

### Workspaces

Each workspace represents a single project with its own pane layout, open files, terminal sessions, and agent state. Workspaces appear as tabs in the **ribbon** at the top of the window.

- **Switch workspaces** with `Cmd+1` through `Cmd+9`, or `Cmd+Shift+[` / `Cmd+Shift+]` to cycle
- **Create a workspace** with the `+` button in the ribbon
- **Right-click** a workspace tab to rename, duplicate, close, or reveal in Finder
- **Drag tabs** to reorder

When you switch workspaces, aIDE saves and restores the full pane layout, open files, scroll positions, and terminal state.

### Panes

The main editing area uses a tiling pane system. Any pane can be an editor, terminal, browser, or preview.

- **Split panes** — `Cmd+\` (vertical) or `Cmd+Shift+\` (horizontal), or right-click a pane header
- **Drag tabs** between panes or to pane edges to create new splits
- Each pane supports **multiple tabs** — editors have file tabs, terminals have shell tabs

### Sidebar

A fixed sidebar on the left provides navigation:

| Icon | Panel | Description |
|---|---|---|
| Explorer | File tree + git worktree list | Browse and manage project files |
| Source Control | Staging, commit, git graph | Stage/unstage files, commit, view history |
| Testing | Test runner + debugger | Discover and run tests |

Toggle the sidebar with `Cmd+B`. Sidebar icons can be reordered, added, or removed in settings.

---

## Editor

aIDE uses CodeMirror 6 as its editor engine.

### Features

- **Syntax highlighting** for JavaScript, TypeScript, Python, Markdown, and more
- **Multi-cursor editing** — `Cmd+D` to select next occurrence, `Cmd+Click` to add cursors
- **Code folding** — collapse function bodies, classes, and blocks via gutter arrows
- **Indent guides** — vertical lines showing block structure
- **Bracket auto-close** — including JSX tags
- **Word wrap toggle**
- **Find/replace** — `Cmd+F` to find, `Cmd+H` to replace (supports regex)

### Language Server Support

Language intelligence (completions, diagnostics, hover, go-to-definition, rename) is provided by LSP servers. Language packs are installed individually — nothing ships by default.

| Language | Server | Install |
|---|---|---|
| Python | Pyright | `npm install pyright` |
| JavaScript/TypeScript | typescript-language-server | `npm install typescript-language-server typescript` |
| CSS/Tailwind | tailwindcss-language-server | `npm install @tailwindcss/language-server` |

Once installed, LSP servers start automatically when you open matching files. They suspend when you switch away from a workspace and resume when you return.

### Markdown Preview

Open any `.md` file and press `Cmd+Shift+V` to toggle a live preview pane alongside the editor. The preview updates as you type and uses theme-matched styling.

---

## Terminal

Terminals are powered by xterm.js with real PTY support — full compatibility with interactive programs like `vim`, `htop`, and Claude Code.

- Each terminal pane supports **multiple tabs** — run your shell, Claude Code, and a dev server all in one pane
- Terminals restore their working directory and state on workspace switch

---

## Browser Panes

aIDE embeds a real Chromium browser with persistent sessions. Log into Google, GitHub, or any service once and stay logged in across app restarts.

- **Shared auth session** — Google, GitHub, Microsoft logins persist across all workspaces
- **Per-workspace sessions** — dev server cookies and localhost state are isolated per workspace
- **Navigation bar** — back, forward, URL bar, and refresh
- **Fullscreen toggle** — expand a browser pane to fill the entire window and back

---

## Search

### Find in Files

`Cmd+Shift+F` opens project-wide search powered by ripgrep. Results are grouped by file with line previews. Click a result to jump to that line in the editor. Supports regex and glob filters. Respects `.gitignore` automatically.

### Quick Open

`Cmd+P` opens a fuzzy file finder to quickly open any file in your project.

### Command Palette

`Cmd+Shift+P` opens the command palette — search for and run any command, including tasks, settings, and editor actions.

### Symbol Search

`Cmd+T` searches for functions, classes, and types across your codebase via LSP.

---

## Tasks

The task system lets you define reusable shell commands in `.aide/tasks.json`. Tasks are committed to git so every collaborator gets the same dev/build/test commands.

### Defining Tasks

Create `.aide/tasks.json` in your project root (or let aIDE generate one from your `package.json`, `Makefile`, etc.):

```json
{
  "version": 1,
  "tasks": [
    {
      "id": "dev",
      "label": "Dev Server",
      "command": "pnpm dev",
      "group": "dev",
      "isBackground": true,
      "autoRestart": true
    },
    {
      "id": "build",
      "label": "Build",
      "command": "pnpm build",
      "group": "build",
      "keybinding": "Cmd+Shift+B"
    },
    {
      "id": "test",
      "label": "Run Tests",
      "command": "pnpm test",
      "group": "test"
    }
  ]
}
```

### Running Tasks

- **Command palette** — `Cmd+Shift+P`, type "task" to see all available tasks
- **Keyboard shortcuts** — `Cmd+Shift+B` for build, `Cmd+Shift+T` for test (configurable)
- **Re-run last task** — `Cmd+Shift+R`
- **Terminate a running task** — `Cmd+Shift+X`

### Task Options

| Option | Description |
|---|---|
| `command` | Shell command to run |
| `cwd` | Working directory (relative to project root) |
| `env` | Additional environment variables |
| `envFile` | Path to a `.env` file to load |
| `group` | Category: `build`, `test`, `dev`, `deploy`, `lint`, `clean`, `custom` |
| `keybinding` | Keyboard shortcut (e.g., `"Cmd+Shift+B"`) |
| `dependsOn` | Task IDs that must complete before this one starts |
| `isBackground` | Mark as long-running (dev servers, watchers) |
| `autoRestart` | Restart if the process exits unexpectedly |
| `promptBefore` | Show a confirmation dialog before running |
| `timeout` | Kill after N milliseconds |
| `problemMatcher` | Parse output for errors (see below) |

### Auto-Run Triggers

Tasks can run automatically on workspace events:

```json
{
  "id": "dev",
  "label": "Dev Server",
  "command": "pnpm dev",
  "isBackground": true,
  "runOn": { "event": "workspaceOpen" }
}
```

| Trigger | When it fires |
|---|---|
| `workspaceOpen` | Workspace is activated or app launches |
| `fileSave` | A matching file is saved (supports `filePattern` glob and `delay` debounce) |
| `preCommit` | Before a git commit from aIDE's git UI |

### Compound Tasks

Run multiple tasks together with a single command:

```json
{
  "compounds": [
    {
      "id": "fullstack",
      "label": "Full Stack Dev",
      "tasks": ["dev:frontend", "dev:backend"],
      "mode": "parallel"
    }
  ]
}
```

### Problem Matchers

Problem matchers parse task output and surface errors as editor diagnostics (underlines, gutter markers) — without needing LSP.

Built-in matchers: `"tsc"`, `"eslint-compact"`, `"python"`, `"gcc"`, `"go"`, `"pytest"`, `"generic"`.

```json
{
  "id": "tsc:watch",
  "label": "TypeScript Watch",
  "command": "pnpm tsc --watch --noEmit",
  "isBackground": true,
  "problemMatcher": "tsc"
}
```

### Built-in Variables

Use these in `command`, `args`, `cwd`, and `env` fields:

| Variable | Value |
|---|---|
| `${workspaceRoot}` | Absolute path to project root |
| `${file}` | Path of the active editor file |
| `${fileRelative}` | Relative path from workspace root |
| `${fileBasename}` | Filename only (e.g., `index.ts`) |
| `${selectedText}` | Currently selected text |
| `${branch}` | Current git branch |
| `${input:id}` | Prompted user input |
| `${env:NAME}` | System environment variable |

### User Inputs

Define reusable prompts that tasks can reference:

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
      "promptBefore": "Deploy to ${input:deployTarget}?"
    }
  ]
}
```

Input types: `text` (free-form), `pick` (dropdown), `confirm` (yes/no).

---

## Git Worktrees

aIDE has built-in support for git worktrees — work on multiple branches simultaneously without stashing.

- **Sidebar panel** lists all worktrees for the repository
- **Create/remove/switch** worktrees from the sidebar
- The **file tree re-roots** when you switch worktrees
- **Terminals** can switch their working directory to a different worktree via right-click
- Externally created worktrees are auto-detected

---

## AI Agent Integration

aIDE is designed around AI-assisted development. Run Claude Code (or other agents) in terminal panes, and aIDE will monitor their status.

### Agent Status

Each workspace tab in the ribbon shows a live status dot for its agent:

| Status | Indicator |
|---|---|
| Idle | Green dot |
| Working | Amber pulsing dot |
| Waiting for input | Blue dot |
| Error | Red dot |

This lets you monitor agent progress across all workspaces at a glance — see which agents are done, which need input, and which hit errors, without switching to each workspace.

---

## Theming

aIDE ships with two themes: **Atom One Dark** (default) and **Atom One Light**. Toggle between them with the theme button in the ribbon's global zone.

All colors use CSS custom properties, so custom themes can be added in future versions.

---

## Settings

Open settings with `Cmd+,`. Settings cascade in this order (highest priority first):

1. **Project settings** — `.aide/settings.json` (committed, shared with collaborators)
2. **User settings** — global app preferences
3. **Built-in defaults**

### Common Settings

| Setting | Default | Description |
|---|---|---|
| `tabSize` | `2` | Spaces per tab |
| `insertSpaces` | `true` | Use spaces instead of tabs |
| `wordWrap` | `off` | `off`, `on`, or `bounded` |
| `fontSize` | `13` | Editor font size in pixels |
| `formatOnSave` | `false` | Auto-format on save |
| `rulers` | `[]` | Vertical ruler positions (e.g., `[80, 120]`) |
| `filesExclude` | `{}` | Glob patterns to hide in the file tree |
| `searchExclude` | `{}` | Additional globs to skip in find-in-files |

Language-specific overrides are supported:

```json
{
  "tabSize": 2,
  "languageOverrides": {
    "[python]": { "tabSize": 4 },
    "[go]": { "tabSize": 4, "insertSpaces": false }
  }
}
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+1`–`Cmd+9` | Switch to workspace by position |
| `Cmd+Shift+[` / `]` | Cycle workspaces |
| `Cmd+P` | Quick open file |
| `Cmd+Shift+P` | Command palette |
| `Cmd+Shift+F` | Find in files |
| `Cmd+F` | Find in current file |
| `Cmd+H` | Find and replace in current file |
| `Cmd+T` | Symbol search (LSP) |
| `Cmd+\` | Split pane vertically |
| `Cmd+Shift+\` | Split pane horizontally |
| `Cmd+B` | Toggle sidebar |
| `Cmd+,` | Open settings |
| `Cmd+Shift+V` | Toggle markdown preview |
| `Cmd+D` | Select next occurrence |
| `Cmd+Shift+B` | Run build task |
| `Cmd+Shift+T` | Run test task |
| `Cmd+Shift+R` | Re-run last task |
| `Cmd+Shift+X` | Terminate running task |

---

## License

MIT
