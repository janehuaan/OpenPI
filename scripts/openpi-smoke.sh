#!/usr/bin/env bash
# Local smoke for OpenPI personal-agent packages.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> build core packages"
npm run build --workspace @earendil-works/pi-tui
npm run build --workspace @earendil-works/pi-ai
npm run build --workspace @earendil-works/pi-agent-core
npm run build --workspace @earendil-works/pi-coding-agent
npm run build --workspace @earendil-works/pi-orchestrator

echo "==> package tests"
npm test --workspace @earendil-works/openpi-bootstrap
npm test --workspace @earendil-works/openpi-memory
npm test --workspace @earendil-works/openpi-intelligence
npm test --workspace @earendil-works/openpi-security
npm test --workspace @earendil-works/openpi-chat
npm test --workspace @earendil-works/openpi-desktop
npm test --workspace @earendil-works/pi-orchestrator
npm test --workspace @earendil-works/openpi-tools

echo "==> bootstrap dry-run"
node --experimental-strip-types packages/openpi-bootstrap/src/cli.ts --dry-run --no-autostart

echo "==> adapter help"
node --experimental-strip-types packages/openpi-tools/scripts/email-fetch.ts --help >/dev/null
node --experimental-strip-types packages/openpi-tools/scripts/calendar-today.ts --help >/dev/null
node --experimental-strip-types packages/openpi-tools/scripts/notify.ts --help >/dev/null

echo "==> doctor (may fail if not enabled; non-fatal)"
node --experimental-strip-types packages/openpi-bootstrap/src/cli.ts doctor || true

echo "OpenPI smoke OK"
