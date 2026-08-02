# OpenPI Task Orchestration V1

## Goal

Phase 1 turns the experimental orchestrator into a persistent task runner. It supports creating, listing, pausing, resuming, deleting, manually running, and scheduling independent Pi prompts while preserving a run history.

## Ownership

- `packages/agent` remains the single-agent runtime.
- `packages/coding-agent` remains the Pi execution process.
- `packages/orchestrator` owns task definitions, schedules, process execution, run history, and restart recovery.
- Intelligence-layer planning and sub-agent workflows remain separate from task scheduling in phase 1.

## State Model

A `TaskDefinition` contains the user intent and schedule. A `TaskRun` is an immutable execution identity whose status progresses independently of the task definition.

```text
Task: active <-> paused

Run: queued -> running -> succeeded
                       -> failed
     queued/running -> interrupted (orchestrator restart)
     queued/running -> cancelled (reserved for cancellation API)
     failed/interrupted -> retry run (optional policy)
```

Before a scheduled execution starts, its next schedule is advanced and one-time tasks are paused. This prevents duplicate execution when the orchestrator crashes while starting a process. Retries do not re-advance the schedule.

## Persistence

The orchestrator stores versioned JSON under `PI_ORCHESTRATOR_DIR` or `~/.pi/orchestrator`:

```text
tasks.json
task-runs.json
task-logs/
  <run-id>.stdout.log
  <run-id>.stderr.log
  sessions/<run-id>/
```

Writes use a temporary file followed by an atomic rename. The daemon is the expected single writer. On startup, queued or running records from the previous process are marked `interrupted`. Automatic requeue happens only when the task retry policy includes `interrupted`.

## Scheduling

- One-time schedules accept RFC3339 timestamps.
- Cron schedules use five fields.
- Supported field syntax: `*`, `*/N`, comma-separated values, and ranges.
- Default timezone is UTC. Optional IANA timezone evaluates wall-clock fields in that zone.
- A task never overlaps another run of itself.

## Execution options

Optional per-task fields:

- `provider` / `model`
- `tools` (comma-separated → `--tools`)
- `env` (merged over process environment)
- `retry` (`maxAttempts`, backoff, `retryOn: failed|interrupted`)

Cancel sends SIGTERM to the process group, then SIGKILL after `PI_TASK_FORCE_KILL_MS` (default 5000).

Each run uses a dedicated session directory and records `sessionId` / `sessionFile` when available.

## CLI

`pi task` automatically starts the orchestrator daemon when its socket is unavailable. In a source checkout, build the coding-agent and orchestrator packages first or set `PI_ORCHESTRATOR_CLI` to the orchestrator CLI entry.

```bash
pi task create --title "Repository review" --prompt "Review this repository" --at 2026-07-20T09:00:00Z --cwd /path/to/repo
pi task create --title "Daily review" --prompt "Review recent changes" --cron "0 9 * * *" --timezone America/New_York --retry-max 2
pi task list
pi task show <task-id>
pi task run <task-id>
pi task runs [task-id]
pi task cancel <run-id>
pi task pause <task-id>
pi task resume <task-id>
pi task delete <task-id>
pi task daemon status
pi task daemon start
pi task daemon stop
```

Lower-level `orchestrator task ...`, `orchestrator health`, and `orchestrator shutdown` require (or control) the daemon. Set `PI_CLI_PATH` when the orchestrator cannot infer the built coding-agent CLI path.

## Safety Boundary

Scheduled prompts execute unattended with the permissions and environment of the orchestrator process. Phase 1 provides persistence and lifecycle correctness, not a sandbox. Operators should run the orchestrator in a container, VM, micro-VM, or policy-controlled sandbox for untrusted work and expose only required credentials and workspace paths. Prefer per-task `tools` allowlists and a security extension on interactive surfaces.

## Deferred Work

- Interactive `/task` command and richer TUI views
- Sub-agent workflow execution and result aggregation
- SQLite or multi-writer coordination (single-writer JSON remains the supported model)
- Per-task sandbox executor profiles
