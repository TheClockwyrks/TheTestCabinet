#!/usr/bin/env bash
#
# Regenerate the COMMITTED signature catalogue for the PureScript arm:
#
#   crates/gg/src/sandbox/guests/purescript.signatures.json
#
# gg embeds that file and renders the responses-as-code system prompt and every documentation view
# from it, so it is the whole of what a model is told about this arm's surface. Every word of it is
# reflected out of the SDK's own declarations by `tools/signatures.mjs`, which reads the `docs.json`
# `purs` itself emits — so a doc comment edited without a regeneration is a diff CI fails on rather
# than a sentence that quietly stopped being true.
#
# WHAT IT COMPILES AGAINST. The committed library tree (`purescript.libraries.tar.gz`), unpacked into
# a scratch directory with this package's *working* `src/` staged over the copy inside it. That is
# what makes this a drift check rather than a re-read: the catalogue is regenerated from the sources
# on disk, against the libraries the arm really ships, without needing Spago or the registry.
#
# It needs `purs` — `scripts/ci/install-purescript.sh` puts the pinned release on PATH, and the gg
# run image carries it at /opt/gg/toolchains/bin — and Node. It does NOT need `esbuild`, Spago, or
# network access.
#
# Usage:
#   packages/gg-sandbox-purescript/signatures.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PACKAGE="packages/gg-sandbox-purescript"
TARBALL="crates/gg/src/sandbox/checkers/purescript.libraries.tar.gz"

# The same lookup order the host uses at run time: what an operator named, then what the gg run image
# installs, then whatever PATH finds.
PURS="${TCAB_GG_PURS:-}"
if [ -z "$PURS" ]; then
	if [ -x /opt/gg/toolchains/bin/purs ]; then
		PURS=/opt/gg/toolchains/bin/purs
	else
		PURS=purs
	fi
fi
if ! command -v "$PURS" > /dev/null 2>&1; then
	echo "error: this needs the pinned \`purs\` on PATH; run scripts/ci/install-purescript.sh." >&2
	exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "Unpacking the committed library tree ..."
tar -xzf "$TARBALL" -C "$WORK"

# The SDK inside the committed tarball is whatever was there when it was last built. What this
# catalogue must describe is what is in the working tree, so it is staged over the top — exactly as
# build.sh stages it before compiling the tree in the first place.
rm -rf "$WORK/libs/gg-sdk/src"
mkdir -p "$WORK/libs/gg-sdk"
cp -a "$PACKAGE/src" "$WORK/libs/gg-sdk/src"

# A fresh output directory rather than the tree's own: `purs` emits a module's `docs.json` only when
# it compiles that module, and against the tarball's up-to-date cache it would compile nothing and
# emit nothing. ~20 s, and it is the only slow step here.
echo "Compiling the SDK for its documentation ..."
(cd "$WORK" && "$PURS" compile --codegen docs --output docs 'libs/*/src/**/*.purs' > /dev/null)

echo "Reflecting the catalogue ..."
node "$PACKAGE/tools/signatures.mjs" "$WORK/docs" "$WORK"
