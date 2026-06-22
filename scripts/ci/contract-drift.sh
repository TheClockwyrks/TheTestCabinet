#!/usr/bin/env bash
# Regenerates the data contract — the TypeScript bindings and the JSON Schemas —
# from the Rust source of truth and fails if the committed output is stale.
#
# This is what makes the contract drift-proof. The TS bindings
# (packages/run-record/src/) and the JSON Schemas (apps/docs/public/schema/) are
# generated from the Rust types that derive `ts_rs::TS` + `schemars::JsonSchema`
# (see crates/contract-codegen and scripts/gen-contract.mjs). Any change to one of
# those types that is not regenerated and committed turns this check red, so the
# three representations can never silently drift apart again.
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
