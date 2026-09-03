# @openpi/extension-tools

Zero-dependency personal-agent toolbelt. Eight extension entry points, no npm
runtime dependencies beyond `typebox`: HTTP goes through `fetch`, browser
automation speaks raw CDP, SMTP and RSS go through `curl`.

## Tools

| entry | tools |
|---|---|
| `web-search.ts` | `web_search` — Tavily, then Brave, then keyless DuckDuckGo |
| `web-fetch.ts` | `web_fetch` — page text extraction |
| `code-search.ts` | `code_search` — ripgrep with a grep fallback |
| `knowledge-base.ts` | `kb_scan` `kb_query` `kb_add` `kb_remove` `kb_list` |
| `ai-news.ts` | `ai_news` — RSS digest, optional email push |
| `monitor.ts` | `monitor` — watch feeds and pages for changes |
| `browser.ts` | `browser` — Chrome DevTools Protocol driver |
| `github.ts` | `github` — PRs, issues, CI, comments, weekly summary |

## State and secrets

Everything lives under the agent directory, which the daemon sets per session
via `PI_CODING_AGENT_DIR` and which defaults to `~/.openpi/agent` — **not** the
user's `~/.pi/agent`, so openpi never shares a secrets file with a pi CLI install.

| file | owner |
|---|---|
| `<agentDir>/secrets.env` | all tools, via `envOrSecret()` |
| `<agentDir>/monitor.json` | `monitor` |
| `<agentDir>/ai-news.json` | `ai_news` |
| `<agentDir>/github-watch.json` | `github` |
| `<cwd>/.pi/knowledge-base/index.json` | `kb_*` |

Keys read from env first, then `secrets.env`: `TAVILY_API_KEY` /
`OPENPI_TAVILY_API_KEY`, `BRAVE_API_KEY`, `GITHUB_TOKEN` /
`OPENPI_GITHUB_TOKEN`, `GMAIL_SMTP_USER` / `GMAIL_SMTP_PASSWORD` /
`GMAIL_NEWS_TO`.

## Changes from the old package

**Deduplicated secret handling.** The old package had the same `secrets.env`
parser three times — in `secrets.ts`, in `feed-utils.ts` (as `agentDir`), and
inline in `web-search.ts` — so a fix in one place missed the others. Now one
implementation in `secrets.ts`.

**Dropped `tasks.ts` and `task-command.ts`.** The `tasks` tool was a second
session-todo implementation competing with `@openpi/extension-session-state`'s
`task` tool, and its own description had to warn the model which one to pick.
`task-command.ts` spawned `pi task`, a CLI subcommand the old fork added by
patching upstream. Structured task state lives in session-state now.

**Dropped `personal.ts` and `scheduled-tasks.ts`** (649 lines, 5 tools). Neither
was in the old `pi.extensions` list and no loader referenced them anywhere in the
repo, so they were unreachable. `scheduled_task` belongs to the scheduler
package; the `calendar` / `email_inbox` / `notify` / `weather` tools can come
back as a deliberate port if wanted.

## Tests

`npm test -w extensions/tools` — 85 tests.

The old package's 29 tests **never ran**: its `test` script was three `--help`
smoke checks and there was no `vitest.config.ts`, so the six vitest files were
orphaned. Those 29 now execute, plus 56 new ones covering the previously
untested `web-search` HTML parsing, `web-fetch` text extraction, `secrets`
precedence, and the CDP expression builder — including that a hostile selector
or link text cannot break out of the JSON payload it is embedded in.
