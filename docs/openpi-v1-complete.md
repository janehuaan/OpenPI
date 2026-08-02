# OpenPI Personal Agent V1 — Complete

This document marks the **V1 personal-agent surface as complete**. Further work is polish, publishing, or V2 scope.

## Product surface (done)

| Area | Status |
|------|--------|
| One-click enable (`openpi-enable`) | Done |
| Doctor / integrity verify | Done |
| Memory (project + global, freeze, compact flush, extract) | Done |
| Security gate + audit disk + mode config | Done |
| Tools (fetch/search/kb/todos) + life adapters | Done |
| Intelligence (context/plan/readiness/workflow auto/subagents) | Done |
| Orchestrator tasks (retry/tz/session/security/docker/ext) | Done |
| `pi task` + `/task` pick/wizard | Done |
| Desktop chat/tasks/memory/security/intelligence/daemon | Done |
| Telegram multi-turn RPC + approvals | Done |
| Discord gateway multi-turn RPC | Done |
| Autostart unit templates | Done |
| CI smoke workflow | Done |
| Local `scripts/openpi-smoke.sh` | Done |

## Explicit non-goals (V1)

- SQLite multi-writer store
- Default vector DB / embeddings service
- MCP in Pi core
- Built-in Gmail/Outlook/Google Calendar SDKs (CLI adapters instead)
- Cryptographic package marketplace / code signing
- Full desktop Tauri release CI matrix (legacy Tauri package removed; Electron only)
- Signed multi-platform Electron store distribution (local `pack:dir` only for now)
- Voice I/O

## Primary entry: Desktop (Electron)

```bash
npm install --ignore-scripts
npm run desktop
# or: npm run dev --workspace @earendil-works/openpi-desktop
```

First launch → **Enable OpenPI** in the UI (no CLI).

## Operator checklist (optional / power users)

```bash
npm install --ignore-scripts
npm run build
./scripts/openpi-smoke.sh

node --experimental-strip-types packages/openpi-bootstrap/src/cli.ts doctor
```

Chat:

```bash
# Telegram
OPENPI_TELEGRAM_BOT_TOKEN=... OPENPI_TELEGRAM_ALLOW_CHAT_IDS=... \
  node --experimental-strip-types packages/openpi-chat/src/cli.ts telegram

# Discord
OPENPI_DISCORD_BOT_TOKEN=... \
  node --experimental-strip-types packages/openpi-chat/src/cli.ts discord
```

## V2 candidates (optional later)

- Publish openpi packages to npm as versioned pi-packages
- Handoff mobile ↔ desktop session identity
- Richer Desktop memory editor / intelligence DAG canvas
- Policy engine for chat channel trust levels
- Optional local embedding ranker behind a flag

Until those are requested, **V1 is feature-complete** for a self-hosted personal coding agent assistant on top of Pi.
