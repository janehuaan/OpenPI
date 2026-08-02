# Changelog

## [Unreleased]

### Added

- Added session-level Work and Code launch profiles, with Code mode enabling repository tools and coding-specific instructions.

## [0.80.8] - 2026-07-24

### Added

- Added persistent scheduled tasks with run history, logs, cancellation, restart recovery, and IPC/CLI management.
- Added persistent conversation recovery, historical Pi session discovery, lazy remounting, rename, and deletion APIs.
- Added task retry/backoff policies, force-kill after cancel, IANA cron timezones, per-task provider/model/tools/env, and session capture on runs.
- Added orchestrator `health` and `shutdown` IPC/CLI endpoints; `pi task daemon status` reports live health.
- Added per-task security mode, extension list, docker sandbox profile, and default openpi-security auto-load for unattended runs.

### Fixed

- Fixed Pi RPC process startup when the coding-agent entry is exposed through ESM package exports.
- Reduced desktop IPC latency with lightweight request and event-stream clients plus batched RPC reads.

## [0.80.7] - 2026-07-14

## [0.80.6] - 2026-07-09

## [0.80.5] - 2026-07-09

## [0.80.4] - 2026-07-09

## [0.80.3] - 2026-06-30
