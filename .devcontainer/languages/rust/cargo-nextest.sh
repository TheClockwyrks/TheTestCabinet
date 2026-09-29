#!/usr/bin/env bash
# Installs cargo-nextest, the repo's Rust test runner (see .config/nextest.toml).
set -euo pipefail

# cargo lands in CARGO_HOME, which languages/rust/rustup.sh leaves to the
# caller: the default under the container user's home here, /usr/local/cargo
# in the CI images under ci/images/. cargo-binstall reads the same variable
# when it places the binary, so nextest lands beside the cargo that runs it.
readonly CARGO="${CARGO_HOME:-$HOME/.cargo}/bin/cargo"

# cargo-binstall is the downloader that places the nextest release binary. Both
# halves of it are pinned to the same tag: the bootstrap script is read from
# that tag rather than from `main`, and BINSTALL_VERSION tells the script which
# release to fetch instead of letting it resolve `releases/latest`. Pinning only
# one of the two leaves the other free to move under it. Override with the
# BINSTALL_VERSION env var when bumping; see
# https://github.com/cargo-bins/cargo-binstall/releases for the version list.
BINSTALL_VERSION="${BINSTALL_VERSION:-1.23.0}"
export BINSTALL_VERSION
readonly BINSTALL_VERSION
readonly BINSTALL_INSTALL_SCRIPT="https://raw.githubusercontent.com/cargo-bins/cargo-binstall/v${BINSTALL_VERSION}/install-from-binstall-release.sh"

# The target triple nextest publishes a binary for on this architecture. Read
# out of the image rather than passed in as a build arg — see "Architecture" in
# .devcontainer/README.md.
arch="$(dpkg --print-architecture)"
case "$arch" in
	amd64) readonly NEXTEST_TARGET_TRIPLE="x86_64-unknown-linux-musl" ;;
	arm64) readonly NEXTEST_TARGET_TRIPLE="aarch64-unknown-linux-gnu" ;;
	*)
		echo "cargo-nextest.sh: unsupported architecture '$arch'" >&2
		exit 1
		;;
esac

curl -L --proto '=https' --tlsv1.2 -sSf "$BINSTALL_INSTALL_SCRIPT" | bash
"$CARGO" binstall -y cargo-nextest --secure --version "$NEXTEST_VERSION" --target "$NEXTEST_TARGET_TRIPLE"

# Run it once. cargo-binstall downloads and places the binary without ever
# executing it, so a build for the wrong architecture installs perfectly quietly
# and first fails in `cargo nextest run` — the repo's test gate, a long way from
# here and from anything that mentions an architecture. See "Architecture" in
# .devcontainer/README.md.
if ! "$CARGO" nextest --version >/dev/null 2>&1; then
	echo "cargo-nextest.sh: the $NEXTEST_TARGET_TRIPLE build does not run here" >&2
	echo "  dpkg --print-architecture: $arch; uname -m: $(uname -m)" >&2
	exit 1
fi
