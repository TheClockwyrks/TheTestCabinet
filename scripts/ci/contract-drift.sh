#!/usr/bin/env bash
# Regenerates every generated-and-committed contract artifact from its source of
# truth and fails if a committed copy is stale.
#
# Two artifacts are checked here, because each is generated from source that a
# change can edit without remembering to regenerate:
#
#  1. The data contract. The TS bindings (packages/run-record/src/) and the JSON
#     Schemas (apps/docs/public/schema/) are generated from the Rust types that
#     derive `ts_rs::TS` + `schemars::JsonSchema` (see crates/contract-codegen and
#     scripts/gen-contract.mjs). Any change to one of those types — including the
#     rustdoc, which is emitted into the schemas as descriptions — that is not
#     regenerated and committed turns this check red, so the three representations
#     can never silently drift apart.
#
#  2. gg's model-facing reference. crates/backend/src/gg_reference.json is projected
#     from gg's own tool definitions and sandbox signature catalogue by `gg reference`
#     (the same `npm run gen:contract` run emits it) and embedded in the backend, which
#     serves it at GET /gg/reference for the console's gg Reference section. The backend
#     cannot depend on test-cabinet-gg — wasmtime, oxc and tiktoken-rs against a static
#     musl build — so this committed artifact stands in for that dependency, and this
#     check is what makes it as trustworthy as one: reword a tool's description without
#     regenerating and the console would keep showing prose no model was ever sent.
#
#     Projecting it means BUILDING gg, and that is no longer cheap: gg's build script
#     reflects all eleven of its program languages' signature catalogues out of their
#     guest SDKs, each with that language's own documentation tool. So this script
#     installs gg's toolchains before it regenerates anything — to build gg, not to
#     reflect a catalogue of its own. See the install step below.
#
# WHAT IS NOT CHECKED HERE, AND USED TO BE — READ THIS BEFORE ADDING A THIRD ITEM. This script was
# once also the drift gate for everything gg embeds about its eleven program languages: the eleven
# SIGNATURE CATALOGUES (what a model is *told* each language offers, reflected out of that language's
# guest SDK), and the four CHECKERS this script could re-cut cheaply (TypeScript's `tsc`, Ruby's Opal,
# and the two JVM arms' SDK jars). None of them is committed any more. Each arm has a crate under
# crates/gg-sandbox-artifacts/ whose build script runs that arm's build.sh into its own OUT_DIR;
# crates/gg/build.rs reflects the catalogues into its own; and crates/gg `include_bytes!`/
# `include_str!`s the result. So the compiler a program is judged by, the guest it runs in and the
# catalogue its prompt was written from all come out of the one checkout that compiled the host.
#
# A regenerate-and-diff check answers "is the committed copy current?", and that question no longer
# has a subject — which is a STRONGER guarantee than the gate was, not a weaker one: a gate finds
# staleness after the fact and only when somebody runs it, whereas generating the artifact makes
# staleness a state the tree cannot be in. That is not theoretical here. This half of the script was
# RED when it was deleted: a commit that added `@throws` prose to three Java SDK files moved the
# catalogue on the next build of gg and left java.sdk.jar (and kotlin.sdk.jar) at an older vintage.
# The fix was to delete the gate and stop committing what it gated, not to re-cut and commit.
#
# The same reasoning retired crates/gg/src/sandbox/language/artifacts.test.rs, which stood in for a
# diff over the four BAKED INTERPRETERS (the TypeScript/JavaScript, Python, Ruby and C# guest
# components) that no diff could ever cover, because not one of them is byte-reproducible — measured,
# two builds of one checkout differing only in where the toolchains were unpacked came out 48 bytes
# apart. It recomputed the source digests a build.sh had written into a manifest beside its output,
# so it could attest what a build had been TOLD and never what it produced.
#
# So: this script gates GENERATED-AND-COMMITTED files, and there are exactly two kinds left, both
# above. If a change makes you want to add a third, the question to ask first is whether the artifact
# needs to be committed at all. What proves gg's own artifacts WORK is the per-arm substrate, surface
# and compile tests, which are untouched and were always the load-bearing half; nothing here ever
# tested behaviour. To READ a catalogue — worth doing, since reflectors are programs and their bugs
# have been of the shape "the `@return` prose was dropped" — run `scripts/gg-signatures.sh` and open
# `target/gg-signatures/`.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "npm ci"
npm ci

# THESE ARE INSTALLED TO BUILD gg, NOT TO REGENERATE ANYTHING. Nothing in this script re-cuts a
# signature catalogue or a checker any more. But `npm run gen:contract` below projects
# crates/backend/src/gg_reference.json by RUNNING gg — `cargo run -p test-cabinet-gg -- reference` is
# its first step — and building gg now reaches every arm twice over. Its own build script reflects
# all eleven arms' catalogues out of their guest SDKs, each with its own documentation tool: `tsc`,
# griffe, YARD, `purs`, javadoc, the Kotlin front end, rustdoc, `swiftc -emit-symbol-graph`,
# `clang++ -ast-dump=json`, Roslyn. And the artifact crates it depends on compile those arms'
# COMPILE INPUTS — javac and `jar` for the JVM arms' SDK jars, Node and the pinned `opal-compiler`
# and `componentize-js` for the Ruby and TypeScript arms, `cargo` against the wasm target for the
# Rust arm's rlibs, `purs` and Spago for the PureScript arm's library tree, and the wasi-sdk and the
# Swift SDK for WebAssembly for the C++ and Swift arms' guest archives. Without them the very first
# cargo invocation below dies inside a build script, several layers away from anything that looks
# like a contract. One call, one pinned list: the same script the devcontainer, the Rust lint/test
# scripts and the driver image's gg stage all run, and it installs both halves — plus a second call
# for the one arm neither half covers, immediately below it.
log "install gg's program-language toolchains (gg is BUILT below; its build reflects and compiles them)"
./scripts/ci/install-gg-toolchains.sh
# And the second list, which is not part of the eleven and must not become part of them: the whole
# .NET SDK and unpruned wasi-sdk that RELINK the C# guest. That guest is not committed any more
# either, so `cargo build -p test-cabinet-gg` below produces it — and without this line
# `packages/gg-sandbox-csharp/build.sh` quietly fetches ~1.4 GB into its own `.build/` instead of
# using the prefix an agent was hydrated with. Idempotent; see its header for why it is separate.
log "install the csharp arm's build toolchains (~1.4 GB no gg RUN needs)"
./scripts/ci/install-gg-build-toolchains.sh
# Several of them land in ~/.local/bin — uv, `purs` — and the reflectors resolve them off PATH. An
# installer cannot export into the shell that ran it, so this shell does it.
export PATH="$HOME/.local/bin:$PATH"

log "regenerate the contract (cargo run -p contract-codegen + prettier)"
npm run gen:contract

log "check for drift"
if ! git diff --exit-code -- packages/run-record/src apps/docs/public/schema \
	crates/backend/src/gg_reference.json; then
	cat >&2 <<'EOF'

error: the generated contract artifacts are out of date.
The TypeScript bindings and/or JSON Schemas no longer match the Rust source, or
gg's committed reference (crates/backend/src/gg_reference.json) no longer matches
the tools and responses-as-code functions gg actually offers models — in which
case the backend would serve, and the console would render, a description no
model was ever sent.
Run `npm run gen:contract` and commit the result.
EOF
	exit 1
fi
