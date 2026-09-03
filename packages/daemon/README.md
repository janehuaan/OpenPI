# @openpi/daemon

Session supervisor and app-level API. Holds one `pi --mode rpc` subprocess per
session, fans their events out to subscribers, and serves the desktop over a
single multiplexed Unix socket.

## Model

```
desktop  ──one long-lived socket, requests correlated by id──▶  daemon
                                                                 │
                                                    one subprocess per session
                                                                 ▼
                                                        pi --mode rpc (0.84.4)
```

- **One connection, fully multiplexed.** No second socket type and no request
  that flips a connection into streaming mode — the old implementation had both,
  which is why its connection handling lived in two places and drifted.
- **Sessions suspend and wake.** `stop` kills the subprocess but keeps the
  record and session file; the next `rpc` or `subscribe` respawns it.
- **`PI_CODING_AGENT_DIR` is set for every child** so a session loads openpi's
  extensions and model defaults, not the user's global `~/.pi/agent`.
- **Scheduled tasks are not here.** They are `@openpi/scheduler`.

## Files

`~/.openpi/` (`OPENPI_DIR` to override): `daemon.sock` (mode `0600`),
`daemon.pid`, `instances.json`, `sessions/<id>.jsonl`, `agent/` (the isolated
`PI_CODING_AGENT_DIR`).

## Credentials

First run imports `models.json` / `auth.json` / `models-store.json` from the
user's `~/.pi/agent` into `~/.openpi/agent`, once, marked by `.bootstrapped`.
After that the two are independent. `openpi-daemon import-credentials` re-runs it.

## CLI

```
openpi-daemon serve | health | list | create <cwd> [--mode code] [--model p/m]
                    | rpc <sessionId> <json> | watch <sessionId> | stop <sessionId>
                    | auth | import-credentials | shutdown
```

`health` reports the pi entry's mtime, so a client can tell the daemon is running
older code than what is now on disk.

## Notable fixes found while testing

**A woken session was untracked.** `SIGTERM` is asynchronous, so suspending and
immediately waking a session left two processes briefly alive — and the old one's
`exit` handler deleted the map entry that already pointed at its *replacement*.
The new child kept running with nothing tracking it, `runningCount` read 0, and
the process never exited. The exit handler now only clears the entry if it still
points at itself, and a deliberate suspend no longer broadcasts `session_exit`.

**One bad frame discarded its whole chunk.** `decodeLines` threw on an
unparseable line, and all three callers responded by clearing the buffer — so a
single malformed frame lost every valid frame that arrived alongside it. It now
skips the bad line and reports it in `errors`.

## Tests

`npm test -w packages/daemon` — 30 tests against `test/fake-pi-rpc.mjs`, a stub
that speaks the real JSONL protocol so framing, correlation, event fan-out,
timeouts, UI requests, and crash handling are covered without a provider.
