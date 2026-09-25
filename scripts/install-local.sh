#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "🛑 Stopping running OpenPI processes if any..."
pkill -f OpenPI || true
sleep 1

echo "📦 Installing native OpenPI.app to /Applications..."
rm -rf /Applications/OpenPI.app
cp -R "$DIR/dist/OpenPI.app" /Applications/OpenPI.app

echo "✅ Successfully installed to /Applications/OpenPI.app!"
du -sh /Applications/OpenPI.app
