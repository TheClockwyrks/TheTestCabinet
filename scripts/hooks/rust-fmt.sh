#!/usr/bin/env bash
# Fast pre-commit gate: fail if any Rust source is not rustfmt-clean.
#
# This is the formatting half of the CI lint gate (scripts/ci/rust-lint.sh, which
# also runs the slower clippy), pulled out so `git commit` can enforce formatting
# without paying for a full clippy pass. rustfmt formats the whole workspace at
# once, so this checks everything regardless of which files are staged.
#
# Invoked by pre-commit (see .pre-commit-config.yaml); also runnable by hand.
set -euo pipefail

# Run from the repo root so cargo resolves the workspace regardless of the caller's
# working directory.
cd "$(git rev-parse --show-toplevel)"

if ! cargo fmt --all -- --check; then
	echo >&2
	echo "rustfmt found unformatted code. Fix it with:" >&2
	echo "    cargo fmt --all" >&2
	exit 1
fi
