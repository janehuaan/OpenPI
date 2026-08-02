# Changelog

## [Unreleased]

## [0.80.8] - 2026-07-24

### Added

- `openpi-enable` merges first-party packages into user settings, writes `openpi.json` / `security.json`, and emits autostart units.
- Integrity hashing of enabled extension files with `openpi-enable verify`.
- `openpi-enable doctor` diagnoses settings, paths, integrity, and daemon socket.
- Default unattended task extensions include openpi-security.
