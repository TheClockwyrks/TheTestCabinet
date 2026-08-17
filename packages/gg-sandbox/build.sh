#!/usr/bin/env bash
#
# Build the artifacts this package produces, into `$GG_ARTIFACTS_OUT_DIR`:
#
#   ecmascript.core.wasm         the guest three arms evaluate a program in
#   ecmascript.adapter.wasm      the preview1 adapter it is encoded with
#   ecmascript.guest.json        which engine, at which pins
#   typescript.tsc.js            the compiler that type-checks a program
#   typescript.lib.d.ts          the standard library it checks against
#   typescript.globals.d.ts      the globals no SDK declaration covers
#   typescript.checker.json      which compiler, at which level
#
# They are named for what they SERVE, not for this package. The `typescript.*` four are the checker
# one arm is judged by; the `ecmascript.*` three are the guest THREE arms evaluate in — `typescript`,
# `javascript` and `purescript`, all of which reach the sandbox as JavaScript. They are built here
# because the guest is cut from this package's SDK.
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
#   * packages/gg-sandbox/src/**    (the SDK or the catalogue)
#   * packages/gg-sandbox/tools/program-globals.d.ts  (the globals a checked program may name)
#   * the pinned `typescript` version in package.json (which the checker is cut from)
#   * tsconfig.base.json            (which decides the emit, and is edited for the web app)
#
# Both halves of this package come out of one `OUT_DIR`: the checker a program is judged by, and the
# guest it is then evaluated in.
#
# Requires Node, a repo-root `npm ci` (for the pinned `typescript`) and the Rust toolchain
# `guest.sh` names. The build takes a few seconds and emits ~7 MB, most of it the checker.
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

# ONE ARM, ONE PROCESS AT A TIME. This package's scratch is a fixed path inside the source tree
# rather than a `mktemp -d`, deliberately — it is a cache — and two cargo processes with two target
# directories do not serialise with each other. See `scripts/gg-scratch-lock.sh`.
# shellcheck source=scripts/gg-scratch-lock.sh
source "$ROOT/scripts/gg-scratch-lock.sh"
gg_lock_scratch "$ROOT/$PACKAGE"

# 1. Type-check the SDK and emit the JavaScript the guest bakes. This is also the gate that catches
#    an SDK that has drifted from `src/membrane.d.ts`.
#
#    THE WORKSPACE'S OWN COMPILER, BY PATH, and not `npx --yes tsc`, which is what this was. This
#    script runs inside an ordinary `cargo build` and a build that talks to npm halfway through is a
#    build that fails on an aeroplane. `npx --yes` does not fail when a checkout has no
#    `node_modules`: it goes to the registry, and the package npm resolves for the bare name `tsc` is
#    the well-known decoy, not TypeScript. So the failure available was a build that reached the
#    network and then emitted the SDK's JavaScript with something that is not the compiler
#    `typescript.checker.json` names two steps below.
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
#
#    `dist` is removed first because `tsc` writes the outputs of the sources it reads and removes
#    nothing: a module deleted from `src` leaves its JavaScript behind, and step 2 bakes `dist/gg/**`
#    into the guest unchanged, so the deleted module would keep shipping. It also keeps a stale
#    build output from being the first thing a search of this tree finds. Emitting from empty costs
#    one type-check, which this step performs either way.
echo "Type-checking and emitting $PACKAGE/dist ..."
rm -rf "${ROOT:?}/$PACKAGE/dist"
"$ROOT/node_modules/.bin/tsc" -p "$ROOT/$PACKAGE/tsconfig.json"

# 2. Build the ECMAScript guest under `guest/` — quickjs-ng inside a `wit-bindgen` component — and
#    its adapter. It is the guest the TypeScript, JavaScript and PureScript arms evaluate a program
#    in (see `guest/src/lib.rs` for the whole argument, and `ecmascript-version.sh` for the pins),
#    and it is built here rather than in a package of its own because it is cut from THIS package's
#    SDK: the `src/gg/**` that step 1 has just emitted to `dist/` is baked into it unchanged. A
#    second package would need a second copy of it.
#
#    A CORE MODULE and an adapter rather than a finished component, for the reason the Rust, C++ and
#    Swift arms ship the same pair: the encode is 5–30 ms, gg already links `wit_component`, and gg
#    does it in its own process (`crates/gg/src/sandbox/language/ecmascript.rs`) so the component a
#    run instantiates is produced by the `wasm-encoder` gg's own wasmtime agrees with, rather than by
#    whichever one a `wasm-tools` on the build machine happened to bundle.
"$ROOT/$PACKAGE/guest.sh"

# 3. Cut the checker gg type-checks a model's program with out of the same pinned `typescript` this
#    package installs, so what the SDK's declarations were emitted by and what a program is judged
#    against are one release.
echo "Cutting the TypeScript checker ..."
npm run --workspace @test-cabinet/gg-sandbox checker

# WHAT THIS BUILD READS is declared as this arm's rerun set, in `gg-artifact-build`'s table, so a
# source edited without a rebuild is not a state the tree can reach:
#
#   src/                 the SDK itself.
#   tsconfig.json  and
#   tsconfig.base.json   which decide TOGETHER what step 1 emits, and the BASE is where the
#                        emit-affecting options actually live: `target`, `module`, `lib` and
#                        `useDefineForClassFields` are all inherited and none is restated in the
#                        leaf. Changing `target` alone was measured to change the JavaScript in
#                        eight emitted files. It is a file edited for the web app and the docs site
#                        by people with no reason to know this guest hangs off it.
#   package.json         pins the `typescript` release that does the emitting, so a program would
#                        otherwise be judged by a compiler this component was not built with.
#   build.sh             the recipe.

