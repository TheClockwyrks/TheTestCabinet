#!/usr/bin/env bash
#
# Build the artifacts this package produces, into `$GG_ARTIFACTS_OUT_DIR`:
#
#   typescript.component.wasm    the baked interpreter component
#   typescript.tsc.js            the compiler that type-checks a program
#   typescript.lib.d.ts          the standard library it checks against
#   typescript.globals.d.ts      the globals no SDK declaration covers
#   typescript.checker.json      which compiler, at which level
#
# They are named for the PROGRAM LANGUAGE they serve, not for this package. gg's responses-as-code
# capability registers a language per guest, and each one files its artifacts under `<language-id>.*`
# — so a second guest, for a second language, is a sibling directory with its own build script
# writing its own set, and touches nothing here.
#
# This build cuts the guests THREE registered arms are evaluated by, and bakes ONE of each.
# `javascript` is `typescript` with gg's type check removed, so both evaluate in the quickjs guest
# `guest.sh` builds and the two arms differ in the compiler and in nothing else; `purescript`
# compiles to self-contained JavaScript and evaluates in the `componentize-js` component below. A
# second, byte-identical component per arm would be a second copy of one artifact.
#
# WHAT IS *NOT* HERE: the two signature catalogues. They are reflected out of the SDK's own emitted
# declarations by `signatures.sh` beside this script, which `scripts/gg-signatures.sh` runs and
# `crates/gg/build.rs` calls — a different question, answered by a different tool, on a different
# schedule, which is why the two steps are two scripts.
#
# NOBODY HAS TO REMEMBER WHEN TO RUN THIS. `crates/gg-sandbox-artifacts/typescript` runs it as part
# of building `test-cabinet-gg`, and the rerun set it declares — in
# `crates/gg-sandbox-artifacts/build-support` — is exactly the list of things this build reads:
#
#   * crates/gg/wit/gg-sandbox.wit  (the membrane — a WIT change without a rebuild fails gg's
#                                    instantiation test, which is the intended failure direction)
#   * packages/gg-sandbox/src/**    (the SDK, the shim, or the catalogue)
#   * packages/gg-sandbox/tools/program-globals.d.ts  (the globals a checked program may name)
#   * the pinned `typescript` version in package.json (which the checker is cut from)
#   * tsconfig.base.json            (which decides the emit, and is edited for the web app)
#
# NOTHING HERE IS BY HAND ANY MORE, AND THE COMPONENT WAS THE LAST OF IT. `crates/gg/src/sandbox/
# guests/` used to hold a committed `typescript.component.wasm` that `typescript.rs` embedded, so a
# change to the SDK or the shim wanted this script run by hand and the 13 MB `.wasm` committed with
# it — while the copy written here was discarded. Both arms of this package now come out of the same
# `OUT_DIR`: the checker a program is judged by, and the guest it is then evaluated in.
#
# Requires Node, a repo-root `npm ci` (for the pinned `typescript`) and the pinned `componentize-js`
# out of the shared tool prefix `scripts/ci/install-gg-build-tools.sh` warms. The build takes a few
# seconds and emits ~13 MB, because the component embeds a whole JavaScript engine.
#
# Usage:
#   scripts/gg-artifacts.sh                               # every arm, into one directory
#   GG_ARTIFACTS_OUT_DIR=<dir> packages/gg-sandbox/build.sh
set -euo pipefail

# Repo root, independent of the caller's working directory.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PACKAGE="packages/gg-sandbox"

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

COMPONENT="$GG_ARTIFACTS_OUT_DIR/typescript.component.wasm"

# The `componentize-js` release this component is built with. Pinned rather than floating: it decides
# which JavaScript engine a program on this arm runs on, which is a study parameter, and a floating
# one would move it between two runs of one sweep.
COMPONENTIZE_VERSION="0.21.0"

# 1. Type-check the guest and emit the JavaScript the component is built from. This is also the gate
#    that catches an SDK that has drifted from `src/membrane.d.ts`.
#
#    THE WORKSPACE'S OWN COMPILER, BY PATH, and not `npx --yes tsc`, which is what this was. The
#    argument under step 2 for resolving `componentize-js` out of a pinned prefix applies here word
#    for word — this script runs inside an ordinary `cargo build` and a build that talks to npm
#    halfway through is a build that fails on an aeroplane — and this call was worse than that one.
#    `npx --yes` does not fail when a checkout has no `node_modules`: it goes to the registry, and
#    the package npm resolves for the bare name `tsc` is the well-known decoy, not TypeScript. So the
#    failure available was a build that reached the network and then emitted the guest's JavaScript
#    with something that is not the compiler `typescript.checker.json` names three steps below.
#
#    Named rather than probed, so the diagnosis is the true one. A missing install is exactly what
#    `scripts/ci/install-gg-toolchains.sh` warns about at the end of its run, in the same words.
if [ ! -x "$ROOT/node_modules/.bin/tsc" ]; then
	echo "error: no $ROOT/node_modules/.bin/tsc." >&2
	echo "       This guest is emitted and type-checked by the \`typescript\` release the" >&2
	echo "       repository pins, which a repo-root \`npm ci\` installs — the same one" >&2
	echo "       step 3 cuts the checker a model's program is judged against out of." >&2
	echo "       Run \`npm ci\` at the repository root." >&2
	exit 1
fi
echo "Type-checking and emitting $PACKAGE/dist ..."
"$ROOT/node_modules/.bin/tsc" -p "$ROOT/$PACKAGE/tsconfig.json"

# 2. Bake the component against the ONE copy of the WIT, which lives in the Rust crate that embeds
#    the result — there is no second copy in this package to drift from it.
#
#    Each `--disable` removes a WASI capability the guest would otherwise inherit:
#      stdio        it is what keeps this component's DECLARED IMPORTS narrow. Removing it adds
#                   eight: `wasi:cli/{stdin,stdout,terminal-input,terminal-output,terminal-stderr,
#                   terminal-stdin,terminal-stdout}` and, because this engine's stdio resolves file
#                   descriptors, the whole of `wasi:filesystem`. gg's linker defines all of them for
#                   every guest, so what a component declares is the whole of what it can reach, and
#                   `gg/responses-as-code/sandbox.md` documents this one as asking for neither
#                   filesystem nor sockets.
#
#                   NOT because a guest write to fd 1 would corrupt gg's telemetry stream, which is
#                   what this comment said and is false: `wasi_context` in
#                   `crates/gg/src/sandbox/membrane.rs` builds every guest's context WITHOUT stdout,
#                   so a write there reaches a sink. And not at the cost of this arm's failure
#                   surface either, which was the other reason to reconsider it: MEASURED through
#                   `run_program`, a stack overflow, an allocation overflow and a plain throw all
#                   reach the model as `InternalError: too much recursion`, `InternalError:
#                   allocation size overflow` and `Error: …` with a location — every one of them
#                   from the shim's own `catch`, over `feedback.report-error`, with nothing on
#                   standard error to fold in. While that catch stands, this flag costs the model
#                   nothing.
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
#
#    Resolved out of the shared pinned tool prefix rather than through `npx --yes`, which reached
#    the registry: this script runs inside an ordinary `cargo build` now, and a build that talks to
#    npm halfway through is a build that fails on an aeroplane.
echo "Building the component with componentize-js@$COMPONENTIZE_VERSION ..."
COMPONENTIZE_DIR="$(gg_npm_tool @bytecodealliance/componentize-js "$COMPONENTIZE_VERSION")"
"$COMPONENTIZE_DIR/node_modules/.bin/componentize-js" \
	"$ROOT/$PACKAGE/dist/shim.js" \
	--wit "$ROOT/crates/gg/wit" \
	--world-name sandbox \
	--disable stdio http fetch-event \
	-o "$COMPONENT"

# 2b. Build the ECMAScript guest under `guest/` — quickjs-ng inside a `wit-bindgen` component — and
#     its adapter. It is the guest the TypeScript, JavaScript and PureScript arms are moving to (see
#     `guest/src/lib.rs` for the whole argument, and `ecmascript-version.sh` for the pins), and it is
#     built here rather than in a package of its own because it is cut from THIS package's SDK: the
#     4,098 lines of `src/gg/**` that step 1 has just emitted to `dist/` are baked into it unchanged.
#     A second package would need a second copy of them.
#
#     A CORE MODULE and an adapter rather than a finished component, for the reason the Rust, C++ and
#     Swift arms ship the same pair: the encode is 5–30 ms, gg already links `wit_component`, and gg
#     does it in its own process (`crates/gg/src/sandbox/language/ecmascript.rs`) so the component a
#     run instantiates is produced by the `wasm-encoder` gg's own wasmtime agrees with, rather than by
#     whichever one a `wasm-tools` on the build machine happened to bundle.
"$ROOT/$PACKAGE/guest.sh"

# 3. Cut the checker gg type-checks a model's program with out of the same pinned `typescript` this
#    package installs, so what the SDK's declarations were emitted by and what a program is judged
#    against are one release. It needs neither the component nor `componentize-js`.
echo "Cutting the TypeScript checker ..."
npm run --workspace @test-cabinet/gg-sandbox checker

# WHAT USED TO BE STEP 4: `typescript.component.manifest.json`, written beside the component by
# `scripts/gg-artifact-manifest.mjs` — the SHA-256 of every file under `src/`, of each of the four
# files below, and of `crates/gg/wit`'s declarations, so that a test could recompute them from the
# checkout and fail when somebody had edited the SDK without re-running this script. That question —
# *is the committed component older than the sources beside it?* — no longer has a subject. The
# component is not committed: `crates/gg-sandbox-artifacts/typescript` runs this script into its own
# cargo `OUT_DIR` on every build whose declared inputs moved, and `crates/gg` embeds what lands
# there. An SDK edit is baked into the guest by the same `cargo build` that compiles the host.
#
# EVERY FILE THAT MANIFEST NAMED IS NOW IN THIS ARM'S RERUN SET, in `gg-artifact-build`'s table, and
# they are named there for the reasons they were recorded here — the list did not shrink, it moved
# from a thing that is checked to a thing that is obeyed:
#
#   src/                 the SDK itself.
#   tsconfig.json  and
#   tsconfig.base.json   which decide TOGETHER what step 1 emits, and the BASE is where the
#                        emit-affecting options actually live: `target`, `module`, `lib` and
#                        `useDefineForClassFields` are all inherited and none is restated in the
#                        leaf. Changing `target` alone was measured to change the JavaScript in
#                        eight emitted files, `shim.js` among them. It is a file edited for the web
#                        app and the docs site by people with no reason to know this guest hangs off
#                        it — which was the best argument for recording it, and is now the best
#                        argument for watching it.
#   package.json         pins the `typescript` release that does the emitting, so a program would
#                        otherwise be judged by a compiler this component was not built with.
#   build.sh             the recipe. The `--disable stdio http fetch-event` flags above decide
#                        whether this guest has a `fetch` at all.
#
# The gate said "you edited the recipe and did not cook"; the rerun set cooks.

echo "Wrote $COMPONENT ($(wc -c <"$COMPONENT") bytes)."
