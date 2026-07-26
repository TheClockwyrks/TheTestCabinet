#!/usr/bin/env bash
# Regenerates every generated-and-committed contract artifact from its source of
# truth and fails if a committed copy is stale.
#
# Two contracts are checked here, because both are generated from source that a
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
#  2. gg's sandbox signature catalogue. crates/gg/src/sandbox/signatures.json is
#     emitted from the TypeScript declarations of @test-cabinet/gg-sandbox (the
#     guest SDK) and embedded in the gg binary, which renders the responses-as-code
#     system prompt from it. If an SDK signature or its JSDoc is edited without
#     regenerating the catalogue, models get shown a surface the guest no longer
#     exports — so the same regenerate-and-diff rule applies. Only the `signatures`
#     half of the guest build is checked: rebuilding the component itself needs
#     `componentize-js`, which is deliberately not an installed dependency (it is
#     driven by packages/gg-sandbox/build.sh via `npx`), whereas `signatures` needs
#     only the `typescript` the `npm ci` below already installs.
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
The TypeScript bindings and/or JSON Schemas no longer match the Rust source.
Run `npm run gen:contract` and commit the result.
EOF
	exit 1
fi

log "regenerate gg's sandbox signature catalogue (tsc + tools/signatures.mjs)"
npm run --workspace @test-cabinet/gg-sandbox signatures

log "check for signature drift"
if ! git diff --exit-code -- crates/gg/src/sandbox/signatures.json; then
	cat >&2 <<'EOF'

error: gg's committed sandbox signature catalogue is out of date.
crates/gg/src/sandbox/signatures.json no longer matches the guest SDK's
declarations, so the responses-as-code prompt would show models a surface the
sandbox does not export.
Run `npm run -w @test-cabinet/gg-sandbox signatures` and commit the result.

If the SDK's exported *surface* changed (a tool added, removed, or renamed) the
committed component is stale too: rebuild it with packages/gg-sandbox/build.sh
and commit crates/gg/src/sandbox/gg-sandbox.component.wasm alongside.
EOF
	exit 1
fi
