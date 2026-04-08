# Custom AI-Integrated IDE — Build Plan

> **Project codename:** _aIDE_
> **Last updated:** April 2, 2026
> **Status:** Active development

---

## TODO

- Move worktree storage from `../.aide-worktrees/` to `<repoRoot>/.aide/worktrees/` (match Claude Code convention, add `.aide/` to `.gitignore`)
- Add `@` prefix in Quick Open (Cmd+P) to go to symbol, `:` prefix to go to line (VS Code-style)
- Clicking the line number indicator in the status bar should open the go-to-line command palette (`:` mode)
- Add a visual switcher overlay for MRU cycling (shows tab/pane list, highlights current selection during cycling session)

### MRU Cycling Sessions (Implemented)

`DockviewNavigation` now supports VS Code-style MRU cycling sessions for both pane and tab navigation:

- On first cycle keystroke: a session begins, the MRU order is frozen, and `recordActivation` is suppressed
- On subsequent keystrokes (while modifier held): the frozen MRU list is walked in order
- On modifier key-up (Ctrl/Alt/Meta): the selection is committed, `recordActivation` fires, and the session ends
- A global `keyup` listener is installed when cycling starts and removed when done

This replaces the previous toggle-most-recent behavior that could only ping-pong between the two most recent entries.

### Deferred V2: Pane/Tab Switcher Overlay

V2 should add a visual switcher overlay on top of the existing MRU cycling session mechanism.

Requirements:

- Holding the modifier should open a transient switcher overlay showing the frozen MRU list
- The overlay should highlight the currently selected entry as the user cycles
- Releasing the modifier should commit the selected target and close the overlay
- The overlay should show enough metadata to disambiguate duplicates: tab title, pane type/icon, and path when relevant

Implementation notes:

- The cycling session logic already exists in `DockviewNavigation` (`isCycling`, `endCyclingSession`). The overlay should consume this state.
- Suppress switcher activation while modal text inputs are focused, unless the focused surface explicitly opts in.
- Prefer a generic switcher primitive so the same mechanism can later power workspace MRU switching if desired.

### Command registration (renderer)

App-wide commands register once from `AppShell` on mount via `registerAppCommands` ([`packages/renderer/src/commands/registerAppCommands.ts`](../packages/renderer/src/commands/registerAppCommands.ts)); handlers read a ref updated each layout pass so state stays current. Handler implementations are split by domain under [`packages/renderer/src/commands/domains/`](../packages/renderer/src/commands/domains/). A `CommandContext` object is assigned each layout pass so commands read current workspace, Dockview, and UI state without duplicate `useCommand` registration or `window` `CustomEvent` indirection for internal actions. `useCommand` in [`CommandRegistry.ts`](../packages/renderer/src/commands/CommandRegistry.ts) is reserved for rare component-scoped commands. `KeybindingService`, `defaultKeybindings`, and `ContextKeys` live under the same `commands/` folder.

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

- [x] Infinitely nestable/resizable tiling panes — any pane can be an editor, terminal, browser, file tree, or agent panel
- [x] Workspace switcher ribbon with per-workspace agent status indicators + global zone (settings, notifications, cost dashboard)
- [ ] Keyboard shortcut workspace switching (`Cmd+1/2/3...`)
- [ ] Layout persistence — each workspace restores its exact pane arrangement on switch
- [ ] Persistent browser panes with real Google, GitHub, and Microsoft account sessions that survive workspace switches and app restarts
- [ ] Claude Code running in terminal panes, with agent status surfaced to the workspace tab
- [x] CodeMirror 6 editor with syntax highlighting for Python, JavaScript/TypeScript, and Markdown
- [x] Editor table-stakes: multi-cursor (`Cmd+D`, `Cmd+Click`), code folding, indent guides, word wrap toggle, bracket auto-close (including JSX)
- [ ] Find in files (`Cmd+Shift+F`) via bundled ripgrep, find/replace in current file (`@codemirror/search`), LSP symbol search (`workspace/symbol`)
- [x] Markdown preview pane (side-by-side: editor left, rendered HTML right via `marked`/`remark`)
- [ ] LSP integration: Pyright (Python) and typescript-language-server (JS/TS) as the first two language packs — installed individually, not bundled by default
- [x] Fixed left sidebar for file tree with dirty file indicators and git branch display (outside Dockview — always present)
- [x] Theming system designed for dark + light mode from day one — Atom One Dark as default, light mode as alternative, CSS variable token system supports custom themes in future
- [ ] Global command palette (`Cmd+Shift+P`) — cross-workspace search and global commands

### Nice-to-have (v2+)

- [x] Agent chat panel UI — Dockview `chatPane` with Ask/Edit/Agent modes, streaming message display, tool call approval cards, working set picker, markdown rendering with syntax highlighting
- [ ] Cursor-style agent panel UI (structured diffs, progress, pause/resume)
- [x] Claude Agent SDK integration (replacing raw Claude Code CLI subprocess spawning with `@anthropic-ai/claude-agent-sdk` `query()` async generator)
- [ ] Tailwind CSS IntelliSense (via tailwindcss-language-server)
- [x] Git worktree management — sidebar panel to create/remove/switch worktrees, file tree re-roots on worktree switch, terminal right-click to switch worktree cwd, auto-detect externally created worktrees
- [ ] Git integration UI (diff viewer, stage/unstage, commit)
- [ ] Multi-root workspace support (monorepos with separate backend/frontend LSP roots)
- [ ] Plugin system with npm-based distribution
- [ ] Broad language support — the goal is to support all languages via individually installable language packs. Use off-the-shelf LSP servers and linters where available; only build custom integrations when necessary. No language tooling installed by default — user installs what they need
- [ ] Chrome extension support (limited — see Known Hard Problems)
- [x] AI-powered inline diff review in editor (CodeMirror `@codemirror/merge` unified view with accept/reject, Cmd+Shift+D toggle, git HEAD comparison)
- [x] Agent permission system — three-tier (confirm/auto-approve/autopilot) with per-tool overrides and pattern matching for terminal commands. Settings UI in Agent > Permissions. Auto-approved tools show "auto" badge in chat.
- [ ] Workspace onboarding wizard — auto-detect project type, Python interpreter, `package.json` scripts, `CLAUDE.md`/`.agentconfig`, git remote, dev server command/port. Surface as a checklist of suggestions on first open
- [ ] Agent project memory — track which files agent has seen, maintain auto-generated `project-summary.md`, surface "unseen files" in agent panel for context priming
- [ ] Linked workspace groups — related workspaces (e.g. frontend + backend), cross-workspace terminal, shared env references
- [ ] Worktree color coding — assign a distinct accent color to each worktree and apply it to terminal tabs, editor tabs, and pane borders so it's immediately clear which worktree a tab belongs to (branch badge pills already implemented in 5.1e)
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

| Layer           | Choice                    | Why                                                                        |
| --------------- | ------------------------- | -------------------------------------------------------------------------- |
| Desktop shell   | **Electron 41+**          | WebContentsView, persist: sessions, UtilityProcess, modern Chromium        |
| UI framework    | **React 19 + TypeScript** | Component model maps well to pane system; community plugin authors know it |
| Build tool      | **Vite + electron-vite**  | Fast HMR in development, clean Electron integration                        |
| Package manager | **pnpm**                  | Workspace monorepo support, faster than npm                                |
| Packaging       | **electron-builder**      | macOS .dmg, Windows .msi, Linux .AppImage                                  |

### Editor

| Layer            | Choice                                     | Why                                                                                                                            |
| ---------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Editor component | **CodeMirror 6**                           | Modular, functional state model, lighter than Monaco (~300KB vs 5–10MB), first-class extension API designed for AI integration |
| LSP client       | **@codemirror/lsp-client**                 | Official package by CodeMirror author, covers completions/hover/go-to-def/rename                                               |
| One Dark theme   | **@codemirror/theme-one-dark**             | Official port of Atom One Dark                                                                                                 |
| Search in file   | **@codemirror/search**                     | Find/replace in current file, regex support                                                                                    |
| Markdown         | **@codemirror/lang-markdown**              | Syntax highlighting for `.md` files                                                                                            |
| Code folding     | **@codemirror/language** (foldGutter)      | Fold function bodies, classes, blocks                                                                                          |
| Indent guides    | **@replit/codemirror-indentation-markers** | Vertical lines showing block structure — handles mixed tabs/spaces and empty-line inheritance                                  |

### Search

| Layer         | Choice                                    | Why                                                                   |
| ------------- | ----------------------------------------- | --------------------------------------------------------------------- |
| Find in files | **@vscode/ripgrep** (bundled `rg` binary) | Same engine VS Code uses; fast, cross-platform, respects `.gitignore` |
| Symbol search | LSP `workspace/symbol`                    | Find function/class across codebase via language server               |

### Markdown preview

| Layer        | Choice                      | Why                                                  |
| ------------ | --------------------------- | ---------------------------------------------------- |
| Renderer     | **marked** or **remark**    | Parse markdown to HTML for preview pane              |
| Preview pane | React component in Dockview | Side-by-side with editor, live-updating on keystroke |

### Layout

| Layer            | Choice           | Why                                                                                                                     |
| ---------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Pane/dock system | **Dockview 5.x** | Zero-dependency, React-native, full serialization API for layout persistence, drag-and-drop, floating panels, zero deps |

### Terminal

| Layer             | Choice       | Why                                                                       |
| ----------------- | ------------ | ------------------------------------------------------------------------- |
| Terminal renderer | **xterm.js** | Battle-tested, used by VS Code; future upgrade path to libghostty-vt WASM |
| PTY bridge        | **node-pty** | Spawns real shell with PTY; required for Claude Code, vim, etc.           |

> **Future exploration: Ghostty WASM terminal upgrade (v2+)**
>
> Ghostty (MIT licensed, written in Zig) offers GPU-accelerated rendering, superior VT escape sequence parsing, full OpenType ligature support, and significantly faster throughput than xterm.js. Its parser is already separated as `libghostty-vt` within the repo, and Zig supports `wasm32-freestanding` as a compile target.
>
> **DIY WASM build is theoretically possible but non-trivial:** system API dependencies (memory, I/O) need stubs for WASM, a JS bridge between the WASM module and xterm.js's rendering pipeline would need to be built, Zig-to-WASM tooling is less mature than Rust's `wasm-pack` ecosystem, and maintaining a fork against upstream changes is ongoing work.
>
> **Recommendation:** Park this unless xterm.js parsing becomes a real pain point. If the Ghostty team ships an official WASM build of `libghostty-vt`, adopt it then for free.

### Language servers (individually installable — nothing bundled by default)

**Philosophy:** aIDE should eventually support all languages. Use off-the-shelf LSP servers where available. Language packs are installed individually by the user — no language tooling ships by default. If custom integrations are needed, they should be separate installable packages following the same pattern.

| Language                    | Server                          | Install                                             | Status                    |
| --------------------------- | ------------------------------- | --------------------------------------------------- | ------------------------- |
| Python                      | **pyright-langserver**          | `npm install pyright` (bundles the server)          | MVP (first language pack) |
| JavaScript/TypeScript       | **typescript-language-server**  | `npm install typescript-language-server typescript` | MVP (first language pack) |
| CSS/Tailwind                | **tailwindcss-language-server** | `npm install @tailwindcss/language-server`          | v2                        |
| Go                          | **gopls**                       | System install via `go install`                     | v2+                       |
| Rust                        | **rust-analyzer**               | System install via `rustup`                         | v2+                       |
| Ruby                        | **solargraph** or **ruby-lsp**  | `gem install`                                       | v2+                       |
| _Any LSP-compatible server_ | User-configured                 | Settings panel: path + args + file glob             | v2+ (generic LSP slot)    |

### AI integration

| Layer              | Choice                                                  | Why                                                                                                                 |
| ------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Agent backend      | **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) | Typed streaming via `query()` async generator, session resume, built-in tools. Replaces raw CLI subprocess spawning |
| API key management | Electron `safeStorage`                                  | Encrypts API key at rest using OS keychain                                                                          |

### State / persistence

| Layer            | Choice                         | Why                                                             |
| ---------------- | ------------------------------ | --------------------------------------------------------------- |
| Workspace state  | **electron-store**             | JSON persistence in userData, typed with TypeScript generics    |
| Layout state     | Dockview `api.toJSON()`        | Built-in; stored as a field in workspace state                  |
| Browser sessions | Electron `persist:` partitions | Stored in userData/Partitions/; survives restarts automatically |
| File watching    | **chokidar**                   | Cross-platform, efficient, powers the file tree dirty state     |

### File tree

| Layer        | Choice                      | Why                                                               |
| ------------ | --------------------------- | ----------------------------------------------------------------- |
| Virtual list | **@tanstack/react-virtual** | Handles large trees without DOM node bloat                        |
| Git status   | **simple-git**              | Node.js wrapper around git CLI; branch, dirty state, ahead/behind |

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
[data-theme='one-dark'] {
  /* Backgrounds */
  --bg-base: #282c34; /* editor background */
  --bg-elevated: #21252b; /* app shell, sidebar */
  --bg-sunken: #1a1d23; /* terminal, status bar */
  --bg-overlay: #1d2026; /* agent panel, secondary surfaces */
  --bg-active-tab: #282c34; /* active workspace tab */
  --bg-inactive-tab: #2c313a; /* inactive workspace tab */
  --bg-hover: #2c313a; /* hover states */
  --bg-selection: rgba(82, 139, 255, 0.15);

  /* Text */
  --text-primary: #abb2bf; /* default code/UI text */
  --text-secondary: #7f8694; /* inactive tabs, file tree dirs */
  --text-muted: #636d83; /* line numbers, hints, placeholders */
  --text-selected: #ffffff;

  /* Semantic text */
  --text-info: hsl(219, 79%, 66%); /* #6aa3f8 */
  --text-success: hsl(140, 44%, 62%); /* #98c379 */
  --text-warning: hsl(36, 60%, 72%); /* #e5c07b */
  --text-error: hsl(9, 100%, 64%); /* #e06c75 */

  /* Borders */
  --border-base: #181a1f;
  --border-subtle: #3e4452;

  /* Accent */
  --accent: #528bff;

  /* Syntax */
  --syntax-keyword: #c678dd; /* purple: import, const, return */
  --syntax-fn: #61afef; /* blue: function names */
  --syntax-string: #98c379; /* green: string literals */
  --syntax-number: #d19a66; /* orange: numbers */
  --syntax-comment: #5c6370; /* gray: comments */
  --syntax-tag: #e06c75; /* red: JSX tags */
  --syntax-attr: #528bff; /* blue: JSX attributes */
}
```

### Color tokens — Atom One Light (built-in alternative)

```css
[data-theme='one-light'] {
  /* Backgrounds */
  --bg-base: #fafafa;
  --bg-elevated: #eaeaeb;
  --bg-sunken: #f0f0f0;
  --bg-overlay: #e5e5e6;
  --bg-active-tab: #fafafa;
  --bg-inactive-tab: #eaeaeb;
  --bg-hover: #e0e0e1;
  --bg-selection: rgba(56, 113, 220, 0.12);

  /* Text */
  --text-primary: #383a42;
  --text-secondary: #696c77;
  --text-muted: #a0a1a7;
  --text-selected: #000000;

  /* Semantic text */
  --text-info: hsl(220, 100%, 45%); /* #0064d6 */
  --text-success: hsl(119, 34%, 40%); /* #50a14f */
  --text-warning: hsl(35, 84%, 44%); /* #c18401 */
  --text-error: hsl(5, 74%, 50%); /* #e45649 */

  /* Borders */
  --border-base: #d0d0d0;
  --border-subtle: #e0e0e0;

  /* Accent */
  --accent: #4078f2;

  /* Syntax */
  --syntax-keyword: #a626a4; /* purple */
  --syntax-fn: #4078f2; /* blue */
  --syntax-string: #50a14f; /* green */
  --syntax-number: #986801; /* orange */
  --syntax-comment: #a0a1a7; /* gray */
  --syntax-tag: #e45649; /* red */
  --syntax-attr: #986801; /* orange */
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

| Pane type  | Component               | Description                                             |
| ---------- | ----------------------- | ------------------------------------------------------- |
| `editor`   | CodeMirror 6            | Code editor; multiple files via tab bar within the pane |
| `terminal` | xterm.js + node-pty     | Shell instance; supports multiple terminal tabs         |
| `browser`  | WebContentsView overlay | Real Chromium browser with persistent session           |
| `filetree` | React virtual list      | Directory explorer for workspace root                   |
| `agent`    | Agent panel component   | Dashboard for active workspace agent                    |
| `preview`  | WebContentsView overlay | Dev server preview (localhost:PORT)                     |

**Creating splits:**

- Right-click any pane header → "Split right" / "Split down"
- Drag a tab to the edge of another pane to split
- `Cmd+\` splits current pane vertically
- `Cmd+Shift+\` splits current pane horizontally

**WebContentsView overlay positioning:**
Browser and preview panes are DOM placeholders in Dockview with a matching `WebContentsView` positioned as an overlay in the native window. On every Dockview `onDidLayoutChange` event:

```typescript
const bounds = paneElement.getBoundingClientRect()
webContentsView.setBounds({
  x: Math.round(bounds.x),
  y: Math.round(bounds.y),
  width: Math.round(bounds.width),
  height: Math.round(bounds.height),
})
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
const snapshot = dockviewApi.toJSON()
workspaceStore.set(`${workspaceId}.layout`, snapshot)

// Restore
const snapshot = workspaceStore.get(`${workspaceId}.layout`)
if (snapshot) {
  dockviewApi.fromJSON(snapshot)
} else {
  buildDefaultLayout(dockviewApi) // first open: editor + terminal
}
```

### 6.3 Browser Panes

**Session architecture:**

| Session key              | Purpose                                                        | Scope                        |
| ------------------------ | -------------------------------------------------------------- | ---------------------------- |
| `persist:auth`           | Google, GitHub, Microsoft accounts                             | Shared across ALL workspaces |
| `persist:workspace-{id}` | Dev server state, localhost cookies, workspace-specific logins | Per workspace                |

**Creating a browser pane:**

```typescript
const authSession = session.fromPartition('persist:auth')
const view = new WebContentsView({ webPreferences: { session: authSession } })
win.contentView.addChildView(view)
view.webContents.loadURL('https://github.com')
```

**On workspace switch:** call `view.setVisible(false)` for all views belonging to old workspace, then `view.setVisible(true)` for views belonging to new workspace, repositioning bounds.

**Navigation UI:** A minimal browser chrome is rendered as a React component in the main WebContentsView (not inside the WebContentsView overlay), positioned above the overlay's bounds. It communicates with the overlay via IPC:

- Back / Forward buttons
- URL bar (read/write via `view.webContents.getURL()` / `view.webContents.loadURL()`)
- Refresh button
- `will-navigate` and `did-navigate` events update the URL bar in real-time

**No Chrome extension support in v1.** Electron's `session.loadExtension()` does not support password manager APIs (`chrome.identity`, `chrome.action`, `chrome.storage.sync`). Plan to handle authentication by staying logged in via persistent sessions — don't promise Chrome extension support to users.

**Fullscreen browser toggle (`Cmd+R`):**
A keyboard shortcut (`Cmd+\``) expands the active browser/dev server pane to fill the entire app window (hiding sidebar, ribbon, other panes). Pressing it again restores the previous layout. This makes it easy to preview a web app at full size without leaving the IDE. Implementation: toggle between `view.setBounds(fullWindowBounds)`and the original Dockview-managed bounds. The browser chrome (URL bar, back/forward) stays visible as an overlay. State:`isFullscreenBrowser: boolean` on the workspace. Keyboard shortcut is user-configurable via the shortcut system.

### 6.4 Editor (CodeMirror 6)

**Extensions to configure at initialization:**

```typescript
import { EditorView, basicSetup } from 'codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import { python } from '@codemirror/lang-python'
import { javascript } from '@codemirror/lang-javascript'
import { lspClient } from '@codemirror/lsp-client'

const editor = new EditorView({
  extensions: [
    basicSetup, // line numbers, undo, bracket matching, etc.
    oneDark, // Atom One Dark theme
    python(), // syntax + fold for .py files
    javascript({ typescript: true }), // syntax + fold for .ts/.tsx/.js files
    lspClient(lspConnection), // LSP completions, diagnostics, hover
    // custom extensions:
    agentEditHighlight(), // highlight lines currently being edited by agent
    dirtyFileMarker(), // gutter indicator for unsaved changes
  ],
})
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
import { spawn } from 'child_process'

const pyright = spawn('pyright-langserver', ['--stdio'], {
  cwd: workspace.rootPath,
  env: { ...process.env, PYTHONPATH: workspace.rootPath },
})
```

Pyright understands virtual environments, type annotations (`mypy`-compatible), and third-party library stubs automatically.

**typescript-language-server for JS/TS:**

```typescript
const tsserver = spawn('typescript-language-server', ['--stdio'], {
  cwd: workspace.rootPath,
})
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
  working: /Analyzing|Reading|Writing|Editing|Running|Searching/i,
  waiting: />\s*$|What would you like/i,
  complete: /Task complete|Done\.|✓/i,
  error: /Error:|Failed:|✗/i,
}

terminalDataStream.subscribe((data: string) => {
  for (const [status, pattern] of Object.entries(CLAUDE_PATTERNS)) {
    if (pattern.test(data)) {
      updateWorkspaceAgentStatus(workspaceId, status)
      break
    }
  }
})
```

**Multiple terminals per workspace:**
Terminal pane supports tabs internally. One tab for the interactive shell, one for `claude`, one for running the dev server — all within one pane, switchable without losing state.

**Phase 2: Claude Agent SDK (programmatic)**

Replace raw terminal with structured integration:

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk'

const agentProcess = new UtilityProcess('./agent-worker.js', {
  env: { ANTHROPIC_API_KEY: getStoredApiKey() },
})

// In agent-worker.js:
for await (const event of query({
  prompt: userPrompt,
  options: { cwd: workspace.rootPath, maxTurns: 20 },
})) {
  process.parentPort.postMessage(event)
}
```

This enables the structured agent panel UI: file-by-file progress, diff previews before applying, pause/resume, and cost tracking.

### 6.7 Customizable Sidebar

**Architecture decision: Fixed left sidebar** (outside Dockview, always present). The sidebar is the navigation root — always accessible, never accidentally closable. This simplifies `WebContentsView` overlay positioning (overlays never overlap the sidebar).

**Icon rail + panel system:**
The sidebar has a VS Code-style icon rail on the far left. Each icon opens a corresponding panel. Default icons (top-to-bottom):

| Icon          | Panel               | Contents                                                                                                                                                        |
| ------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 📁 Folder     | **Explorer**        | File tree (see below) + git worktree list                                                                                                                       |
| 🔀 Git branch | **Source Control**  | Staging UI (stage/unstage hunks/files, commit message, commit button), git graph (commit history DAG), open PR list (fetch from GitHub API, show status checks) |
| 🧪 Beaker     | **Testing / Debug** | Test runner UI (discover + run tests, show pass/fail), debugger controls (breakpoints, call stack, variables)                                                   |

**Customization model:**

- Users can **reorder**, **add**, **remove**, or **replace** sidebar icons and their associated panels
- Each icon maps to a panel component (built-in or plugin-provided in v2+)
- Two layers of configuration:
  - **User default** — stored in global settings, applied when opening any new workspace that doesn't have its own config
  - **Workspace override** — stored per-workspace, overrides user default for that workspace only. Useful for project-specific panels (e.g. a monorepo might add a "Services" panel)
- Settings UI: drag-to-reorder icon list, toggle visibility, pick icon from a set, assign panel type
- Config shape (stored in settings / workspace config):

```typescript
SidebarConfig {
  icons: SidebarIconEntry[]  // ordered list
}

SidebarIconEntry {
  id: string           // e.g. 'explorer', 'source-control', 'testing'
  icon: string         // icon identifier (built-in set or custom SVG path)
  label: string        // tooltip / accessibility label
  panelType: string    // component key to render in the panel area
  enabled: boolean     // toggle visibility without removing
}
```

### 6.8 File Tree

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
import simpleGit from 'simple-git'
const git = simpleGit(workspace.rootPath)

// Poll every 2 seconds, or on file save
const status = await git.status()
// status.modified, status.staged, status.not_added, etc.
```

### 6.9 Search

**Find in files (`Cmd+Shift+F`):**
One of the most-used IDE features — especially critical for the AI workflow where you want to search for what the agent just wrote. Uses bundled ripgrep (`@vscode/ripgrep`) for speed and `.gitignore` awareness.

```typescript
import { rgPath } from '@vscode/ripgrep'
import { spawn } from 'child_process'

function searchFiles(query: string, rootPath: string, options?: SearchOptions) {
  const args = [
    '--json', // structured output for parsing
    '--max-count',
    '100', // limit results per file
    '--smart-case', // case-insensitive unless query has uppercase
  ]
  if (options?.regex) args.push('--pcre2')
  if (options?.glob) args.push('--glob', options.glob)
  args.push(query, rootPath)

  return spawn(rgPath, args)
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
  registerPaneType(id: string, component: React.ComponentType, config: PaneConfig): void
  // Register a language server
  registerLanguageServer(config: LSPServerConfig): void
  // Register keyboard shortcuts
  registerCommand(id: string, shortcut: string, handler: () => void): void
  // Read/write workspace-scoped storage
  storage: { get(key: string): unknown; set(key: string, value: unknown): void }
  // Subscribe to workspace events
  on(event: WorkspaceEvent, handler: (data: unknown) => void): void
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

- [x] **2.3** Terminal (xterm.js + node-pty)
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
  - Build `KeybindingService` — VS Code-style separated commands/keybindings with ordered rule dispatch, `when` context clauses, negative rules, and last-match-wins priority
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
  - Install `@anthropic-ai/claude-agent-sdk`
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

- [x] **6.1** Settings system
  - Settings panel skeleton (accessible via `Cmd+,`)
  - Two-scope UI: User (electron-store) and Workspace (.aide/settings.json)
  - Schema-driven: categories + descriptors, add new settings by appending to registry
  - Font size, font family, tab size, insert spaces, word wrap, format on save
  - Theme picker in Workbench > Appearance
  - Placeholder categories: Cursor, Minimap, Suggestions, Layout, Window, Terminal, Browser, Explorer, Extensions, Keyboard Shortcuts
  - Search bar filters settings by label/description/key
  - Modified indicators with per-setting reset-to-default
  - Keyboard shortcut customization: keybinding recorder, conflict detection, user overrides persisted to electron-store
  - Future: API key management (`safeStorage`), LSP server paths

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
  id: string // uuid v4
  name: string // display name
  rootPath: string // absolute path to project root
  icon?: string // emoji or color hex
  layout: SerializedDockviewLayout // from dockviewApi.toJSON()
  openTabs: Record<string, TabState> // paneId → tab state
  browserPanes: BrowserPaneState[]
  agentState: AgentState
  lspServers: LSPServerState[]
  gitBranch?: string
  createdAt: number // unix ms
  lastOpenedAt: number // unix ms
}

interface TabState {
  filePath: string
  scrollTop: number
  cursorOffset: number
  foldedRanges: [number, number][]
  isDirty: boolean
}

interface BrowserPaneState {
  paneId: string
  url: string
  sessionKey: 'auth' | string // 'auth' = shared, string = workspace-specific
}

interface AgentState {
  status: 'idle' | 'running' | 'waiting' | 'error' | 'complete'
  currentTask?: string
  conversationHistory?: MessageParam[] // Anthropic SDK type
  filesModified: string[]
  lastActivityAt?: number
}

interface LSPServerState {
  language: 'python' | 'typescript' | 'javascript'
  pid?: number
  status: 'stopped' | 'starting' | 'running' | 'suspended'
  rootPath: string
}
```

### App-level state (electron-store schema)

```typescript
interface AppState {
  workspaces: Record<string, Workspace> // id → Workspace
  workspaceOrder: string[] // ordered list of workspace ids
  activeWorkspaceId: string | null
  settings: AppSettings
}

interface AppSettings {
  fontSize: number // default: 13
  fontFamily: string // default: 'JetBrains Mono'
  tabSize: number // default: 2
  apiKeyEncrypted?: string // safeStorage encrypted
  theme: 'one-dark' | 'one-light' // custom themes in v2+
  shortcuts: Record<string, string> // command id → key combo
}
```

---

## 9. Known Hard Problems

### 9.1 WebContentsView overlay positioning

**Problem:** `WebContentsView` is a native Chromium layer positioned in OS pixel coordinates relative to the window. Dockview manages pane positions in CSS/DOM coordinates. They're in different coordinate systems, and high-DPI displays (Retina) add a device pixel ratio multiplier.

**Solution approach:**

```typescript
const dpr = window.devicePixelRatio // typically 2.0 on Retina
const rect = paneElement.getBoundingClientRect()

// getBoundingClientRect() returns CSS pixels (logical)
// setBounds() expects physical pixels on some platforms
// Test per platform — on macOS with electron, logical pixels work directly
view.setBounds({
  x: Math.round(rect.x),
  y: Math.round(rect.y + RIBBON_HEIGHT + TABBAR_HEIGHT),
  width: Math.round(rect.width),
  height: Math.round(rect.height),
})
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
    api.fromJSON(saved as SerializedDockview)
  } catch (e) {
    console.error('Layout restore failed, using default:', e)
    buildDefaultLayout(api)
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

| #   | Decision                                   | Answer                                                                                                                                                                                           | Impact  |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| D1  | Light mode support?                        | **Yes** — design token system for dark + light from day one. Custom themes in v2+                                                                                                                | Phase 1 |
| D2  | File tree: fixed sidebar or Dockview pane? | **Fixed sidebar** — always present, outside Dockview. Toggle with `Cmd+B`                                                                                                                        | Phase 1 |
| D3  | Minimap in editor?                         | **Skip v1** — add community CodeMirror extension later                                                                                                                                           | Phase 2 |
| D4  | Markdown preview: side-by-side or inline?  | **Side-by-side** Dockview pane in v1                                                                                                                                                             | Phase 2 |
| D4b | Markdown code block highlighting?          | **highlight.js** (regex-based, 190+ langs, lightweight) for v1. May switch to **Shiki** (TextMate grammars, VS Code-grade accuracy) in v2+. No LSP interaction — code blocks are static snippets | Phase 2 |
| D5  | Agent permission defaults?                 | **Ask before destructive ops** — configurable via `.agentconfig` per workspace (v2)                                                                                                              | Phase 5 |
| D6  | Update mechanism: silent or prompt?        | **Prompt always** — compile-from-source only for MVP, `electron-updater` in v2                                                                                                                   | Phase 6 |
| D7  | Crash telemetry: opt-in or none?           | **Opt-in with explicit consent**                                                                                                                                                                 | Phase 6 |
| D8  | macOS only to start?                       | **Yes** — macOS first, Linux second, Windows third                                                                                                                                               | Phase 1 |

---

## 11. Open Questions

These need a decision before or during the relevant phase.

| #   | Question                                                                              | Phase | Notes                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q1  | **Auto-start LSP servers on workspace open, or lazy (on first file open)?**           | 3     | Lazy is better UX — don't start Pyright until a .py file is opened                                                                                                                                                                                                 |
| Q2  | **How to handle workspaces without a git repo?**                                      | 4     | Hide git branch display, disable dirty indicators, show warning in file tree                                                                                                                                                                                       |
| Q3  | **Multiple browser panes per workspace?**                                             | 3     | Dockview supports multiple panes of the same type — probably yes, each with own URL/session                                                                                                                                                                        |
| Q4  | **Should the agent use the workspace's `persist:auth` session for GitHub API calls?** | 5     | Security consideration — the agent shouldn't have access to the user's GitHub token unless explicitly granted                                                                                                                                                      |
| Q5  | **Font bundling?** Include JetBrains Mono in the app bundle or rely on system fonts?  | 2     | Bundling ensures consistent look on clean systems; adds ~2MB to app size                                                                                                                                                                                           |
| Q6  | **How to handle `.env` files in agent context?**                                      | 5     | The agent shouldn't be able to read/exfiltrate `.env` files. Part of the broader agent permission system (v2 `.agentconfig`)                                                                                                                                       |
| Q7  | **Linked workspace groups?**                                                          | v2+   | Related workspaces (frontend + backend) that share context: cross-workspace terminal, shared env references. Interesting concept — needs design                                                                                                                    |
| Q8  | **Agent project memory / context generation?**                                        | v2+   | Auto-generate `project-summary.md`, track agent-seen files, surface unseen files for context priming. Design data model in v1 to not block this                                                                                                                    |
| Q9  | **Ghostty libghostty-vt WASM as xterm.js parser replacement?**                        | v2+   | Ghostty is open source (MIT/Zig). DIY WASM build is possible but heavy — needs system API stubs, JS bridge to xterm.js renderer, and ongoing fork maintenance. Wait for official WASM build unless xterm.js parsing causes real issues. See Terminal section notes |
| Q10 | ~~**Best keybinding for fullscreen browser toggle?**~~                                | 3     | **Resolved:** `Cmd+\`` — no common IDE conflicts, has a natural "toggle/switch" feel consistent with macOS `Cmd+\`` window cycling                                                                                                                                 |
| Q11 | **Source Control panel: embed git graph or link to a Dockview pane?**                 | v2+   | Git graph (commit DAG) can get complex. Options: simplified inline graph in sidebar, or clicking "Git Graph" opens a full Dockview pane. Sidebar space is limited — lean toward a summary view in sidebar + full pane for detail                                   |
| Q12 | **PR list data source: GitHub API only, or also GitLab/Bitbucket?**                   | v2+   | Start with GitHub (octokit). Abstract behind a provider interface so other forges can be added via plugins                                                                                                                                                         |

---

## 12. Progress Tracker

Track milestone completion here. Update as you go.

**2026-03-29:** Built-in chat — `useChat` refreshes after `CHAT_STREAM_END` and tool-call IPC now call `chatGetHistory(workspaceId, sessionId)` so history stays scoped to the active tab; avoids main falling back to `getMostRecent` (multi-tab isolation + pre-persist race).

**2026-04-08:** Pane focus handoff fix — `EditorPane` and `TerminalPane` now move DOM focus into CodeMirror/xterm when a Dockview panel becomes active and also when a newly-created panel finishes mounting while already active. This fixes keyboard pane/tab switching paths that selected a panel without moving the caret into the target surface.

### Phase 1: Skeleton (Weeks 1–3)

| Milestone                           | Status      | Notes                                                                                                                                                                                                                       |
| ----------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 Project scaffolding             | ✅ Complete | electron-vite + React 19 + TS, pnpm workspaces (main/renderer/shared), ESLint + Prettier + TS strict, electron-builder for macOS                                                                                            |
| 1.2 Electron shell                  | ✅ Complete | BaseWindow (frameless, hiddenInset), custom drag region, typed IPC channels, app menu with zoom/clipboard/fullscreen. safeStorage for API keys deferred to Phase 6.1                                                        |
| 1.3 Theming system + React renderer | ✅ Complete | data-theme CSS variable system, one-dark + one-light themes, theme toggle persisted via electron-store, ThemeProvider + useTheme hook, AppShell layout (ribbon/sidebar/status bar), fullscreen-aware ribbon padding         |
| 1.4 Dockview integration            | ✅ Complete | Dockview 5.x wired into main content area (sidebar outside Dockview), theme CSS vars mapped to dockview tokens, default 3-pane layout (Editor/Terminal/Agent placeholders), compact tab styling with close button overrides |

### Phase 2: Core IDE Features (Weeks 4–7)

| Milestone                          | Status         | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 File tree (fixed sidebar)      | 🟡 In progress | 2.1a complete: open folder dialog, read-only browsable tree, persisted workspace root + sidebar width. WindowApi centralized. 2.1b complete: @parcel/watcher (native C++ FSEvents, not chokidar) with debounced incremental tree updates, native ignore patterns (node_modules/.git/dist/build), error recovery with exponential backoff. File operations: createFile, createDir, delete, rename IPC handlers. Right-click context menu (New File, New Folder, Rename, Delete, Copy Path, Reveal in Finder). Inline rename input with validation. Cmd+B sidebar toggle via ShortcutManager. 2.1c complete: simple-git status polling (3s interval) with per-file badges (M/A/U/D) and directory-level dirty dots, current branch display in StatusBar, case-insensitive file tree filter with ancestor path preservation. 2.1d complete: @tanstack/react-virtual virtualization (22px fixed rows, 15-item overscan, memoized DFS into VirtualRow[] union type), Seti-style file-type icons (~30 file types + ~15 special folders with color-coded SVGs), gitignored file dimming via `git ls-files --others --ignored --exclude-standard --directory` (0.4 opacity + italic). 2.1e complete: file watcher rewritten from single-root to scoped multi-root system — `activeScopes: Map<scopeId, { roots, watchers }>` replaces single `activeWatcher`. Events tagged with `scopeId` field on `FsWatchEvent`. Nested-root deduplication prevents duplicate events. Currently uses `'default'` scope; designed for Phase 4 cross-workspace watching where each workspace gets its own scope. 2.1f complete: file tree filter now searches the entire file tree (including collapsed directories) via `listAllFiles` IPC, displaying matching files as a flat list with relative paths and file-type icons. Cached file list invalidated on fs watch events. Deferred: drag files between directories |
| 2.2 CodeMirror 6 editor            | 🟡 In progress | 2.2a complete: click-to-open files with syntax highlighting (JS/TS/Python/Markdown/JSON/CSS/HTML), readFile IPC with 10MB limit + binary rejection, EditorState cache preserving cursor/scroll across tab switches, theme hot-swap via Compartment, real line/col/language in status bar. 2.2b complete: writeFile IPC + Cmd+S save, dirty tracking with `•` tab indicator, indent guides (@replit/codemirror-indentation-markers), word wrap toggle (Cmd+Alt+W via Compartment), confirm-before-close for unsaved tabs (DockviewDefaultTab + closeActionOverride). Search (Cmd+F/H), code folding, bracket auto-close, multi-cursor all work via basicSetup. 2.2c complete: EditorPane subscribes to `onFsWatchEvent` for external change detection — clean files auto-reload silently, dirty files show toast with "Reload" button, deleted files show deletion toast and mark dirty. `isReloadingRef` guard prevents self-triggered dirty state during programmatic reloads. Content comparison against `cleanContentMap` prevents spurious reloads after save. **Bug fix**: File reopen loading bug (#18) — reopening a closed tab no longer gets stuck on 'loading'. Root cause: cached EditorState was reused wholesale on reopen, carrying stale extension closures (referencing old component refs) and accumulating duplicate compartment entries via `appendConfig`. Fix: always create fresh EditorState with fresh extensions on reopen, only restore cursor position from cache; cache entries are now consumed (removed) on retrieval; `init()` wrapped in `.catch()` to guarantee `setLoading(false)` on any unexpected error. Deferred to 2.2d: minimap, breadcrumb nav                                                                                                                                                                                                           |
| 2.3 Terminal (xterm.js + node-pty) | ✅ Complete    | xterm.js 6 + node-pty in main process, UUID-multiplexed IPC (PTY_DATA_IN/OUT/RESIZE/KILL/EXIT), FitAddon + WebLinksAddon with appActions dispatch, ResizeObserver + debounced ptyResize, theme hot-swap, Cmd+Shift+T for new terminal tabs, destroyed-flag async safety pattern. Deferred: file path link detection, terminal search, session persistence, shell profiles                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2.4 Find in files + symbol search  | 🟡 In progress | 2.4a complete: FindInFilesPane Dockview pane with bundled @vscode/ripgrep, streaming JSON results via IPC (SEARCH_START/RESULTS/COMPLETE/CANCEL/REPLACE), toggle buttons (regex/case/whole-word/file-glob), results grouped by file with match highlighting, click-to-jump opens file at line/column, single/per-file/global replace mode. Deferred: symbol search (requires LSP in Phase 3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2.5 Markdown preview               | ✅ Complete    | MarkdownPreviewPane in Dockview, marked v17 + DOMPurify + highlight.js (may switch to Shiki TextMate in future). Live preview via editorContentBus pub/sub. Cmd+Shift+V toggle. Toast notification on .md open. Auto-close on editor close. Theme-aware CSS with syntax token mapping                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2.6 Keyboard shortcut system       | ✅ Complete    | 2.6a complete: centralized ShortcutManager singleton with platform-aware modifier normalization (Cmd/Ctrl), useShortcut React hook, capture-phase keydown listener. 2.6b complete: CommandRegistry (single source of truth for all IDE commands), ContextKeys system (boolean when-clause evaluation), chord shortcut support (Cmd+K Cmd+S style), conflict detection with console.warn, useCommand hook. All existing shortcuts migrated to command registry. New shortcuts: Cmd+Shift+P (command palette), Cmd+P (quick open), Cmd+Shift+F (find in files), Cmd+\\ (split vertical), Cmd+Shift+\\ (split horizontal). Placeholder commands: Cmd+1-9 (workspace switching), Cmd+Shift+[/] (tab cycling), Cmd+T (symbol search). **2.6c complete:** When-aware shortcut dispatch — ShortcutManager evaluates `when` clauses before firing, allowing same keybinding with different contexts (e.g., F3 in editor vs terminal). Keyboard Shortcuts manager in Settings: VS Code-style table with Command/Keybinding/When/Source columns, inline KeybindingRecorder with chord support and conflict warnings, user overrides persisted via IPC in electron-store, `useKeybindingOverrides` hook for load/set/reset/apply lifecycle. **Bug fix:** recording-mode flag in KeybindingService suppresses global shortcut dispatch while KeybindingRecorder is active (fixes #26)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2.7 Git worktree management        | ✅ Complete    | Sidebar refactored into collapsible SidebarSection components. Worktree panel lists all repo worktrees with branch name, dirty badge, main label. Create worktree modal (new or existing branch, base branch picker). Worktrees stored at `../.aide-worktrees/<branch>/`. File tree re-roots on worktree switch. Terminal right-click context menu for worktree switching. Auto-detect external worktrees via 5s polling of `git worktree list --porcelain`. Backend: `worktreeManager.ts` follows gitStatus.ts pattern. New IPC channels: WORKTREE_LIST/CREATE/REMOVE/SET_ACTIVE/GET_ACTIVE/LIST_CHANGED/LIST_BRANCHES. **UX polish pass**: VS Code-style 2px accent left-border for active item, 30px item height, inline hover action buttons (terminal + more), "M" letter badge for dirty status with pulse animation, context menu icons, segmented toggle in create modal replacing checkbox, CSS spinner + success flash on submit, entry slide-in animations for new worktrees, empty state guidance, list-integrated add button. **Worktree file watcher fix**: switching worktrees now watches both repo root and active worktree simultaneously via `startWatchers('default', [repoRoot, worktreePath])` — changes in either root are detected and surfaced to the editor. Deferred: cross-worktree diff, agent panel integration, git graph sidebar section                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

### Phase 3: LSP + Browser Pane (Weeks 8–10)

| Milestone                             | Status         | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 LSP infrastructure                | ⬜ Not started |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 3.2 Pyright (Python)                  | ⬜ Not started |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 3.3 typescript-language-server        | ⬜ Not started |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 3.4 Browser pane — auth sessions      | ⬜ Not started |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 3.5 Browser pane — dev server preview | ⬜ Not started |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 3.6 Per-panel zoom                    | ✅ Complete    | Shared `@aide/shared` zoom helpers (`adjustZoomFactor`, `clampZoomFactor`, `resetZoomFactor`, `zoomFactorToPercent`) with 0.5×–2× range. Menu-bar Cmd+=/Cmd+-/Cmd+0 zooms the active Dockview panel via `APP_ZOOM_COMMAND` IPC. Editor & terminal panes scale font size (base 13px × zoom factor) via CodeMirror `editorMetricsCompartment` and xterm.js `fontSize` option. Browser panes zoom via native `webContents.setZoomFactor()` with toolbar ±/readout controls and `BROWSER_ZOOM_GET/SET/ADJUST` IPC. CSS-based panes (welcome, find-in-files, markdown preview, placeholder) use `--panel-zoom` CSS variable with `calc()` font scaling. Zoom state persisted per-panel in Dockview params and workspace runtime snapshots. |

### Phase 4: Workspace System (Weeks 11–13)

| Milestone                                                         | Status      | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.0a .aide folder infrastructure                                  | ✅ Complete | `aideInit.ts`, `settingsResolver.ts`, project type detection, settings cascade                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 4.0b Gitignore security audit                                     | ✅ Complete | `gitignoreAudit.ts`, review modal, command palette command, toast flow                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 4.0c Task system                                                  | ✅ Complete | `taskRunner.ts`, `taskVariableResolver.ts`, `problemMatcher.ts`, `taskAutoDetect.ts`, `useTasks` hook, `TaskInputModal`, status bar indicator, command palette commands                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 4.0d Task runner parity (Phase 1)                                 | ✅ Complete | `runOn.workspaceOpen` auto-triggers, `runOn.fileSave` triggers from editor Cmd-S, `presentation.panel` terminal routing (shared/dedicated/new), editor context variables (`${file}`, `${selectedText}`, `${lineNumber}`), Problems pane (`ProblemsPane.tsx`), singleton task guards, trigger result toasts, diagnostics clear-on-rerun/workspace-switch                                                                                                                                                                                                                                                                                |
| 4.0e Workspace runtime boundary                                   | ✅ Complete | `WorkspaceRuntime` owns per-workspace task runner, agents, conversation store, native session watcher. `WorkspaceRuntimeRegistry` supervises focus/background. Phase 3 (2026-04-02): FS watchers, git polling, and worktree polling start/stop with each runtime via `startRuntimeServices` / `stopRuntimeServices` (per-`workspaceId` scopes/maps). Active worktree paths are keyed by workspace in `worktreeManager.ts`, not reset on every switch.                                                                                                                                                                                  |
| 4.0f Workspace-scoped main→renderer IPC (multi-work Phase 2)      | ✅ Complete | Runtime broadcasts are workspace-addressable: shared payloads carry `workspaceId` (or envelopes) for chat/CLI streams, tasks, git status/branch, worktree list, FS watch, search batches/completion, gitignore audit, PTY data/exit (`PtyDataOutPayload` / `PtyExitPayload` single-object IPC), and related `WindowApi` / preload wiring. Renderer hooks and panes filter or route by `workspaceId` so background workspaces do not corrupt the focused shell’s state. See `docs/multiwork.md` Phase 2. Verified 2026-04-02: `pnpm exec tsc` clean on shared/main/renderer.                                                            |
| 4.0g Multi-work Phase 3 (long-lived services per runtime)         | ✅ Complete | Built-in/CLI chat and conversation mutations resolve runtime by session or explicit `workspaceId`. Task control plane IPC is workspace-keyed. `GIT_STATUS`, worktree list/create/remove/set-active/get-active/branches, and multi-workspace concurrent git/worktree polling. See `docs/multiwork.md` Phase 3.                                                                                                                                                                                                                                                                                                                          |
| 4.0h Multi-work Phase 4 (global runtime notifications)            | ✅ Complete | Ribbon inbox bell (`RuntimeInboxBell`): pending built-in tool approvals + recent activity; `approvalInboxStore` / `runtimeActivityStore`; `useRuntimeGlobalNotifications` wires `onChatToolCall`, `onChatStreamEnd`, `onCliAgentResult`, `onTaskStatusChanged` for all workspaces with background toasts; IPC `CHAT_PENDING_TOOL_APPROVALS_LIST` + `AgentManager.listPendingToolApprovals` + `onWorkloadChanged` → `refreshWorkload` on approval wait; `WorkspaceRuntimeRegistry` uses `blocked` background state when `pendingApproval` / `pendingUserInput`; ribbon dot shows `blocked` vs running. See `docs/multiwork.md` Phase 4. |
| 4.0i Multi-work Phase 5 (document sessions)                       | ✅ Complete | Workspace-scoped `documentStore.ts`: clean baseline, working copy, selection, `diskChangedWhileDirty`. `EditorPane` hydrates from the store and persists edits; `workspaceStateSerializer` fills `TabState.dirtyContent`, `cleanBaseline`, `selection`, conflict flag; `workspaceSwitcher` loads target `openTabs` into the store before `fromJSON`, drops `clearAllDirty`, keeps LRU editor cache clear only. Unsaved buffers survive workspace switches without disk reload. See `docs/multiwork.md` Phase 5.                                                                                                                        |
| 4.0j Multi-work Phase 6 (per-workspace worktree + effective root) | ✅ Complete | `activeWorktreePath` on `AideLocalState` (disk + in-memory snapshots); `startRuntimeServices` hydrates `worktreeManager` from `loadWorkspaceState` before watchers; `workspaceSwitcher` calls `setActiveWorktree` when restoring. `effectiveWorkspaceRoot.ts`; `WorkspaceRuntime.getEffectiveRoot()`; task run context uses effective root for cwd / `${workspaceRoot}`; `findByFilePath` matches paths under the active worktree outside repo prefix; PTY default cwd via workspace effective root; `getWorkspaceRoot(workspaceId?)` IPC returns effective tree. See `docs/multiwork.md` Phase 6.                                     |
| 4.0k Multi-work Phase 7 (tasks as workspace workloads)            | ✅ Complete | IPC `TASK_LIST_RUNNING` + `listRunningTasks` hydrates `useTasks` when switching workspaces (fixes stale running list). `taskInputInboxStore` + global `onTaskRequestInput` bridge in `AppShell`; background toasts with workspace switch in `useRuntimeGlobalNotifications`. Agent builtin `run_workspace_task` wires `AgentManager` → same `TaskRunner` as the UI (`runWorkspaceTask` opt). Tests: `useTasks.test.tsx`, `runWorkspaceTaskTool.test.ts`. See `docs/multiwork.md` Phase 7.                                                                                                                                              |
| 4.0l Multi-work Phase 8 (cleanup + policy)                        | ✅ Complete | Documented lifecycle: focus vs dispose, v1 suspension semantics (background keeps services; `asleep`+stopped only after dispose), quit/crash/`--clean` behavior, global-vs-runtime resource table, narrow IPC active-workspace fallback rules. Code pointers: `workspaceRootResolution.ts`, `mainIpcWorkspaceFallbackPolicy.test.ts`, `mainElectronStorePolicy.test.ts`. See `docs/multiwork.md` Phase 8 policy section.                                                                                                                                                                                                               |
| 4.1 Workspace creation flow                                       | ✅ Complete | `workspaceRegistry.ts`, `useWorkspaces` hook, ribbon tabs, context menu, Cmd+1-9/Cmd+Shift+[/] switching                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 4.2 Workspace switching + state persistence                       | ✅ Complete | `stateSerializer.ts`, `workspaceStateSerializer.ts`, `workspaceSwitcher.ts`, 30s auto-save, atomic writes, worktree sync fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 4.3 Agent status in ribbon                                        | ✅ Complete | `WorkspaceRuntimeSnapshot` workload + state drive per-tab `AgentStatusDot` (idle / running / blocked / error); tooltips; Phase 4 global inbox for approvals without a mounted chat pane.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 4.4 Workspace management UI                                       | ✅ Complete | Close workspace (Cmd+Shift+W, tab × button, middle-click, context menu), blank workspace (Cmd+Shift+N, + button), open folder in blank workspace (Cmd+O), welcome pane with shortcut hints, proper empty state on last workspace close                                                                                                                                                                                                                                                                                                                                                                                                 |
| 4.5 App lifecycle (Phase E)                                       | ✅ Complete | Session restore, graceful quit with async save, crash recovery toast, `--clean` flag, welcome tab on empty session                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### Phase 5: Agent Integration (Weeks 14–17)

| Milestone                               | Status         | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.0a Types + IPC plumbing               | ✅ Complete    | `agentTypes.ts` (16 types), 14 IPC channels (10 chat + 4 MCP), WindowApi methods, preload bridge. 17 tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 5.0b LLM client                         | ✅ Complete    | Provider-agnostic `LlmClient` with adapter pattern. `AnthropicProvider` + `OpenAiCompatibleProvider` (covers OpenAI/Ollama/Together/Groq). Shared SSE parser, `${env:VAR}` key interpolation, AbortController cancellation. 78 tests total.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 5.0c Built-in tools + registry          | ✅ Complete    | 9 built-in tools (`file_read`, `file_write`, `file_list`, `terminal_exec`, `run_workspace_task`, `search_files`, `git_status`, `git_diff`, `browser_read`) with JSON Schema inputs and direct main-process executors. `ToolRegistry` class with mode filtering, LLM-ready conversion, dynamic MCP tool registration/unregistration. `BrowserPaneManager.getPageContent()` added. 53 new tests (agentTools + toolRegistry).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 5.0d Agent loop                         | ✅ Complete    | `AgentManager` class — core agent loop: session management, prompt assembly (system + conversation history + mode context), LLM streaming via `LlmClient`, tool execution with Promise-based approval gates, retry tracking (5 per tool), configurable turn limits (default 25), chat persistence to `.aide/local/chat.json` via atomic writes. IPC handlers for all 7 `CHAT_*` channels wired in `index.ts`. Lifecycle integrated with `activateWorkspace`/`finishQuit`. "Confirm everything" permission tier. 20 new tests.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 5.1 Agent panel pane type               | ✅ Complete    | `ChatPane` + `CliAgentPane` dockview panel types. Both accept optional `conversationId` param for loading specific conversations. Tabs auto-title from conversation metadata.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 5.1b Conversation history system        | ✅ Complete    | `ConversationStore` persists conversation metadata and messages under `.aide/local/conversations/`. `conversationTypes.ts` defines `ConversationMeta`, `ConversationCreateOpts`, `ConversationListChangedPayload`. 6 new IPC channels (`conversation:list/create/delete/rename/get/list-changed`). Both `AgentManager` and `CliAgentManager` integrated: multi-conversation support (removed single `workspaceSessions` map), `conversationId`-aware `getHistory`/`start`, auto-titling from first user message via `deriveTitle`, async `destroy()` with session persistence. `ChatHistoryPane` + `useConversationHistory` hook for browsing history. `useChat`/`useCliAgent` expose `conversationTitle` with live updates via `onConversationListChanged`. Command `agent.history.open` injects `onOpenConversation` so clicking a conversation opens `chatPane` or `cliAgentPane` with `conversationId` (and native/CLI backends routed to `cliAgentPane`). |
| 5.1c CLI native session hydration       | ✅ Complete    | `ClaudeNativeSessionWatcher.loadMessages(sessionId)` reads `~/.claude/projects/<slug>/<sessionId>.jsonl`, skips sidechains / thinking / file-history blocks, and maps rows to `CliAgentMessage[]`. IPC `cli-agent:load-messages` takes `(workspaceId, conversationId)`, returns `[]` when that workspace is not active (avoids native-prefix reads against the wrong project dir), and `useCliAgent` uses a hydrate generation guard, avoids clobbering a non-empty transcript with a stale empty IPC result, clears transcript only when the workspace+conversation key changes, and re-fetches native history once when `CONVERSATION_LIST_CHANGED` reports a `claude-native` row with messages but the pane is still empty. `CliAgentPane` waits on `historyHydrated`. Aide-managed sessions use `ConversationStore.loadMessages`. `CliAgentManager.start` sets `claudeSessionId` from `claude-native:<uuid>` for `--resume`.                               |
| 5.1d CLI multi-tab isolation            | ✅ Complete    | New `cliAgentPane` instances receive a provisional `conversationId` (`crypto.randomUUID()` from `agent.open` and default workspace layout in `workspaceSwitcher`). `useCliAgent` stops calling `cliAgentGetSession(workspaceId)` without a session id so tabs are not hydrated from `CliAgentManager.getSession`'s first in-memory match for the workspace. Command `agent.open` (e.g. Cmd+K Cmd+A) always adds a new agent panel for parallel work instead of focusing an existing tab.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 5.1e Multi-worktree agent orchestration | ✅ Complete    | Per-panel worktree isolation: `worktreePath` threaded through `CliAgentManager.start()` → spawn `cwd`, `CliAgentSession`, IPC, `useCliAgent` hook, `CliAgentPane` params. `AgentTab` custom tab component with branch badge pill (registered in `DockviewContainer.tabComponents`). "Start Agent in Worktree" button + context menu entry in `WorktreePanel`/`WorktreeItem`. Built-in agent isolation via `ToolContext.effectiveRoot` in `agentTools.ts` (terminal_exec, search_files, git_status, git_diff). `ChatSession.worktreePath` loaded from `ConversationMeta`. Worktree removal confirmation guard. Terminal panels from worktrees also get branch badges.                                                                                                                                                                                                                                                                                           |
| 5.2 Claude Agent SDK integration        | ✅ Complete    | `CliAgentManager` streams Claude responses via `@anthropic-ai/claude-agent-sdk` `query()`, persists/resumes sessions, and now resolves the packaged executable from the SDK's own unpacked `cli.js` before falling back to the legacy `@anthropic-ai/claude-code` path. This fixes packaged-app startup failures caused by stale Claude Code path resolution. OpenCode/Codex SDK integration remains future work.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 5.3 Diff preview before apply           | ⬜ Not started |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 5.4 Agent edit highlighting in editor   | ⬜ Not started |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 5.5 Crash recovery                      | ⬜ Not started |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

### Phase 6: Polish + Open Source Release (Weeks 18–21)

| Milestone                                  | Status         | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| 6.1 Settings system                        | ✅ Complete    | Settings panel skeleton (Cmd+,). Two-scope UI (User/Workspace) with category sidebar, search, schema-driven setting rows. IPC handlers for per-layer read/write (electron-store for user, .aide/settings.json for workspace). Theme picker, toggle/number/text/enum controls, modified indicators with reset. **Keyboard Shortcuts manager:** VS Code-style table (Command, Keybinding, When, Source columns), inline keybinding recorder with chord support and conflict detection, user overrides persisted in electron-store, when-aware shortcut dispatch via ShortcutManager + ContextKeys integration. Placeholder categories for future features (Terminal, Browser, Extensions). |
| 6.2 Quick open (`Cmd+P`) + command palette | ✅ Complete    | Reusable SearchPanel overlay (fuzzy filtering, virtualized list, portal-based). CommandPalette: lists all registered commands with keybinding hints, recently-used sort. QuickOpen: file search via `git ls-files` IPC, FileTypeIcon, relative path display. Both wired as commands in registry                                                                                                                                                                                                                                                                                                                                                                                          |     |
| 6.3 GitHub repository + CI                 | 🟡 In progress | electron-builder.yml configured for macOS (dmg+zip arm64+x64), Linux (AppImage+deb), Windows (nsis+zip). pnpm dist scripts added. GitHub Releases publish via `--publish always`. First alpha release: v0.1.0-alpha.1                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 6.4 Plugin system foundation               | ⬜ Not started |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

**Status key:** ⬜ Not started · 🟡 In progress · ✅ Complete · ⏸ Blocked

---

## Workspace Runtime Boundary

### Why this boundary exists

`packages/main/src/index.ts` still contains two different kinds of state:

- app-wide ownership: `store`, `workspaceRegistry`, `mainWindow`, `contentView`, `browserPaneManager`
- active-workspace ownership: `taskRunner`, `agentManager`, `cliAgentManager`, `conversationStore`, `nativeSessionWatcher`, `nativeSessionCache`, and activation sequencing state

The runtime boundary freezes that distinction before the service migration begins. The first pass is intentionally additive: the runtime registry and shell exist now, but the existing singleton implementations still live in `index.ts`.

### Phase 0 contracts

Canonical runtime files:

- `packages/main/src/workspace/runtimeTypes.ts`
- `packages/main/src/workspace/WorkspaceRuntime.ts`
- `packages/main/src/workspace/WorkspaceRuntimeRegistry.ts`

Canonical state machine vocabulary:

- `WorkspaceId`: stable runtime key, sourced from `WorkspaceEntry['id']`
- `RuntimeState`: `idle | activating | focused | background | disposed`
- `RuntimeLifecycle`: activation sequencing + focus/blur/dispose timestamps

The first `WorkspaceRuntime` is a composition root, not a service container implementation. It owns identity, lifecycle state, and empty service slots so later migrations can move services into it without redefining the boundary each time.

### Service ownership inventory

| Service / global                                | Current owner                            | Future owner                       | Migration phase         |
| ----------------------------------------------- | ---------------------------------------- | ---------------------------------- | ----------------------- |
| `store`                                         | app-global in `index.ts`                 | app-global                         | stays app-wide          |
| `workspaceRegistry`                             | app-global in `index.ts`                 | app-global registry backing store  | stays app-wide          |
| `mainWindow`                                    | app-global in `index.ts`                 | app-global                         | stays app-wide          |
| `contentView`                                   | app-global in `index.ts`                 | app-global                         | stays app-wide          |
| `browserPaneManager`                            | app-global in `index.ts`                 | app-global                         | stays app-wide          |
| `taskRunner`                                    | active-workspace singleton in `index.ts` | `WorkspaceRuntime`                 | later service migration |
| `agentManager`                                  | active-workspace singleton in `index.ts` | `WorkspaceRuntime`                 | later service migration |
| `cliAgentManager`                               | active-workspace singleton in `index.ts` | `WorkspaceRuntime`                 | later service migration |
| `conversationStore`                             | active-workspace singleton in `index.ts` | `WorkspaceRuntime`                 | later service migration |
| `nativeSessionWatcher`                          | active-workspace singleton in `index.ts` | `WorkspaceRuntime`                 | later service migration |
| `nativeSessionCache`                            | active-workspace cache in `index.ts`     | `WorkspaceRuntime`                 | later service migration |
| file watcher internals                          | hidden module singleton                  | runtime-scoped instance/registry   | later service migration |
| git polling internals                           | hidden module singleton                  | runtime-scoped instance/registry   | later service migration |
| worktree polling internals                      | hidden module singleton                  | runtime-scoped instance/registry   | later service migration |
| activation sequence / workspace-open scheduling | process-global in `index.ts`             | `WorkspaceRuntime` lifecycle state | moved in boundary phase |

### IPC inventory for later `workspaceId` migration

Already workspace-aware enough for the boundary phase:

- `WORKSPACE_*`
- `CLI_AGENT_START`
- `CLI_AGENT_GET_SESSION`
- `CONVERSATION_CREATE`
- `BROWSER_CREATE`
- `BROWSER_DESTROY_WORKSPACE`
- root-path based helpers such as `STATE_*`, `SEARCH_START`, `FS_LIST_ALL_FILES`, `GIT_DIFF_ORIGINAL`, `OPEN_IN_VSCODE`

Likely needs `workspaceId` added later because the handler still relies on the focused runtime or global active workspace state:

- `WORKSPACE_ROOT_GET`
- `AIDE_INIT`
- `AIDE_GET_RESOLVED_SETTINGS`
- `SETTINGS_GET_WORKSPACE`
- `SETTINGS_SET_WORKSPACE`
- `GITIGNORE_AUDIT`
- `GITIGNORE_APPEND`
- `GITIGNORE_DISMISS`
- `GIT_STATUS`
- `WORKTREE_LIST`
- `WORKTREE_CREATE`
- `WORKTREE_REMOVE`
- `WORKTREE_SET_ACTIVE`
- `WORKTREE_GET_ACTIVE`
- `WORKTREE_LIST_BRANCHES`
- `TASK_LIST`
- `TASK_RUN`
- `TASK_RELOAD`
- `TASK_GENERATE`
- `TASK_FILE_SAVED`
- `CHAT_SEND_MESSAGE`
- `CHAT_SET_MODE`
- `CHAT_SET_WORKING_SET`
- `CHAT_TOOL_APPROVE`
- `CHAT_TOOL_REJECT`
- `CHAT_STOP`
- `CLI_AGENT_SEND`
- `CLI_AGENT_STOP`
- `CONVERSATION_DELETE`
- `CONVERSATION_RENAME`
- `CONVERSATION_GET`

Broadcast payloads that likely need `workspaceId` when multiplexing multiple runtimes:

- `GIT_STATUS_CHANGED`
- `GIT_BRANCH_CHANGED`
- `WORKTREE_LIST_CHANGED`
- `TASK_STATUS_CHANGED`
- `TASK_REQUEST_INPUT`
- `TASK_DIAGNOSTICS`
- `TASK_TRIGGER_RESULT`
- `TASK_AUTO_DETECT`
- `GITIGNORE_AUDIT_RESULT`
- `SETTINGS_CHANGED`
- `SEARCH_RESULTS`
- `SEARCH_COMPLETE`
- `PTY_DATA_OUT`
- `PTY_EXIT`
- `CHAT_STREAM_CHUNK`
- `CHAT_STREAM_END`
- `CHAT_TOOL_CALL`
- `CLI_AGENT_STREAM_DELTA`
- `CLI_AGENT_MESSAGE`
- `CLI_AGENT_STATUS`
- `CLI_AGENT_RESULT`

**Phase 2 (2026-04-02):** The broadcast channels in the list above now use typed payloads that include `workspaceId` (or an envelope with `workspaceId`) wherever main can emit from a specific workspace runtime; renderer subscribers treat focus and delivery as orthogonal. Global channels (theme, zoom, workspace registry list, lifecycle) stay unscoped. Phase 3 service migration can re-home git/worktree/file-watch polling per runtime without another IPC shape break for these events.

### Phase 1 implementation rule

Phase 1 is additive only:

- `index.ts` activates workspaces by resolving `runtimeRegistry.getOrCreate(entry)` and then focusing that runtime
- visible behavior remains unchanged
- no IPC schema changes land yet
- no service implementation has moved out of `index.ts` yet

That keeps the partial-migration window explicit: ownership is now modeled, but the actual per-service migration can happen incrementally and be tracked service-by-service instead of ad hoc.

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

_This document is a living reference. Update the Progress Tracker as milestones complete. Add decisions to Open Questions as they arise. Revisit architecture decisions at the start of each phase._
