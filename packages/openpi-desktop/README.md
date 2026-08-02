# OpenPI Desktop (Electron)

Graphical OpenPI personal agent. **No terminal required for normal use.**

Features presented in the UI:

- First-run **Enable OpenPI** (memory / security / tools / intelligence)
- Chat with multi-turn agent sessions
- Scheduled tasks
- Memory editor
- Security mode + audit
- Intelligence runs
- Daemon health + instance control
- Capabilities / packages

## Prerequisites

Build the runtime packages once (from repo root):

```bash
npm install --ignore-scripts
npm run build --workspace @earendil-works/pi-coding-agent
npm run build --workspace @earendil-works/pi-orchestrator
```

## Run

```bash
cd packages/openpi-desktop
npm install --ignore-scripts
npm run dev
```

This starts Vite + Electron. On first launch click **Enable OpenPI**.

Production-like:

```bash
npm run desktop
```

## Icon + local macOS install

App icon assets live in `build/` (`icon.png` 1024, `icon.icns`). Style: dark squircle + blue π (macOS HIG-style master).

```bash
# Bundle Pi runtime + build .app + DMG into packages/openpi-desktop/release/
npm run pack:mac --workspace @earendil-works/openpi-desktop

# Copy OpenPI.app → /Applications (or ~/Applications if needed)
npm run install:local --workspace @earendil-works/openpi-desktop
```

`pack:mac` first runs `bundle:runtime` (isolated `runtime/` with coding-agent + orchestrator). The packaged app ships:

- `Resources/openpi-runtime` — fallback Pi CLI + orchestrator
- `Resources/openpi-packages` — fallback first-party extensions

## Backend-first updates (prefer no reinstall)

When a monorepo checkout is available (`OPENPI_REPO_ROOT`, `~/.pi/agent/openpi.json` `repoRoot`, or `~/OpenPI`), the desktop **prefers monorepo paths**:

| Layer | Where logic lives | Hot update |
|-------|-------------------|------------|
| Memory / tools / intelligence | `packages/openpi-*` (loaded as extensions) | Edit source → new chat / restart daemon |
| Coding agent / orchestrator | `packages/coding-agent` + `orchestrator` **dist** | `npm run build` in package → **restart daemon** (no .app reinstall) |
| Electron shell (UI, IPC, preload) | `packages/openpi-desktop` | Needs `npm run install:local` |

**Day-to-day feature work:** put logic in monorepo packages, not Electron.  
**Only reinstall the .app** when shell/preload/packaging changes, or on machines without a monorepo.

After install once: run **Enable OpenPI** so `settings.json` extensions point at monorepo (or packaged fallback).

Unsigned local builds may need **右键 → 打开** the first time (Gatekeeper).

## Architecture

- **Electron main** talks to orchestrator over the Unix socket (Node, no Rust)
- **Preload** exposes a safe `window.openpi` bridge
- **React UI** is the former Tauri web app, adapted for Electron

**This package is the only product desktop entry** (Electron). Legacy Tauri (`packages/desktop`) was removed.
