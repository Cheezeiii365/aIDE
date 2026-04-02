# Rust Migration Analysis for aIDE

> Generated 2026-04-02 — Analysis of performance bottlenecks and Rust migration ROI.

## Slowest Parts of the Codebase (Ranked by Impact)

### 1. Git Status Polling (`packages/main/src/git/gitStatus.ts`)

**Current:** Spawns `simple-git` (shells out to `git`) every 3s per workspace. Each poll
runs `git status` + `git ls-files --others --ignored`, then `JSON.stringify()` for diff
comparison.

| Approach | Expected Gain |
|----------|--------------|
| JS optimization (libgit2 binding, hash-based diffing, event-driven refresh) | 3-5x |
| Rust rewrite (`git2` crate via napi-rs) | 5-10x |

**Verdict:** Best ROI target for Rust. Self-contained module, clear boundary.

---

### 2. Ripgrep Result Parsing (`packages/main/src/search/ripgrepSearch.ts`)

**Current:** `JSON.parse()` per output line, string buffer concatenation, 100ms flush timer.

| Approach | Expected Gain |
|----------|--------------|
| JS optimization (streaming parser, `--vimgrep` format, Buffer.concat) | 2-3x |
| Rust rewrite (parse rg stdout bytes natively) | 2-3x |

**Verdict:** JS optimization sufficient — ripgrep itself is already Rust.

---

### 3. File Watcher Event Processing (`packages/main/src/workspace/fileWatcher.ts`)

**Current:** Every fs event triggers async `stat()` for type detection. 50ms dedup + 150-500ms debounce.

| Approach | Expected Gain |
|----------|--------------|
| JS optimization (`@parcel/watcher` — native events with types, no stat) | 3-5x |
| Rust rewrite (`notify` crate via napi-rs) | 3-5x |

**Verdict:** `@parcel/watcher` gets 80% of the Rust benefit without the complexity.

---

### 4. PTY Scrollback (`packages/main/src/terminal/ptyManager.ts`)

**Current:** String concatenation + slice for 200KB ring. High GC pressure under load.

| Approach | Expected Gain |
|----------|--------------|
| JS optimization (ring buffer / Buffer instead of string) | 2-3x |
| Rust rewrite (native ring buffer) | 2-4x |

**Verdict:** Data structure fix in JS is sufficient.

---

### 5. IPC Serialization (56+ channels, main ↔ renderer)

**Current:** Electron structured clone for all messages. PTY_DATA_OUT fires per keystroke.

| Approach | Expected Gain |
|----------|--------------|
| JS optimization (MessagePort, batching, SharedArrayBuffer) | ~2x |
| Rust rewrite | N/A — Electron architectural constraint |

**Verdict:** JS-only optimization path. Rust cannot help here.

---

### 6. Agent Loop / LLM Streaming (`packages/main/src/chat/agentManager.ts`)

**Current:** Network-bound. Waiting for API responses dominates.

**Verdict:** Neither JS nor Rust helps. Bottleneck is external API latency.

---

### 7. Document Store (`packages/renderer/src/lib/editor/documentStore.ts`)

**Current:** Full string equality for dirty detection. `split('\n')` for line offset calculation.

| Approach | Expected Gain |
|----------|--------------|
| JS optimization (hash-based dirty check, cached line offsets) | 1.5x |
| Rust/WASM | ~2x |

**Verdict:** CodeMirror already handles the heavy lifting. Minimal gain from Rust.

---

## Summary Table

| Area | JS Optimization | Rust Rewrite | Winner |
|------|----------------|-------------|--------|
| Git status | 3-5x | 5-10x | Rust |
| Search parsing | 2-3x | 2-3x | JS (rg is already Rust) |
| File watching | 3-5x | 3-5x | JS (@parcel/watcher) |
| PTY scrollback | 2-3x | 2-4x | JS (data structure fix) |
| IPC overhead | ~2x | N/A | JS only |
| Agent/LLM | Negligible | Negligible | Neither (network bound) |
| Document store | 1.5x | ~2x | JS (CodeMirror does the work) |

## Recommended Path

### Priority 1: JS Optimizations (High impact, low effort)

1. Replace `simple-git` polling with file-watcher-triggered git status
2. Switch to `@parcel/watcher` for native file watching with event types
3. Use `MessagePort` for high-frequency IPC (PTY data, search results)
4. Ring buffer for PTY scrollback
5. Streaming search result parsing (avoid JSON.parse per line)

### Priority 2: Surgical Rust via napi-rs (If performance still insufficient)

Three targeted native modules (~1000 lines of Rust total):

1. **`git-status` module** — `git2` crate, expose `getStatus(rootPath)` to Node (~500 LOC)
2. **File watcher module** — `notify` crate, emit events over channel (~300 LOC)
3. **Search result parser** — Parse raw rg stdout bytes, return structured results (~200 LOC)

These three modules deliver ~80% of full-Rust performance at ~5% of rewrite cost.

### What NOT to Rewrite in Rust

- Renderer/React/CodeMirror/Dockview (DOM-bound, zero Rust-eligible bottlenecks)
- Agent loop / LLM streaming (network-bound)
- IPC layer (Electron architectural constraint)
- Task runner (process management, not compute)

## Overall Assessment

A full Rust rewrite would yield ~2-3x overall speedup at enormous engineering cost.
Most bottlenecks are I/O-bound, architecture-bound, or fixable with better JS libraries
and data structures. The surgical napi-rs approach is the pragmatic middle ground.
