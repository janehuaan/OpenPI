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
| `src/ai-news.ts` | `ai_news` AI 早报: fetch RSS sources, render digest, email via Gmail SMTP |
| `src/monitor.ts` | `monitor` 订阅监控: watch feeds/pages, report new items / changes, daily digest |
| `src/browser.ts` | `browser` CDP browser automation: open/click/type/snapshot (zero deps) |
| `src/github.ts` | `github` automation: PRs/issues/CI, comments, weekly summary |

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

## New plugins

- **AI 早报** — `ai_news fetch|digest|send|status`. Sources: OpenAI/DeepMind/Google/HF/Mistral + AI tech media RSS.
  Send requires `GMAIL_SMTP_USER` / `GMAIL_SMTP_PASSWORD` / `GMAIL_NEWS_TO` in `~/.pi/agent/secrets.env`.
  Daily push example: `scheduled_task create --title "AI 早报" --cron "0 22 * * *" --timezone Asia/Shanghai --prompt "调用 ai_news 生成今日 AI 早报并发送到邮箱"`.
- **订阅监控** — `monitor add <name> <url> [kind=rss|page]` then `monitor check|summary`. State in `~/.pi/agent/monitor.json`.
- **浏览器自动化** — `browser open <url>`, then `browser click|type|snapshot|eval`. Uses Chrome over CDP (headless by default);
  set `OPENPI_CHROME_PATH` if Chrome is not on a default path.
- **GitHub** — `github prs|issues|ci|comment|weekly|watch`. Read actions work without a token;
  `comment` needs `GITHUB_TOKEN` / `OPENPI_GITHUB_TOKEN`. Watched repos in `~/.pi/agent/github-watch.json`.

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
