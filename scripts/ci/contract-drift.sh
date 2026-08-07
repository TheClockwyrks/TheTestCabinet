#!/usr/bin/env bash
# Regenerates every generated-and-committed contract artifact from its source of
# truth and fails if a committed copy is stale.
#
# Four artifacts are checked here, because each is generated from source that a
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
#  3. gg's sandbox signature catalogues. gg's responses-as-code capability drives a
#     model in one of its registered PROGRAM LANGUAGES, and each language commits a
#     guest and a signature catalogue under crates/gg/src/sandbox/guests/, named for
#     the language: <language-id>.component.wasm and <language-id>.signatures.json.
#     Each catalogue is emitted from that language's guest SDK — for TypeScript, the
#     declarations of @test-cabinet/gg-sandbox — and embedded in the gg binary, which
#     renders the responses-as-code system prompt from it. If an SDK signature or its
#     doc comment is edited without regenerating the catalogue, models get shown a
#     surface the guest no longer exports, so the same regenerate-and-diff rule
#     applies. The whole directory is diffed rather than one file, so a second
#     language's catalogue is covered by this gate the day it lands.
#
#     Only the `signatures` half of each guest build is run here: rebuilding a
#     component needs its own toolchain — `componentize-js` for TypeScript and
#     `componentize-py` for Python, neither of which is an installed dependency (each
#     is driven by that package's own build.sh) — whereas emitting a catalogue reads
#     the sources and needs only that language's documentation tool: the `typescript`
#     the `npm ci` below already installs, a pinned `griffe` that
#     packages/gg-sandbox-python/signatures.sh fetches through uv, a pinned `yard`
#     that packages/gg-sandbox-ruby/signatures.sh installs into the Ruby all three of
#     these machines already ship, the pinned `purs` scripts/ci/install-purescript.sh
#     fetches (PureScript's documentation tool IS its compiler), the JDK
#     scripts/ci/install-java.sh fetches, whose `javadoc` runs a doclet of gg's own, and
#     the Kotlin compiler scripts/ci/install-kotlin.sh fetches, whose own front end reads
#     KDoc — the reading Dokka would itself be asking for, with one fewer thing pinned, and
#     the `rustdoc` this checkout's own pinned toolchain already ships, whose JSON output is
#     read under RUSTC_BOOTSTRAP because that output is unstable and this repository pins a
#     stable compiler on purpose. The
#     committed .wasm files therefore sit in the diffed directory untouched: nothing here regenerates one, so one cannot cause a
#     false positive, and if one ever does diff then something rewrote a binary CI must
#     not touch and failing is right.
#
#     A guest need not be an npm package, and Python's is not — only the emitted JSON
#     is contractual. That is why each language owns its own regeneration command and
#     why this script installs uv: the devcontainer's base image ships no usable pip
#     and a CI agent's system Python refuses one (PEP 668), so uv is how every machine
#     that runs this reaches the same pinned `griffe`.
#
#  4. gg's program CHECKERS and COMPILERS, under crates/gg/src/sandbox/checkers/. A
#     language whose prepare step runs a compiler carries that compiler, because gg is
#     copied as a single file into a run container. TypeScript's is cut straight out of
#     the pinned `typescript` — the same one the catalogue is reflected with — so bumping
#     the pin without re-cutting the checker would leave a model's program judged by one
#     release and its prompt written from another; Ruby's is Opal, cut out of the pinned
#     `opal-compiler`, and the same argument holds twice over there because the SAME pin
#     also decides the runtime baked into that language's guest. It is the same
#     regenerate-and-diff rule, and each needs only Node.
#
#     PureScript's artifact in that directory is the one exception, and it is a declared one:
#     it is not a compiler at all but the compiled LIBRARY SET a program is type-checked
#     against, which needs `purs` and the registry to rebuild, and it is verified by what is
#     committed beside it — see the exemption below, which is enforced rather than assumed.
#
#     Java's stem covers three files of three different kinds, and only one of them is re-cut
#     here: the SDK jar, which is this arm's LIBRARY and is rebuilt reproducibly from
#     packages/gg-sandbox-java/src. The other two are neither cut nor derived — the compiler
#     DRIVER is gg's own hand-written source, reviewable by reading and diffing like any other,
#     and the toolchain manifest is the pin itself. What could drift between those two and the
#     shell side that installs them is what `java.compile.test.rs` fails on.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "npm ci"
npm ci

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

# One regeneration per registered program language. Each guest owns its own script,
# because a guest need not even be an npm package — only the JSON it emits is
# contractual — so a second language adds a line here rather than changing this one.
# The gg-sandbox script below is the one that emits two: `typescript` and `javascript`
# are one guest and one set of declarations, differing only in whether gg type-checks the
# program, so their catalogues are two reflections of the same source rather than two
# sources.
#
# The stems this script knows how to regenerate. The drift check below diffs *every*
# committed catalogue, so one whose guest this script never re-runs would be green whatever
# its sources did. That is the failure this list closes: an unregenerated stem is an error
# rather than a silent pass, and the message says exactly what to add.
regenerated="typescript javascript python ruby purescript java kotlin rust"
for catalogue in crates/gg/src/sandbox/guests/*.signatures.json; do
	stem="$(basename "$catalogue" .signatures.json)"
	case " $regenerated " in
	*" $stem "*) ;;
	*)
		cat >&2 <<EOF

error: $catalogue has no regeneration step in this script.
Its guest's declarations could change without the drift check noticing, because the
check below only diffs what has already been written. Add the regeneration command
for the $stem guest here, and add "$stem" to \$regenerated.
EOF
		exit 1
		;;
	esac
done

log "regenerate gg's sandbox signature catalogues (tsc + tools/signatures.mjs)"
npm run --workspace @test-cabinet/gg-sandbox signatures

log "install uv (the Python guest's catalogue is reflected with a pinned griffe)"
./scripts/ci/install-uv.sh
export PATH="$HOME/.local/bin:$PATH"

log "regenerate the Python guest's signature catalogue (griffe + tools/signatures.py)"
./packages/gg-sandbox-python/signatures.sh

log "regenerate the Ruby guest's signature catalogue (YARD + tools/signatures.rb)"
./packages/gg-sandbox-ruby/signatures.sh

log "install the pinned purs (the PureScript arm's catalogue is reflected with the compiler itself)"
./scripts/ci/install-purescript.sh
export PATH="$HOME/.local/bin:$PATH"

log "regenerate the PureScript arm's signature catalogue (purs --codegen docs + tools/signatures.mjs)"
./packages/gg-sandbox-purescript/signatures.sh

log "install the pinned JDK (the Java arm's catalogue is reflected with javadoc's doclet API)"
./scripts/ci/install-java.sh

log "regenerate the Java arm's signature catalogue (javadoc + tools/GgSignatures.java)"
./packages/gg-sandbox-java/signatures.sh

log "install the pinned Kotlin compiler (this arm's catalogue is reflected with its own front end)"
./scripts/ci/install-kotlin.sh

log "regenerate the Kotlin arm's signature catalogue (KDoc through the compiler's own PSI)"
./packages/gg-sandbox-kotlin/signatures.sh

log "install the wasm target (the Rust arm's catalogue is reflected for the target it compiles to)"
./scripts/ci/install-rust-wasm.sh

log "regenerate the Rust arm's signature catalogue (rustdoc JSON + tools/signatures.py)"
./packages/gg-sandbox-rust/signatures.sh

# The same completeness rule the catalogues get, over the other committed directory: a
# checker or compiler this script never re-cuts would sit in the diff below and be green
# whatever its pin said. Stems are the first dot-separated component of each file name,
# which is the language id each artifact is named for.
recut="typescript ruby java kotlin"
# The one exemption, and it is an exemption rather than an omission. PureScript's committed
# artifact is not a compiler: it is the LIBRARY SET, compiled — 1.2 MB of externs and
# JavaScript that `purs` needs before it can type-check anything. Re-cutting it needs `purs`,
# Spago and the registry, takes about a minute, and produces a binary nobody can review by
# reading. So it is verified by its CONTENTS instead: `purescript.compiler.json` declares
# every package and module in the tree, and gg's own test unpacks the tarball and compares —
# a tree rebuilt with a different library set and committed without its manifest fails there.
# `spago.yaml` and `spago.lock` are committed beside the build, so what went in is reviewable
# even though what came out is not.
#
# Java's stem is in $recut rather than here, and it is worth saying what that re-cut does and
# does not cover, because the stem names three files of three kinds. `java.sdk.jar` is this
# arm's LIBRARY — the surface a model's program is compiled against — and it is rebuilt from
# `packages/gg-sandbox-java/src` below, reproducibly (`jar --date` and a sorted entry list), so
# an SDK edit committed without the jar fails the diff exactly as an unregenerated catalogue
# does. `java.compiler.java` is gg's own hand-written compiler driver and `java.toolchain.json`
# is the pin itself: neither is cut from anything, both are reviewable by reading, and what
# could drift is the pin against the shell side that installs it — which `java.compile.test.rs`
# fails on when the two name different releases, when a TeaVM jar in the list is at another
# version, or when the driver's protocol constant and the manifest's disagree.
#
# `jvm` is the third, and it is the same kind as Java's driver: `jvm.backend.java` is the half of
# that hand-written driver the two JVM arms SHARE — javac, TeaVM and the JSON — which gg appends to
# an arm's front end before running it. Nothing cuts it either, and what it must not lose is
# asserted over the text rather than by a diff: `jvm.test.rs` fails if the TeaVM settings that make
# a `NullPointerException` an exception at all leave it.
#
# `kotlin`'s stem is in $recut for the same reason Java's is, and covers the same three kinds of
# file: `kotlin.sdk.jar` is this arm's LIBRARY and is rebuilt below out of
# `packages/gg-sandbox-kotlin/src`, reproducibly, so an SDK edit committed without the jar fails the
# diff; `kotlin.compiler.java` is this arm's own half of gg's hand-written driver and
# `kotlin.toolchain.json` is its pin, and neither is cut from anything. What could drift between the
# pin and the shell side that installs it is what `kotlin.compile.test.rs` fails on — including when
# the scripting plugin's four file names, which the compiler looks for by name and without which
# every program on this arm fails, leave the list.
#
# `rust` is exempted for PureScript's reason and answered with a stronger check than a diff.
# Its committed artifact is not a compiler either: `rust.libraries.tar.gz` is the compiled
# LIBRARY SET — this arm's SDK and the curated crates a model's program is linked against — and
# re-cutting it needs the pinned `wit-bindgen` CLI downloaded from GitHub and a
# `wasm32-unknown-unknown` build, and produces an archive of binaries nobody can review by
# reading. `rust.toolchain.json` declares what built it and every crate in it, and gg's own tests
# compare it four ways: the manifest against the archive's contents; the manifest's compiler
# against THIS CHECKOUT's `rustc` (an `.rlib` cannot be read by any other release, so a bumped
# `rust-toolchain.toml` fails there by name); the crates the manifest marks `extern` against the
# ones the CATALOGUE regenerated above tells a model it may name, which is the drift a stale
# tarball beside a fresh catalogue would otherwise be; and — the check no diff could make — a
# real Rust program, compiled against the set by the production prepare step and run through the
# real membrane, that calls every one of them. A stale set does not merely differ; it stops
# linking.
declared="purescript jvm rust"
for artifact in crates/gg/src/sandbox/checkers/*; do
	stem="$(basename "$artifact")"
	stem="${stem%%.*}"
	case " $recut $declared " in
	*" $stem "*) ;;
	*)
		cat >&2 <<EOF

error: $artifact has no re-cut step in this script.
The compiler a $stem program is judged by could drift from its pin without the drift
check noticing, because the check below only diffs what has already been written. Add
the re-cut command for $stem here, and add "$stem" to \$recut — or, if the artifact is
verified by a committed manifest instead, add it to \$declared and say where.
EOF
		exit 1
		;;
	esac
done

log "re-cut gg's program checkers (tools/checker.mjs)"
npm run --workspace @test-cabinet/gg-sandbox checker

log "re-cut the Ruby compiler (Opal, tools/compiler.mjs)"
./packages/gg-sandbox-ruby/compiler.sh

log "rebuild the Java arm's SDK jar (javac + jar)"
./packages/gg-sandbox-java/build.sh

log "rebuild the Kotlin arm's SDK jar (kotlinc + jar)"
./packages/gg-sandbox-kotlin/build.sh

log "check for signature and checker drift"
if ! git diff --exit-code -- crates/gg/src/sandbox/guests crates/gg/src/sandbox/checkers; then
	cat >&2 <<'EOF'

error: a committed gg sandbox catalogue or program checker is out of date.
crates/gg/src/sandbox/guests/<language>.signatures.json no longer matches that
language's guest SDK declarations, so the responses-as-code prompt would show
models a surface the sandbox does not export.
Run the regeneration for the language that drifted and commit the result — for
TypeScript, `npm run -w @test-cabinet/gg-sandbox signatures`; for Python,
`packages/gg-sandbox-python/signatures.sh`; for Ruby,
`packages/gg-sandbox-ruby/signatures.sh`; for PureScript,
`packages/gg-sandbox-purescript/signatures.sh`; for Java,
`packages/gg-sandbox-java/signatures.sh`; for Kotlin,
`packages/gg-sandbox-kotlin/signatures.sh`.

If the SDK's exported *surface* changed (a tool added, removed, or renamed) that
language's committed component is stale too: rebuild it with its own build script
— packages/gg-sandbox/build.sh for TypeScript, packages/gg-sandbox-python/build.sh
for Python, packages/gg-sandbox-ruby/build.sh for Ruby — and commit
crates/gg/src/sandbox/guests/<language>.component.wasm alongside. PureScript has no
component of its own, and its SDK lives instead inside the committed LIBRARY TREE:
run packages/gg-sandbox-purescript/build.sh and commit
crates/gg/src/sandbox/checkers/purescript.libraries.tar.gz with its manifest. Java has no
component of its own either, and its SDK is the committed JAR: run
packages/gg-sandbox-java/build.sh and commit
crates/gg/src/sandbox/checkers/java.sdk.jar with the regenerated catalogue. Kotlin shares
that guest and that arrangement: run packages/gg-sandbox-kotlin/build.sh and commit
crates/gg/src/sandbox/checkers/kotlin.sdk.jar with its catalogue.

If instead crates/gg/src/sandbox/checkers/ drifted, the pinned compiler a model's
program is compiled or type-checked with no longer matches the one installed here —
usually a version bump. Run `npm run -w @test-cabinet/gg-sandbox checker` for
TypeScript's, or `packages/gg-sandbox-ruby/compiler.sh` for Ruby's, and commit the
result. A Ruby bump is two artifacts, not one: the same pin decides the Opal baked
into that language's guest, so rebuild it with
packages/gg-sandbox-ruby/build.sh and commit the component alongside.
EOF
	exit 1
fi
