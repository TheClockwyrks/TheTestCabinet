#!/usr/bin/env bash
# Installs cargo-nextest, the repo's Rust test runner (see .config/nextest.toml).
set -euo pipefail

readonly CARGO="$HOME/.cargo/bin/cargo"
readonly BINSTALL_INSTALL_SCRIPT="https://raw.githubusercontent.com/cargo-bins/cargo-binstall/main/install-from-binstall-release.sh"

# The triple cargo-binstall fetches the prebuilt cargo-nextest for, resolved from the
# machine this runs on rather than passed in. Upstream publishes both a gnu and a musl
# build per architecture; these are the two this image installs.
case "$(uname -m)" in
x86_64) readonly NEXTEST_TARGET_TRIPLE="x86_64-unknown-linux-musl" ;;
aarch64 | arm64) readonly NEXTEST_TARGET_TRIPLE="aarch64-unknown-linux-gnu" ;;
*)
	echo "error: no cargo-nextest build for $(uname -m)." >&2
	exit 1
	;;
esac

curl -L --proto '=https' --tlsv1.2 -sSf "$BINSTALL_INSTALL_SCRIPT" | bash
"$CARGO" binstall -y cargo-nextest --secure --version "$NEXTEST_VERSION" --target "$NEXTEST_TARGET_TRIPLE"
