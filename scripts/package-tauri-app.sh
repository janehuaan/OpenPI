#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

echo "🎨 1. Building React 19 Frontend with Vite..."
yarn --cwd apps/desktop build

echo "🔨 2. Building Rust Release Binaries (openpi-daemon & openpi-desktop)..."
cargo build --release -p openpi-daemon

echo "📦 3. Packaging Tauri Desktop Application Bundle..."
yarn --cwd apps/desktop tauri build

APP_BUNDLE="$DIR/target/release/bundle/macos/OpenPI.app"

# Embed openpi-daemon into the .app bundle so it is 100% self-contained
echo "🔗 4. Embedding openpi-daemon into OpenPI.app/Contents/MacOS/..."
cp "$DIR/target/release/openpi-daemon" "$APP_BUNDLE/Contents/MacOS/openpi-daemon"

echo "🎉 OpenPI.app packaging complete at: $APP_BUNDLE"
du -sh "$APP_BUNDLE"
