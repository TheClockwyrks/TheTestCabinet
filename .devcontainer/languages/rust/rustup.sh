#!/usr/bin/env bash
# Installs Rust via rustup, with rustfmt. Clippy arrives with the toolchain
# instead: rust-toolchain.toml lists it in `components`, and rustup materializes
# it the first time a cargo command runs in the workspace.
set -euo pipefail

# The toolchain rustup installs, from the compose file's build args. It is the
# same version rust-toolchain.toml pins, so the image ships the compiler every
# checkout then builds with rather than downloading a second one on first use.
: "${RUST_VERSION:?RUST_VERSION must be set}"

# rustup's own version, pinned the way the toolchain it installs is. The
# `sh.rustup.rs` bootstrap always serves the current release, so a rebuild would
# otherwise pick up whatever rustup shipped that week; the archive publishes
# every release at a stable path. See
# https://static.rust-lang.org/rustup/release-stable.toml for what is current,
# and override with the RUSTUP_VERSION env var when bumping.
readonly RUSTUP_VERSION="${RUSTUP_VERSION:-1.29.1}"

# The archive names its builds by target triple. Read out of the image rather
# than passed in as a build arg; see "Architecture" in .devcontainer/README.md.
# No separate run-it-once check is needed here, unlike the other hand-downloaded binaries:
# the build executes rustup-init immediately, so a binary for the wrong CPU
# fails on this line rather than several layers later.
arch="$(dpkg --print-architecture)"
case "$arch" in
	amd64) readonly RUSTUP_TARGET_TRIPLE="x86_64-unknown-linux-gnu" ;;
	arm64) readonly RUSTUP_TARGET_TRIPLE="aarch64-unknown-linux-gnu" ;;
	*)
		echo "rustup.sh: unsupported architecture '$arch'" >&2
		exit 1
		;;
esac

readonly RUSTUP_INIT_URL="https://static.rust-lang.org/rustup/archive/${RUSTUP_VERSION}/${RUSTUP_TARGET_TRIPLE}/rustup-init"
readonly RUSTUP_INIT="/tmp/rustup-init"

curl --proto '=https' --tlsv1.2 -sSf -o "$RUSTUP_INIT" "$RUSTUP_INIT_URL"
chmod +x "$RUSTUP_INIT"
"$RUSTUP_INIT" -y \
	--default-toolchain "$RUST_VERSION" \
	--component rustfmt
rm -f "$RUSTUP_INIT"

# shellcheck disable=SC2016
if ! grep -Fqx 'export PATH="$HOME/.cargo/bin:$PATH"' "$HOME/.bashrc"; then
	echo 'export PATH="$HOME/.cargo/bin:$PATH"' >> "$HOME/.bashrc"
fi
