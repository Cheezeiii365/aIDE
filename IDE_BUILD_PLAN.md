# Custom AI-Integrated IDE — Build Plan
> **Project codename:** *aIDE*
> **Last updated:** March 24, 2026
> **Status:** Pre-development / Planning (pressure-tested)

---

## Table of Contents

1. [Project Vision](#1-project-vision)
2. [Core Requirements](#2-core-requirements)
3. [Architecture Decision](#3-architecture-decision)
4. [Technology Stack](#4-technology-stack)
5. [Design System](#5-design-system)
6. [Feature Specifications](#6-feature-specifications)
7. [Phase-by-Phase Build Plan](#7-phase-by-phase-build-plan)
8. [Data Models](#8-data-models)
9. [Known Hard Problems](#9-known-hard-problems)
10. [Design Decisions (Resolved)](#10-design-decisions-resolved)
11. [Open Questions](#11-open-questions)
12. [Progress Tracker](#12-progress-tracker)
13. [Reference Links](#13-reference-links)

---

## 1. Project Vision

A desktop IDE built specifically for the workflow of running multiple AI coding agents in parallel — one per project/codebase — while switching freely between them without losing context, browser sessions, or agent state.

**The gap this fills:** Existing tools (CMUX, Cursor, Windsurf) each solve part of the problem. CMUX has great multi-agent terminal management but no editor or real browser. Cursor/Windsurf have great editors but no multi-workspace agent isolation and no persistent browser with real account sessions.

**Primary user:** Solo developer or small team running several AI-assisted projects simultaneously — agent working on one codebase while human works in another.

**Open source strategy:** Personal-use primary, community contributions welcome. MIT license. npm-based plugin system so contributors can extend without forking.

---

## 2. Core Requirements

### Must-have at launch (MVP)
- [ ] Infinitely nestable/resizable tiling panes — any pane can be an editor, terminal, browser, file tree, or agent panel
- [ ] Workspace switcher ribbon with per-workspace agent status indicators + global zone (settings, notifications, cost dashboard)
- [ ] Keyboard shortcut workspace switching (`Cmd+1/2/3...`)
- [ ] Layout persistence — each workspace restores its exact pane arrangement on switch
- [ ] Persistent browser panes with real Google, GitHub, and Microsoft account sessions that survive workspace switches and app restarts
- [ ] Claude Code running in terminal panes, with agent status surfaced to the workspace tab
- [ ] CodeMirror 6 editor with syntax highlighting for Python, JavaScript/TypeScript, and Markdown
- [ ] Editor table-stakes: multi-cursor (`Cmd+D`, `Cmd+Click`), code folding, indent guides, word wrap toggle, bracket auto-close (including JSX)
- [ ] Find in files (`Cmd+Shift+F`) via bundled ripgrep, find/replace in current file (`@codemirror/search`), LSP symbol search (`workspace/symbol`)
- [ ] Markdown preview pane (side-by-side: editor left, rendered HTML right via `marked`/`remark`)
- [ ] LSP integration: Pyright (Python) and typescript-language-server (JS/TS) as the first two language packs — installed individually, not bundled by default
- [ ] Fixed left sidebar for file tree with dirty file indicators and git branch display (outside Dockview — always present)
- [ ] Theming system designed for dark + light mode from day one — Atom One Dark as default, light mode as alternative, CSS variable token system supports custom themes in future
- [ ] Global command palette (`Cmd+Shift+P`) — cross-workspace search and global commands

### Nice-to-have (v2+)
- [ ] Cursor-style agent panel UI (structured diffs, progress, pause/resume)
- [ ] Claude Agent SDK integration (replacing raw Claude Code CLI)
- [ ] Tailwind CSS IntelliSense (via tailwindcss-language-server)
- [ ] Git integration UI (diff viewer, stage/unstage, commit)
- [ ] Multi-root workspace support (monorepos with separate backend/frontend LSP roots)
- [ ] Plugin system with npm-based distribution
- [ ] Broad language support — the goal is to support all languages via individually installable language packs. Use off-the-shelf LSP servers and linters where available; only build custom integrations when necessary. No language tooling installed by default — user installs what they need
- [ ] Chrome extension support (limited — see Known Hard Problems)
- [ ] AI-powered inline diff review in editor
- [ ] Agent permission system — configurable guardrails per workspace via `.agentconfig` (file access scope, shell command scope, network scope, package installation). Default: "ask before running destructive commands." Requires approval UI in agent panel that surfaces to workspace tab even when in another workspace
- [ ] Workspace onboarding wizard — auto-detect project type, Python interpreter, `package.json` scripts, `CLAUDE.md`/`.agentconfig`, git remote, dev server command/port. Surface as a checklist of suggestions on first open
- [ ] Agent project memory — track which files agent has seen, maintain auto-generated `project-summary.md`, surface "unseen files" in agent panel for context priming
- [ ] Linked workspace groups — related workspaces (e.g. frontend + backend), cross-workspace terminal, shared env references
- [ ] Custom user themes beyond light/dark defaults
- [ ] Editor minimap (community CodeMirror extension or custom build)
- [ ] Auto-update via `electron-updater` — notify + prompt (never silent restart). Compile-from-source only for MVP
- [ ] React `ErrorBoundary` per pane (crash in one pane doesn't kill others), graceful error state UI, opt-in crash telemetry via `electron.crashReporter` or Sentry
- [ ] Notifications center — aggregated view of all agent activity across all workspaces
- [ ] API usage / cost dashboard — tokens consumed, running cost across all agents
- [ ] `.aide` project settings folder — per-project configuration directory (like `.vscode`/`.cursor`) for workspace settings, recommended extensions, debug configs, and app preferences. Committed to version control so collaborators share the same IDE setup

### Explicitly out of scope
- Web-based version (desktop-only by design)
- VS Code extension compatibility
- Cloud sync or remote workspaces (v1)

---

## 3. Architecture Decision

**Chosen approach: Electron from scratch** (not a VS Code fork, not a Pulsar fork)

### Why not fork VS Code
- VS Code's webview API deliberately blocks cookies — persistent Google/GitHub/Microsoft sessions are architecturally incompatible with VS Code's extension model
- Monthly upstream merges create crushing maintenance debt for a solo developer (EclipseSource documented this as a "nightmare" after attempting it)
- Microsoft blocks proprietary extensions (C/C++, Remote Dev, GitHub Copilot) in forks, forcing reliance on Open VSX's ~2,800 packages vs. 50,000+ on the marketplace
- VS Code's workbench layout system makes embedding `WebContentsView` with its own session partition structurally hostile — it operates as a native Chromium overlay outside the DOM

### Why not fork Pulsar (Atom successor)
- Only 3–5 active contributors — unsustainable for a dependency
- Just completed an 18-version Electron upgrade (v12 → v30) that took 2.5 years
- No AI package ecosystem whatsoever
- Legacy CoffeeScript debt throughout the codebase

### Why Electron from scratch
- Full architectural control over `WebContentsView` and `persist:` session partitions — the persistent browser requirement is a first-class citizen, not a workaround
- `UtilityProcess` per workspace for agent isolation with no extension host constraints
- Clean, understandable codebase — every line is yours, not inherited complexity
- CodeMirror 6 is a better fit than Monaco for heavy AI integration (functional state model, first-class extension API)
- 10–16 week MVP timeline vs. ongoing fork maintenance indefinitely

### Process architecture

```
Main Process (Electron)
├── BaseWindow (app shell)
│   ├── WebContentsView: React app (editor, file tree, UI chrome)
│   ├── WebContentsView: Browser pane A  [session: persist:auth]
│   ├── WebContentsView: Browser pane B  [session: persist:workspace-{id}]
│   └── WebContentsView: Dev server preview [session: persist:workspace-{id}]
├── UtilityProcess: Workspace Agent 1 (Claude API, cwd: ~/btlx-web)
├── UtilityProcess: Workspace Agent 2 (Claude API, cwd: ~/studio60-api)
├── ChildProcess: pyright-langserver (per workspace with Python files)
├── ChildProcess: typescript-language-server (per workspace with TS/JS files)
└── ChildProcess: node-pty shell instances (per terminal pane)
```

---

## 4. Technology Stack

### Core framework
| Layer | Choice | Why |
|---|---|---|
| Desktop shell | **Electron 41+** | WebContentsView, persist: sessions, UtilityProcess, modern Chromium |
| UI framework | **React 19 + TypeScript** | Component model maps well to pane system; community plugin authors know it |
| Build tool | **Vite + electron-vite** | Fast HMR in development, clean Electron integration |
| Package manager | **pnpm** | Workspace monorepo support, faster than npm |
| Packaging | **electron-builder** | macOS .dmg, Windows .msi, Linux .AppImage |

### Editor
| Layer | Choice | Why |
|---|---|---|
| Editor component | **CodeMirror 6** | Modular, functional state model, lighter than Monaco (~300KB vs 5–10MB), first-class extension API designed for AI integration |
| LSP client | **@codemirror/lsp-client** | Official package by CodeMirror author, covers completions/hover/go-to-def/rename |
| One Dark theme | **@codemirror/theme-one-dark** | Official port of Atom One Dark |
| Search in file | **@codemirror/search** | Find/replace in current file, regex support |
| Markdown | **@codemirror/lang-markdown** | Syntax highlighting for `.md` files |
| Code folding | **@codemirror/language** (foldGutter) | Fold function bodies, classes, blocks |
| Indent guides | **@replit/codemirror-indentation-markers** | Vertical lines showing block structure — handles mixed tabs/spaces and empty-line inheritance |

### Search
| Layer | Choice | Why |
|---|---|---|
| Find in files | **@vscode/ripgrep** (bundled `rg` binary) | Same engine VS Code uses; fast, cross-platform, respects `.gitignore` |
| Symbol search | LSP `workspace/symbol` | Find function/class across codebase via language server |

### Markdown preview
| Layer | Choice | Why |
|---|---|---|
| Renderer | **marked** or **remark** | Parse markdown to HTML for preview pane |
| Preview pane | React component in Dockview | Side-by-side with editor, live-updating on keystroke |

### Layout
| Layer | Choice | Why |
|---|---|---|
| Pane/dock system | **Dockview 5.x** | Zero-dependency, React-native, full serialization API for layout persistence, drag-and-drop, floating panels, zero deps |

### Terminal
| Layer | Choice | Why |
|---|---|---|
| Terminal renderer | **xterm.js** | Battle-tested, used by VS Code; future upgrade path to libghostty-vt WASM |
| PTY bridge | **node-pty** | Spawns real shell with PTY; required for Claude Code, vim, etc. |

> **Future exploration: Ghostty WASM terminal upgrade (v2+)**
>
> Ghostty (MIT licensed, written in Zig) offers GPU-accelerated rendering, superior VT escape sequence parsing, full OpenType ligature support, and significantly faster throughput than xterm.js. Its parser is already separated as `libghostty-vt` within the repo, and Zig supports `wasm32-freestanding` as a compile target.
>
> **DIY WASM build is theoretically possible but non-trivial:** system API dependencies (memory, I/O) need stubs for WASM, a JS bridge between the WASM module and xterm.js's rendering pipeline would need to be built, Zig-to-WASM tooling is less mature than Rust's `wasm-pack` ecosystem, and maintaining a fork against upstream changes is ongoing work.
>
> **Recommendation:** Park this unless xterm.js parsing becomes a real pain point. If the Ghostty team ships an official WASM build of `libghostty-vt`, adopt it then for free.

### Language servers (individually installable — nothing bundled by default)

**Philosophy:** aIDE should eventually support all languages. Use off-the-shelf LSP servers where available. Language packs are installed individually by the user — no language tooling ships by default. If custom integrations are needed, they should be separate installable packages following the same pattern.

| Language | Server | Install | Status |
|---|---|---|---|
| Python | **pyright-langserver** | `npm install pyright` (bundles the server) | MVP (first language pack) |
| JavaScript/TypeScript | **typescript-language-server** | `npm install typescript-language-server typescript` | MVP (first language pack) |
| CSS/Tailwind | **tailwindcss-language-server** | `npm install @tailwindcss/language-server` | v2 |
| Go | **gopls** | System install via `go install` | v2+ |
| Rust | **rust-analyzer** | System install via `rustup` | v2+ |
| Ruby | **solargraph** or **ruby-lsp** | `gem install` | v2+ |
| _Any LSP-compatible server_ | User-configured | Settings panel: path + args + file glob | v2+ (generic LSP slot) |

### AI integration
| Layer | Choice | Why |
|---|---|---|
| Phase 1 agent | **Claude Code CLI** (via node-pty terminal) | Zero integration cost; terminal is sufficient for v1 |
| Phase 2 agent | **Claude Agent SDK** (programmatic) | Structured output, diff preview, pause/resume control |
| API key management | Electron `safeStorage` | Encrypts API key at rest using OS keychain |

### State / persistence
| Layer | Choice | Why |
|---|---|---|
| Workspace state | **electron-store** | JSON persistence in userData, typed with TypeScript generics |
| Layout state | Dockview `api.toJSON()` | Built-in; stored as a field in workspace state |
| Browser sessions | Electron `persist:` partitions | Stored in userData/Partitions/; survives restarts automatically |
| File watching | **chokidar** | Cross-platform, efficient, powers the file tree dirty state |

### File tree
| Layer | Choice | Why |
|---|---|---|
| Virtual list | **@tanstack/react-virtual** | Handles large trees without DOM node bloat |
| Git status | **simple-git** | Node.js wrapper around git CLI; branch, dirty state, ahead/behind |

---

## 5. Design System

### Theming architecture

**Decision:** Support dark + light mode from day one. Design the CSS variable token system to support custom themes in the future.

All colors are referenced via semantic CSS variables. Theme files define the concrete values. The app loads one theme at a time by setting a `data-theme` attribute on `<html>`. CodeMirror themes must be swapped in parallel (CodeMirror uses its own theming system via extensions, not CSS variables — so each app theme bundles a matching CodeMirror theme extension).

```
themes/
├── atom-one-dark.css    ← default
├── atom-one-light.css   ← built-in alternative
└── custom/              ← user-installed themes (v2+)
```

**Theme switching:** `document.documentElement.setAttribute('data-theme', 'one-dark')` — all components re-render with new token values. CodeMirror `EditorView.reconfigure()` swaps the theme extension.

### Color tokens — Atom One Dark (default)

Define these in `[data-theme="one-dark"]` and reference throughout. Lifted from Atom's official `one-dark-ui` theme variables.

```css
[data-theme="one-dark"] {
  /* Backgrounds */
  --bg-base:        #282c34;   /* editor background */
  --bg-elevated:    #21252b;   /* app shell, sidebar */
  --bg-sunken:      #1a1d23;   /* terminal, status bar */
  --bg-overlay:     #1d2026;   /* agent panel, secondary surfaces */
  --bg-active-tab:  #282c34;   /* active workspace tab */
  --bg-inactive-tab:#2c313a;   /* inactive workspace tab */
  --bg-hover:       #2c313a;   /* hover states */
  --bg-selection:   rgba(82, 139, 255, 0.15);

  /* Text */
  --text-primary:   #abb2bf;   /* default code/UI text */
  --text-secondary: #7f8694;   /* inactive tabs, file tree dirs */
  --text-muted:     #636d83;   /* line numbers, hints, placeholders */
  --text-selected:  #ffffff;

  /* Semantic text */
  --text-info:      hsl(219, 79%, 66%);   /* #6aa3f8 */
  --text-success:   hsl(140, 44%, 62%);   /* #98c379 */
  --text-warning:   hsl(36, 60%, 72%);    /* #e5c07b */
  --text-error:     hsl(9, 100%, 64%);    /* #e06c75 */

  /* Borders */
  --border-base:    #181a1f;
  --border-subtle:  #3e4452;

  /* Accent */
  --accent:         #528bff;

  /* Syntax */
  --syntax-keyword: #c678dd;   /* purple: import, const, return */
  --syntax-fn:      #61afef;   /* blue: function names */
  --syntax-string:  #98c379;   /* green: string literals */
  --syntax-number:  #d19a66;   /* orange: numbers */
  --syntax-comment: #5c6370;   /* gray: comments */
  --syntax-tag:     #e06c75;   /* red: JSX tags */
  --syntax-attr:    #528bff;   /* blue: JSX attributes */
}
```

### Color tokens — Atom One Light (built-in alternative)

```css
[data-theme="one-light"] {
  /* Backgrounds */
  --bg-base:        #fafafa;
  --bg-elevated:    #eaeaeb;
  --bg-sunken:      #f0f0f0;
  --bg-overlay:     #e5e5e6;
  --bg-active-tab:  #fafafa;
  --bg-inactive-tab:#eaeaeb;
  --bg-hover:       #e0e0e1;
  --bg-selection:   rgba(56, 113, 220, 0.12);

  /* Text */
  --text-primary:   #383a42;
  --text-secondary: #696c77;
  --text-muted:     #a0a1a7;
  --text-selected:  #000000;

  /* Semantic text */
  --text-info:      hsl(220, 100%, 45%);  /* #0064d6 */
  --text-success:   hsl(119, 34%, 40%);   /* #50a14f */
  --text-warning:   hsl(35, 84%, 44%);    /* #c18401 */
  --text-error:     hsl(5, 74%, 50%);     /* #e45649 */

  /* Borders */
  --border-base:    #d0d0d0;
  --border-subtle:  #e0e0e0;

  /* Accent */
  --accent:         #4078f2;

  /* Syntax */
  --syntax-keyword: #a626a4;   /* purple */
  --syntax-fn:      #4078f2;   /* blue */
  --syntax-string:  #50a14f;   /* green */
  --syntax-number:  #986801;   /* orange */
  --syntax-comment: #a0a1a7;   /* gray */
  --syntax-tag:     #e45649;   /* red */
  --syntax-attr:    #986801;   /* orange */
}
```

### Typography
- **Font:** System monospace stack for code (`'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace`)
- **UI font:** System sans-serif (`-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`)
- **Code size:** 13px (configurable via settings)
- **UI size:** 12px for labels/tabs, 13px for file tree, 11px for status bar

### Layout measurements
- **Workspace ribbon height:** 38px
- **Tab bar height:** 26px (per pane)
- **Status bar height:** 22px
- **Sidebar (file tree) default width:** 220px (user-resizable)
- **Minimum pane size:** 100px × 80px
- **Drag handle width:** 4px (hit target: 8px)

### Agent status dot colors
- **Idle:** `var(--text-success)` (#98c379, dim green) — no animation
- **Running:** `var(--text-warning)` (#e5c07b, amber) — pulsing ring animation
- **Waiting for input:** `var(--accent)` (#528bff, blue) — solid, no animation
- **Error/crashed:** `var(--text-error)` (#e06c75, red) — no animation
- **Completed:** `var(--text-success)` (#98c379) — bright, no animation

---

## 6. Feature Specifications

### 6.1 Workspace System

**What a "workspace" is:**
A workspace is a named configuration binding together: a root directory path, a Dockview layout snapshot, a set of browser pane URLs and their session partition ID, active LSP servers, and the last known agent state.

**Workspace data shape** (see Section 8 for full model):
```
Workspace {
  id: string (uuid)
  name: string
  rootPath: string
  icon?: string
  layout: DockviewSerializedLayout
  browserPanes: BrowserPaneState[]
  agentState: AgentState
  gitBranch?: string
  createdAt: number
  lastOpenedAt: number
}
```

**Workspace switcher ribbon behavior:**
- Render one tab per workspace in creation order
- Active workspace tab uses `--bg-active-tab` fill
- `Cmd+1` through `Cmd+9` jump to workspace by position
- `Cmd+Shift+[` / `Cmd+Shift+]` cycle through workspaces
- Right-click a tab: rename, duplicate, close, reveal in Finder
- Drag tabs to reorder
- `+` button creates new workspace (opens workspace creation modal)
- Agent status dot updates in real-time from the workspace's agent process

**Workspace switching:**
1. Serialize current Dockview layout to JSON → store in workspace state
2. Suspend (not kill) LSP servers for previous workspace
3. Hide all WebContentsView overlays for previous workspace
4. Load new workspace's Dockview layout from stored JSON
5. Resume (or start) LSP servers for new workspace
6. Position WebContentsView overlays for new workspace panes
7. Set focus to previously-focused pane in new workspace

### 6.2 Tiling Pane System

**Powered by Dockview.** Each panel slot in Dockview is a typed "pane" that renders one of:

| Pane type | Component | Description |
|---|---|---|
| `editor` | CodeMirror 6 | Code editor; multiple files via tab bar within the pane |
| `terminal` | xterm.js + node-pty | Shell instance; supports multiple terminal tabs |
| `browser` | WebContentsView overlay | Real Chromium browser with persistent session |
| `filetree` | React virtual list | Directory explorer for workspace root |
| `agent` | Agent panel component | Dashboard for active workspace agent |
| `preview` | WebContentsView overlay | Dev server preview (localhost:PORT) |

**Creating splits:**
- Right-click any pane header → "Split right" / "Split down"
- Drag a tab to the edge of another pane to split
- `Cmd+\` splits current pane vertically
- `Cmd+Shift+\` splits current pane horizontally

**WebContentsView overlay positioning:**
Browser and preview panes are DOM placeholders in Dockview with a matching `WebContentsView` positioned as an overlay in the native window. On every Dockview `onDidLayoutChange` event:
```typescript
const bounds = paneElement.getBoundingClientRect();
webContentsView.setBounds({
  x: Math.round(bounds.x),
  y: Math.round(bounds.y),
  width: Math.round(bounds.width),
  height: Math.round(bounds.height)
});
```
When a browser pane is hidden (workspace switch or minimized), call `webContentsView.setVisible(false)` — this preserves the session and page state without destroying the view.

**Tile action buttons (v2+):**
Each Dockview panel header should have a row of icon buttons on the right side (inspired by cmux). Actions include:
- **New terminal** — opens a new terminal tab in that tile
- **New browser** — opens a new browser tab in that tile
- **Split vertical** — splits the tile vertically
- **Split horizontal** — splits the tile horizontally

These buttons provide quick, discoverable access to tile operations without needing keyboard shortcuts or right-click context menus.

**Double-click tab to maximize pane (v2+):**
Double-clicking a Dockview panel tab should expand that pane to fill the entire workspace area, hiding all other panes. Double-clicking again restores the previous layout. Same behavior as VS Code's editor tab maximize. Dockview exposes `maximizeGroup()` / `exitMaximizedGroup()` on the API — toggle based on `isMaximized` state.

**Layout serialization:**
```typescript
// Save
const snapshot = dockviewApi.toJSON();
workspaceStore.set(`${workspaceId}.layout`, snapshot);

// Restore
const snapshot = workspaceStore.get(`${workspaceId}.layout`);
if (snapshot) {
  dockviewApi.fromJSON(snapshot);
} else {
  buildDefaultLayout(dockviewApi); // first open: editor + terminal
}
```

### 6.3 Browser Panes

**Session architecture:**

| Session key | Purpose | Scope |
|---|---|---|
| `persist:auth` | Google, GitHub, Microsoft accounts | Shared across ALL workspaces |
| `persist:workspace-{id}` | Dev server state, localhost cookies, workspace-specific logins | Per workspace |

**Creating a browser pane:**
```typescript
const authSession = session.fromPartition('persist:auth');
const view = new WebContentsView({ webPreferences: { session: authSession } });
win.contentView.addChildView(view);
view.webContents.loadURL('https://github.com');
```

**On workspace switch:** call `view.setVisible(false)` for all views belonging to old workspace, then `view.setVisible(true)` for views belonging to new workspace, repositioning bounds.

**Navigation UI:** A minimal browser chrome is rendered as a React component in the main WebContentsView (not inside the WebContentsView overlay), positioned above the overlay's bounds. It communicates with the overlay via IPC:
- Back / Forward buttons
- URL bar (read/write via `view.webContents.getURL()` / `view.webContents.loadURL()`)
- Refresh button
- `will-navigate` and `did-navigate` events update the URL bar in real-time

**No Chrome extension support in v1.** Electron's `session.loadExtension()` does not support password manager APIs (`chrome.identity`, `chrome.action`, `chrome.storage.sync`). Plan to handle authentication by staying logged in via persistent sessions — don't promise Chrome extension support to users.

### 6.4 Editor (CodeMirror 6)

**Extensions to configure at initialization:**

```typescript
import { EditorView, basicSetup } from 'codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { lspClient } from '@codemirror/lsp-client';

const editor = new EditorView({
  extensions: [
    basicSetup,           // line numbers, undo, bracket matching, etc.
    oneDark,              // Atom One Dark theme
    python(),             // syntax + fold for .py files
    javascript({ typescript: true }), // syntax + fold for .ts/.tsx/.js files
    lspClient(lspConnection), // LSP completions, diagnostics, hover
    // custom extensions:
    agentEditHighlight(), // highlight lines currently being edited by agent
    dirtyFileMarker(),    // gutter indicator for unsaved changes
  ]
});
```

**Multi-file tabs within an editor pane:**
Each editor pane maintains its own list of open files. Tabs are rendered in the pane's tab bar. Each tab stores:
- File path
- CodeMirror EditorState snapshot (cursor position, scroll, fold state)
- Dirty flag (has unsaved changes)

Switching tabs swaps `EditorView.setState(savedState)` — instant, no re-parse needed.

**LSP connection per workspace:**
Each workspace gets its own LSP client connection, scoped to its root directory. The `@codemirror/lsp-client` package handles the JSON-RPC communication over stdin/stdout of the language server child process.

### 6.5 Language Server Protocol (LSP)

**What LSP provides (what the "Python plugin" actually does):**
- **Completions:** As you type, the language server returns ranked completion suggestions with types and documentation
- **Diagnostics:** Real-time red/yellow squiggles for errors, warnings, and type issues — without running the code
- **Hover:** Mouse over any symbol → type signature and documentation tooltip
- **Go to definition:** `Cmd+Click` any symbol → jump to where it's defined
- **Find references:** All usages of a symbol across the codebase
- **Rename symbol:** Rename a variable/function everywhere it's used atomically
- **Format on save:** Auto-format using the language's formatter (Black for Python, Prettier for JS/TS)

**Pyright for Python:**
```typescript
import { spawn } from 'child_process';

const pyright = spawn('pyright-langserver', ['--stdio'], {
  cwd: workspace.rootPath,
  env: { ...process.env, PYTHONPATH: workspace.rootPath }
});
```
Pyright understands virtual environments, type annotations (`mypy`-compatible), and third-party library stubs automatically.

**typescript-language-server for JS/TS:**
```typescript
const tsserver = spawn('typescript-language-server', ['--stdio'], {
  cwd: workspace.rootPath
});
```
Provides the same intelligence VS Code's TypeScript experience uses. Also handles plain `.js` files with JSDoc type inference.

**Per-workspace LSP lifecycle:**
- Start LSP servers when workspace is first opened and matching file types exist
- Suspend (`SIGSTOP`) when workspace is switched away from — saves CPU while not in focus
- Resume (`SIGCONT`) when workspace is switched back to
- Kill when workspace is closed

### 6.6 Claude Code Terminal Integration

**Phase 1: Terminal pane with output parsing**

Claude Code runs in a normal terminal pane (xterm.js + node-pty). No special integration required — just a shell.

The value-add in v1 is **output monitoring**: subscribe to the terminal's data stream and parse for Claude Code's status patterns to update the workspace tab's agent status dot:

```typescript
// Patterns to detect in terminal output
const CLAUDE_PATTERNS = {
  working:   /Analyzing|Reading|Writing|Editing|Running|Searching/i,
  waiting:   />\s*$|What would you like/i,
  complete:  /Task complete|Done\.|✓/i,
  error:     /Error:|Failed:|✗/i,
};

terminalDataStream.subscribe((data: string) => {
  for (const [status, pattern] of Object.entries(CLAUDE_PATTERNS)) {
    if (pattern.test(data)) {
      updateWorkspaceAgentStatus(workspaceId, status);
      break;
    }
  }
});
```

**Multiple terminals per workspace:**
Terminal pane supports tabs internally. One tab for the interactive shell, one for `claude`, one for running the dev server — all within one pane, switchable without losing state.

**Phase 2: Claude Agent SDK (programmatic)**

Replace raw terminal with structured integration:
```typescript
import { query } from '@anthropic-ai/claude-code';

const agentProcess = new UtilityProcess('./agent-worker.js', {
  env: { ANTHROPIC_API_KEY: getStoredApiKey() }
});

// In agent-worker.js:
for await (const event of query({
  prompt: userPrompt,
  options: { cwd: workspace.rootPath, maxTurns: 20 }
})) {
  process.parentPort.postMessage(event);
}
```

This enables the structured agent panel UI: file-by-file progress, diff previews before applying, pause/resume, and cost tracking.

### 6.7 File Tree

**Architecture decision: Fixed left sidebar** (outside Dockview, always present). The file tree is special — it's the navigation root. This avoids the problem of users accidentally closing it with no obvious way to get it back, and simplifies `WebContentsView` overlay positioning (overlays can never overlap the sidebar).

**Features:**
- Virtual list (TanStack Virtual) for large directories without DOM bloat
- Directory expand/collapse with chevron icons
- File type icons (a small icon set — no heavy icon font needed)
- Git dirty state per file: `M` (modified), `A` (added), `?` (untracked), `D` (deleted) — shown as colored indicators
- Right-click context menu: New File, New Folder, Rename, Delete, Copy Path, Reveal in Finder
- Drag files between directories
- Search/filter within the tree (`Cmd+P`-style quick open for files is a separate global shortcut)
- Toggle visibility with `Cmd+B` (sidebar can be hidden but returns to fixed position)

**Git status integration:**
```typescript
import simpleGit from 'simple-git';
const git = simpleGit(workspace.rootPath);

// Poll every 2 seconds, or on file save
const status = await git.status();
// status.modified, status.staged, status.not_added, etc.
```

### 6.8 Search

**Find in files (`Cmd+Shift+F`):**
One of the most-used IDE features — especially critical for the AI workflow where you want to search for what the agent just wrote. Uses bundled ripgrep (`@vscode/ripgrep`) for speed and `.gitignore` awareness.

```typescript
import { rgPath } from '@vscode/ripgrep';
import { spawn } from 'child_process';

function searchFiles(query: string, rootPath: string, options?: SearchOptions) {
  const args = [
    '--json',              // structured output for parsing
    '--max-count', '100',  // limit results per file
    '--smart-case',        // case-insensitive unless query has uppercase
  ];
  if (options?.regex) args.push('--pcre2');
  if (options?.glob) args.push('--glob', options.glob);
  args.push(query, rootPath);

  return spawn(rgPath, args);
}
```

**Search results UI:** A results panel (Dockview pane type) showing file-grouped results with line previews. Click a result → jump to that line in the editor. Support replace-all across files.

**Find/replace in current file:** `@codemirror/search` extension — `Cmd+F` for find, `Cmd+H` for replace. Regex support built-in.

**Symbol search:** LSP `workspace/symbol` request via `Cmd+T` — find functions, classes, types across the codebase. Results ranked by relevance from the language server.

### 6.9 Markdown Preview

**Side-by-side rendering:** Editor pane on the left, live-updating rendered preview on the right. The preview is a React component in a Dockview pane, not a `WebContentsView` overlay (simpler, no overlay positioning needed).

Uses `marked` for parsing and `DOMPurify` for sanitization (markdown content can contain arbitrary HTML — must sanitize before rendering to prevent XSS).

**Styling:** The preview pane uses a CSS stylesheet that matches the current app theme (dark or light). Code blocks in the preview use the same syntax highlighting colors as the editor.

**Auto-open:** When a `.md` file is opened, offer to open a preview pane alongside it (small toast notification, not forced). `Cmd+Shift+V` toggles the preview for the current markdown file.

### 6.10 Workspace Ribbon Global Zone

The workspace ribbon has two zones:
- **Left:** Per-workspace tabs (as described in 6.1)
- **Right:** Global controls that are workspace-independent

**Global zone contents:**
- **Settings icon** (`Cmd+,`) — opens app settings panel
- **Notifications bell** — aggregated view of agent activity across all workspaces. Badge count shows unread events. Click to expand dropdown: "Workspace A: agent completed task", "Workspace B: agent waiting for input", etc.
- **API cost indicator** — compact display showing today's token usage / estimated cost. Click to expand detailed cost dashboard (tokens per workspace, per hour, running total). This is a differentiating feature for AI-first IDEs
- **Theme toggle** — quick switch between dark/light mode

### 6.11 Plugin System (v2)

**Design principles:**
- Plugins are npm packages with a naming convention: `{appname}-plugin-{name}`
- Each plugin exports a manifest and either a main-process module, a renderer module, or both
- The host app exposes a typed API surface — plugins cannot access Electron internals directly
- Plugins are sandboxed to the renderer process unless explicitly granted main-process access in their manifest

**Exposed plugin APIs (v2 scope):**
```typescript
interface PluginAPI {
  // Register a new pane type
  registerPaneType(id: string, component: React.ComponentType, config: PaneConfig): void;
  // Register a language server
  registerLanguageServer(config: LSPServerConfig): void;
  // Register keyboard shortcuts
  registerCommand(id: string, shortcut: string, handler: () => void): void;
  // Read/write workspace-scoped storage
  storage: { get(key: string): unknown; set(key: string, value: unknown): void; };
  // Subscribe to workspace events
  on(event: WorkspaceEvent, handler: (data: unknown) => void): void;
}
```

---

## 7. Phase-by-Phase Build Plan

### Phase 1: Skeleton (Weeks 1–3)

**Goal:** A running Electron app with the visual shell, Atom One Dark theme, a hardcoded 2-pane layout, and a hello-world React renderer. No real editor functionality yet.

#### Milestones
- [ ] **1.1** Project scaffolding
  - Initialize with `electron-vite` + React + TypeScript template
  - Configure pnpm workspaces (packages: `main`, `renderer`, `shared`)
  - Set up ESLint + Prettier + TypeScript strict mode
  - Configure electron-builder for macOS (primary target first)

- [ ] **1.2** Electron shell
  - Create `BaseWindow` (frameless with custom title bar)
  - Implement custom drag region for macOS traffic lights
  - Set up IPC channel scaffolding (`ipcMain` / `ipcRenderer` bridge with typed channels)
  - Configure `safeStorage` for API key storage

- [ ] **1.3** Theming system + React renderer
  - Build `data-theme` attribute-based theming system (see Section 5)
  - Define all CSS variables in `[data-theme="one-dark"]` and `[data-theme="one-light"]` selectors
  - Implement theme toggle (stored in app settings)
  - Build `AppShell` layout: workspace ribbon (top) + fixed left sidebar (file tree placeholder) + Dockview main content + status bar
  - Implement workspace ribbon with 2 dummy workspaces + status dots + global zone (right side: settings, notifications, cost, theme toggle)
  - Implement status bar with placeholder content

- [ ] **1.4** Dockview integration
  - Install `dockview` and wire into main content area (sidebar is outside Dockview)
  - Configure Dockview theme to match both dark and light modes (override CSS variables based on `data-theme`)
  - Implement `buildDefaultLayout(api)` — default editor + terminal arrangement
  - Verify drag-and-drop pane rearrangement works
  - Verify layout serialization round-trip: `toJSON()` → `fromJSON()`

#### Deliverable
An Electron window with the correct visual chrome, dark + light theme toggle working, fixed sidebar, Dockview panes, and a workspace ribbon with global zone — even though nothing is functional yet.

---

### Phase 2: Core IDE Features (Weeks 4–7)

**Goal:** A usable editor with file tree, working terminal, search, markdown preview, and keyboard shortcuts. This phase is the "does it feel like an IDE" phase.

#### Milestones
- [ ] **2.1** File tree (fixed sidebar)
  - Implement `WorkspaceStore` with `electron-store` (Section 8 data model)
  - Build file tree component with TanStack Virtual in the fixed left sidebar
  - Connect `chokidar` watcher to file tree (add/remove/rename react in real-time)
  - Implement expand/collapse, right-click context menu
  - Add `simple-git` status polling (dirty file indicators: M/A/U/D badges)
  - Display current git branch in status bar
  - Implement `Cmd+B` sidebar toggle

- [x] **2.2** CodeMirror 6 editor
  - Install `codemirror`, `@codemirror/lang-python`, `@codemirror/lang-javascript`, `@codemirror/lang-markdown`, `@codemirror/theme-one-dark`, `@replit/codemirror-indentation-markers`
  - Build `EditorPane` component that renders `EditorView`
  - Implement multi-file tab bar within the editor pane
  - Handle file open from file tree click (read file → create EditorState → display)
  - Handle file save (`Cmd+S` → write to disk via writeFile IPC)
  - Preserve cursor position, scroll, and fold state per file tab
  - Show dirty indicator (`•`) on unsaved tabs (module-level dirty state + onDirtyChange listeners)
  - Confirm-before-close for unsaved tabs (DockviewDefaultTab + closeActionOverride)
  - Configure table-stakes editor features:
    - Multi-cursor editing (`Cmd+D` select next occurrence, `Cmd+Click` place cursor) — via basicSetup
    - Code folding with fold gutters (`@codemirror/language` foldGutter) — via basicSetup
    - Indent guides (vertical block structure lines) — via @replit/codemirror-indentation-markers
    - Word wrap toggle (`Cmd+Alt+W`) — via Compartment
    - Bracket matching and auto-close — via basicSetup
    - Find/replace in file (`Cmd+F` find, `Cmd+H` replace) — via basicSetup
  - Wire CodeMirror theme to follow app theme (swap extension on theme toggle)

- [ ] **2.3** Terminal (xterm.js + node-pty)
  - Install `xterm`, `xterm-addon-fit`, `node-pty`
  - Build `TerminalPane` component
  - Spawn PTY shell on pane creation (use user's default shell from `process.env.SHELL`)
  - Implement fit-to-pane resizing via `FitAddon`
  - Configure terminal color scheme to follow app theme (dark + light)
  - Implement multiple terminal tabs within one terminal pane

- [ ] **2.4** Find in files + symbol search
  - Bundle ripgrep via `@vscode/ripgrep`
  - Build search panel (Dockview pane type) with file-grouped results and line previews
  - Implement `Cmd+Shift+F` to open/focus search panel
  - Click result → jump to line in editor
  - Support regex toggle, case sensitivity toggle, file glob filter
  - Replace across files (with confirmation)
  - LSP symbol search via `Cmd+T` (wired after LSP is available in Phase 3)

- [x] **2.5** Markdown preview
  - Build `MarkdownPreviewPane` React component in Dockview
  - Use `marked` for parsing + `DOMPurify` for XSS sanitization
  - Live-update preview on editor keystroke via `editorContentBus` pub/sub
  - Style preview to match current app theme (dark/light) using CSS variable tokens
  - Code block syntax highlighting via `highlight.js` (regex-based, 190+ languages). May switch to Shiki (TextMate grammars) in future for VS Code-grade accuracy. Does not interact with LSP — code blocks are static snippets
  - `Cmd+Shift+V` toggles preview for current markdown file
  - Toast notification system with "Open Preview" action when `.md` file is opened
  - Preview auto-closes when source editor tab is closed

- [ ] **2.6** Keyboard shortcut system
  - Build `ShortcutManager` singleton with a focus context stack
  - Implement `Cmd+1–9` for workspace switching
  - Implement `Cmd+\` / `Cmd+Shift+\` for pane splitting
  - Implement `Cmd+W` for closing current tab (not pane)
  - Implement `Cmd+S` for save
  - Implement `Cmd+P` for quick file open (fuzzy search in workspace root)
  - Implement `Cmd+Shift+P` for global command palette
  - Implement `Cmd+Shift+[` / `Cmd+Shift+]` for workspace cycling
  - Implement `Cmd+Shift+F` for find in files
  - Implement `Cmd+T` for symbol search
  - Implement `Cmd+B` for sidebar toggle

#### Deliverable
You can open a folder, see the file tree, click a Python or JS/TS file to open it with syntax highlighting, multi-cursor, code folding, and find/replace. Search across all files. Preview markdown side-by-side. Run commands in the terminal. Toggle dark/light theme. It feels like a real IDE.

---

### Phase 3: LSP + Browser Pane (Weeks 7–9)

**Goal:** Full language intelligence for Python and JS/TS, plus the browser pane with persistent account sessions.

#### Milestones
- [ ] **3.1** LSP infrastructure
  - Build `LSPManager` class in the main process (manages server lifecycle per workspace)
  - Implement server auto-detection: scan workspace root for `*.py` → start Pyright; scan for `*.ts`/`*.js`/`*.tsx`/`*.jsx` → start typescript-language-server
  - Implement SIGSTOP/SIGCONT on workspace switch for LSP servers
  - Build IPC bridge between LSP processes and renderer
  - Connect `@codemirror/lsp-client` to the IPC bridge

- [ ] **3.2** Pyright integration (Python)
  - Bundle `pyright` as a dev dependency (installs `pyright-langserver` binary)
  - Configure initialization options: workspace root, `pythonPath` detection (check for `.venv`, `venv`, conda env)
  - Verify completions, diagnostics, hover, go-to-definition work for Python files
  - Test with a real Python project

- [ ] **3.3** typescript-language-server integration (JS/TS)
  - Bundle `typescript` and `typescript-language-server` as dev dependencies
  - Configure initialization with `tsconfig.json` discovery
  - Verify completions, diagnostics, hover, go-to-definition for TypeScript files
  - Verify JSX support (`.tsx` / `.jsx`)
  - Test with a real Next.js or React project

- [ ] **3.4** Browser pane — auth sessions
  - Create `BrowserPaneManager` in main process
  - Create `persist:auth` session partition
  - Build `BrowserPane` pane type: renders a placeholder div in Dockview + a `WebContentsView` overlay
  - Implement `WebContentsView` bounds synchronization on Dockview layout change
  - Implement `setVisible(false/true)` on workspace switch
  - Build minimal browser chrome React component (back/forward/refresh/URL bar) via IPC
  - Test: log in to GitHub → switch workspaces → switch back → still logged in

- [ ] **3.5** Browser pane — dev server preview
  - Create `persist:workspace-{id}` session partition per workspace
  - Build `PreviewPane` variant of browser pane
  - Auto-detect common dev server ports (3000, 5173, 8080) and offer to open preview
  - Ensure preview sessions are isolated between workspaces (localhost:3000 in workspace A ≠ workspace B)

#### Deliverable
You can open a Python file and get real type checking, completions, and go-to-definition. You can open a TypeScript React file and get the same. You can add a browser pane, log in to GitHub, switch to another workspace, come back, and still be logged in.

---

### Phase 4: Workspace System (Weeks 10–12)

**Goal:** The full multi-workspace experience — create, switch, persist, restore workspaces with complete state.

#### Milestones
- [ ] **4.1** Workspace creation flow
  - Build "New Workspace" modal: name input, root directory picker, icon/color selector
  - Implement workspace store CRUD (create, read, update, delete) with `electron-store`
  - Generate UUID for each workspace, create `persist:workspace-{id}` session partition

- [ ] **4.2** Workspace switching with full state persistence
  - Implement `WorkspaceSwitcher.switchTo(id)`:
    1. Serialize current Dockview layout → store
    2. Serialize current editor tab states → store
    3. SIGSTOP active LSP servers
    4. Hide `WebContentsView` overlays
    5. Load target workspace layout from store → `dockviewApi.fromJSON()`
    6. Restore editor tab states
    7. SIGCONT target workspace LSP servers (start if first time)
    8. Reposition and show `WebContentsView` overlays
    9. Restore focus to previously-focused pane
  - Implement workspace tab keyboard shortcuts (`Cmd+1–9`)
  - Test: verify pane arrangement, scroll position, open files, and browser URL all restore correctly

- [ ] **4.3** Agent status in workspace ribbon
  - Connect terminal output parser (from 6.6) to workspace ribbon status dots
  - Implement pulsing ring CSS animation for "running" state
  - Implement desktop notification when agent in background workspace completes or needs input
  - Add unread badge count on workspace tab (number of lines output since last focus)

- [ ] **4.4** Workspace management UI
  - Workspace tab right-click menu: rename, duplicate, delete, reveal root in Finder
  - Drag-to-reorder workspace tabs
  - Workspace settings panel: change name, root path, icon

#### Deliverable
The full workspace switching experience. You can create two workspaces, start Claude Code in each terminal, switch between them with `Cmd+1/2`, and observe each workspace independently maintaining its pane layout, open files, browser state, and agent status.

---

### Phase 5: Agent Integration (Weeks 13–16)

**Goal:** Move from "Claude Code in a dumb terminal" to a purpose-built agent panel with structured interaction and visibility.

#### Milestones
- [ ] **5.1** Agent panel pane type
  - Build `AgentPane` React component
  - Display: current task description, progress bar, files modified count, current file being edited
  - Display: agent action log (summarized, not raw terminal output)
  - Controls: pause, resume, abandon task
  - Display: estimated cost (token count × pricing)

- [ ] **5.2** Claude Agent SDK integration
  - Install `@anthropic-ai/claude-code`
  - Build `AgentWorker` UtilityProcess that runs the SDK's `query()` loop
  - Implement IPC message protocol between AgentWorker and renderer
  - Stream events to `AgentPane`: `file_read`, `file_write`, `command_run`, `thinking`, `complete`

- [ ] **5.3** Diff preview before apply
  - When agent proposes a file edit, show inline diff in a modal before applying
  - Accept / reject individual file changes
  - "Accept all" button for bulk apply

- [ ] **5.4** Agent edit highlighting in editor
  - Build CodeMirror extension `agentEditHighlight()` 
  - When agent is writing to a file currently open in editor, highlight the lines being modified in real-time
  - Show subtle "agent editing" banner at top of editor pane

- [ ] **5.5** Crash recovery
  - Implement `AgentSupervisor` in main process: polls agent UtilityProcess every 5s
  - On crash: mark workspace agent status as "error", preserve last conversation history, show toast notification
  - "Restart agent" button in agent panel that restores conversation context

#### Deliverable
A fully integrated AI coding agent experience. You can describe a task in the agent panel, watch it work across your codebase with real-time visibility, preview diffs before they're applied, and monitor multiple agents across workspaces simultaneously.

---

### Phase 6: Polish + Open Source Release (Weeks 17–20)

**Goal:** The quality bar needed to put this in front of other developers.

#### Milestones
- [ ] **6.1** Settings system
  - Build settings panel (accessible via `Cmd+,`)
  - Font size, font family selection
  - Editor tab size (2 vs 4 spaces)
  - API key management (stored via `safeStorage`)
  - LSP server paths (for custom installations)
  - Keyboard shortcut customization

- [ ] **6.2** Quick open (`Cmd+P`)
  - Fuzzy file search across workspace root
  - `Cmd+Shift+P` command palette

- [ ] **6.3** GitHub repository
  - Write comprehensive README with screenshots/GIF demo
  - `CONTRIBUTING.md` with dev setup instructions
  - Issue templates (bug report, feature request)
  - GitHub Actions CI: lint + type-check on PR
  - `electron-builder` release pipeline: auto-build macOS `.dmg` on git tag

- [ ] **6.4** Plugin system foundation (optional v1)
  - Implement `PluginRepository` (main + renderer)
  - Expose `registerPaneType` API
  - Document plugin authoring guide

---

## 8. Data Models

### Workspace

```typescript
interface Workspace {
  id: string;                          // uuid v4
  name: string;                        // display name
  rootPath: string;                    // absolute path to project root
  icon?: string;                       // emoji or color hex
  layout: SerializedDockviewLayout;    // from dockviewApi.toJSON()
  openTabs: Record<string, TabState>; // paneId → tab state
  browserPanes: BrowserPaneState[];
  agentState: AgentState;
  lspServers: LSPServerState[];
  gitBranch?: string;
  createdAt: number;                   // unix ms
  lastOpenedAt: number;               // unix ms
}

interface TabState {
  filePath: string;
  scrollTop: number;
  cursorOffset: number;
  foldedRanges: [number, number][];
  isDirty: boolean;
}

interface BrowserPaneState {
  paneId: string;
  url: string;
  sessionKey: 'auth' | string;         // 'auth' = shared, string = workspace-specific
}

interface AgentState {
  status: 'idle' | 'running' | 'waiting' | 'error' | 'complete';
  currentTask?: string;
  conversationHistory?: MessageParam[];  // Anthropic SDK type
  filesModified: string[];
  lastActivityAt?: number;
}

interface LSPServerState {
  language: 'python' | 'typescript' | 'javascript';
  pid?: number;
  status: 'stopped' | 'starting' | 'running' | 'suspended';
  rootPath: string;
}
```

### App-level state (electron-store schema)

```typescript
interface AppState {
  workspaces: Record<string, Workspace>;   // id → Workspace
  workspaceOrder: string[];                 // ordered list of workspace ids
  activeWorkspaceId: string | null;
  settings: AppSettings;
}

interface AppSettings {
  fontSize: number;                         // default: 13
  fontFamily: string;                       // default: 'JetBrains Mono'
  tabSize: number;                          // default: 2
  apiKeyEncrypted?: string;                 // safeStorage encrypted
  theme: 'one-dark' | 'one-light';           // custom themes in v2+
  shortcuts: Record<string, string>;        // command id → key combo
}
```

---

## 9. Known Hard Problems

### 9.1 WebContentsView overlay positioning
**Problem:** `WebContentsView` is a native Chromium layer positioned in OS pixel coordinates relative to the window. Dockview manages pane positions in CSS/DOM coordinates. They're in different coordinate systems, and high-DPI displays (Retina) add a device pixel ratio multiplier.

**Solution approach:**
```typescript
const dpr = window.devicePixelRatio; // typically 2.0 on Retina
const rect = paneElement.getBoundingClientRect();

// getBoundingClientRect() returns CSS pixels (logical)
// setBounds() expects physical pixels on some platforms
// Test per platform — on macOS with electron, logical pixels work directly
view.setBounds({
  x: Math.round(rect.x),
  y: Math.round(rect.y + RIBBON_HEIGHT + TABBAR_HEIGHT),
  width: Math.round(rect.width),
  height: Math.round(rect.height)
});
```
**Critical:** The main `WebContentsView` (React app) must reserve the exact pixel regions where browser overlays will appear — they render above the React DOM, not within it. The React DOM renders a colored placeholder div; the browser overlay covers it exactly.

### 9.2 LSP per-workspace isolation
**Problem:** If two workspaces have overlapping file paths (monorepos, shared libraries), LSP servers from one workspace may interfere with another.

**Solution approach:** Each workspace's LSP servers receive the workspace `rootPath` as their working directory during initialization. The `workspaceFolders` LSP init parameter scopes all operations to that directory. Use strict process isolation (no IPC between workspace LSPs). If two workspaces share a root path, they share one set of LSP servers (deduplicate on root path, not workspace ID).

### 9.3 node-pty on Apple Silicon + Windows
**Problem:** `node-pty` is a native Node module that requires compilation per platform/architecture. Electron's Node version must match exactly.

**Solution:** Use `electron-rebuild` in the build pipeline:
```json
// package.json scripts
"postinstall": "electron-rebuild -f -w node-pty"
```
Pin `node-pty` version and test on both Intel and Apple Silicon macOS, and Windows x64. Document in CONTRIBUTING.md that contributors must run `electron-rebuild` after `npm install`.

### 9.4 Dockview layout corruption on schema migration
**Problem:** If you add new pane types in v2 and a user opens a saved layout from v1, `dockviewApi.fromJSON()` will crash on unknown component names (confirmed GitHub issue).

**Solution:**
```typescript
function safeRestoreLayout(api: DockviewApi, saved: unknown) {
  try {
    api.fromJSON(saved as SerializedDockview);
  } catch (e) {
    console.error('Layout restore failed, using default:', e);
    buildDefaultLayout(api);
    // Optionally: notify user that layout was reset
  }
}
```
Additionally: version-stamp all saved layouts (`version: 1`) and write a migration function before calling `fromJSON`.

### 9.5 Agent process crash state recovery
**Problem:** If a `UtilityProcess` agent crashes mid-edit, files on disk may be partially modified. The conversation history in memory is lost.

**Solution:** 
- Write conversation history to disk incrementally (every N turns) in the AgentWorker
- On crash detection in `AgentSupervisor`, check git for uncommitted changes and surface them in the agent panel: "Agent crashed with X uncommitted changes. [View diff] [Revert all]"
- Never auto-commit — always require human review after a crash

---

## 10. Design Decisions (Resolved)

| # | Decision | Answer | Impact |
|---|---|---|---|
| D1 | Light mode support? | **Yes** — design token system for dark + light from day one. Custom themes in v2+ | Phase 1 |
| D2 | File tree: fixed sidebar or Dockview pane? | **Fixed sidebar** — always present, outside Dockview. Toggle with `Cmd+B` | Phase 1 |
| D3 | Minimap in editor? | **Skip v1** — add community CodeMirror extension later | Phase 2 |
| D4 | Markdown preview: side-by-side or inline? | **Side-by-side** Dockview pane in v1 | Phase 2 |
| D4b | Markdown code block highlighting? | **highlight.js** (regex-based, 190+ langs, lightweight) for v1. May switch to **Shiki** (TextMate grammars, VS Code-grade accuracy) in v2+. No LSP interaction — code blocks are static snippets | Phase 2 |
| D5 | Agent permission defaults? | **Ask before destructive ops** — configurable via `.agentconfig` per workspace (v2) | Phase 5 |
| D6 | Update mechanism: silent or prompt? | **Prompt always** — compile-from-source only for MVP, `electron-updater` in v2 | Phase 6 |
| D7 | Crash telemetry: opt-in or none? | **Opt-in with explicit consent** | Phase 6 |
| D8 | macOS only to start? | **Yes** — macOS first, Linux second, Windows third | Phase 1 |

---

## 11. Open Questions

These need a decision before or during the relevant phase.

| # | Question | Phase | Notes |
|---|---|---|---|
| Q1 | **Auto-start LSP servers on workspace open, or lazy (on first file open)?** | 3 | Lazy is better UX — don't start Pyright until a .py file is opened |
| Q2 | **How to handle workspaces without a git repo?** | 4 | Hide git branch display, disable dirty indicators, show warning in file tree |
| Q3 | **Multiple browser panes per workspace?** | 3 | Dockview supports multiple panes of the same type — probably yes, each with own URL/session |
| Q4 | **Should the agent use the workspace's `persist:auth` session for GitHub API calls?** | 5 | Security consideration — the agent shouldn't have access to the user's GitHub token unless explicitly granted |
| Q5 | **Font bundling?** Include JetBrains Mono in the app bundle or rely on system fonts? | 2 | Bundling ensures consistent look on clean systems; adds ~2MB to app size |
| Q6 | **How to handle `.env` files in agent context?** | 5 | The agent shouldn't be able to read/exfiltrate `.env` files. Part of the broader agent permission system (v2 `.agentconfig`) |
| Q7 | **Linked workspace groups?** | v2+ | Related workspaces (frontend + backend) that share context: cross-workspace terminal, shared env references. Interesting concept — needs design |
| Q8 | **Agent project memory / context generation?** | v2+ | Auto-generate `project-summary.md`, track agent-seen files, surface unseen files for context priming. Design data model in v1 to not block this |
| Q9 | **Ghostty libghostty-vt WASM as xterm.js parser replacement?** | v2+ | Ghostty is open source (MIT/Zig). DIY WASM build is possible but heavy — needs system API stubs, JS bridge to xterm.js renderer, and ongoing fork maintenance. Wait for official WASM build unless xterm.js parsing causes real issues. See Terminal section notes |

---

## 12. Progress Tracker

Track milestone completion here. Update as you go.

### Phase 1: Skeleton (Weeks 1–3)
| Milestone | Status | Notes |
|---|---|---|
| 1.1 Project scaffolding | ✅ Complete | electron-vite + React 19 + TS, pnpm workspaces (main/renderer/shared), ESLint + Prettier + TS strict, electron-builder for macOS |
| 1.2 Electron shell | ✅ Complete | BaseWindow (frameless, hiddenInset), custom drag region, typed IPC channels, app menu with zoom/clipboard/fullscreen. safeStorage for API keys deferred to Phase 6.1 |
| 1.3 Theming system + React renderer | ✅ Complete | data-theme CSS variable system, one-dark + one-light themes, theme toggle persisted via electron-store, ThemeProvider + useTheme hook, AppShell layout (ribbon/sidebar/status bar), fullscreen-aware ribbon padding |
| 1.4 Dockview integration | ✅ Complete | Dockview 5.x wired into main content area (sidebar outside Dockview), theme CSS vars mapped to dockview tokens, default 3-pane layout (Editor/Terminal/Agent placeholders), compact tab styling with close button overrides |

### Phase 2: Core IDE Features (Weeks 4–7)
| Milestone | Status | Notes |
|---|---|---|
| 2.1 File tree (fixed sidebar) | 🟡 In progress | 2.1a complete: open folder dialog, read-only browsable tree, persisted workspace root + sidebar width. WindowApi centralized. 2.1b complete: @parcel/watcher (native C++ FSEvents, not chokidar) with debounced incremental tree updates, native ignore patterns (node_modules/.git/dist/build), error recovery with exponential backoff. File operations: createFile, createDir, delete, rename IPC handlers. Right-click context menu (New File, New Folder, Rename, Delete, Copy Path, Reveal in Finder). Inline rename input with validation. Cmd+B sidebar toggle via ShortcutManager. Deferred to 2.1c: @tanstack/react-virtual virtualization, git status badges (simple-git) |
| 2.2 CodeMirror 6 editor | 🟡 In progress | 2.2a complete: click-to-open files with syntax highlighting (JS/TS/Python/Markdown/JSON/CSS/HTML), readFile IPC with 10MB limit + binary rejection, EditorState cache preserving cursor/scroll across tab switches, theme hot-swap via Compartment, real line/col/language in status bar. 2.2b complete: writeFile IPC + Cmd+S save, dirty tracking with `•` tab indicator, indent guides (@replit/codemirror-indentation-markers), word wrap toggle (Cmd+Alt+W via Compartment), confirm-before-close for unsaved tabs (DockviewDefaultTab + closeActionOverride). Search (Cmd+F/H), code folding, bracket auto-close, multi-cursor all work via basicSetup. Deferred to 2.2c: minimap, breadcrumb nav |
| 2.3 Terminal (xterm.js + node-pty) | ✅ Complete | xterm.js 6 + node-pty in main process, UUID-multiplexed IPC (PTY_DATA_IN/OUT/RESIZE/KILL/EXIT), FitAddon + WebLinksAddon with appActions dispatch, ResizeObserver + debounced ptyResize, theme hot-swap, Cmd+Shift+T for new terminal tabs, destroyed-flag async safety pattern. Deferred: file path link detection, terminal search, session persistence, shell profiles |
| 2.4 Find in files + symbol search | ⬜ Not started | Bundled ripgrep |
| 2.5 Markdown preview | ✅ Complete | MarkdownPreviewPane in Dockview, marked v17 + DOMPurify + highlight.js (may switch to Shiki TextMate in future). Live preview via editorContentBus pub/sub. Cmd+Shift+V toggle. Toast notification on .md open. Auto-close on editor close. Theme-aware CSS with syntax token mapping |
| 2.6 Keyboard shortcut system | 🟡 In progress | 2.6a complete: centralized ShortcutManager singleton with platform-aware modifier normalization (Cmd/Ctrl), useShortcut React hook, capture-phase keydown listener. Shortcuts wired: Cmd+Shift+T (new terminal), Cmd+B (sidebar toggle), Cmd+W (close active panel). Deferred: Cmd+P quick open, Cmd+Shift+P command palette, Cmd+Shift+F find in files |

### Phase 3: LSP + Browser Pane (Weeks 8–10)
| Milestone | Status | Notes |
|---|---|---|
| 3.1 LSP infrastructure | ⬜ Not started | |
| 3.2 Pyright (Python) | ⬜ Not started | |
| 3.3 typescript-language-server | ⬜ Not started | |
| 3.4 Browser pane — auth sessions | ⬜ Not started | |
| 3.5 Browser pane — dev server preview | ⬜ Not started | |

### Phase 4: Workspace System (Weeks 11–13)
| Milestone | Status | Notes |
|---|---|---|
| 4.1 Workspace creation flow | ⬜ Not started | |
| 4.2 Workspace switching + state persistence | ⬜ Not started | |
| 4.3 Agent status in ribbon | ⬜ Not started | |
| 4.4 Workspace management UI | ⬜ Not started | |

### Phase 5: Agent Integration (Weeks 14–17)
| Milestone | Status | Notes |
|---|---|---|
| 5.1 Agent panel pane type | ⬜ Not started | |
| 5.2 Claude Agent SDK integration | ⬜ Not started | |
| 5.3 Diff preview before apply | ⬜ Not started | |
| 5.4 Agent edit highlighting in editor | ⬜ Not started | |
| 5.5 Crash recovery | ⬜ Not started | |

### Phase 6: Polish + Open Source Release (Weeks 18–21)
| Milestone | Status | Notes |
|---|---|---|
| 6.1 Settings system | ⬜ Not started | |
| 6.2 Quick open (`Cmd+P`) + command palette | ⬜ Not started | |
| 6.3 GitHub repository + CI | 🟡 In progress | electron-builder.yml configured for macOS (dmg+zip arm64+x64), Linux (AppImage+deb), Windows (nsis+zip). pnpm dist scripts added. GitHub Releases publish via `--publish always`. First alpha release: v0.1.0-alpha.1 |
| 6.4 Plugin system foundation | ⬜ Not started | |

**Status key:** ⬜ Not started · 🔵 In progress · ✅ Complete · ⏸ Blocked

---

## 13. Reference Links

### Architecture research
- [Is Forking VS Code a Good Idea? — EclipseSource](https://eclipsesource.com/blogs/2024/12/17/is-it-a-good-idea-to-fork-vs-code/)
- [Why Cursor and Windsurf fork VS Code but shouldn't — Eclipse Foundation](https://blogs.eclipse.org/post/thomas-froment/why-cursor-windsurf-and-co-fork-vs-code-shouldnt)
- [Cursor Background Agents documentation](https://docs.cursor.com/en/background-agent)
- [WebContentsView replacing BrowserView — Mamezou](https://developer.mamezou-tech.com/en/blogs/2024/03/06/electron-webcontentsview/)

### Core dependencies
- [Electron docs — session & partitions](https://www.electronjs.org/docs/latest/api/session)
- [Dockview documentation](https://dockview.dev/)
- [CodeMirror 6 documentation](https://codemirror.net/)
- [xterm.js documentation](https://xtermjs.org/)
- [typescript-language-server GitHub](https://github.com/typescript-language-server/typescript-language-server)
- [electron-store GitHub](https://github.com/sindresorhus/electron-store)
- [simple-git documentation](https://github.com/steveukx/git-js)

### Design reference
- [Atom One Dark UI — official variables](https://github.com/atom/one-dark-ui/blob/master/styles/ui-variables.less)
- [Atom One Dark syntax — GitHub](https://github.com/atom/one-dark-syntax)
- [@codemirror/theme-one-dark](https://www.npmjs.com/package/@codemirror/theme-one-dark)

### AI integration
- [Claude Agent SDK — Anthropic](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk)
- [Anthropic tool use documentation](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)
- [LSP + AI coding tools — February 2026](https://amirteymoori.com/lsp-language-server-protocol-ai-coding-tools/)

### Inspiration / prior art
- [CMUX — the terminal built for multitasking](https://cmux.com/)
- [Ghostty terminal documentation](https://ghostty.org/docs/about)
- [Tilectron — tiling browser in Electron](https://github.com/rhysd/Tilectron)
- [Plugin architecture for Electron apps — Beyond Code](https://beyondco.de/blog/plugin-system-for-electron-apps-part-1)

---

*This document is a living reference. Update the Progress Tracker as milestones complete. Add decisions to Open Questions as they arise. Revisit architecture decisions at the start of each phase.*
