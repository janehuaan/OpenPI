#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

echo "🎨 1. Building React 19 Frontend with Vite..."
npm run build:web -w @openpi/desktop

echo "🔨 2. Building Rust Release Binaries (openpi-daemon & openpi-desktop)..."
cargo build --release -p openpi-daemon -p openpi-desktop

APP_DIR="$DIR/dist/OpenPI-Tauri.app"
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS"
mkdir -p "$APP_DIR/Contents/Resources"

echo "📦 3. Assembling macOS Application Bundle..."
# Copy Tauri binary
cp target/release/openpi-desktop "$APP_DIR/Contents/MacOS/OpenPI"

# Copy Daemon binary
cp target/release/openpi-daemon "$APP_DIR/Contents/MacOS/openpi-daemon"

# Copy App Icon
if [ -f "$DIR/apps/desktop/build/icon.icns" ]; then
    cp "$DIR/apps/desktop/build/icon.icns" "$APP_DIR/Contents/Resources/icon.icns"
fi

cat << 'PLIST' > "$APP_DIR/Contents/Info.plist"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>OpenPI</string>
    <key>CFBundleIconFile</key>
    <string>icon</string>
    <key>CFBundleIdentifier</key>
    <string>com.openpi.desktop</string>
    <key>CFBundleName</key>
    <string>OpenPI</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>0.2.3</string>
    <key>LSMinimumSystemVersion</key>
    <string>12.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
PLIST

echo "🎉 OpenPI-Tauri.app packaging complete!"
du -sh "$APP_DIR"
