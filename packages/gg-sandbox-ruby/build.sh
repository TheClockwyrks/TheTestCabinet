#!/usr/bin/env bash
#
# Refresh the COMMITTED artifact this package produces:
#
#   crates/gg/src/sandbox/guests/ruby.component.wasm   the ECMAScript engine with Opal's runtime,
#                                                      gg's Ruby SDK and the libraries a program may
#                                                      require, all pre-initialised into it
#
# It is named for the PROGRAM LANGUAGE it serves, not for this package, exactly as the other guests'
# artifacts are: gg's responses-as-code capability registers a language per guest, and each one
# commits its artifacts under `crates/gg/src/sandbox/guests/<language-id>.*`.
#
# The host-side Opal compiler is this package's OTHER pair of committed artifacts and is cut by
# `compiler.sh`, not by this script. The split is the same one the Python guest makes: cutting the
# compiler needs only Node and is therefore something CI can run and diff, where this needs
# `componentize-js` and emits 20 MB.
#
# The signature catalogue is the THIRD committed artifact and is emitted by `signatures.sh`, which
# needs Ruby and YARD rather than either of the above. CI runs that one too.
#
# The component is checked in, exactly as the other guests' are, so no build or CI step ever needs
# `componentize-js`: the Rust host reads it with `include_bytes!`. That is also why this script is
# never wired into a build — it is run by hand, deliberately, and its output is committed alongside
# the source change that motivated it.
#
# Run it after changing anything the component is made of:
#
#   * crates/gg/wit/gg-sandbox.wit         (the membrane — a WIT change without a rebuild fails gg's
#                                           instantiation test, which is the intended failure
#                                           direction)
#   * packages/gg-sandbox-ruby/src/**      (this guest's entry module, its Ruby SDK, and the library
#                                           manifest — a change to `src/gg/**` is also a change to
#                                           the signature catalogue, so run `signatures.sh` too)
#   * the pins in opal-version.sh
#
# Requires Node and network access the first time, to fetch the pinned `componentize-js`, the
# pinned Opal npm packages, and the Opal gem of the same release (for the standard library's Ruby
# sources, which npm does not ship). The build takes a few seconds and emits ~20 MB: a whole
# JavaScript engine, plus Opal's corelib, the curated libraries and gg's SDK as they stand after
# their top level has run.
#
# WHY EVERYTHING IS BAKED IN RATHER THAN PREPENDED TO EACH PROGRAM. `componentize-js` executes the
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
DEST_DIR="crates/gg/src/sandbox/guests"
COMPONENT="$DEST_DIR/ruby.component.wasm"
MANIFEST="crates/gg/src/sandbox/checkers/ruby.compiler.json"

# The Opal pins, shared with `compiler.sh`, and the `componentize-js` release.
# shellcheck source=packages/gg-sandbox-ruby/opal-version.sh
source "$ROOT/$PACKAGE/opal-version.sh"

BUILD_DIR="$PACKAGE/.build"
GEM_DIR="$BUILD_DIR/opal-gem"
mkdir -p "$DEST_DIR" "$BUILD_DIR"

# 1. Vendor Opal from npm: the runtime this guest bakes and the self-hosted compiler that lowers
#    gg's own Ruby to JavaScript. Both come out of the one pinned install, which is what keeps the
#    compiler and the runtime the same release.
echo "Vendoring opal-compiler@$OPAL_COMPILER_VERSION ..."
npm install --silent --no-audit --no-fund --prefix "$BUILD_DIR" \
	"opal-compiler@$OPAL_COMPILER_VERSION"

# 2. The npm packages carry Opal's runtime and compiler and NOT its standard library's sources, so
#    the libraries `src/library.rb` declares are fetched from the Opal gem of the same release. The
#    check is against what the committed compiler reports rather than against a comment, so a bump
#    to one pin that forgets the other fails here instead of producing a guest whose libraries were
#    compiled by a different Opal than the one that runs them.
if [ -f "$MANIFEST" ]; then
	CUT_VERSION="$(node -e 'process.stdout.write(require(process.argv[1]).opal)' "$ROOT/$MANIFEST")"
	if [ "$CUT_VERSION" != "$OPAL_VERSION" ]; then
		echo "error: opal-version.sh pins the gem at $OPAL_VERSION but the committed compiler is Opal $CUT_VERSION." >&2
		echo "       Set OPAL_VERSION to $CUT_VERSION (or re-cut the compiler) and run this again." >&2
		exit 1
	fi
fi
if [ ! -d "$GEM_DIR/stdlib" ]; then
	echo "Fetching the opal $OPAL_VERSION gem for the standard library's Ruby sources ..."
	mkdir -p "$GEM_DIR"
	curl -sSfL "https://rubygems.org/downloads/opal-$OPAL_VERSION.gem" -o "$BUILD_DIR/opal.gem"
	tar -xf "$BUILD_DIR/opal.gem" -C "$GEM_DIR" data.tar.gz
	tar -xzf "$GEM_DIR/data.tar.gz" -C "$GEM_DIR"
fi

# 3. Compile the two Ruby halves of the guest — gg's SDK, and the libraries `src/library.rb`
#    declares together with everything they require — with the SAME Opal that compiles a model's
#    program on the host.
echo "Compiling the Ruby SDK and the library set ..."
GG_RUBY_VENDOR="$ROOT/$BUILD_DIR/node_modules" GG_OPAL_SOURCES="$ROOT/$GEM_DIR" \
	node "$PACKAGE/tools/guest.mjs"

# 4. Stage the entry beside the three files it imports.
echo "Staging the entry module ..."
cp "$PACKAGE/src/shim.js" "$BUILD_DIR/shim.js"
cp "$BUILD_DIR/node_modules/opal-runtime/src/opal.js" "$BUILD_DIR/opal.js"

# 5. Bake the component against the ONE copy of the WIT, which lives in the Rust crate that embeds
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
npx --yes "@bytecodealliance/componentize-js@$COMPONENTIZE_VERSION" \
	"$ROOT/$BUILD_DIR/shim.js" \
	--wit "$ROOT/crates/gg/wit" \
	--world-name sandbox \
	--disable stdio http fetch-event \
	-o "$ROOT/$COMPONENT"

echo "Wrote $COMPONENT ($(wc -c <"$COMPONENT") bytes)."
echo "Remember to commit the refreshed artifact together with the source change."
