# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

aIDE is a custom IDE built for multi-agent workflows, built with Electron from scratch (not a VS Code/Pulsar fork). See `IDE_BUILD_PLAN.md` for the full architecture, feature specs, and phased build plan.

At this point, the project is being written in this editor. Any bug reports come from user experience.

## Tech Stack

- **Desktop shell**: Electron 41+ (BaseWindow + WebContentsView)
- **UI**: React 19 + TypeScript
- **Build**: Vite + electron-vite
- **Package manager**: pnpm (workspace monorepo: `main`, `renderer`, `shared`)
- **Editor**: CodeMirror 6 (not Monaco)
- **Layout**: Dockview 5.x (tiling panes)
- **Terminal**: xterm.js + node-pty
- **Search**: Bundled ripgrep via @vscode/ripgrep
- **Target**: macOS first, Linux second, Windows third

## Key Architecture Decisions

- **Fixed left sidebar** for file tree (outside Dockview, always present)
- **Theming**: CSS variable token system with `data-theme` attribute. Dark + light mode from day one. Custom themes in v2+
- **Browser panes**: Real `WebContentsView` overlays with `persist:` session partitions (not webviews)
- **Agent isolation**: One `UtilityProcess` per workspace for agent processes
- **LSP per workspace**: Separate language server processes, SIGSTOP/SIGCONT on workspace switch

## Repository

- GitHub: https://github.com/Cheezeiii365/aIDE
- Branch: `main`

### Commiting conventions

- Always check against the .gitignore file when committing for security and performance reasons.
- Always update IDE_BUILD_PLAN.md when making changes to the codebase.

- Use `feat:` for new features
- Use `fix:` for bug fixes
- Use `refactor:` for code refactoring
- Use `test:` for testing
- Use `docs:` for documentation
- Use `chore:` for chores
- Use `style:` for styling
- Use `perf:` for performance improvements
- Use `build:` for build system changes
- Use `ci:` for CI configuration changes