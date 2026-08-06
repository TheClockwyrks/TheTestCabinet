#!/usr/bin/env bash
#
# Refresh the COMMITTED artifacts this package produces:
#
#   crates/gg/src/sandbox/checkers/purescript.libraries.tar.gz  the library set, COMPILED: every
#                                                               package's PureScript sources plus the
#                                                               externs and JavaScript `purs` emitted
#                                                               for them
#   crates/gg/src/sandbox/checkers/purescript.compiler.json     what that tree was built from and
#                                                               what is in it
#
# They are named for the PROGRAM LANGUAGE they serve, exactly as the other arms' artifacts are.
#
# WHY A COMPILED TREE IS COMMITTED AT ALL. `purs` cannot type-check a program without the sources
# AND the externs of everything it imports (measured: with externs alone, every import is
# `ModuleNotFound`), and compiling the library set from scratch takes ~16 s — which is not a cost a
# turn can pay. So the set is compiled once, here, and shipped. It rides inside gg's binary rather
# than in the run image for the reason every other artifact does: gg is copied as a single file into
# an ephemeral run container, and a tree that lived in the image could be a different vintage from
# the binary reading it — which, once the SDK's own modules are in this tree, would mean a model
# writing against one surface and being compiled against another.
#
# What does NOT ride in the binary is `purs` itself: it is a ~100 MB statically linked Haskell
# executable with one build per platform, so it is installed into the gg toolchain image
# (`containers/gg-toolchains/Dockerfile`) and found on `PATH` at run time. `esbuild`, which flattens
# the module graph `purs` emits into the one script the guest evaluates, is there for the same
# reason.
#
# The tree is checked in, so no build or CI step ever needs `purs` or Spago: the Rust host reads it
# with `include_bytes!`. That is also why this script is never wired into a build — it is run by
# hand, deliberately, and its output is committed alongside the source change that motivated it.
#
# Run it after changing:
#
#   * spago.yaml                  (the library set a program may import)
#   * purescript-version.sh       (the compiler, the bundler, or the registry package set)
#   * src/**                      (this arm's PureScript SDK, once it exists — its modules are
#                                  compiled into the same tree, so a change there is a change here)
#
# Requires Node and network access: the pinned `purescript`, `spago` and `esbuild` come from npm,
# and Spago fetches the package set's sources from the registry. It takes about a minute and emits
# ~1.3 MB.
#
# Usage:
#   packages/gg-sandbox-purescript/build.sh
set -euo pipefail

# Repo root, independent of the caller's working directory.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PACKAGE="packages/gg-sandbox-purescript"
DEST_DIR="crates/gg/src/sandbox/checkers"
TARBALL="$DEST_DIR/purescript.libraries.tar.gz"
MANIFEST="$DEST_DIR/purescript.compiler.json"

# The compiler, bundler, Spago and registry pins.
# shellcheck source=packages/gg-sandbox-purescript/purescript-version.sh
source "$ROOT/$PACKAGE/purescript-version.sh"

BUILD_DIR="$PACKAGE/.build"
TREE_DIR="$BUILD_DIR/tree"
mkdir -p "$DEST_DIR" "$BUILD_DIR"

# 1. Vendor the toolchain from npm. `purescript` and `esbuild` both ship a platform binary; the
#    versions are the ones the run image installs, so the tree is compiled by the same `purs` that
#    will compile programs against it.
echo "Vendoring purescript@$PURS_VERSION, spago@$SPAGO_VERSION and esbuild@$ESBUILD_VERSION ..."
npm install --silent --no-audit --no-fund --prefix "$BUILD_DIR" \
	"purescript@$PURS_VERSION" "spago@$SPAGO_VERSION" "esbuild@$ESBUILD_VERSION"
export PATH="$ROOT/$BUILD_DIR/node_modules/.bin:$PATH"

CUT_PURS="$(purs --version)"
if [ "$CUT_PURS" != "$PURS_VERSION" ]; then
	echo "error: purescript-version.sh pins purs at $PURS_VERSION but the vendored one reports $CUT_PURS." >&2
	exit 1
fi

# 2. Resolve the package set and fetch every package's sources. Spago writes `spago.lock` beside
#    `spago.yaml`; both are committed, so which versions this resolved to is reviewable rather than
#    implicit in a tarball.
echo "Resolving the package set against registry $REGISTRY_VERSION ..."
(cd "$PACKAGE" && spago install)

# 3. Stage the sources under a layout that owes nothing to Spago. What ships is `libs/<package
#    name>-<version>/src/**`, which is what the run-time compile globs — so nothing at run time has
#    to know Spago exists, and the paths recorded in `output/cache-db.json` are relative to the tree
#    root and therefore the same on every machine.
echo "Staging the library sources ..."
rm -rf "$TREE_DIR"
mkdir -p "$TREE_DIR/libs"
for package in "$PACKAGE"/.spago/p/*/; do
	name="$(basename "$package")"
	mkdir -p "$TREE_DIR/libs/$name"
	cp -aL "$package/src" "$TREE_DIR/libs/$name/src"
done

# 4. Compile it, with exactly the arguments a turn's compile uses. `purs` writes `externs.cbor` and
#    `index.js` per module and copies each module's FFI in as `foreign.js`; nothing else is emitted
#    at the default codegen, so there is nothing to prune.
echo "Compiling the library set ..."
(cd "$TREE_DIR" && purs compile --output output 'libs/*/src/**/*.purs')

# 5. Pack it. The flags are all about making the same inputs produce the same bytes: entries sorted,
#    ownership and timestamps zeroed, and gzip told not to stamp the archive with the time of day.
#    Nothing depends on that reproducibility today — the drift gate verifies this artifact by its
#    declared contents rather than by re-cutting it — but an artifact that changes when nothing did
#    is one nobody can review.
echo "Packing the tree ..."
tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner \
	-cf "$BUILD_DIR/libraries.tar" -C "$TREE_DIR" libs output
gzip -9 -n -c "$BUILD_DIR/libraries.tar" > "$TARBALL"

# 6. Write the manifest: what compiled the tree, and what is in it. The package list is read out of
#    the staged tree rather than out of `spago.yaml`, so it names what actually shipped — including
#    the transitive packages nobody wrote down — and `purescript.compile.rs`'s own gate holds the
#    two to each other.
echo "Writing the manifest ..."
export PURS_VERSION ESBUILD_VERSION REGISTRY_VERSION
node - "$TREE_DIR" "$MANIFEST" <<'NODE'
const fs = require("node:fs");
const [treeDir, manifestPath] = process.argv.slice(2);
const packages = fs
	.readdirSync(`${treeDir}/libs`, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name)
	.sort()
	.map((name) => {
		const cut = name.lastIndexOf("-");
		return { name: name.slice(0, cut), version: name.slice(cut + 1) };
	});
const modules = fs
	.readdirSync(`${treeDir}/output`, { withFileTypes: true })
	.filter((entry) => entry.isDirectory()).length;
const manifest = {
	purs: process.env.PURS_VERSION,
	esbuild: process.env.ESBUILD_VERSION,
	registry: process.env.REGISTRY_VERSION,
	modules,
	packages,
};
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`);
NODE

echo
echo "Wrote:"
ls -la "$TARBALL" "$MANIFEST"
echo
echo "Commit both. gg embeds the tarball with include_bytes! and unpacks it once per process."
