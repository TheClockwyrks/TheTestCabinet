#!/usr/bin/env bash
#
# Refresh the COMMITTED artifacts this package produces:
#
#   crates/gg/src/sandbox/guests/typescript.component.wasm    the baked interpreter component
#   crates/gg/src/sandbox/guests/typescript.signatures.json   the catalogue the prompt is built from
#   crates/gg/src/sandbox/guests/javascript.signatures.json   the same catalogue, for the arm that
#                                                             runs the program without checking it
#   crates/gg/src/sandbox/checkers/typescript.tsc.js          the compiler that type-checks a program
#   crates/gg/src/sandbox/checkers/typescript.lib.d.ts        the standard library it checks against
#   crates/gg/src/sandbox/checkers/typescript.globals.d.ts    the globals no SDK declaration covers
#   crates/gg/src/sandbox/checkers/typescript.checker.json    which compiler, at which level
#
# They are named for the PROGRAM LANGUAGE they serve, not for this package. gg's responses-as-code
# capability registers a language per guest, and each one commits its pair under
# `crates/gg/src/sandbox/guests/<language-id>.*` — so a second guest, for a second language, is a
# sibling directory with its own build script writing its own pair, and touches nothing here.
#
# This guest serves TWO registered languages, which is why there are two catalogues and one
# component: `javascript` is `typescript` with gg's type check removed, so the two arms differ in
# what gg does to a program before handing it over and in nothing else. Committing a second,
# byte-identical component would be a second copy of one artifact.
#
# Both are checked in, exactly as the `foray-ref-*` guests are, so no build or CI step ever needs
# `componentize-js`: the Rust host `include_bytes!`s the component and `include_str!`s the catalogue.
# (The only Node CI touches for this package is the `signatures` regeneration in
# `scripts/ci/contract-drift.sh`, which needs TypeScript alone.) That is also why this script is
# never wired into a build — it is run by hand, deliberately, and its outputs are committed alongside
# the source change that motivated them.
#
# Run it after changing anything the component is made of:
#
#   * crates/gg/wit/gg-sandbox.wit  (the membrane — a WIT change without a rebuild fails gg's
#                                    instantiation test, which is the intended failure direction)
#   * packages/gg-sandbox/src/**    (the SDK, the shim, or the catalogue)
#   * packages/gg-sandbox/tools/program-globals.d.ts  (the globals a checked program may name)
#   * the pinned `typescript` version in package.json (which the checker is cut from)
#
# Requires Node and network access the first time, to fetch the pinned `componentize-js` through
# `npx`; nothing else. The build takes a few seconds and emits ~13 MB, because the component embeds a
# whole JavaScript engine.
#
# Usage:
#   packages/gg-sandbox/build.sh
set -euo pipefail

# Repo root, independent of the caller's working directory.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PACKAGE="packages/gg-sandbox"
DEST_DIR="crates/gg/src/sandbox/guests"
COMPONENT="$DEST_DIR/typescript.component.wasm"

# The `componentize-js` release the committed artifact is built with. Pinned rather than floating:
# the component is a binary in the repository, so a silent toolchain bump would land as an
# unexplained multi-megabyte diff.
COMPONENTIZE_VERSION="0.21.0"

mkdir -p "$DEST_DIR"

# 1. Type-check the guest and emit the JavaScript the component is built from. This is also the gate
#    that catches an SDK that has drifted from `src/membrane.d.ts`.
echo "Type-checking and emitting $PACKAGE/dist ..."
npx --yes tsc -p "$ROOT/$PACKAGE/tsconfig.json"

# 2. Bake the component against the ONE copy of the WIT, which lives in the Rust crate that embeds
#    the result — there is no second copy in this package to drift from it.
#
#    Each `--disable` removes a WASI capability the guest would otherwise inherit:
#      stdio        gg's telemetry IS this process's stdout (newline-delimited JSON); a guest write
#                   would corrupt the stream, so `console.*` is rebound to a host call instead
#      http,
#      fetch-event  this guest gets no HTTP client. Not a sandbox-wide denial: gg's host linker
#                   defines the whole WASI surface, `wasi:sockets` included, for every guest — a
#                   guest that imports it has the network. This one does not import it, and the two
#                   flags are what keep `fetch` from reaching an import that is not there
#
#    Everything else the engine offers — the clock, the RNG — is left in place: a program that asks
#    what time it is gets the answer, and gg's host linker supplies the rest of WASI ambiently.
#
#    The shim shadows the globals these disables leave behind (`fetch`, and the timers, which need
#    an event loop this synchronous export does not run): disabling a capability removes the WASI
#    import, not the builtin that calls it, so an unshadowed call reaches a missing import and traps
#    the whole store instead of raising a catchable error.
echo "Building the component with componentize-js@$COMPONENTIZE_VERSION ..."
npx --yes "@bytecodealliance/componentize-js@$COMPONENTIZE_VERSION" \
	"$ROOT/$PACKAGE/dist/shim.js" \
	--wit "$ROOT/crates/gg/wit" \
	--world-name sandbox \
	--disable stdio http fetch-event \
	-o "$ROOT/$COMPONENT"

# 3. Reflect the signature catalogue out of the SDK's own emitted declarations, so the system prompt
#    quotes the signatures the component actually exports. It writes one per language this guest
#    serves, into `$DEST_DIR`; the directory lives in this package's `signatures` npm script, because
#    CI runs that script on its own as the catalogues' drift gate.
echo "Reflecting the signature catalogue ..."
npm run --workspace @test-cabinet/gg-sandbox signatures

# 4. Cut the checker gg type-checks a model's program with out of the same pinned `typescript` this
#    package installs, so what the SDK's declarations were emitted by and what a program is judged
#    against are one release. It needs neither the component nor `componentize-js`.
echo "Cutting the TypeScript checker ..."
npm run --workspace @test-cabinet/gg-sandbox checker

echo "Wrote $COMPONENT ($(wc -c <"$COMPONENT") bytes)."
echo "Remember to commit the refreshed artifacts together with the source change."
