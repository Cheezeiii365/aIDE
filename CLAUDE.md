# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

aIDE is a custom IDE built for multi-agent workflows, built with Electron from scratch (not a VS Code/Pulsar fork). See `IDE_BUILD_PLAN.md` for the full architecture, feature specs, and phased build plan.

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
