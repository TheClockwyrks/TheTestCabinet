#!/usr/bin/env bash
#
# Refresh the COMMITTED artifacts this package produces:
#
#   crates/gg/src/sandbox/guests/typescript.component.wasm    the baked interpreter component
#   crates/gg/src/sandbox/checkers/typescript.tsc.js          the compiler that type-checks a program
#   crates/gg/src/sandbox/checkers/typescript.lib.d.ts        the standard library it checks against
#   crates/gg/src/sandbox/checkers/typescript.globals.d.ts    the globals no SDK declaration covers
#   crates/gg/src/sandbox/checkers/typescript.checker.json    which compiler, at which level
#
# They are named for the PROGRAM LANGUAGE they serve, not for this package. gg's responses-as-code
# capability registers a language per guest, and each one files its artifacts under
# `crates/gg/src/sandbox/{guests,checkers}/<language-id>.*` — so a second guest, for a second
# language, is a sibling directory with its own build script writing its own set, and touches
# nothing here.
#
# This guest serves TWO registered languages and bakes ONE component: `javascript` is `typescript`
# with gg's type check removed, so the two arms differ in what gg does to a program before handing it
# over and in nothing else. Committing a second, byte-identical component would be a second copy of
# one artifact.
#
# WHAT IS *NOT* HERE ANY MORE: the two signature catalogues. They are reflected out of the SDK's own
# emitted declarations by `signatures.sh` beside this script, which `scripts/gg-signatures.sh` runs
# and `crates/gg/build.rs` calls — so the catalogue a model is described by is generated on the build
# that compiles the host embedding it, and cannot be older than the declarations it quotes. This
# script therefore has nothing to refresh about them, and running it is not a prerequisite for
# building gg.
#
# The component IS checked in, exactly as the `foray-ref-*` guests are, so no build or CI step ever
# needs `componentize-js`: the Rust host `include_bytes!`s it. That is why this script is run by
# hand, deliberately, and its outputs are committed alongside the source change that motivated them —
# and it is the reason `gg-artifact-manifest.mjs` records what went into the component below, since a
# committed binary is the one thing in this package that a build cannot re-derive for you.
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

# 3. Cut the checker gg type-checks a model's program with out of the same pinned `typescript` this
#    package installs, so what the SDK's declarations were emitted by and what a program is judged
#    against are one release. It needs neither the component nor `componentize-js`.
echo "Cutting the TypeScript checker ..."
npm run --workspace @test-cabinet/gg-sandbox checker

# 4. Record what went into the component, beside it. `contract-drift.sh` deliberately never rebuilds
#    this artifact, so this manifest — and the Rust test that recomputes it from the checkout — is
#    the only thing standing between an SDK edit committed without a rebuild and every TypeScript
#    and JavaScript program in the run being evaluated by last month's guest.
#
#    The files beside the SDK tree are inputs as much as the tree is. `tsconfig.json` and the
#    repository-wide `tsconfig.base.json` it extends decide together what step 1 emits — and the
#    base file is where the emit-affecting options actually live: `target`, `module`, `lib` and
#    `useDefineForClassFields` are all inherited, none of them is restated in the leaf, and changing
#    `target` alone was measured to change the JavaScript in eight emitted files, `shim.js` among
#    them. It is a file edited for the web app and the docs site by people with no reason to know
#    this component hangs off it, which is exactly why it is recorded here. `package.json` pins the
#    `typescript` release that does the emitting, so a program is judged by a compiler this
#    component was not built with the moment it moves alone.
#
#    `build.sh` records ITSELF, because the recipe is an input: the `--disable stdio http
#    fetch-event` flags above decide whether this guest has a `fetch` at all, and dropping one and
#    committing without rebuilding would leave the checkout claiming a capability the artifact does
#    not have. That an edit to this file fails the gate until it is run is the intended reading.
echo "Recording the component manifest ..."
node "$ROOT/scripts/gg-artifact-manifest.mjs" \
	--arm typescript \
	--rebuild "$PACKAGE/build.sh" \
	--artifact "$COMPONENT" \
	--source-root "$PACKAGE/src" \
	--source-file "$PACKAGE/tsconfig.json" \
	--source-file tsconfig.base.json \
	--source-file "$PACKAGE/package.json" \
	--source-file "$PACKAGE/build.sh" \
	--wit crates/gg/wit \
	--pin "componentizeJs=$COMPONENTIZE_VERSION" \
	--out "$DEST_DIR/typescript.component.manifest.json"

echo "Wrote $COMPONENT ($(wc -c <"$COMPONENT") bytes)."
echo "Remember to commit the refreshed artifacts together with the source change."
