#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "🛑 1. Stopping running OpenPI processes..."
pkill -f "OpenPI" || true
pkill -f "openpi-desktop" || true
pkill -f "openpi-daemon" || true
pkill -f "rpc-entry.js" || true
sleep 1

# Clean stale socket
rm -f "$HOME/.openpi/daemon.sock"

APP_BUNDLE="$DIR/target/release/bundle/macos/OpenPI.app"

if [ ! -d "$APP_BUNDLE" ]; then
    echo "⚠️ Target app bundle not found, compiling and packaging now..."
    "$DIR/scripts/package-tauri-app.sh"
fi

# Ensure openpi-daemon is inside the app bundle
if [ -f "$DIR/target/release/openpi-daemon" ]; then
    echo "🔗 Embedding latest openpi-daemon into bundle..."
    cp "$DIR/target/release/openpi-daemon" "$APP_BUNDLE/Contents/MacOS/openpi-daemon"
fi

echo "📦 2. Installing native OpenPI.app to /Applications..."
rm -rf /Applications/OpenPI.app
cp -R "$APP_BUNDLE" /Applications/OpenPI.app

# Also install daemon to ~/.local/bin and /usr/local/bin if writable
if [ -f "$DIR/target/release/openpi-daemon" ]; then
    mkdir -p "$HOME/.local/bin"
    cp "$DIR/target/release/openpi-daemon" "$HOME/.local/bin/openpi-daemon"
    chmod +x "$HOME/.local/bin/openpi-daemon"
    if [ -w /usr/local/bin ]; then
        cp "$DIR/target/release/openpi-daemon" /usr/local/bin/openpi-daemon 2>/dev/null || true
    fi
fi

# Refresh macOS LaunchServices registry for OpenPI.app
if [ -x /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister ]; then
    echo "🔄 3. Refreshing macOS LaunchServices registry..."
    /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f /Applications/OpenPI.app
fi

echo "✅ 4. Successfully installed to /Applications/OpenPI.app!"
echo "   - Version: $(defaults read /Applications/OpenPI.app/Contents/Info CFBundleShortVersionString)"
echo "   - Identifier: $(defaults read /Applications/OpenPI.app/Contents/Info CFBundleIdentifier)"
echo "   - App Size: $(du -sh /Applications/OpenPI.app | awk '{print $1}')"
echo "   - Contents:"
ls -la /Applications/OpenPI.app/Contents/MacOS/
