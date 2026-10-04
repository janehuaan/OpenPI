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
rm -f "$HOME/.openpi/daemon.sock" "$HOME/.openpi/openpi.sock"

APP_BUNDLE="$DIR/target/release/bundle/macos/OpenPI.app"

if [ ! -d "$APP_BUNDLE" ]; then
    echo "⚠️ Target app bundle not found, compiling and packaging now..."
    "$DIR/scripts/package-tauri-app.sh"
fi

# Ensure openpi-daemon binary is updated in bundle resources
if [ -f "$DIR/target/release/openpi-daemon" ]; then
    echo "🔗 Updating openpi-daemon in bundle..."
    mkdir -p "$APP_BUNDLE/Contents/Resources/openpi/bin"
    cp "$DIR/target/release/openpi-daemon" "$APP_BUNDLE/Contents/Resources/openpi/bin/openpi-daemon"
    chmod +x "$APP_BUNDLE/Contents/Resources/openpi/bin/openpi-daemon"
    if [ ! -f "$APP_BUNDLE/Contents/MacOS/openpi-daemon" ]; then
        cp "$DIR/target/release/openpi-daemon" "$APP_BUNDLE/Contents/MacOS/openpi-daemon"
    fi
fi

echo "📦 2. Installing native OpenPI.app to /Applications..."
rm -rf /Applications/OpenPI.app
cp -R "$APP_BUNDLE" /Applications/OpenPI.app

# The daemon was copied into the bundle above, after the packager had signed it, so
# the bundle seal no longer matches. Re-sign in place (nested code first, bundle
# last) — otherwise the installed app ships unsigned, and an unsigned binary cannot
# hold a Full Disk Access grant.
IDENTITY="${OPENPI_SIGN_IDENTITY:-$(security find-identity -v -p codesigning 2>/dev/null | grep -m1 -oE '"Apple Development: [^"]+"' | tr -d '"')}"
if [ -n "$IDENTITY" ]; then
    SIGN=(--force --timestamp=none --sign "$IDENTITY")
else
    echo "   ⚠️  no signing identity found — falling back to ad-hoc"
    SIGN=(--force --sign -)
fi
codesign "${SIGN[@]}" /Applications/OpenPI.app/Contents/Resources/openpi/bin/openpi-daemon
codesign "${SIGN[@]}" /Applications/OpenPI.app/Contents/MacOS/openpi-daemon
codesign "${SIGN[@]}" /Applications/OpenPI.app
codesign --verify --deep --strict /Applications/OpenPI.app
echo "   signed by: $(codesign -dv /Applications/OpenPI.app 2>&1 | grep -E 'TeamIdentifier' | tr '\n' ' ')"

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
