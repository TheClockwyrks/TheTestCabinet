#!/usr/bin/env bash
# Regenerates every generated-and-committed contract artifact from its source of
# truth and fails if a committed copy is stale.
#
# ONE artifact is checked here: the data contract. The TS bindings
# (packages/run-record/src/) and the JSON Schemas (apps/docs/public/schema/) are
# generated from the Rust types that derive `ts_rs::TS` + `schemars::JsonSchema` (see
# crates/contract-codegen and scripts/gen-contract.mjs). Any change to one of those
# types — including the rustdoc, which is emitted into the schemas as descriptions —
# that is not regenerated and committed turns this check red, so the three
# representations can never silently drift apart.
#
# It is committed, and stays committed, for the one reason that survives everything the
# rest of this header describes being deleted: its READERS cannot run the generator.
# They are TypeScript builds (`tsc -b packages/run-record`, Vite, the site build) and a
# static docs site serving the schemas as files, none of which can invoke a Rust binary.
# Committing is what you do when the reader cannot run the generator.
#
# WHAT IS NOT CHECKED HERE, AND USED TO BE — READ THIS BEFORE ADDING A SECOND ITEM. This script was
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
# AND THE MOST RECENT THING IT STOPPED GATING, retired on exactly that reasoning:
# crates/backend/src/gg_reference.json, the projection of gg's model-facing surface the console's
# Reference page is served from. It was committed because the backend serves it and cannot depend on
# test-cabinet-gg — oxc and tiktoken-rs, and eleven language toolchains to build it — so a committed
# artifact stood in for the dependency and this check made it "as trustworthy as one". It was neither
# of those things in the end. It carried ONE of gg's eleven program languages, because the projection
# picked the default arm; it was a second renderer of prose whose first renderer is gg's own
# documentation runtime; and a gate that finds staleness after the fact only when somebody runs it is
# strictly weaker than an artifact that cannot be stale. gg writes the twelve documents itself now
# (`gg reference --out`, see scripts/gg-reference.sh), the backend image bakes them beside the binary,
# and tcab-backend reads them at run time from TCAB_GG_REFERENCE.
#
# THE CONSEQUENCE FOR THIS SCRIPT IS LARGER THAN A DELETED PATH: it does not build gg any more, so
# it does not need gg's toolchains any more. `npm run gen:contract`'s first step used to be
# `cargo run -p test-cabinet-gg -- reference`, and building gg reaches every arm twice over — eleven
# documentation tools to reflect the catalogues, and every arm's artifact crate to compile what a
# program is judged against. Two installer calls and ~3.3 GB stood here for exactly that one step.
# What is left links test-cabinet-core and test-cabinet-backend, and the backend links neither gg nor
# anything gg pulls. If you find yourself adding an installer back, check first whether something
# taught this script to build gg again — that is the regression, not the missing toolchain.
#
# So: this script gates GENERATED-AND-COMMITTED files, and there is exactly one kind left, at the top.
# If a change makes you want to add a second, the question to ask first is whether the artifact needs
# to be committed at all — and the test that decides it is whether its READERS can run the generator.
# What proves gg's own artifacts WORK is the per-arm substrate, surface and compile tests, which are
# untouched and were always the load-bearing half; nothing here ever tested behaviour. To READ a
# catalogue — worth doing, since reflectors are programs and their bugs have been of the shape "the
# `@return` prose was dropped" — run `scripts/gg-signatures.sh` and open `target/gg-signatures/`; to
# read the reference the console renders, run `scripts/gg-reference.sh` and open
# `target/gg-reference/`.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "npm ci"
npm ci

log "regenerate the contract (cargo run -p contract-codegen + prettier)"
npm run gen:contract

log "check for drift"
if ! git diff --exit-code -- packages/run-record/src apps/docs/public/schema; then
	cat >&2 <<'EOF'

error: the generated contract artifacts are out of date.
The TypeScript bindings and/or JSON Schemas no longer match the Rust types they
are generated from, so the Rust, TypeScript and JSON Schema representations of
the contract disagree.
Run `npm run gen:contract` and commit the result.
EOF
	exit 1
fi
