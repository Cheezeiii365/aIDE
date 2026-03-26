# Browser Panes — Revised Implementation Plan

## Key Design Decisions

- **State persistence**: Browser pane metadata lives in the existing workspace UI state layer (same save/load path as layout), not the workspace registry. Registry stays lightweight.
- **Session model**: Typed `sessionMode` enum (`shared-auth` | `workspace` | `temporary`), main process derives actual partition strings. No raw partition strings in renderer or persistence.
- **Lifecycle**: Pane ID + workspace ID + visibility state is the source of truth, not React mount/unmount. Create/destroy are explicit operations, not tied to component lifecycle.
- **Lazy load**: `browserCreate` creates the native view shell only. URL loads on first meaningful visibility, tracked via `hasLoadedOnce`.
- **Host registration**: Single coherent `browserHostUpdate` message (paneId, workspaceId, bounds, visible, chromeHeight) instead of scattered setBounds/setVisible calls.
- **Overlay suppression**: Scoped — command palette/quick open hide all overlays, but non-overlapping UI (toasts, status bar) doesn't trigger hiding.
- **Security policies**: Decided upfront in the manager, not bolted on later.
- **Preview pane**: Deferred — same as browser pane + fullscreen toggle presentation mode.
- **Multiple panes**: Unlimited browser panes per workspace.
- **Per-tile chrome**: Each browser pane gets its own URL bar + back/forward/refresh.

---

## Step 1: Shared Types + IPC Channels

**Types** (in `packages/shared/src/index.ts`):

```typescript
type BrowserSessionMode = 'shared-auth' | 'workspace' | 'temporary'

interface BrowserPaneState {
  paneId: string
  sessionMode: BrowserSessionMode
  url: string           // last known URL, empty string if never loaded
  hasLoadedOnce: boolean
}

interface BrowserHostUpdate {
  paneId: string
  workspaceId: string
  bounds: { x: number; y: number; width: number; height: number }
  visible: boolean
  chromeHeight: number
}
```

**IPC Channels**:
- `BROWSER_CREATE` (invoke — renderer needs confirmation)
- `BROWSER_DESTROY` (send)
- `BROWSER_NAVIGATE` (invoke — may want result/error)
- `BROWSER_GO_BACK` (send)
- `BROWSER_GO_FORWARD` (send)
- `BROWSER_RELOAD` (send)
- `BROWSER_HOST_UPDATE` (send — high frequency, fire-and-forget)
- `BROWSER_DID_NAVIGATE` (event → renderer)
- `BROWSER_PAGE_TITLE_UPDATED` (event → renderer)
- `BROWSER_LOADING_CHANGED` (event → renderer)
- `BROWSER_CAN_NAVIGATE_CHANGED` (event → renderer, canGoBack + canGoForward)

---

## Step 2: `BrowserPaneManager` (main process)

New file: `packages/main/src/browserPaneManager.ts`

**Internal tracking per pane:**
```typescript
interface ManagedBrowserPane {
  view: WebContentsView
  workspaceId: string
  sessionMode: BrowserSessionMode
  currentUrl: string
  lastBounds: { x: number; y: number; width: number; height: number }
  visible: boolean
  hasLoadedOnce: boolean
}
```

`Map<string, ManagedBrowserPane>` keyed by paneId.

**Session derivation** (internal, never exposed):
- `shared-auth` → `session.fromPartition('persist:auth')`
- `workspace` → `session.fromPartition('persist:workspace-${workspaceId}')`
- `temporary` → `session.fromPartition('')` (ephemeral, no persist prefix)

**Security policies** (set on each `WebContentsView` at creation):
- `setWindowOpenHandler` — same-origin opens in same view, cross-origin opens in system browser via `shell.openExternal`
- `permission-request` handler — TBD (see open questions)
- Downloads — TBD (see open questions)
- External protocol handlers (`mailto:`, `slack:`, custom) — pass through to `shell.openExternal`
- Certificate errors — reject (default secure behavior)

**Methods:**
- `create(paneId, workspaceId, sessionMode)` — creates view shell, attaches to window, does NOT load URL
- `destroy(paneId)` — removes view from window, destroys it
- `loadUrl(paneId, url)` — sets `hasLoadedOnce = true`, loads URL
- `handleHostUpdate(update: BrowserHostUpdate)` — dedupes against `lastBounds`, applies bounds (offset by chromeHeight), sets visibility
- `hideAllForWorkspace(workspaceId)` — workspace switch out
- `showAllForWorkspace(workspaceId)` — workspace switch in (triggers lazy load for panes that haven't loaded yet)
- `suppressOverlays()` / `unsuppressOverlays()` — modal open/close
- Navigation: `goBack`, `goForward`, `reload`, `navigate`

---

## Step 3: Preload Bridge

Add to `packages/main/src/preload.ts`:

- `browserCreate(paneId, workspaceId, sessionMode)` → invoke (returns success/error)
- `browserDestroy(paneId)` → send
- `browserNavigate(paneId, url)` → invoke
- `browserGoBack(paneId)` → send
- `browserGoForward(paneId)` → send
- `browserReload(paneId)` → send
- `browserHostUpdate(update: BrowserHostUpdate)` → send
- `browserSuppressOverlays()` → send
- `browserUnsuppressOverlays()` → send
- `onBrowserDidNavigate(cb)` → on (returns unsubscribe)
- `onBrowserTitleUpdated(cb)` → on (returns unsubscribe)
- `onBrowserLoadingChanged(cb)` → on (returns unsubscribe)
- `onBrowserCanNavigateChanged(cb)` → on (returns unsubscribe)

---

## Step 4: `BrowserPane` Component + Per-Tile Chrome

New file: `packages/renderer/src/components/panes/BrowserPane.tsx`

**Layout:**
```
┌─────────────────────────────┐
│ ◀ ▶ ↻  [ URL bar         ] │  ← nav chrome (React, measured height = chromeHeight)
├─────────────────────────────┤
│                             │
│    placeholder div          │  ← colored div, native overlay covers this area
│    (ResizeObserver)         │
│                             │
└─────────────────────────────┘
```

**Lifecycle (not mount/unmount driven):**
- On panel appearance (Dockview add or restore): call `browserCreate` if this paneId doesn't exist in manager yet, or rebind if it does
- On panel disposal (explicit close by user): call `browserDestroy`
- On workspace switch away: manager handles `hideAllForWorkspace` — component doesn't need to do anything
- On workspace switch back: manager handles `showAllForWorkspace` + lazy load

**Host registration:**
- `ResizeObserver` on the placeholder div
- On every observation: measure bounds, combine with `chromeHeight`, send `browserHostUpdate`
- Compare to last sent bounds, skip if identical (dedupe before IPC)

**Tab title updates:**
- Check how existing panes (editor, terminal) handle title. If there's a dedicated mechanism, use that. If `updateParameters` is what's used, use it but only when title actually changes (not on every navigation event).

---

## Step 5: Bounds Sync + Overlay Suppression

**Sync triggers** (all flow through `browserHostUpdate`):
1. `ResizeObserver` on placeholder div
2. Dockview `onDidLayoutChange`
3. Window resize
4. Sidebar collapse/expand

**Bounds math:**
- `getBoundingClientRect()` on placeholder div gives CSS-pixel rect relative to viewport
- The main `WebContentsView` fills the window, so viewport coords = window coords
- Native view bounds = `{ x: rect.x, y: rect.y, width: rect.width, height: rect.height }` (placeholder already excludes chrome height since chrome is a sibling above it)
- Verify on Retina — may need DPR adjustment (plan says macOS logical pixels work directly, but test)

**Overlay suppression:**
- Command palette open → `browserSuppressOverlays()`
- Command palette close → `browserUnsuppressOverlays()`
- Same for quick open, any full-screen modal
- Manager tracks `isSuppressed` flag, sets all visible views to `setVisible(false)` while suppressed, restores on unsuppress

---

## Step 6: Focus / Active-Pane Tracking

- Each `WebContentsView`'s `webContents` emits `'focus'` and `'blur'` events
- Manager forwards these to renderer: `BROWSER_FOCUS_CHANGED(paneId, focused)`
- Renderer tracks `activeBrowserPaneId` — used for:
  - Routing keyboard shortcuts (back/forward/reload) to the right pane
  - Status bar display
  - Determining which pane "owns" global browser commands
- Global shortcuts (`Cmd+Shift+P`, etc.) registered at `BaseWindow` level so they work even when a browser view has focus

---

## Step 7: Persistence (existing workspace state path)

- On workspace save: collect `BrowserPaneState[]` from manager for current workspace, include in the same state blob that holds layout/tabs
- On workspace restore: Dockview `fromJSON` recreates browser panel entries → each `BrowserPane` component reads its params (paneId, sessionMode, url) → calls `browserCreate` (shell only) → sends initial `browserHostUpdate` → if visible, triggers `loadUrl`
- If saved browser metadata is missing or invalid for a layout entry: open as empty browser pane (blank, no URL) rather than failing

---

## Step 8: Command Palette — "New Browser Pane"

- Register command: "New Browser Pane"
- Opens a small dialog/dropdown: choose session mode (`shared-auth` / `workspace` / `temporary`)
- Optionally enter a starting URL (default blank/new tab page)
- Creates a new Dockview panel with type `browser` and the chosen params
- Also wire up context menu on existing panes: "Split Right → Browser", "Split Down → Browser"

---

## Step 9: Workspace Switching Integration

**On switch away from workspace A:**
1. `browserPaneManager.hideAllForWorkspace(workspaceA.id)` — sets all views invisible, preserves state
2. Existing workspace save proceeds (layout + browser state serialized)

**On switch to workspace B:**
1. Dockview layout restored from workspace B state
2. Browser pane components mount/rebind
3. `browserPaneManager.showAllForWorkspace(workspaceB.id)` — sets views visible
4. For each pane where `hasLoadedOnce === false` and pane is now visible: trigger `loadUrl`

---

## Open Questions

1. **`setWindowOpenHandler`** — when a page tries to open a new window (e.g. GitHub OAuth popup, `target="_blank"` link): navigate in the same view, open a new browser pane, or open in system browser? Recommendation: same-origin → same view, cross-origin → system browser.

2. **Downloads** — allow with Electron's default save dialog, or block in v1?

3. **Permission requests** (camera, mic, geolocation, notifications) — auto-allow, auto-deny, or prompt?
