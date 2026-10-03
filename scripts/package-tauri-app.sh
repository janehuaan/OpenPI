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
rm -f "$RUNTIME/bin/openpi-daemon"
cp -f "$DAEMON" "$RUNTIME/bin/openpi-daemon"
chmod +x "$RUNTIME/bin/openpi-daemon"

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

echo "🔏 5. Re-signing application bundle..."
codesign --force --deep --sign - "$APP_BUNDLE"
codesign --verify --deep --strict "$APP_BUNDLE"

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
