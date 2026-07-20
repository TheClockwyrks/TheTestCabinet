#!/usr/bin/env bash
# Installs cargo-nextest, the repo's Rust test runner (see .config/nextest.toml).
set -euo pipefail

readonly CARGO="$HOME/.cargo/bin/cargo"
readonly BINSTALL_INSTALL_SCRIPT="https://raw.githubusercontent.com/cargo-bins/cargo-binstall/main/install-from-binstall-release.sh"

if [ "$BUILDARCH" = "amd64" ]; then
	readonly NEXTEST_TARGET_TRIPLE="x86_64-unknown-linux-musl"
else
	readonly NEXTEST_TARGET_TRIPLE="aarch64-unknown-linux-gnu"
fi

curl -L --proto '=https' --tlsv1.2 -sSf "$BINSTALL_INSTALL_SCRIPT" | bash
"$CARGO" binstall -y cargo-nextest --secure --version "$NEXTEST_VERSION" --target "$NEXTEST_TARGET_TRIPLE"
