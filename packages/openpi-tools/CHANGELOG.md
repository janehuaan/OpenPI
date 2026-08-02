# Changelog

## [Unreleased]

### Added

- `scheduled_task` tool: create/list/pause/run OpenPI orchestrator cron/once jobs (same store as Desktop 定时任务). Agents must use this for 定时任务 instead of GitHub Actions or session todos.

### Changed

- Session `tasks` tool clarified as in-chat todos only; not for scheduled jobs.
- Exported `chunkText`/`scoreChunks` (knowledge-base) and `rgSearch`/`grepSearch` (code-search) as pure functions for unit testing.

## [0.80.8] - 2026-07-24

### Added

- `web_search` tool: keyword search with provider priority Tavily (`TAVILY_API_KEY` / `OPENPI_TAVILY_API_KEY`) → Brave (`BRAVE_API_KEY` / `OPENPI_BRAVE_API_KEY`) → DuckDuckGo (no key). Keys may live in `~/.pi/agent/secrets.env`. Pair with `web_fetch` for full pages.
- First-party tools package: web fetch, code search, knowledge base, session tasks, `/task` command.
- Life adapters: `scripts/email-fetch.ts`, `calendar-today.ts`, `notify.ts` plus updated skills.
- Richer `/task pick` and interactive create wizard.
