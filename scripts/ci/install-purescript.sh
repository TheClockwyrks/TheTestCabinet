#!/usr/bin/env bash
# Install the PureScript program language's toolchain — `purs` and `esbuild` — so a
# machine running gg's test suite has the same two binaries a gg run container does
# (containers/gg-toolchains/Dockerfile). Pinned to the versions in
# packages/gg-sandbox-purescript/purescript-version.sh, so every machine agrees.
#
# WHY THIS EXISTS AT ALL, when no other language arm needs an install step. gg's other
# compiled arm carries its compiler inside gg's own binary: Opal is 2.9 MB of JavaScript
# and runs with the `node` every image already has. `purs` cannot be carried — it is a
# ~100 MB statically linked Haskell executable with a separate build per platform — so it
# is installed, into the run image for a run and here for a test. `esbuild`, which
# flattens the module graph `purs` emits into the one script the guest evaluates, is a
# 10 MB Go binary with the same property.
#
# Neither is fetched through npm. `npm install purescript` runs a postinstall that
# downloads exactly the tarball this script downloads, and it leaves a node_modules tree
# where a container wants a binary; going to the release directly is the same bytes with
# nothing around them, and it is what the toolchain image does too.
#
# Idempotent: a matching version already installed (a developer's machine, a cache
# restore) is left alone.
#
# Usage:
#   scripts/ci/install-purescript.sh            # -> $HOME/.local/bin
#   PURS_INSTALL_DIR=/opt/gg/toolchains/bin scripts/ci/install-purescript.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=packages/gg-sandbox-purescript/purescript-version.sh
source "$ROOT/packages/gg-sandbox-purescript/purescript-version.sh"
# shellcheck source=scripts/ci/fetch.sh
source "$ROOT/scripts/ci/fetch.sh"

INSTALL_DIR="${PURS_INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$INSTALL_DIR"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

case "$(uname -s)-$(uname -m)" in
Linux-x86_64) PURS_ASSET="linux64" ESBUILD_PLATFORM="linux-x64" ;;
Linux-aarch64 | Linux-arm64) PURS_ASSET="linux-arm64" ESBUILD_PLATFORM="linux-arm64" ;;
Darwin-x86_64) PURS_ASSET="macos" ESBUILD_PLATFORM="darwin-x64" ;;
Darwin-arm64) PURS_ASSET="macos-arm64" ESBUILD_PLATFORM="darwin-arm64" ;;
*)
	echo "error: no pinned purs build for $(uname -s)-$(uname -m)." >&2
	echo "       The PureScript arm's tests need one; see purescript-version.sh." >&2
	exit 1
	;;
esac

# --- purs -------------------------------------------------------------------
if [ -x "$INSTALL_DIR/purs" ] && [ "$("$INSTALL_DIR/purs" --version 2>/dev/null)" = "$PURS_VERSION" ]; then
	echo "purs $PURS_VERSION already installed"
else
	echo "Installing purs $PURS_VERSION ($PURS_ASSET) -> $INSTALL_DIR"
	gg_fetch \
		"https://github.com/purescript/purescript/releases/download/v$PURS_VERSION/$PURS_ASSET.tar.gz" \
		"$WORK/purs.tar.gz"
	tar -xzf "$WORK/purs.tar.gz" -C "$WORK"
	install -m 0755 "$WORK/purescript/purs" "$INSTALL_DIR/purs"
	"$INSTALL_DIR/purs" --version
fi

# --- esbuild ----------------------------------------------------------------
if [ -x "$INSTALL_DIR/esbuild" ] && [ "$("$INSTALL_DIR/esbuild" --version 2>/dev/null)" = "$ESBUILD_VERSION" ]; then
	echo "esbuild $ESBUILD_VERSION already installed"
else
	echo "Installing esbuild $ESBUILD_VERSION ($ESBUILD_PLATFORM) -> $INSTALL_DIR"
	gg_fetch \
		"https://registry.npmjs.org/@esbuild/$ESBUILD_PLATFORM/-/$ESBUILD_PLATFORM-$ESBUILD_VERSION.tgz" \
		"$WORK/esbuild.tgz"
	tar -xzf "$WORK/esbuild.tgz" -C "$WORK"
	install -m 0755 "$WORK/package/bin/esbuild" "$INSTALL_DIR/esbuild"
	"$INSTALL_DIR/esbuild" --version
fi
