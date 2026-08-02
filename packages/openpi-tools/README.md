# @earendil-works/openpi-tools

Personal agent tools + skills for OpenPI.

## Extensions

| File | Capability |
|------|------------|
| `src/web-search.ts` | `web_search` (Tavily → Brave → DuckDuckGo; keys in env or `~/.pi/agent/secrets.env`) |
| `src/web-fetch.ts` | `web_fetch` (read a page by URL) |
| `src/code-search.ts` | `code_search` |
| `src/knowledge-base.ts` | local keyword KB |
| `src/tasks.ts` | in-session todo tracker |
| `src/task-command.ts` | `/task` orchestrator UI |

## Skills

- `email-summary` → `scripts/email-fetch.ts`
- `calendar-today` → `scripts/calendar-today.ts`
- `notify-desktop` → `scripts/notify.ts`

## Enable

```bash
node --experimental-strip-types packages/openpi-bootstrap/src/cli.ts
```

Or load individually:

```bash
pi -e packages/openpi-tools/src/web-fetch.ts
```

Scheduled automation uses `pi task` / orchestrator (not the deprecated `scheduled-tasks` example).

## Web search API keys

Provider priority for openpi `web_search`:

1. **Tavily** — `TAVILY_API_KEY` or `OPENPI_TAVILY_API_KEY`
2. **Brave** — `BRAVE_API_KEY` or `OPENPI_BRAVE_API_KEY`
3. **DuckDuckGo HTML** — no key

Put keys in the environment or in `~/.pi/agent/secrets.env` (mode `600`, never commit):

```bash
# ~/.pi/agent/secrets.env
TAVILY_API_KEY=tvly-...
```

OpenPI Desktop loads this file into agent child processes via `nodeSpawnEnv`. The extension also reads the file directly.

### Prefer `pi-web-access` when installed

If settings `packages` includes `npm:pi-web-access`, OpenPI bootstrap **skips** openpi `web-search.ts` / `web-fetch.ts` (same `web_search` tool name would crash spawn). Use pi-web-access only:

- Config: `~/.pi/agent/web-search.json` — e.g. `provider: "tavily"`, `tavilyApiKey`, `workflow: "auto-summary"` (no browser curator) or `"none"`.
- Tools: `web_search`, `fetch_content`, etc. from the package.

Without pi-web-access, openpi lightweight `web_search` + `web_fetch` remain available via bootstrap.
