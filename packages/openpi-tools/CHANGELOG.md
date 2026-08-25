# Changelog

## [Unreleased]

### Added

- `scheduled_task` tool: create/list/pause/run OpenPI orchestrator cron/once jobs (same store as Desktop 定时任务). Agents must use this for 定时任务 instead of GitHub Actions or session todos.
- `ai_news` tool (AI 早报): fetch configured AI RSS sources into a local cache, render a markdown digest, and email it via Gmail SMTP (curl, zero npm deps). Keys: `GMAIL_SMTP_USER`/`GMAIL_SMTP_PASSWORD`/`GMAIL_NEWS_TO` in `~/.pi/agent/secrets.env`. Pair with `scheduled_task` for a daily push.
- `monitor` tool (订阅监控): watch RSS/Atom feeds and web pages; `check` reports new items and changed pages, `summary` renders a daily digest. State in `~/.pi/agent/monitor.json`.
- `browser` tool (浏览器自动化): Chrome over CDP with no npm dependencies — `open`/`snapshot`/`click`/`type`/`back`/`close`/`eval`, headless by default, element selection by CSS selector or visible text.
- `github` tool (GitHub 自动化): list PRs/issues, CI workflow runs, post comments, and a 7-day weekly summary across watched repos (`~/.pi/agent/github-watch.json`). Token: `GITHUB_TOKEN`/`OPENPI_GITHUB_TOKEN`.

### Changed

- Session `tasks` tool clarified as in-chat todos only; not for scheduled jobs.
- Exported `chunkText`/`scoreChunks` (knowledge-base) and `rgSearch`/`grepSearch` (code-search) as pure functions for unit testing.

## [0.80.8] - 2026-07-24

### Added

- `web_search` tool: keyword search with provider priority Tavily (`TAVILY_API_KEY` / `OPENPI_TAVILY_API_KEY`) → Brave (`BRAVE_API_KEY` / `OPENPI_BRAVE_API_KEY`) → DuckDuckGo (no key). Keys may live in `~/.pi/agent/secrets.env`. Pair with `web_fetch` for full pages.
- First-party tools package: web fetch, code search, knowledge base, session tasks, `/task` command.
- Life adapters: `scripts/email-fetch.ts`, `calendar-today.ts`, `notify.ts` plus updated skills.
- Richer `/task pick` and interactive create wizard.
