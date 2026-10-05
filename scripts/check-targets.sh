#!/usr/bin/env bash
# Compile the cfg-gated code for the macOS target we are *not* building on.
#
# `cfg(target_arch = "aarch64")` blocks are invisible to a build on x86_64, and
# vice versa. A warning or error can therefore sit in one of them while every
# local check stays green: an `unused_assignments` error in
# crates/openpi-memory/src/metal.rs reached CI on an arm64 runner even though
# the whole workspace passed locally on x86_64. Run this before pushing so the
# other architecture is compiled too.
#
# The host target is skipped because the normal test/clippy runs already cover
# it; this only closes the cross-architecture gap.
set -euo pipefail

cd "$(dirname "$0")/.."

# The Rust toolchain is not on the default PATH on this machine (see AGENTS.md),
# and hooks run in a non-login shell, so add it explicitly.
if [ -d "$HOME/.cargo/bin" ]; then
  PATH="$HOME/.cargo/bin:$PATH"
  export PATH
fi

host="$(rustc -vV | sed -n 's/^host: //p')"
if [ -z "$host" ]; then
  echo "could not determine the rustc host triple" >&2
  exit 1
fi

for target in aarch64-apple-darwin x86_64-apple-darwin; do
  if [ "$target" = "$host" ]; then
    continue
  fi
  echo "==> cargo check --workspace --all-targets --target $target"
  rustup target add "$target"
  RUSTFLAGS="-D warnings" cargo check --workspace --all-targets --target "$target"
done

echo "==> cross-architecture check passed (host: $host)"
