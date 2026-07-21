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
# Note this is NOT doctests. `cargo test --doc` compiles and runs the ``` code
# examples inside doc comments; it says nothing about whether the links in those
# comments resolve. The two gates catch disjoint problems, and doctests are the
# one this repo does not need locally: every doctest in the workspace is
# `ignore`/`text`, so `cargo test --doc` spends ~35s to execute zero tests. CI
# still runs it (scripts/ci/rust-test.sh) as the backstop for when that changes.
#
# `--no-deps` documents only workspace crates, not the dependency graph, which is
# what makes this cheap enough to sit on every commit: ~5s warm, ~11s after
# touching test-cabinet-core (the crate with the most dependents) — comparable to
# the clippy gate beside it, and reusing the same `cargo check` artifacts clippy
# just built. Like clippy, it excludes only the Tauri desktop shell
# (crates/desktop) so committing does not require the desktop app's heavy GUI
# system libraries; rustdoc has to compile a crate before it can document it.
#
# Invoked by pre-commit (see .pre-commit-config.yaml); also runnable by hand.
set -euo pipefail

# Run from the repo root so cargo resolves the workspace regardless of the caller's
# working directory.
cd "$(git rev-parse --show-toplevel)"

if ! cargo doc --locked --workspace --exclude test-cabinet-desktop --no-deps; then
	echo >&2
	echo "rustdoc found issues. Fix them, then commit again." >&2
	echo "(If a commit is genuinely fine, 'git commit --no-verify' bypasses the hook; CI remains the backstop.)" >&2
	exit 1
fi
