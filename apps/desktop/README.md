# @openpi/desktop

Electron shell over the openpi daemon.

## Structure

```
electron/
  channels.ts   IPC allowlist — single source of truth for preload and handlers
  preload.ts    contextBridge surface, allowlist-enforced
  handlers.ts   forwards to the daemon + the three Electron-only capabilities
  daemon.ts     start / connect / version-drift restart
  main.ts       window lifecycle and window-state persistence
web/
  App.tsx                 view switcher over three panes, composition only
  hooks/useSessions.ts    session list, selection, event subscription, UI prompts
  hooks/useTasks.ts       scheduled tasks
  lib/turn.ts             pure reducer: pi event stream -> chat state
  lib/ui-request.ts       extension_ui_request classification and replies
  lib/markdown.ts         markdown -> token list (never HTML)
  lib/cron.ts             cron validation and plain-language descriptions
  lib/api.ts              typed renderer client
  components/             SessionList, Chat, Markdown, ContextPanel, StatusBar,
                          TasksView, CreateTaskDialog, ProvidersView,
                          NewSessionDialog, UiRequestDialog
  styles.css              one stylesheet, custom properties, light/dark
```

## Views

**Chat** — session list, transcript with markdown and tool activity, workspace and
memory context pane.

**Tasks** — scheduled tasks: create with cron presets or a one-shot time, run now,
pause, delete, and per-run status with a stdout tail. This is the UI for
`@openpi/scheduler`; without it that package is unreachable.

**Providers** — which providers have a key, and a re-import from the user's pi CLI
setup. Editing keys is deliberately absent: they live in the isolated agent dir's
`models.json`, and a UI writing that file races the sessions reading it, so
`pi auth` stays the supported path.

## Extension prompts

An extension calling `ctx.ui.confirm`/`select`/`input` blocks its agent turn until
something replies. The daemon broadcasts the request as a session event and
`UiRequestDialog` answers it — cancelling still sends a reply, because closing
without one would hang the session.

`setStatus` / `setWidget` arrive on the same channel, need no answer, and show as
status text (ANSI-stripped) in the status bar.

## What changed from the old desktop

| old | now |
|---|---|
| `components/surfaces/index.tsx` 7,180 lines, 48 components | five components, largest ~120 lines |
| `styles.css` 7,255 lines | 1 stylesheet, ~600 lines of tokens + layout |
| `App.tsx` 1,880 lines, ~60 `useState` | shell + one hook; stream reduction is a pure function |
| `bridge.mjs` 1,326 lines of business logic in the asar | handlers forward; logic lives in the daemon |
| `electron/*.mjs`, ~2,500 lines with no typechecking | TypeScript, in `npm run typecheck` |
| two IPC channel lists with "keep in sync" (already drifted) | one list, plus a test that every channel has a handler |
| `@vitejs/plugin-react` installed but unused → full page reload per edit | wired, so Fast Refresh works |
| `tasks`/`todo` state read through four custom pi RPC commands | `pi.appendEntry` + upstream `get_entries` |

## Security posture

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The renderer
reaches the outside only through the preload allowlist. A CSP in `index.html`
permits no remote origins — nothing is fetched from the network by the UI.

Model output renders as text, never HTML. `open_external` accepts http(s) only:
a `file://` or custom-scheme URL arriving from page content would otherwise be a
local-execution path.

## Build

```bash
npm run dev -w @openpi/desktop     # vite + electron, Fast Refresh
npm run build -w @openpi/desktop   # esbuild main/preload + vite renderer
npm start -w @openpi/desktop       # run the production build
```

The main process is bundled with esbuild rather than emitted by `tsc`: it imports
`@openpi/daemon`, a workspace package whose entry is TypeScript, and bundling
resolves that at build time so the shipped main process is plain JavaScript. The
preload is emitted as CommonJS — Electron rejects an ESM preload when the
renderer is sandboxed.

The daemon is spawned as `process.execPath` with `ELECTRON_RUN_AS_NODE=1` and
`--experimental-strip-types`, so no second Node runtime has to be shipped.

## Tests

`npm test -w @openpi/desktop` — 89 tests over the four pure modules and the
channel contract:

- **turn.ts** — doubled text when deltas and a final message both arrive, provider
  errors carried on an assistant message rather than thrown, tool lifecycle,
  unknown event types.
- **ui-request.ts** — the field names the real stream uses (`confirm` puts its
  question in `title`, not `message`), fire-and-forget vs blocking methods, and
  that cancel still produces a reply.
- **markdown.ts** — an unterminated fence stays code (streamed output is cut
  mid-block), and a `javascript:` or `file:` link stays literal text.
- **cron.ts** — every field's range, and that no preset uses minute 0.
- **channels.ts** — no duplicates, and every allowlisted channel has a handler.
