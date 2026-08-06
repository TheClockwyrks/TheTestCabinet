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
#     component needs its own toolchain — `componentize-js` for TypeScript, which is
#     deliberately not an installed dependency (it is driven by
#     packages/gg-sandbox/build.sh via `npx`) — whereas `signatures` needs only the
#     `typescript` the `npm ci` below already installs. The committed .wasm files
#     therefore sit in the diffed directory untouched: nothing here regenerates one,
#     so one cannot cause a false positive, and if one ever does diff then something
#     rewrote a binary CI must not touch and failing is right.
#
#  4. gg's program CHECKERS, under crates/gg/src/sandbox/checkers/. A language that
#     type-checks a model's program carries its compiler and that compiler's standard
#     library, because gg is copied as a single file into a run container. TypeScript's
#     is cut straight out of the pinned `typescript` — the same one the catalogue is
#     reflected with — so bumping the pin without re-cutting the checker would leave a
#     model's program judged by one release and its prompt written from another. It is
#     the same regenerate-and-diff rule, and it needs only `typescript` too.
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
regenerated="typescript javascript"
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

log "re-cut gg's program checkers (tools/checker.mjs)"
npm run --workspace @test-cabinet/gg-sandbox checker

log "check for signature and checker drift"
if ! git diff --exit-code -- crates/gg/src/sandbox/guests crates/gg/src/sandbox/checkers; then
	cat >&2 <<'EOF'

error: a committed gg sandbox catalogue or program checker is out of date.
crates/gg/src/sandbox/guests/<language>.signatures.json no longer matches that
language's guest SDK declarations, so the responses-as-code prompt would show
models a surface the sandbox does not export.
Run the regeneration for the language that drifted and commit the result — for
TypeScript, `npm run -w @test-cabinet/gg-sandbox signatures`.

If the SDK's exported *surface* changed (a tool added, removed, or renamed) that
language's committed component is stale too: rebuild it with its own build script
— for TypeScript, packages/gg-sandbox/build.sh — and commit
crates/gg/src/sandbox/guests/<language>.component.wasm alongside.

If instead crates/gg/src/sandbox/checkers/ drifted, the pinned compiler a model's
program is type-checked with no longer matches the one installed here — usually a
`typescript` version bump. Run `npm run -w @test-cabinet/gg-sandbox checker` and
commit the result.
EOF
	exit 1
fi
