# LSP, Language Packs, and Autocomplete Plan

## Goals

This document captures the current direction for language support in aIDE, based on discussion of plugins, language servers, autocomplete, syntax highlighting, packaging, and future extensibility.

The immediate goal is not to build a full plugin marketplace or a full VS Code-compatible extension ecosystem. The goal is to build a clean, practical architecture for:

- syntax highlighting
- autocomplete
- diagnostics
- hover
- go-to-definition
- symbols
- globally installed language support packs
- workspace-scoped language server runtime

The first target users are TypeScript/JavaScript and Python developers. Other languages should be possible later through the same pack model, without forcing every user to install or ship every LSP.

## Decisions Made

### Core product decisions

- Language support should be global per machine, not per workspace.
- Language servers should be installed separately from the app.
- aIDE should start with a local language-pack directory.
- Packs should be auto-enabled when discovered, at least initially.
- Official language packs will be published separately.
- Community packs should be possible later using the same format.
- Eventually a built-in language-pack/LSP browser would be useful, but it is not required for the first implementation.

### Packaging decisions

- Use plain folders with an aIDE-specific manifest as the installed format.
- Do not use npm packages as the primary runtime/discovery format.
- A future GitHub download/install UI can install into the same local folder format.
- The installed artifact should be ecosystem-agnostic so it can support npm, pip, and standalone binary-based language servers.
- First-version language packs should be declarative, not code-driven.

### Architecture decisions

- Syntax highlighting, autocomplete, and LSP are related but distinct layers.
- Syntax highlighting should remain local to the renderer and work even without an LSP.
- Autocomplete is an editor feature that can combine multiple sources.
- LSP is one semantic backend source for editor intelligence.
- LSP server processes should not run in the renderer.
- LSP server runtime should be workspace-scoped, even though installation is machine-scoped.
- Pack activation should use workspace scanning.
- If a relevant language pack is present but the server is missing or broken, aIDE should surface that through a toast.

### Rollout decisions

- Keep syntax support for core languages in aIDE initially.
- First language packs should focus on semantic language support and server integration.
- Build TypeScript/JavaScript and Python first.
- Defer dynamic syntax-pack ownership until the pack system is stable.

## Conceptual Model

Language support in aIDE should be split into three cooperating layers.

### 1. Syntax highlighting

Purpose:

- fast local parsing/tokenization
- syntax coloring
- bracket/structure awareness
- baseline editor experience

Properties:

- local to renderer
- should work instantly
- should not depend on LSP availability

Current state:

- implemented through static CodeMirror language extensions in `packages/renderer/src/lib/languageExtension.ts`

### 2. Autocomplete and language UX

Purpose:

- completion UI
- hover UI
- symbol search
- go-to-definition
- diagnostics rendering
- code actions later

Properties:

- renderer-owned UI
- should not depend on one specific backend
- should merge multiple providers where useful

Likely sources:

- snippets
- local buffer words
- syntax-aware local completion
- LSP results

### 3. LSP runtime

Purpose:

- semantic project understanding
- project-wide symbols
- diagnostics
- hover/type info
- definition/reference/rename
- semantic completions

Properties:

- background service
- external process per server
- should not run in renderer
- should be scoped to workspace at runtime

## How VS Code Works, Applied to aIDE

VS Code separates:

- editor UI
- extension/provider registration
- extension host
- language server processes

The editor does not directly implement semantic understanding. It asks registered providers for completions, hover, definitions, diagnostics, symbols, and other language features. Many of those providers are backed by LSP servers running in separate processes.

aIDE should follow the same conceptual model, but with a simpler first implementation:

- renderer hosts the editor and UI integration
- main owns server lifecycle and transport
- a global pack registry defines installed language support
- language packs declare language metadata and server behavior
- renderer talks to a provider facade, not directly to individual servers

## Why Language Servers Should Be Installed Separately

Bundling every language server with the app is not a good fit for this product.

Reasons:

- users do not all need the same languages
- language servers are large and language-specific
- servers update independently
- ecosystems differ across languages
- bundling all servers bloats the application

Examples:

- TypeScript tooling often comes from npm
- Python tooling may come from npm, pip, or binaries
- Rust uses `rust-analyzer`
- Go uses `gopls`

The app should ship the infrastructure for language support, not all language servers.

## Why Installation Should Be Global But Runtime Should Be Per Workspace

Two different scopes exist:

### Machine scope

What is installed on this computer:

- TypeScript pack installed
- Python pack installed
- pack versions
- executable locations
- health/install status
- global pack metadata

### Workspace scope

What is active for this project:

- this workspace has TypeScript files
- this workspace has Python files
- start TS server for this workspace root
- start Python server for this workspace root if needed
- server sees project-specific config and files

This distinction is important:

- installation is a machine capability
- analysis/runtime is a project capability

## Pack Format Recommendation

Use a plain folder format with an aIDE-specific manifest.

Example shape:

```text
<global-language-pack-dir>/
  typescript/
    aide-language.json
    snippets/
    docs/
    icons/
  python/
    aide-language.json
    snippets/
    docs/
```

This is preferable to npm-package-first runtime discovery because:

- it is easier to inspect
- it is easier to validate
- it works across ecosystems
- it maps cleanly to GitHub-based installation later
- it avoids coupling runtime support to Node-specific packaging

## First-Version Pack Scope

For the first implementation, a pack should primarily own:

- language metadata
- server detection metadata
- launch configuration
- install/help text
- snippets
- optional contributed commands

For the first implementation, aIDE core should still own:

- core syntax highlighting for the main built-in languages
- editor UI plumbing
- generic LSP client/runtime
- diagnostics storage and rendering
- completion broker

This staged approach is intentional:

- syntax highlighting is foundational and should work immediately
- dynamic syntax contribution adds complexity
- starting with LSP-first packs reduces early scope

Later, packs can be extended to contribute syntax assets too.

## Recommended Initial Architecture

### A. Renderer responsibilities

The renderer should own:

- CodeMirror editor instances
- syntax highlighting attachment
- autocomplete UI
- hover UI
- diagnostic decorations
- go-to-definition UI flow
- symbol search UI
- local document state
- provider facade consumed by editors

The editor should not know about individual language servers directly.

### B. Main process responsibilities

The main process should own:

- language pack discovery
- pack validation
- global installed-language registry
- LSP process spawning
- LSP transport management
- server restart/crash/backoff logic
- workspace-scoped server instance registry
- IPC bridge between renderer and server runtime

This matches the existing shape of the codebase, where main already owns PTYs, watchers, search, and task processes.

### C. Shared contract responsibilities

Shared types should define:

- language metadata records
- installed-pack status
- document lifecycle messages
- completion request/response types
- hover request/response types
- definition request/response types
- symbol request/response types
- diagnostic record types
- server health/status records

These should live in `packages/shared`.

## Proposed Internal Components

These components do not necessarily exist yet; they are the proposed target structure.

### Renderer-side

- `languageRegistry`
  - maps files to language ids and syntax extensions
  - reads installed language metadata from main

- `documentStore`
  - tracks open files, text, versions, dirty state, language ids
  - sends open/change/save/close notifications

- `completionBroker`
  - merges snippets, local words, and LSP completions
  - normalizes ranking and deduplication

- `diagnosticsStore`
  - stores diagnostics per file
  - merges task diagnostics and LSP diagnostics

- `languageFeatureFacade`
  - single renderer-facing interface for:
    - completions
    - hover
    - definitions
    - symbols
    - diagnostics subscription

- CodeMirror adapters
  - completion integration
  - hover tooltip integration
  - diagnostic decorations
  - definition/jump integration

### Main-side

- `languagePackRegistry`
  - scans pack directory
  - validates manifests
  - tracks installed/broken packs

- `lspManager`
  - owns workspace-scoped server sessions
  - starts/stops/reuses servers

- `languageServerProcess`
  - manages one LSP connection
  - JSON-RPC transport
  - initialization state
  - request/response bookkeeping

- `languageActivationService`
  - determines which installed packs apply to a workspace
  - lazily activates support as needed

- `languagePackInstaller` later
  - install from GitHub/local source
  - not required in phase 1

## How Autocomplete Should Work

Autocomplete should be treated as a UI/broker feature, not as “whatever the LSP returns”.

Recommended completion sources:

- snippets
- local words from current/open documents
- optional syntax-aware local completion
- LSP

The renderer should ask one completion broker for results. The broker should:

- query all relevant providers
- merge results
- normalize fields
- deduplicate items
- rank by priority
- drop stale responses

Why this matters:

- the editor remains useful even if no LSP exists
- local completions are a good fallback
- LSP is not the only useful completion source

## How Syntax Highlighting Should Work

Syntax highlighting should initially remain built into aIDE.

Reasons:

- it must work instantly
- it should not depend on pack discovery
- the app already has basic language support in CodeMirror
- dynamic syntax-pack loading can be added later without blocking semantic features

Initial built-in syntax support should likely include:

- JavaScript
- TypeScript
- TSX/JSX
- Python
- Markdown
- JSON
- CSS
- HTML

Later, packs may contribute syntax assets too, but that should be a second phase.

## How LSP Runtime Should Work

### Server lifecycle

For each workspace and relevant language:

- detect whether an installed pack applies
- lazily start the server when a matching file opens or a matching language feature is requested
- keep the server alive while the workspace is active
- stop or suspend it when the workspace closes

### Document synchronization

LSP must operate on unsaved in-memory buffers, not just files on disk.

That means aIDE must send:

- document open
- document change
- document save
- document close

with:

- file uri/path
- version number
- full current content or incremental changes
- language id

This is mandatory for correct diagnostics and autocomplete.

### Requests and pushes

Request-style operations:

- completion
- hover
- definition
- references
- document symbols
- workspace symbols
- rename
- formatting

Push-style operations:

- diagnostics
- progress/status if supported

## Detailed Request Flow Example

Example: user opens a TypeScript file and types `user.`

1. Renderer opens the file in `EditorPane`.
2. Renderer identifies the language as TypeScript.
3. Syntax highlighting is attached immediately.
4. `documentStore` records the document as open with version 1.
5. Renderer tells main/LSP runtime that the document opened.
6. Main ensures TypeScript support is active for this workspace.
7. Main starts or reuses the TypeScript language server for that workspace.
8. As the user types, renderer increments document version and sends changes.
9. When the completion UI is triggered, CodeMirror asks `completionBroker` for suggestions.
10. `completionBroker` asks:
    - snippet provider
    - local word provider
    - LSP provider
11. LSP provider sends a completion request through main to the TypeScript server.
12. The server responds with completion items.
13. The broker merges and ranks the combined results.
14. CodeMirror renders the menu.
15. Separately, the server pushes diagnostics after analysis.
16. Main forwards diagnostics to renderer.
17. `diagnosticsStore` updates the file’s diagnostics.
18. Editor surfaces squiggles, hover messages, and future Problems panel entries.

## Interaction With the Existing Codebase

### Relevant current pieces

- `packages/renderer/src/components/panes/EditorPane.tsx`
  - current CodeMirror editor host
  - currently owns file read/load/write behavior directly

- `packages/renderer/src/lib/languageExtension.ts`
  - current hardcoded syntax extension map

- `packages/main/src/index.ts`
  - current main-process IPC/service hub

- `packages/main/src/preload.ts`
  - current renderer bridge

- `packages/shared/src/index.ts`
  - current shared contracts

- `packages/main/src/problemMatcher.ts`
  - current non-LSP diagnostic producer from task output

### Existing architectural precedent that helps

The codebase already has the right general shape for service-backed features:

- main owns long-lived background/process-heavy systems
- preload exposes a typed bridge
- shared defines cross-process contracts
- renderer consumes higher-level APIs

That pattern should be reused for language support.

## Diagnostics Strategy

aIDE should have one central diagnostics model that can merge multiple sources.

Initial sources:

- task diagnostics from problem matchers
- LSP diagnostics

Later possible sources:

- static analysis from packs
- custom workspace tools

The renderer should not care where diagnostics came from. It should just render:

- editor squiggles
- gutter markers if desired
- hover text
- future Problems panel
- possible file/tab status indicators

## Initial Implementation Steps

The recommended order is intentionally narrow and pragmatic.

### Phase 1: language foundation

1. Expand the current language mapping into a real language registry model.
2. Separate `languageId`, display name, extensions, and syntax extension metadata.
3. Add machine-level language-pack discovery and status reporting in main.
4. Define the pack manifest schema and version it.

### Phase 2: document and feature plumbing

5. Create a renderer-side `documentStore` for open files.
6. Assign version numbers to in-memory documents.
7. Route editor open/change/save/close events through the document layer.
8. Define shared IPC/message contracts for language features and document sync.

### Phase 3: LSP runtime

9. Implement `lspManager` in main.
10. Implement a generic `languageServerProcess` transport layer.
11. Add workspace-scoped server session lifecycle management.
12. Add server health reporting and basic crash recovery.

### Phase 4: editor feature integration

13. Implement a renderer-side `completionBroker`.
14. Add CodeMirror completion integration.
15. Add LSP-backed hover integration.
16. Add definition/symbol request plumbing.
17. Add a shared diagnostics store and editor decorations.

### Phase 5: first official packs

18. Build an official TypeScript pack.
19. Build an official Python pack.
20. Prove:
    - pack discovery
    - server detection
    - server startup
    - completions
    - diagnostics
    - hover
    - definitions
    - symbols

### Phase 6: install/discovery UX

21. Add pack status UI in aIDE.
22. Show installed, missing, broken, and unsupported language support.
23. Add local-folder install support if needed beyond manual placement.
24. Later add GitHub-based install/download UI on top of the same pack format.

## First Milestone Recommendation

Do not start with a general marketplace or a full plugin host.

The first milestone should prove one narrow end-to-end vertical slice:

- built-in syntax highlighting
- machine-scoped installed pack registry
- workspace-scoped LSP runtime
- document synchronization
- completion broker
- diagnostics store
- one official TypeScript pack
- one official Python pack

Feature target for milestone 1:

- completion
- diagnostics
- hover
- go-to-definition
- document symbols

This is enough to validate the architecture without overcommitting to a larger ecosystem too early.

## Key Risks and Challenges

### 1. Unsaved buffer synchronization

If LSP sees only the filesystem, results will be wrong. The document store and versioning model are critical.

### 2. Stale responses and cancellation

Autocomplete and hover requests can become obsolete quickly. The transport and broker need cancellation or stale-response dropping.

### 3. Workspace scoping

Runtime server instances must be workspace-correct even though installation is global.

### 4. Manifest/API stability

If packs can contribute many capabilities, the manifest and pack API must be versioned early.

### 5. Security and trust

Even local packs are effectively extensions. Community packs should eventually have trust/verification states, even if auto-enabled initially.

### 6. Cross-ecosystem installation variance

Servers may come from npm, pip, or direct binaries. The pack model should not assume one packaging system.

### 7. Dynamic syntax contribution

Allowing packs to contribute runtime syntax assets is useful but should not block the initial semantic language-support rollout.

## Future Expansion

Not required initially, but the architecture should leave room for:

- built-in pack/LSP browser
- GitHub install/update UI
- official/community pack distinction
- pack verification/trust levels
- syntax contributions from packs
- snippets and commands from packs
- formatter support
- code actions
- rename
- references
- workspace symbols
- richer language status UI

## Recommended Manifest Direction

The exact schema still needs to be designed, but it should be:

- explicit
- versioned
- folder-based
- easy to validate
- ecosystem-agnostic
- capable of describing:
  - language identity
  - file matching
  - server launch/detection
  - install/help metadata
  - optional snippets/commands/settings/docs

The first version should prefer declarative configuration where possible.

In practice, this means packs should initially describe behavior through manifest data such as:

- language id
- file matching rules
- server detection metadata
- launch command/args metadata
- snippet file references
- docs/help references

They should not initially ship arbitrary runtime JavaScript for custom behavior.

## Open Questions

These points are not fully decided yet and should be resolved before implementation begins:

1. What should the global installed language-pack directory be on each platform?
2. How should aIDE represent pack health states in the UI beyond transient toasts?
3. Should official packs include installation helpers/scripts, or only detection + setup instructions initially?

## Current Recommendation Summary

The recommended plan is:

- keep syntax highlighting built into aIDE initially
- install language support globally per machine
- use plain-folder language packs with an aIDE manifest
- auto-enable packs when discovered
- make v1 packs declarative rather than code-driven
- use workspace scanning to determine relevant language support
- show a toast when a relevant pack exists but its server is missing or broken
- make language server runtime workspace-scoped
- let packs eventually contribute broad language experience features
- start with TypeScript and Python official packs
- defer pack browser/install UI until after the core architecture works

This gives aIDE a practical path toward strong language support without overbuilding the plugin ecosystem first.
