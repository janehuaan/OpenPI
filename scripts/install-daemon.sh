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

# Replacing the nested daemon invalidates the bundle seal, so re-sign in place —
# nested code first, bundle last, exactly like scripts/package-tauri-app.sh. An
# unsigned bundle cannot hold its Full Disk Access grant.
if [[ -f "$DEST_APP" && -d "/Applications/OpenPI.app" ]]; then
    IDENTITY="${OPENPI_SIGN_IDENTITY:-$(security find-identity -v -p codesigning 2>/dev/null | grep -m1 -oE '"Apple Development: [^"]+"' | tr -d '"')}"
    if [ -n "$IDENTITY" ]; then
        SIGN=(--force --timestamp=none --sign "$IDENTITY")
    else
        echo "   ⚠️  no signing identity found — falling back to ad-hoc"
        SIGN=(--force --sign -)
    fi
    codesign "${SIGN[@]}" "$DEST_APP"
    codesign "${SIGN[@]}" "/Applications/OpenPI.app"
    codesign --verify --deep --strict "/Applications/OpenPI.app"
    echo "✓ re-signed /Applications/OpenPI.app"
fi

# Ask the current daemon to exit; the app supervisor respawns it from the freshly
# installed binary. This keeps the update supervised instead of self-destructive.
#
# The verdict comes from the process table, never from the reply. An earlier
# version of this script sent `shutdown`, hung up, and printed "asked the running
# daemon to restart" — while the daemon (and the old binary) kept running,
# because the handler was cancelled before it could exit. A deploy that silently
# does nothing is worse than one that fails loudly.
if [[ -S "$SOCK" ]]; then
    if ! python3 - "$SOCK" <<'PY'
import json, os, socket, subprocess, sys, time

sock = sys.argv[1]


def rpc(payload, expect_reply=True, timeout=2.0):
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect(sock)
        s.sendall(json.dumps(payload).encode() + b"\n")
        if not expect_reply:
            return None
        buf = b""
        while b"\n" not in buf:
            chunk = s.recv(4096)
            if not chunk:
                break
            buf += chunk
        return json.loads(buf.decode()) if buf.strip() else None
    except (OSError, ValueError):
        return None
    finally:
        s.close()


def still_running(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    # A zombie is already dead; its parent just has not reaped it yet.
    state = subprocess.run(
        ["ps", "-o", "state=", "-p", str(pid)], capture_output=True, text=True
    ).stdout.strip()
    return not state.startswith("Z")


health = rpc({"type": "health", "id": "deploy-health"})
pid = ((health or {}).get("data") or {}).get("pid")
if not pid:
    print("·  no live daemon answered on the socket — nothing to restart")
    sys.exit(0)

# Same shape as before: send the shutdown and hang up without reading the reply.
rpc({"type": "shutdown", "id": "deploy"}, expect_reply=False)

for _ in range(100):  # up to 10s
    time.sleep(0.1)
    if not still_running(pid):
        break
else:
    print(f"❌ daemon {pid} is STILL RUNNING after the shutdown request — the old binary is still in use")
    sys.exit(1)

# The app spawns the replacement lazily, on its next request. Say which of the two
# actually happened instead of implying the new binary is already serving.
for _ in range(50):  # up to 5s
    health = rpc({"type": "health", "id": "deploy-after"}, timeout=0.5)
    new_pid = ((health or {}).get("data") or {}).get("pid")
    if new_pid and new_pid != pid:
        print(f"✓ daemon {pid} stopped; {new_pid} is now serving the new binary")
        sys.exit(0)
    time.sleep(0.1)

print(f"✓ daemon {pid} stopped; the app will spawn the new binary on its next request")
sys.exit(0)

PY
    then
        echo "error: the running daemon did not stop; the old binary is still loaded" >&2
        exit 1
    fi
fi
