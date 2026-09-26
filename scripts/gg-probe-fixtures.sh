#!/usr/bin/env bash
#
# Project gg's model-probe fixtures into the backend crate.
#
#   scripts/gg-probe-fixtures.sh [OUT_DIR]   # default: crates/backend/src/probe/fixtures
#
# WHAT IT WRITES. One `<language>.json` per registered program language: the responses-as-code
# turn-1 conversation the backend's model probe replays for each of its cases — the real system
# prompt, the real bootstrap program and module listing, the real documentation views, a seeded spec
# file view with its total-line-count heading — plus the
# `submit_program` tool definition and each case's pass criteria. Nothing model-facing is authored
# twice: every byte comes out of the same machinery a real gg session sends (see
# `crates/gg/src/probe_fixtures.rs`).
#
# WHY THE OUTPUT IS COMMITTED. The backend must not depend on `test-cabinet-gg` (see
# `scripts/gg-reference.sh` for the whole argument), and the probe embeds its request at compile
# time via `include_str!`, so the projection crosses the crate boundary as committed JSON under
# `crates/backend/src/probe/fixtures/`. Re-run this script — and commit the diff — whenever the
# system prompt, an arm's catalogue, or a probe case changes.
#
# WHAT IT NEEDS: whatever BUILDING gg needs (all eleven toolchains; the devcontainer has them).
# Running the projection itself needs none of them.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT_DIR="${1:-crates/backend/src/probe/fixtures}"

cargo run --quiet -p test-cabinet-gg --bin gg -- probe-fixtures --out "$OUT_DIR"

echo
echo "Wrote gg's probe fixtures to $OUT_DIR:"
for document in "$OUT_DIR"/*.json; do
	printf '  %-24s %8s bytes\n' "$(basename "$document")" "$(wc -c <"$document")"
done
