#!/usr/bin/env bash
#
# Refresh the COMMITTED artifact this package produces:
#
#   crates/gg/src/sandbox/guests/ruby.component.wasm   the ECMAScript guest with Opal's runtime
#                                                      pre-initialised into it
#
# It is named for the PROGRAM LANGUAGE it serves, not for this package, exactly as the other guests'
# artifacts are: gg's responses-as-code capability registers a language per guest, and each one
# commits its artifacts under `crates/gg/src/sandbox/guests/<language-id>.*`.
#
# The host-side Opal compiler is this package's OTHER pair of committed artifacts and is cut by
# `compiler.sh`, not by this script. The split is the same one the Python guest makes: cutting the
# compiler needs only Node and is therefore something CI can run and diff, where this needs
# `componentize-js` and emits 18 MB.
#
# The artifact is checked in, exactly as the other guests' are, so no build or CI step ever needs
# `componentize-js`: the Rust host reads it with `include_bytes!`. That is also why this script is
# never wired into a build — it is run by hand, deliberately, and its output is committed alongside
# the source change that motivated it.
#
# Run it after changing anything the component is made of:
#
#   * crates/gg/wit/gg-sandbox.wit         (the membrane — a WIT change without a rebuild fails gg's
#                                           instantiation test, which is the intended failure
#                                           direction)
#   * packages/gg-sandbox-ruby/src/**      (this guest's entry module)
#   * packages/gg-sandbox/src/**           (the shared shim this guest re-exports `run` from — a
#                                           change there is a change to BOTH components, and both
#                                           have to be rebuilt)
#   * the pins in opal-version.sh
#
# Requires Node and network access the first time, to fetch the pinned `componentize-js` and Opal.
# The build takes a few seconds and emits ~18 MB: a whole JavaScript engine, plus Opal's corelib as
# it stands after the runtime's top-level has run.
#
# WHY THE RUNTIME IS BAKED IN RATHER THAN PREPENDED TO EACH PROGRAM. `componentize-js` executes the
# entry module's top level at build time under `wizer` and snapshots the heap, so Opal's 743 KB
# runtime is built once, into the artifact. Measured through gg's own store and linker, on this
# repository's dev container: a Ruby program costs 2.1–2.6 ms per turn this way, against 45.6–51.0 ms
# with the same runtime prepended to the program and evaluated in the committed ECMAScript
# component — and 1.2–1.4 ms is what a plain JavaScript program costs on the same component. The
# difference is the whole reason this artifact exists.
#
# Usage:
#   packages/gg-sandbox-ruby/build.sh
set -euo pipefail

# Repo root, independent of the caller's working directory.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PACKAGE="packages/gg-sandbox-ruby"
SHARED="packages/gg-sandbox"
DEST_DIR="crates/gg/src/sandbox/guests"
COMPONENT="$DEST_DIR/ruby.component.wasm"

# The one Opal pin, shared with `compiler.sh`, and the `componentize-js` release.
# shellcheck source=packages/gg-sandbox-ruby/opal-version.sh
source "$ROOT/$PACKAGE/opal-version.sh"

BUILD_DIR="$PACKAGE/.build"
mkdir -p "$DEST_DIR" "$BUILD_DIR"

# 1. Vendor Opal. Only the RUNTIME is baked into this component — the compiler runs on the host and
#    is a separate committed artifact — but both come out of the one pinned install, which is what
#    keeps the compiler and the runtime the same release.
echo "Vendoring opal-compiler@$OPAL_COMPILER_VERSION ..."
npm install --silent --no-audit --no-fund --prefix "$BUILD_DIR" \
	"opal-compiler@$OPAL_COMPILER_VERSION"

# 2. Emit the shared guest's JavaScript. This guest's entry re-exports the ECMAScript guest's `run`,
#    so the shared package's `dist` is a real input to this build rather than a convenience — and
#    emitting it here is also what type-checks it, which is the gate that catches an SDK that has
#    drifted from `src/membrane.d.ts`.
echo "Type-checking and emitting $SHARED/dist ..."
npx --yes tsc -p "$ROOT/$SHARED/tsconfig.json"

# 3. Stage the entry beside the runtime it imports. Both land one directory below the package, which
#    is where `src/shim.js` already sits, so `../../gg-sandbox/dist/shim.js` resolves the same from
#    either — the entry can be read where it is authored and bundled where it is staged.
echo "Staging the entry module ..."
cp "$PACKAGE/src/shim.js" "$BUILD_DIR/shim.js"
cp "$BUILD_DIR/node_modules/opal-runtime/src/opal.js" "$BUILD_DIR/opal.js"

# 4. Bake the component against the ONE copy of the WIT, which lives in the Rust crate that embeds
#    the result. The `--disable` flags are the ECMAScript guest's, unchanged and deliberately so:
#    this component is that component plus a runtime, and a capability enabled here and not there
#    would be a difference between two arms of a study that nobody chose.
#
#      stdio        gg's telemetry IS this process's stdout (newline-delimited JSON); a guest write
#                   would corrupt the stream, so `console.*` is rebound to a host call instead — and
#                   this guest additionally points Ruby's own `$stdout`/`$stderr` at it
#      http,
#      fetch-event  this guest gets no HTTP client, for the reason the shared shim's `DENIED_GLOBALS`
#                   gives
echo "Building the component with componentize-js@$COMPONENTIZE_VERSION ..."
npx --yes "@bytecodealliance/componentize-js@$COMPONENTIZE_VERSION" \
	"$ROOT/$BUILD_DIR/shim.js" \
	--wit "$ROOT/crates/gg/wit" \
	--world-name sandbox \
	--disable stdio http fetch-event \
	-o "$ROOT/$COMPONENT"

echo "Wrote $COMPONENT ($(wc -c <"$COMPONENT") bytes)."
echo "Remember to commit the refreshed artifact together with the source change."
