# Changelog

## [Unreleased]

### Added

- Model provider directory in the capabilities panel: lists all built-in pi.dev providers with per-model context window and input/output pricing, inline API-key entry (saved to models.json), OAuth login/logout, and a searchable custom-provider list.
- MCP panel shows per-server status (name, status, tool count, error) from RPC capabilities `mcp.servers`.
- Security mode UI writes `settings.json` `securityMode` (builtin gate authority) and keeps `security.json` as a legacy mirror for the openpi-security extension; reads prefer `settings.json`.

### Added

- Added Work and Code conversation modes with a native project-directory picker and mode-aware conversation starters.
- Task list panel in chat: shows the agent's persistent task list (progress, current step, per-item status) from `<cwd>/.pi/todos/current.json`, polling every 2s while a conversation is open.
- Added bundled local Whisper streaming speech-to-text in the chat composer with automatic session continuation and native microphone permissions.

### Fixed

- Replaced macOS system speech recognition with the bundled `whisper.cpp` small-q5_1 multilingual model for lower latency, higher Chinese accuracy, and offline operation.

## [0.80.8] - 2026-07-24

### Changed

- **Backend-first paths**: prefer monorepo `openpi-*` packages and monorepo `coding-agent`/`orchestrator` dist when present, so feature updates usually need only rebuild + daemon restart — not reinstalling OpenPI.app. Packaged runtime remains fallback for pure .app installs.

### Fixed

- Preload IPC allowlist includes `memory_meta` and `maintain_memory` (was blocking memory surface stats / maintain).
- New conversation: wait until RPC is ready after spawn; retry once after daemon restart; avoid refresh race clearing the new selection.
- Stale `Unknown instance` no longer polled forever — dead IDs are dropped from the sidebar with a clear “新建对话” message.
- Snapshot prefers online/starting instances; drops error ghosts without a session file.
- Chat markdown renders GFM pipe tables as real HTML tables.

### Added

- Packaged app embeds first-party packages under `Resources/openpi-packages` (memory/security/tools/intelligence/bootstrap) so proactive memory works without a monorepo checkout.
- Memory surface: proactive cross-chat banner, archive/digest counts, local vector/lexicon status, latest session digest.
- Desktop paths resolve `openpi-memory` desktop-ops and bootstrap from packaged packages or monorepo.

### Added

- Electron desktop app as the primary OpenPI product UI (replaces CLI-first workflow).
- First-run Enable OpenPI setup (bootstrap + daemon) entirely from the GUI.
- Full bridge for chat, tasks, memory, security, intelligence, capabilities, and daemon control.
- `nodeSpawnEnv` merges `~/.pi/agent/secrets.env` (e.g. `TAVILY_API_KEY`) into agent child processes; existing env wins.

### Fixed

- Packaged app resolves monorepo CLI via `openpi.json` / `OPENPI_REPO_ROOT` (not paths inside `OpenPI.app`).
- Local install uses `ditto` so Electron framework relative symlinks stay intact (fixes GPU/icu flash-quit).
- Daemon instance rows no longer mash `cwd` and instance id; status labels in Chinese.
- Chat hides duplicate in-message tool chips once `toolResult` rows exist; tool results align with message column.
- Composer: Enter inserts newline; ⌘/Ctrl+Enter sends.

### Added

- Self-contained Pi runtime under `Resources/openpi-runtime` (coding-agent + orchestrator + deps). `pack:mac` runs `bundle:runtime`; restart daemon no longer requires monorepo on disk.
- Memory surface: project/global scope, maintain (dedupe) action, meta stats, body field, BM25-backed backend.

### Fixed

- Daemon/setup/doctor child processes no longer spawn via Electron `process.execPath` (which is Electron.app, not Node). Resolve a real `node` binary (or `ELECTRON_RUN_AS_NODE`) so orchestrator serve and bootstrap work from the desktop app.

### Removed

- Repo no longer includes the legacy Tauri package (`packages/desktop`). Electron remains the only desktop shell.

### Fixed

- Session list hygiene: hide stopped instances by default, optional show + prune stopped.
- Daemon restart to pick up rebuilt orchestrator health; health missing hint in UI.
- Preload IPC channel allowlist; Electron `sandbox: true`.
- Memory UI ops go through `openpi-memory` store (no duplicate bridge parser).
- Adaptive snapshot poll (5s streaming / 15s idle).
- Security rail icon; light/dark theme toggle.
- Split giant UI into `App` + `lib/*` + `components/surfaces`.
- Desktop tests, tsconfig, biome coverage; local `pack:dir` electron-builder entry.
- Product UX: sidebar shows recent 15 with clean titles; Memory empty state is starter cards (Chinese), not empty admin metrics.
- Product UX pass: Chinese product copy and human empty states across chat, tasks, capabilities, security, intelligence, daemon, dialogs, and setup.
- Chat-first IA (OpenClaw-like): drop equal-weight left rail; sessions + chat are primary; memory/tasks/security/etc. live under sidebar **更多**; runtime is a status chip, not a main nav.
- Chat hub actions: message **记住** / **任务**; composer chips; `/` slash menu (local + agent commands); `/记住` `/任务` and nav shortcuts.
- Visual redesign: neutral restrained palette, typography, chat/sidebar/composer chrome (less admin-green dashboard).
- Chat polish: markdown rendering, user bubbles, compact model·thinking control, + menu instead of chip bar; quieter sidebar.
