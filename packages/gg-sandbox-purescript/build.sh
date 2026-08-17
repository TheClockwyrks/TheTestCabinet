#!/usr/bin/env bash
#
# Build the artifacts this package produces, into `$GG_ARTIFACTS_OUT_DIR`:
#
#   purescript.libraries.tar.gz  the library set, COMPILED: every package's PureScript sources plus
#                                the externs and JavaScript `purs` emitted for them
#   purescript.compiler.json     what that tree was built from and what is in it
#
# They are named for the PROGRAM LANGUAGE they serve, exactly as the other arms' artifacts are.
#
# WHY A COMPILED TREE IS SHIPPED AT ALL. `purs` cannot type-check a program without the sources AND
# the externs of everything it imports (measured: with externs alone, every import is
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
# Run it after changing:
#
#   * spago.yaml                  (the library set a program may import)
#   * purescript-version.sh       (the compiler, the bundler, or the registry package set)
#   * src/**                      (this arm's PureScript SDK — its modules are compiled into the
#                                  same tree, so a change there is a change here)
#
# None of those is meant to be left to a reader of this comment, and none of them is. They are the
# rerun set this arm's artifact crate declares (`crates/gg-sandbox-artifacts/purescript`, whose
# table lives in `build-support`), so an edit to any of them re-compiles the tree on the next
# `cargo build` and `crates/gg` embeds what lands in that crate's `OUT_DIR`. Nothing is committed and
# nothing gates it.
#
# The third one is why this arm mattered most. The catalogue a model reads is reflected out of `src/`
# on every build, and a compile resolves `Gg` against the SDK inside THIS tarball; while the tarball
# was committed, an SDK edit landed in the catalogue immediately and in the compile only when
# somebody remembered to re-run this — a model shown one surface and compiled against another, with
# every other gate green. `purescript.compile.test.rs::the_shipped_sdk_is_the_sdk_in_the_working_tree`
# used to be the thing that named the drifted file; it is deleted, because the two are now cut from
# the same `src/` by the same `cargo build` and cannot be two vintages.
#
# THIS TARBALL IS ALSO AN INPUT TO THE SIGNATURE REFLECTION, which is the one place any arm's
# artifact and catalogue touch: `signatures.sh` unpacks it and stages the working `src/` over the
# copy inside, because `purs` will not type-check a module whose imports it has no externs for. That
# ordering is enforced by the package graph — `crates/gg` depends on `gg-artifact-purescript`, so
# cargo runs this before the reflection and `crates/gg/build.rs` hands over the path.
#
# Requires `purs` and `esbuild` at the pins — `scripts/ci/install-purescript.sh` installs both, and
# the gg toolchain image carries the same two — plus the pinned `spago` out of the shared tool prefix
# `scripts/ci/install-gg-build-tools.sh` warms and a populated `.spago/p`. It takes about a minute
# and emits ~1.3 MB.
#
# Usage:
#   scripts/gg-artifacts.sh                                          # every arm, into one directory
#   GG_ARTIFACTS_OUT_DIR=<dir> packages/gg-sandbox-purescript/build.sh
set -euo pipefail

# Repo root, independent of the caller's working directory.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PACKAGE="packages/gg-sandbox-purescript"
# Where this package's own SDK is staged inside the tree. Not a registry package and not named like
# one, so the manifest records it separately and a reader can tell the two apart.
SDK_DIR="gg-sdk"

# The destination, which is required and has no default — see the file itself for why.
# shellcheck source=scripts/gg-artifacts-out-dir.sh
source "$ROOT/scripts/gg-artifacts-out-dir.sh"
# shellcheck source=scripts/gg-npm-tools.sh
source "$ROOT/scripts/gg-npm-tools.sh"
# shellcheck source=scripts/gg-downloads.sh
source "$ROOT/scripts/gg-downloads.sh"

# ONE ARM, ONE PROCESS AT A TIME. This package's scratch is a fixed path inside the source tree
# rather than a `mktemp -d`, deliberately — it is a cache — and two cargo processes with two target
# directories do not serialise with each other. See `scripts/gg-scratch-lock.sh`.
# shellcheck source=scripts/gg-scratch-lock.sh
source "$ROOT/scripts/gg-scratch-lock.sh"
gg_lock_scratch "$ROOT/$PACKAGE"

TARBALL="$GG_ARTIFACTS_OUT_DIR/purescript.libraries.tar.gz"
MANIFEST="$GG_ARTIFACTS_OUT_DIR/purescript.compiler.json"

# The compiler, bundler, Spago and registry pins.
# shellcheck source=packages/gg-sandbox-purescript/purescript-version.sh
source "$ROOT/$PACKAGE/purescript-version.sh"

BUILD_DIR="$PACKAGE/.build"
TREE_DIR="$BUILD_DIR/tree"
mkdir -p "$BUILD_DIR"

# 1. Resolve the toolchain, and NOT through npm for two of the three. `purs` and `esbuild` are
#    already installed at these exact pins by `scripts/ci/install-purescript.sh` — which exists
#    because the run image needs the two binaries and not a `node_modules` tree — so reaching for
#    the npm packages here would download a second ~110 MB copy of two files this machine has.
#    Spago has no such installer and no run-time role at all, so it comes out of the shared pinned
#    npm tool prefix.
export PATH="$HOME/.local/bin:/opt/gg/toolchains/bin:$PATH"
SPAGO_DIR="$(gg_npm_tool spago "$SPAGO_VERSION")"
export PATH="$SPAGO_DIR/node_modules/.bin:$PATH"

CUT_PURS="$(purs --version)"
if [ "$CUT_PURS" != "$PURS_VERSION" ]; then
	echo "error: purescript-version.sh pins purs at $PURS_VERSION but the one on PATH reports $CUT_PURS." >&2
	echo "       Run scripts/ci/install-purescript.sh." >&2
	exit 1
fi

# 2. Resolve the package set and fetch every package's sources, ONCE PER DECLARATION. Spago writes
#    `spago.lock` beside `spago.yaml`; both are committed, so which versions this resolved to is
#    reviewable rather than implicit in a tarball.
#
#    THE PACKAGE STORE IS NOT IN THIS CHECKOUT. Spago keeps the registry index, the package sets and
#    every package tarball under `$XDG_CACHE_HOME`, which by default is `~/.cache` — 48 MB nothing
#    warmed, no image carried and `hydrate-gg-toolchains.sh` did not copy, so a fresh CI checkout
#    cloned two PureScript registries from inside `cargo build`. `gg_spago_cache` puts it in the same
#    version-stamped per-user prefix every other pinned download of gg's uses, stamped by the
#    registry package set because that is the pin that decides what is in it; see
#    `scripts/gg-downloads.sh`. `scripts/ci/install-gg-build-tools.sh` warms it.
#
#    THE STAMP IS WHY THIS DOES NOT RESOLVE ON EVERY BUILD. `spago install` against a warm store and
#    a current lockfile completes fast and rewrites nothing — but "fast" is not "free", and this
#    script now runs inside an ordinary `cargo build`. So the resolved state is recorded as a digest
#    and the step is skipped outright when it matches.
#
#    OF BOTH FILES, and that is the correction that matters. The stamp was the lockfile's digest
#    alone, while `spago.yaml` — the file that DECLARES the dependencies and the package set — is in
#    this arm's cargo rerun set. Editing it therefore re-ran this whole build with the resolution
#    step skipped: step 3 staged the previously resolved `.spago/p`, the tarball was compiled against
#    the old set, and the manifest at step 6 is read back out of that same staged tree so it agreed
#    with it. Green, silent, and exactly the drift this arrangement exists to abolish, one level
#    down. Both files digested together means a `spago.yaml` whose lock has not been regenerated
#    re-resolves — and if the two genuinely disagree, Spago is the thing that says so.
echo "Resolving the package set against registry $REGISTRY_VERSION ..."
XDG_CACHE_HOME="$(gg_spago_cache "$REGISTRY_VERSION")"
export XDG_CACHE_HOME
SPAGO_STAMP="$BUILD_DIR/spago.stamp"
DECLARED_DIGEST="$(cat "$PACKAGE/spago.yaml" "$PACKAGE/spago.lock" | sha256sum | cut -d" " -f1)"
if [ -f "$SPAGO_STAMP" ] && [ "$(cat "$SPAGO_STAMP")" = "$DECLARED_DIGEST" ] && [ -d "$PACKAGE/.spago/p" ]; then
	echo "    already resolved for this spago.yaml and spago.lock"
else
	(cd "$PACKAGE" && spago install)
	echo "$DECLARED_DIGEST" >"$SPAGO_STAMP"
fi

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

# 3b. Stage THIS package's own PureScript — the hand-written SDK — into the same tree, under a
#     directory of its own. It is compiled into the tarball exactly as a library is, which is the
#     whole reason the tree rides inside gg's binary rather than in the run image: the surface a
#     model is shown in its prompt and the surface its program is compiled against are then one
#     artifact, and cannot be two vintages.
echo "Staging the SDK ..."
mkdir -p "$TREE_DIR/libs/$SDK_DIR"
cp -aL "$PACKAGE/src" "$TREE_DIR/libs/$SDK_DIR/src"

# 4. Compile it, with exactly the arguments a turn's compile uses. `purs` writes `externs.cbor`,
#    `index.js` and `index.js.map` per module and copies each module's FFI in as `foreign.js`;
#    nothing else is emitted at this codegen, so there is nothing to prune.
#
#    THE CODEGEN SET MUST MATCH `purescript.compile.rs`'s. `purs` treats a module compiled for a
#    different set of targets as stale, so a tree cut without the maps is a tree every turn's compile
#    rebuilds whole: measured, ~2.9 s instead of ~200 ms. The maps are what a run-time frame is read
#    back through — `esbuild` composes them with its own and gg reads the composition — and they cost
#    ~120 KB in the packed tarball.
echo "Compiling the library set ..."
(cd "$TREE_DIR" && purs compile --codegen js,sourcemaps --output output 'libs/*/src/**/*.purs')

# 5. Pack it. The flags are all about making the same inputs produce the same bytes: entries sorted,
#    ownership and timestamps zeroed, and gzip told not to stamp the archive with the time of day.
#    Nothing depends on that reproducibility today — nothing diffs this artifact against a second
#    cut of it any more, because there is no second copy to diff against — but an artifact that
#    changes when nothing did is one nobody can review, and the flags cost a line each.
echo "Packing the tree ..."
tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner \
	-cf "$BUILD_DIR/libraries.tar" -C "$TREE_DIR" libs output
gzip -9 -n -c "$BUILD_DIR/libraries.tar" > "$TARBALL"

# 6. Write the manifest: what compiled the tree, and what is in it. The package list is read out of
#    the staged tree rather than out of `spago.yaml`, so it names what actually shipped — including
#    the transitive packages nobody wrote down — and `purescript.compile.rs`'s own gate holds the
#    two to each other.
echo "Writing the manifest ..."
export PURS_VERSION ESBUILD_VERSION REGISTRY_VERSION SDK_DIR
node - "$TREE_DIR" "$MANIFEST" <<'NODE'
const fs = require("node:fs");
const [treeDir, manifestPath] = process.argv.slice(2);
const sdk = process.env.SDK_DIR;
const packages = fs
	.readdirSync(`${treeDir}/libs`, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name)
	.filter((name) => name !== sdk)
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
	sdk,
	modules,
	packages,
};
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`);
NODE

echo
echo "Wrote:"
ls -la "$TARBALL" "$MANIFEST"
