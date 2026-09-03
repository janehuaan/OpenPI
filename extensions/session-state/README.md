# @openpi/extension-session-state

Task state, context checkpoints, structured compaction, and the event ledger -
as one extension, on published hooks only.

## What this replaces

The old fork wedged eight unrelated concerns into
`coding-agent/src/core/agent-session.ts` (+578/-22 lines). Each maps to a hook:

| old (patched into AgentSession) | now |
|---|---|
| `_maybeInjectContext()` mutating the message array | `on("context")` |
| `_maybeAppendSnapshot()` + a new `SnapshotEntry` session type | `on("session_before_compact")` returning a `compaction` result |
| `appendEvent()` calls inside `beforeToolCall`/`afterToolCall` | `on("tool_call")` / `on("tool_result")` |
| 5 runtime tools for sub-agents/jobs/task state | one `task` tool via `registerTool` |
| 4 custom RPC commands for the desktop to read state | `pi.appendEntry` + upstream's `get_entries` |
| JSON compaction prompt patched into `compaction.ts` | our own prompt, in `compaction.ts` here |

Zero upstream files are modified.

## Files on disk

| path | written by |
|---|---|
| `<cwd>/.pi/tasks/<sessionId>.json` | the `task` tool |
| `<cwd>/.pi/checkpoints/<sessionId>.json` | `session_before_compact` |
| `<cwd>/.pi/events/<sessionId>.jsonl` | the ledger |

**Everything is scoped by session id.** The old code wrote one shared
`current.json` and `events.jsonl` per directory, then filtered by session id at
read time - so every new conversation in a directory had to load and reject
another session's abandoned list, and the ledger mixed all sessions together.

## Context injection

`on("context")` inserts a compact task-state block and checkpoint block before
the final message. Both renderings are deterministic and the last injected text
is remembered per session, so an unchanged block is not re-sent - a
byte-identical prefix is what keeps the provider's prompt cache warm.

## Structured compaction

`session_before_compact` asks the model for JSON matching the checkpoint schema,
saves the parsed checkpoint, and returns prose (not the JSON) as the compaction
summary - the summary is replayed as conversation history, where a JSON blob
reads as data to parse rather than context to continue.

Any failure returns `undefined` and upstream's default compaction runs: bad JSON,
empty response, aborted request, or a checkpoint with no usable content.

## Desktop data channel

`pi.appendEntry` writes `openpi:task-state`, `openpi:checkpoint`, and
`openpi:session-state-resumed` entries. The desktop reads them with upstream's
`get_entries` RPC - verified in the Phase 0 spike, and the reason none of the old
fork's four custom RPC commands are needed.

## Tests

`npm test -w extensions/session-state` - 79 tests covering persistence,
per-session isolation, corrupt-file handling, JSON extraction from fenced/prose
responses, the fallback contract, ledger input summarization, and the stability
of both compact renderings.
