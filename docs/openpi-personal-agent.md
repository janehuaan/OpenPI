# OpenPI Personal Agent Bundle

How to run OpenPI as a personal agent assistant on top of Pi core.

**V1 is complete.** See [openpi-v1-complete.md](./openpi-v1-complete.md) for the done checklist and non-goals.

## Packages

| Package | Purpose |
|---------|---------|
| `@earendil-works/pi-coding-agent` | Coding agent CLI / RPC |
| `@earendil-works/pi-orchestrator` | Always-on tasks + instances |
| `@earendil-works/openpi-memory` | Long-term file memory |
| `@earendil-works/openpi-security` | Permission gate + audit |
| `@earendil-works/openpi-tools` | web_fetch, code_search, kb, session tasks, `/task` |
| `@earendil-works/openpi-intelligence` | Context + planning + sub-agents |
| `@earendil-works/openpi-chat` | Telegram bridge |
| `@earendil-works/openpi-desktop` | Desktop console (Electron) |

## One-click enable (user settings, not core)

```bash
npm install --ignore-scripts
npm run build

# Merge absolute monorepo paths into ~/.pi/agent/settings.json
node --experimental-strip-types packages/openpi-bootstrap/src/cli.ts
# preview: ... --dry-run
```

After enable, plain `pi` / `./pi-test.sh` loads memory, security, tools, and intelligence from settings.

## Manual enable (source tree)

```bash
./pi-test.sh \
  -e packages/openpi-memory/src/index.ts \
  -e packages/openpi-security/src/index.ts \
  -e packages/openpi-tools/src/web-fetch.ts \
  -e packages/openpi-tools/src/code-search.ts \
  -e packages/openpi-tools/src/tasks.ts \
  -e packages/openpi-tools/src/task-command.ts \
  -e packages/openpi-intelligence/src/index.ts
```

## Always-on tasks

```bash
pi task create --title "Daily review" --prompt "Review recent changes" --cron "0 9 * * *" --timezone America/New_York --retry-max 2
pi task daemon status
```

## Chat (multi-turn RPC)

Default: Telegram → orchestrator RPC instance per chat id (`~/.pi/openpi-chat/sessions.json`).
Discord gateway also supported.

```bash
export OPENPI_TELEGRAM_BOT_TOKEN=...
export OPENPI_TELEGRAM_ALLOW_CHAT_IDS=...
export OPENPI_CHAT_CWD=/path/to/workspace
node --experimental-strip-types packages/openpi-chat/src/cli.ts telegram

export OPENPI_DISCORD_BOT_TOKEN=...
node --experimental-strip-types packages/openpi-chat/src/cli.ts discord
# force single-turn print: OPENPI_CHAT_MODE=print
```

Integrity after enable:

```bash
node --experimental-strip-types packages/openpi-bootstrap/src/cli.ts verify
```

## Security defaults

- Use `--security-gate-mode confirm` (or `strict` for unattended review).
- Prefer per-task `--tools` allowlists for scheduled work.
- Do not expose orchestrator sockets publicly.

## Life adapters

```bash
node --experimental-strip-types packages/openpi-tools/scripts/email-fetch.ts --limit 20
node --experimental-strip-types packages/openpi-tools/scripts/calendar-today.ts
node --experimental-strip-types packages/openpi-tools/scripts/notify.ts --title OpenPI --body "Done"
```

Skills `email-summary`, `calendar-today`, `notify-desktop` call these adapters (or env CLIs).

## Memory scopes

- Project: `.pi/memory/`
- Global: `~/.pi/memory/` via `memory({ action: "save", scope: "global", ... })`

## CI

`.github/workflows/openpi-smoke.yml` builds orchestrator/coding-agent and runs openpi package tests + adapter --help smoke.

## Task safety defaults

Unattended `pi task` runs default to:

- tools from `~/.pi/agent/openpi.json` `defaultTaskTools` (or read/grep/find/ls/bash)
- `--security-gate-mode strict` unless overridden
- optional `--extension` paths, `--sandbox docker`, `--docker-image`

## Autostart

After `openpi-enable`, units land in `~/.pi/agent/autostart/`:

- macOS: copy plist to `~/Library/LaunchAgents/` then `launchctl load ...`
- Linux: copy service to `~/.config/systemd/user/` then `systemctl --user enable --now ...`

## Non-goals (documented)

- SQLite multi-writer (single daemon JSON is supported)
- Vector DB as default memory
- MCP in core (use adapter packages)
- Full Discord gateway (scaffold only; Telegram is the primary chat surface)
