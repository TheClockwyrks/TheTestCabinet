#!/usr/bin/env bash
#
# Build this arm's three artifacts, into `$GG_ARTIFACTS_OUT_DIR`:
#
#   ruby.component.wasm   the ECMAScript engine with Opal's runtime, gg's Ruby SDK and the libraries
#                         a program may require, all pre-initialised into it
#   ruby.opal.cjs         the host-side Opal compiler, as one CommonJS bundle with gg's driver
#   ruby.compiler.json    which Opal that is, and which Ruby it emulates
#
# They are named for the PROGRAM LANGUAGE they serve, not for this package, exactly as the other
# guests' artifacts are: gg's responses-as-code capability registers a language per guest, and each
# one files its artifacts under `<language-id>.*`.
#
# THIS IS THE ARM'S ONE PRODUCER. `scripts/gg-arms.sh` promises three files for this row and this
# script writes all three; a second entry point that wrote only some of them would leave gg
# embedding half a set. Two of the three — the compiler and the manifest describing it — used to be
# cut by a separate `compiler.sh` that `scripts/ci/contract-drift.sh` called directly, because that
# check wanted the cheap half without the 20 MB component. Nothing diffs them any more, so the split
# has no caller and step 2 below is what became of it.
#
# The signature catalogue — what a model is TOLD this arm offers — is emitted by `signatures.sh`,
# which needs Ruby and YARD rather than either of the above. That is the fourth thing this package
# produces, and it is a different question answered by a different tool on a different schedule,
# which is why it is not a step here.
#
# NOBODY HAS TO REMEMBER WHEN TO RUN THIS. `crates/gg-sandbox-artifacts/ruby` runs it as part of
# building `test-cabinet-gg`, and the rerun set it declares — in
# `crates/gg-sandbox-artifacts/build-support` — is exactly the list of things this build reads:
#
#   * crates/gg/wit/gg-sandbox.wit         (the membrane — a WIT change without a rebuild fails gg's
#                                           instantiation test, which is the intended failure
#                                           direction)
#   * packages/gg-sandbox-ruby/src/**      (this guest's entry module, its Ruby SDK, and the library
#                                           manifest — a change to `src/gg/**` is also a change to
#                                           the signature catalogue, which `signatures.sh` reflects
#                                           off the same tree on the same build)
#   * packages/gg-sandbox-ruby/tools/**    (what lowers that SDK — both times, see step 1 and step 4)
#   * the pins in opal-version.sh
#
# Requires Node, the pinned Opal npm packages and `componentize-js` out of the shared tool prefix
# `scripts/ci/install-gg-build-tools.sh` warms, and the Opal gem of the same release (for the
# standard library's Ruby sources, which npm does not ship) out of the version-stamped cache that
# same installer fills. The build takes a few seconds and emits ~20 MB: a whole
# JavaScript engine, plus Opal's corelib, the curated libraries and gg's SDK as they stand after
# their top level has run.
#
# WHY EVERYTHING IS BAKED IN RATHER THAN PREPENDED TO EACH PROGRAM. `componentize-js` executes the
# entry module's top level at build time under `wizer` and snapshots the heap, so Opal's 743 KB
# runtime is built once, into the artifact. Measured through gg's own store and linker, on this
# repository's dev container: a Ruby program costs 2.1–2.6 ms per turn this way, against 45.6–51.0 ms
# with the same runtime prepended to the program and evaluated in the TypeScript arm's plain
# ECMAScript component — and 1.2–1.4 ms is what a plain JavaScript program costs on that same
# component. The difference is the whole reason this artifact exists.
#
# Usage:
#   scripts/gg-artifacts.sh                                    # every arm, into one directory
#   GG_ARTIFACTS_OUT_DIR=<dir> packages/gg-sandbox-ruby/build.sh
set -euo pipefail

# Repo root, independent of the caller's working directory.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PACKAGE="packages/gg-sandbox-ruby"

# The destination, which is required and has no default — see the file itself for why.
# shellcheck source=scripts/gg-artifacts-out-dir.sh
source "$ROOT/scripts/gg-artifacts-out-dir.sh"
# shellcheck source=scripts/gg-npm-tools.sh
source "$ROOT/scripts/gg-npm-tools.sh"

# ONE ARM, ONE PROCESS AT A TIME. This package's scratch is a fixed path inside the source tree
# rather than a `mktemp -d`, deliberately — it is a cache — and two cargo processes with two target
# directories do not serialise with each other. See `scripts/gg-scratch-lock.sh`.
# shellcheck source=scripts/gg-scratch-lock.sh
source "$ROOT/scripts/gg-scratch-lock.sh"
gg_lock_scratch "$ROOT/$PACKAGE"

COMPONENT="$GG_ARTIFACTS_OUT_DIR/ruby.component.wasm"
MANIFEST="$GG_ARTIFACTS_OUT_DIR/ruby.compiler.json"

# The Opal pins and the `componentize-js` release.
# shellcheck source=packages/gg-sandbox-ruby/opal-version.sh
source "$ROOT/$PACKAGE/opal-version.sh"

BUILD_DIR="$PACKAGE/.build"
mkdir -p "$BUILD_DIR"

# 1. Resolve Opal — ONCE, for both halves of this build. The npm tree below is the runtime this
#    guest bakes AND the self-hosted compiler step 2 bundles for the host, and resolving it once is
#    what makes "the compiler and the runtime are the same release" a fact about this script rather
#    than an agreement two scripts have to keep.
OPAL_DIR="$(gg_npm_tool opal-compiler "$OPAL_COMPILER_VERSION")"

# 2. Cut the host-side compiler: Opal's runtime and its self-hosted compiler as one CommonJS bundle
#    with gg's driver at the end of it, plus the manifest saying which Opal that is. It comes before
#    everything the component is made of because step 3 reads that manifest.
#
#    This was its own script, `compiler.sh`, for exactly as long as there was a caller that wanted
#    the cheap half alone: `scripts/ci/contract-drift.sh` re-cut `ruby.opal.cjs` and diffed it
#    against the committed copy, and doing that through `build.sh` would have meant baking a 20 MB
#    non-reproducible component on every CI run to check 3 MB of JavaScript. Nothing is committed
#    now and nothing diffs it, so that caller is gone and so is the script. What is left is the
#    invariant both orchestrators want: one `build.sh` and one `signatures.sh` per package, and
#    nothing else that produces an artifact.
echo "Cutting the Opal compiler bundle ..."
GG_RUBY_VENDOR="$OPAL_DIR/node_modules" node "$PACKAGE/tools/compiler.mjs"

# 3. The npm packages carry Opal's runtime and compiler and NOT its standard library's sources, so
#    the libraries `src/library.rb` declares come from the Opal gem of the same release. The check is
#    against what the compiler cut in step 2 reports rather than against a comment, so a bump to one
#    pin that forgets the other fails here instead of producing a guest whose libraries were
#    compiled by a different Opal than the one that runs them.
#
#    THE GEM IS CACHED OUTSIDE THIS PACKAGE, under a version-stamped prefix
#    `scripts/ci/install-gg-build-tools.sh` also fills, for the reason every other pinned download
#    moved there: `.build/` is wiped by a `git clean` and by anybody debugging this arm, and a cache
#    that a routine tidy-up empties is a cache that puts a registry call back inside `cargo build`.
#    The existence check is the marker, as it was before — the gem either unpacked or it did not.
GEM_DIR="${GG_OPAL_GEM_DIR:-$HOME/.local/share/tcab/gg-opal-$OPAL_VERSION}"
CUT_VERSION="$(node -e 'process.stdout.write(require(process.argv[1]).opal)' "$MANIFEST")"
if [ "$CUT_VERSION" != "$OPAL_VERSION" ]; then
	echo "error: opal-version.sh pins the gem at $OPAL_VERSION but the compiler cut above is Opal $CUT_VERSION." >&2
	echo "       Set OPAL_VERSION to $CUT_VERSION and run this again." >&2
	exit 1
fi
if [ ! -d "$GEM_DIR/stdlib" ]; then
	echo "Fetching the opal $OPAL_VERSION gem for the standard library's Ruby sources ..."
	mkdir -p "$GEM_DIR"
	curl -sSfL "https://rubygems.org/downloads/opal-$OPAL_VERSION.gem" -o "$GEM_DIR/opal.gem"
	tar -xf "$GEM_DIR/opal.gem" -C "$GEM_DIR" data.tar.gz
	tar -xzf "$GEM_DIR/data.tar.gz" -C "$GEM_DIR"
fi

# 4. Compile the two Ruby halves of the guest — gg's SDK, and the libraries `src/library.rb`
#    declares together with everything they require — with the SAME Opal that compiles a model's
#    program on the host.
echo "Compiling the Ruby SDK and the library set ..."
GG_RUBY_VENDOR="$OPAL_DIR/node_modules" GG_OPAL_SOURCES="$GEM_DIR" \
	node "$PACKAGE/tools/guest.mjs"

# 5. Stage the entry beside the three files it imports.
echo "Staging the entry module ..."
cp "$PACKAGE/src/shim.js" "$BUILD_DIR/shim.js"
cp "$OPAL_DIR/node_modules/opal-runtime/src/opal.js" "$BUILD_DIR/opal.js"

# 6. Bake the component against the ONE copy of the WIT, which lives in the Rust crate that embeds
#    the result. The `--disable` flags are the ECMAScript guest's, unchanged and deliberately so:
#    a capability enabled here and not there would be a difference between two arms of a study that
#    nobody chose.
#
#      stdio        gg's telemetry IS this process's stdout (newline-delimited JSON); a guest write
#                   would corrupt the stream, so `console.*` is rebound to a host call instead — and
#                   this guest additionally points Ruby's own `$stdout`/`$stderr` at it
#      http,
#      fetch-event  this guest gets no HTTP client, for the reason `DENIED_GLOBALS` gives
echo "Building the component with componentize-js@$COMPONENTIZE_VERSION ..."
COMPONENTIZE_DIR="$(gg_npm_tool @bytecodealliance/componentize-js "$COMPONENTIZE_VERSION")"
"$COMPONENTIZE_DIR/node_modules/.bin/componentize-js" \
	"$ROOT/$BUILD_DIR/shim.js" \
	--wit "$ROOT/crates/gg/wit" \
	--world-name sandbox \
	--disable stdio http fetch-event \
	-o "$COMPONENT"

# WHAT USED TO BE STEP 7: `ruby.component.manifest.json`, written beside the component by
# `scripts/gg-artifact-manifest.mjs` — the SHA-256 of every file under `src/`, of `tools/guest.mjs`,
# of this script, and of `crates/gg/wit`'s declarations, so that a test could recompute them from the
# checkout and fail when somebody had edited the SDK without re-running it. That question — *is the
# committed component older than the sources beside it?* — no longer has a subject. The component is
# not committed: `crates/gg-sandbox-artifacts/ruby` runs this script into its own cargo `OUT_DIR` on
# every build whose declared inputs moved, and `crates/gg` embeds what lands there.
#
# THE PAIRING THIS ARM DEPENDS ON IS NOW A CONSEQUENCE RATHER THAN A CLAIM, and it is the reason
# this was the arm most worth moving. gg's Ruby SDK is lowered to JavaScript TWICE from the one
# `src/` — once by step 4 into the component above, and once by step 1 into the host-side Opal
# compiler `crates/gg` also embeds. Two lowerings of the same SDK at two vintages is a
# `NoMethodError` inside somebody's run, and the manifest could only ever have reported it after the
# fact and only if somebody ran the test. One `build.sh` writes all three artifacts and one rerun
# set decides when, so they cannot be cut at different vintages.
#
# EVERY FILE THAT MANIFEST NAMED IS NOW IN THIS ARM'S RERUN SET, in `gg-artifact-build`'s table, and
# for the reasons they were recorded here: `tools/` because `guest.mjs` is what lowers the SDK and
# the library set, so a change there changes the JavaScript baked in without a line of Ruby moving;
# `opal-version.sh` because the standard library's Ruby sources come from the gem it pins, in a
# different variable from the compiler's; and `build.sh` because the recipe is an input — the
# `--disable`s above decide what capabilities this guest is baked with.

echo "Wrote $COMPONENT ($(wc -c <"$COMPONENT") bytes)."
