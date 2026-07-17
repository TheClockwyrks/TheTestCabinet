#!/usr/bin/env bash
# Pre-commit gate: fail if Clippy reports anything with warnings denied.
#
# This is the Clippy half of the CI lint gate (scripts/ci/rust-lint.sh, which
# also checks rustfmt); the formatting half lives in scripts/hooks/rust-fmt.sh.
# Clippy compiles the workspace, so this is the slow gate — it mirrors CI's
# invocation exactly (every headless crate, all targets, warnings denied) and
# excludes only the Tauri desktop shell (crates/desktop), whose heavy GUI system
# libraries CI likewise skips. Clippy operates on the whole workspace, so this
# checks everything regardless of which files are staged.
#
# Invoked by pre-commit (see .pre-commit-config.yaml); also runnable by hand.
set -euo pipefail

# Run from the repo root so cargo resolves the workspace regardless of the caller's
# working directory.
cd "$(git rev-parse --show-toplevel)"

if ! cargo clippy --locked --workspace --exclude test-cabinet-desktop --all-targets -- -D warnings; then
	echo >&2
	echo "clippy found issues. Fix them, then commit again." >&2
	echo "(If a commit is genuinely fine, 'git commit --no-verify' bypasses the hook; CI remains the backstop.)" >&2
	exit 1
fi
