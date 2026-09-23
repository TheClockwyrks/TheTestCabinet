#!/usr/bin/env bash
# Pre-commit gate: fail if rustdoc reports anything with warnings denied.
#
# This guards the doc-comment half of the workspace that neither clippy nor the
# test suite can see. The workspace denies `warnings` ([workspace.lints.rust] in
# the root Cargo.toml), and that group covers rustdoc's own lints, so a broken
# intra-doc link is already a hard error — but only when something actually runs
# `cargo doc`. Nothing did before this hook, which is how the workspace
# accumulated 135 of them across 25 crates unnoticed.
#
# `--document-private-items` is why it now sees the crates that need it most.
# Without it rustdoc walks only a crate's *public* surface, so the gate is as
# small as a crate's exports: `crates/gg` exposes exactly one `pub` item
# (`run_from_args`) and declares every module as private `mod`, so this hook
# passed vacuously over ~44k doc-comment lines. Measured, not theorised — a
# deliberately broken link planted in `crates/gg/src/sandbox/operations.rs`
# produced no warning and exit 0. With the flag that crate reported 304
# unresolved links, including ones naming items deleted with the multi-model
# feature (`PRIMARY_SLOT`, `CAPABILITY_MULTI_MODEL`, `validate_slots`).
#
# It is applied workspace-wide, matching scripts/ci/rust-lint.sh exactly (change
# the two together, or the hook and CI stop agreeing about what a clean tree is).
#
# Note this is NOT doctests. `cargo test --doc` compiles and runs the ``` code
# examples inside doc comments; it says nothing about whether the links in those
# comments resolve. The two gates catch disjoint problems, and doctests are the
# one this repo does not need locally: every doctest in the workspace is
# `ignore`/`text`, so `cargo test --doc` spends ~35s to execute zero tests. CI
# still runs it (scripts/ci/rust-test.sh) as the backstop for when that changes.
#
# `--no-deps` documents only workspace crates, not the dependency graph, which is
# what makes this cheap enough to sit on every commit even with private items in
# scope. Re-measured on one machine with and without the flag, so the delta is the
# part to trust: no-op 1s → 2s, and 38s → 61s after touching test-cabinet-core
# (the crate with the most dependents); touching crates/gg, the crate the flag
# actually unlocks, costs 13s. Still comparable to the clippy gate beside it, and
# it reuses the same `cargo check` artifacts clippy just built.
#
# Invoked by pre-commit (see .pre-commit-config.yaml); also runnable by hand.
set -euo pipefail

# Run from the repo root so cargo resolves the workspace regardless of the caller's
# working directory.
cd "$(git rev-parse --show-toplevel)"

if ! cargo doc --locked --workspace --no-deps --document-private-items; then
	echo >&2
	echo "rustdoc found issues. Fix them, then commit again." >&2
	echo "(If a commit is genuinely fine, 'git commit --no-verify' bypasses the hook; CI remains the backstop.)" >&2
	exit 1
fi
