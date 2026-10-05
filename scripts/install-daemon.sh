#!/usr/bin/env bash
# Atomically deploy a freshly built openpi-daemon and restart the running one.
#
# Never `cp` over a running daemon: an in-place write truncates a file that is
# already mapped into the live process, which corrupts its pages and wedges it.
# The process stays alive but stops answering — indistinguishable from "still
# working" in the UI, which is how a run can appear to hang for hours.
#
# Installing to a temp file and renaming swaps the inode instead, so the live
# process keeps its old image until it is deliberately restarted by the app's
# supervisor (not by the agent killing itself).
#
# Usage: scripts/install-daemon.sh [path-to-openpi-daemon]
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-$DIR/target/debug/openpi-daemon}"
DEST_APP="/Applications/OpenPI.app/Contents/Resources/openpi/bin/openpi-daemon"
DEST_LOCAL="$HOME/.local/bin/openpi-daemon"
SOCK="${OPENPI_SOCKET_PATH:-$HOME/.openpi/openpi.sock}"

[[ -x "$SRC" ]] || { echo "error: source daemon not found or not executable: $SRC" >&2; exit 1; }

atomic_install() {
    local dest="$1"
    [[ -d "$(dirname "$dest")" ]] || return 0
    local tmp="$dest.tmp.$$"
    install -m 755 "$SRC" "$tmp"
    mv -f "$tmp" "$dest"
    echo "✓ installed $dest"
}

atomic_install "$DEST_APP"
atomic_install "$DEST_LOCAL"

# Ask the current daemon to exit; the app supervisor respawns it from the freshly
# installed binary. This keeps the update supervised instead of self-destructive.
if [[ -S "$SOCK" ]]; then
    python3 - "$SOCK" <<'PY' || true
import socket, sys
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.settimeout(2)
try:
    s.connect(sys.argv[1])
    s.sendall(b'{"type":"shutdown","id":"deploy"}\n')
except Exception as exc:
    print(f"(restart request skipped: {exc})")
finally:
    s.close()
PY
    echo "↻ asked the running daemon to restart"
fi
