#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

if [[ "$(uname -s)" != Darwin ]]; then
    echo "error: Tauri packaging is supported only on macOS" >&2
    exit 1
fi

for tool in yarn cargo codesign ditto unzip; do
    command -v "$tool" >/dev/null || { echo "error: missing $tool" >&2; exit 1; }
done

[[ -f "$DIR/yarn.lock" ]] || {
    echo "error: yarn.lock is missing" >&2
    exit 1
}

ARCH="$(uname -m)"

if [[ "${OPENPI_SKIP_BUILD:-0}" != "1" ]]; then
    echo "🎨 1. Building desktop frontend and daemon..."
    yarn --cwd apps/desktop build
    cargo build --release --locked -p openpi-daemon
    echo "📦 2. Building Tauri application bundle..."
    yarn --cwd apps/desktop tauri build --bundles app
else
    echo "Resuming packaging from existing release build..."
fi

APP_BUNDLE="$DIR/target/release/bundle/macos/OpenPI.app"
RUNTIME="$APP_BUNDLE/Contents/Resources/openpi"
DAEMON="$DIR/target/release/openpi-daemon"
[[ -d "$APP_BUNDLE/Contents/MacOS" && -x "$DAEMON" ]] || {
    echo "error: Tauri app or daemon build output is missing" >&2
    exit 1
}

echo "🔗 3. Embedding pure Rust openpi-daemon binary..."
mkdir -p "$RUNTIME/bin"
# Atomic replace: an in-place `cp` over a *running* daemon truncates a file that
# is already mapped into the live process, corrupting its pages and wedging it.
# Installing to a temp path and renaming swaps the inode instead, so a running
# process keeps its old image until it is deliberately restarted.
install -m 755 "$DAEMON" "$RUNTIME/bin/.openpi-daemon.tmp"
mv -f "$RUNTIME/bin/.openpi-daemon.tmp" "$RUNTIME/bin/openpi-daemon"

echo "📝 4. Generating daemon launcher..."
cat > "$APP_BUNDLE/Contents/MacOS/openpi-daemon" <<'LAUNCHER'
#!/bin/bash
set -euo pipefail
MACOS_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNTIME="$MACOS_DIR/../Resources/openpi"
exec "$RUNTIME/bin/openpi-daemon" "$@"
LAUNCHER
chmod +x "$APP_BUNDLE/Contents/MacOS/openpi-daemon"
bash -n "$APP_BUNDLE/Contents/MacOS/openpi-daemon"

echo "🔏 5. Signing application bundle..."
# Prefer a real identity over ad-hoc. An ad-hoc signature has no Team ID, so macOS
# keys the Full Disk Access grant to a hash of the binary and every rebuild
# silently invalidates it. With a development identity the grant is keyed to
# TeamID + bundle id and survives rebuilds.
IDENTITY="${OPENPI_SIGN_IDENTITY:-$(security find-identity -v -p codesigning 2>/dev/null | grep -m1 -oE '"Apple Development: [^"]+"' | tr -d '"')}"
if [ -n "$IDENTITY" ]; then
    echo "   identity: $IDENTITY"
    SIGN=(--force --timestamp=none --sign "$IDENTITY")
else
    echo "   ⚠️  no signing identity found — falling back to ad-hoc; Full Disk Access will reset on every rebuild"
    SIGN=(--force --sign -)
fi

# Nested code first, bundle last. --deep does not reach Resources/openpi/bin, which
# is why the daemon used to ship unsigned (and unsigned code cannot hold a grant).
codesign "${SIGN[@]}" "$RUNTIME/bin/openpi-daemon"
codesign "${SIGN[@]}" "$APP_BUNDLE/Contents/MacOS/openpi-daemon"
codesign "${SIGN[@]}" "$APP_BUNDLE"
codesign --verify --deep --strict "$APP_BUNDLE"
echo "   signed by: $(codesign -dv "$APP_BUNDLE" 2>&1 | grep -E 'TeamIdentifier|Signature' | tr '\n' ' ')"

echo "🗜️ 6. Compressing application archive with maximum compression..."
VERSION="$(grep -m1 '"version"' "$DIR/apps/desktop/src-tauri/tauri.conf.json" | cut -d'"' -f4)"
ZIP="$DIR/target/release/bundle/OpenPI_${VERSION}_${ARCH}.zip"
rm -f "$ZIP"
ditto -c -k --zlibCompressionLevel 9 --noextattr --noacl --noqtn --keepParent "$APP_BUNDLE" "$ZIP"
unzip -tq "$ZIP"
for entry in 'Contents/MacOS/openpi-daemon' 'Contents/Resources/openpi/bin/openpi-daemon'; do
    unzip -Z1 "$ZIP" | grep -Fx "OpenPI.app/$entry" >/dev/null || {
        echo "error: release archive is missing $entry" >&2
        exit 1
    }
done

echo "🎉 Success! Packaged pure native macOS Tauri app: $ZIP"
du -sh "$APP_BUNDLE"
ls -lh "$ZIP"
