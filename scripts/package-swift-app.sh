#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR/swift"

echo "🔨 Building Swift Release Binaries..."
swift build -c release

APP_DIR="$DIR/dist/OpenPI.app"
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS"
mkdir -p "$APP_DIR/Contents/Resources/openpi"

# Copy Desktop binary
cp .build/release/OpenPIDesktop "$APP_DIR/Contents/MacOS/OpenPI"

# Copy Daemon binary
cp .build/release/openpi-daemon "$APP_DIR/Contents/MacOS/openpi-daemon"
cp .build/release/openpi-daemon "$APP_DIR/Contents/Resources/openpi/openpi-daemon"
if [ -f "$DIR/apps/desktop/build/icon.icns" ]; then
    cp "$DIR/apps/desktop/build/icon.icns" "$APP_DIR/Contents/Resources/AppIcon.icns"
fi

cat << 'PLIST' > "$APP_DIR/Contents/Info.plist"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>OpenPI</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>CFBundleIdentifier</key>
    <string>com.openpi.desktop</string>
    <key>CFBundleName</key>
    <string>OpenPI</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>0.2.0</string>
    <key>LSMinimumSystemVersion</key>
    <string>14.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
PLIST

echo "🎉 OpenPI.app packaging complete!"
du -sh "$APP_DIR"
