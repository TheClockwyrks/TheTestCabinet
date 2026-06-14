#!/usr/bin/env bash
# Installs Rust via rustup, with rustfmt and clippy.
set -euo pipefail

curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | \
	sh -s -- -y \
		--default-toolchain "$RUST_VERSION" \
		--component rustfmt clippy

# shellcheck disable=SC2016
if ! grep -Fqx 'export PATH="$HOME/.cargo/bin:$PATH"' "$HOME/.bashrc"; then
	echo 'export PATH="$HOME/.cargo/bin:$PATH"' >> "$HOME/.bashrc"
fi
