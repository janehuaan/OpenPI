#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

if [[ "$(uname -s)" != Darwin ]]; then
    echo "error: Tauri packaging is supported only on macOS" >&2
    exit 1
fi

for tool in yarn cargo node rsync codesign ditto unzip; do
    command -v "$tool" >/dev/null || { echo "error: missing $tool" >&2; exit 1; }
done

[[ -f "$DIR/yarn.lock" && -d "$DIR/node_modules/@earendil-works/pi-coding-agent" ]] || {
    echo "error: install the yarn.lock dependencies before packaging" >&2
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

echo "🔗 3. Embedding openpi-daemon binary..."
mkdir -p "$RUNTIME/bin" "$RUNTIME/node_modules"
cp "$DAEMON" "$RUNTIME/bin/openpi-daemon"
chmod +x "$RUNTIME/bin/openpi-daemon"

echo "🧹 4. Pruning and copying ONLY required production runtime dependencies (excluding dev/frontend bloat)..."
python3 -c "
import os, json, subprocess

visited = set()
to_visit = [
    '@earendil-works/pi-coding-agent',
    '@earendil-works/pi-ai',
    '@earendil-works/pi-agent-core',
    '@earendil-works/chord',
    '@earendil-works/pi-tui'
]

while to_visit:
    pkg = to_visit.pop(0)
    if pkg in visited:
        continue
    visited.add(pkg)
    
    pkg_json = os.path.join('$DIR/node_modules', pkg, 'package.json')
    if os.path.exists(pkg_json):
        try:
            with open(pkg_json) as f:
                data = json.load(f)
            for dep in data.get('dependencies', {}).keys():
                if dep not in visited:
                    to_visit.append(dep)
        except Exception:
            pass

target_nm = '$RUNTIME/node_modules'
subprocess.run(['rm', '-rf', target_nm], check=True)
os.makedirs(target_nm, exist_ok=True)

for pkg in sorted(list(visited)):
    src = os.path.join('$DIR/node_modules', pkg)
    dest = os.path.join(target_nm, pkg)
    if os.path.exists(src):
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        subprocess.run(['rsync', '-aL', f'{src}/', f'{dest}/'], check=True)

print(f'Successfully copied {len(visited)} essential production runtime packages.')
"

CLI="$RUNTIME/node_modules/@earendil-works/pi-coding-agent/dist/cli.js"
RPC="$RUNTIME/node_modules/@earendil-works/pi-coding-agent/dist/rpc-entry.js"
[[ -f "$CLI" && -f "$RPC" ]] || {
    echo "error: pi CLI or RPC entry is missing from the packaged dependencies" >&2
    exit 1
}

# Verify that system Node can cleanly import the bundled pi agent
node --check "$CLI"
node --check "$RPC"
node --input-type=module -e 'await import(process.argv[1])' "$RUNTIME/node_modules/@earendil-works/pi-coding-agent/dist/index.js" || {
    echo "error: bundled pi dependencies cannot be loaded with Node" >&2
    exit 1
}

echo "📝 5. Generating daemon launcher..."
cat > "$APP_BUNDLE/Contents/MacOS/openpi-daemon" <<'LAUNCHER'
#!/bin/bash
set -euo pipefail
MACOS_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNTIME="$MACOS_DIR/../Resources/openpi"
export OPENPI_PI_CLI_PATH="$RUNTIME/node_modules/@earendil-works/pi-coding-agent/dist/cli.js"
export OPENPI_PI_RPC_ENTRY="$RUNTIME/node_modules/@earendil-works/pi-coding-agent/dist/rpc-entry.js"
exec "$RUNTIME/bin/openpi-daemon" "$@"
LAUNCHER
chmod +x "$APP_BUNDLE/Contents/MacOS/openpi-daemon"
bash -n "$APP_BUNDLE/Contents/MacOS/openpi-daemon"

echo "🔏 6. Re-signing application bundle..."
codesign --force --deep --sign - "$APP_BUNDLE"
codesign --verify --deep --strict "$APP_BUNDLE"

echo "🗜️ 7. Compressing application archive with maximum compression..."
VERSION="$(node -p "require('./apps/desktop/src-tauri/tauri.conf.json').version")"
ZIP="$DIR/target/release/bundle/OpenPI_${VERSION}_${ARCH}.zip"
rm -f "$ZIP"
ditto -c -k --zlibCompressionLevel 9 --noextattr --noacl --noqtn --keepParent "$APP_BUNDLE" "$ZIP"
unzip -tq "$ZIP"
for entry in 'Contents/MacOS/openpi-daemon' 'Contents/Resources/openpi/bin/openpi-daemon' 'Contents/Resources/openpi/node_modules/@earendil-works/pi-coding-agent/dist/rpc-entry.js'; do
    unzip -Z1 "$ZIP" | grep -Fx "OpenPI.app/$entry" >/dev/null || {
        echo "error: release archive is missing $entry" >&2
        exit 1
    }
done

echo "🎉 Success! Packaged lightweight macOS Tauri app: $ZIP"
du -sh "$APP_BUNDLE"
ls -lh "$ZIP"
