# @openpi/scheduler

Cron and one-shot task scheduling with DAG steps, retry policies, and unattended
`pi --print` runs.

## Why it is its own package

In the old repo this lived inside `packages/orchestrator` alongside the session
instance pool — ~4,400 lines owning two unrelated jobs on one lifecycle. A cron
definition outlives every session, so it gets its own package and its own
directory.

## Storage

Everything under `~/.openpi/scheduler` (`OPENPI_SCHEDULER_DIR` to override):

| path | contents |
|---|---|
| `tasks.json` | task definitions, mode `0600` |
| `task-runs.json` | run records |
| `step-runs.json` | per-step records for DAG tasks |
| `task-logs/<runId>.stdout.log` | captured stdout, also the run's `result` |
| `sessions/<runId>/` | session files from unattended runs |

## Model

`TaskScheduler.tick()` finds tasks whose `nextRunAt` has passed and triggers
them. A task with `steps` runs as a DAG (`dependsOn`, `skipIfFailed`,
`skipIfSkipped`, `maxConcurrentSteps`); without steps its prompt runs as a single
step. Failures follow `TaskRetryPolicy` with exponential backoff.

`markInterruptedRuns()` runs at startup: anything left `queued` or `running` by a
crash becomes `interrupted`, so a dead run is never counted as live forever.

## Changes from the orchestrator version

**Two bugs fixed, both found by running a real multi-step task:**

1. *A wasted pi process per step task.* `executeStepTask` called
   `executor.execute(task, run)` on the parent task purely to get a handle for
   `cancel()`, spawning a full pi process on the parent's placeholder prompt and
   discarding its output — one wasted LLM call per run. `ActiveRun` now holds a
   cancel callback, which in step mode forwards to the in-flight steps.

2. *Step results were always empty.* The step path never wrote `stdoutPath` onto
   its step run, so `readLog(sr.stdoutPath)` always read `undefined`. Steps
   reported `succeeded` with `result: ""`. The single-step path had it right.

**A corrupt store file no longer takes the scheduler down.** `readJson` threw out
of `loadTasks()`, which runs on every tick and at startup. It now quarantines the
file as `<name>.corrupt.<ts>` and continues from empty — returning empty without
the rename would let the next save destroy recoverable bytes.

**Aligned with upstream 0.84.4.** `--security-gate-mode` no longer exists, so
`buildArgs` does not pass it (`TaskDefinition.securityMode` stays for the
desktop's UI). The executor resolves the pinned `node_modules` install instead of
probing for `../coding-agent/cli.js`, and no longer silently appends a
`packages/openpi-security` extension that only existed inside the fork.

**Task sessions moved** from `task-logs/sessions/` to `sessions/`.

## Tests

`npm test -w packages/scheduler` — 73 tests, up from 15.

The ported suite also **leaked into `~/.openpi/scheduler`** because `TaskStore`'s
module-level singleton resolved real paths; a `setupFiles` hook now gives each
test file its own temp directory. Two ported expectations were wrong about real
behavior and are now documented as such: a Feb-29 cron more than a year out
throws rather than resolving (the search window is 366 days), and a weekday cron
resolves in the target zone, not UTC.

Verified end-to-end against pi 0.84.4: a one-shot task returns `SCHEDULED` with
exit 0, and a two-step DAG runs in dependency order with both results captured.
