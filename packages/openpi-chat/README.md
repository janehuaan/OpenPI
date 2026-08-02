# @earendil-works/openpi-chat

Chat bridges for OpenPI.

**Default mode:** Telegram long-poll → orchestrator **RPC multi-turn** instances  
(one Pi session per chat id, stored under `~/.pi/openpi-chat/sessions.json`).

Also supports **Discord gateway** (Message Content intent required).

**Fallback:** `pi --print` when orchestrator is unavailable, or `OPENPI_CHAT_MODE=print`.

## Setup

```bash
npm run build --workspace @earendil-works/pi-orchestrator
npm run build --workspace @earendil-works/pi-coding-agent

# Telegram
export OPENPI_TELEGRAM_BOT_TOKEN=...
export OPENPI_TELEGRAM_ALLOW_CHAT_IDS=123456789
export OPENPI_CHAT_CWD=/path/to/workspace
node --experimental-strip-types packages/openpi-chat/src/cli.ts telegram

# Discord
export OPENPI_DISCORD_BOT_TOKEN=...
export OPENPI_DISCORD_ALLOW_CHANNEL_IDS=...
export OPENPI_CHAT_CWD=/path/to/workspace
node --experimental-strip-types packages/openpi-chat/src/cli.ts discord
```

Telegram supports mid-turn security approvals (yes/no). Discord uses multi-turn RPC replies.
Always pair with `openpi-security`. Unattended chat inherits process permissions.
