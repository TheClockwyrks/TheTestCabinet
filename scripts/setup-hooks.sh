#!/usr/bin/env bash
# Idempotent one-shot setup for this repo's git hooks.
#
# Run this once after cloning (the devcontainer runs it for you on create). It
# installs the pre-commit framework's hook into .git/hooks so the gates in
# .pre-commit-config.yaml run on every `git commit`. Safe to re-run any time.
#
# Because git never runs committed hooks until something wires them into a clone,
# this is the single command that does that wiring. CI (scripts/ci/*, driven by
# azure-pipelines.yml and .github/workflows/ci.yml) runs the same
# formatting/lint/spell gates, so it stays the backstop even if a clone never
# runs this.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# pre-commit is baked into the devcontainer image (.devcontainer/tools/uv.sh). If
# it's missing (e.g. running outside the devcontainer), install it via uv, and
# fall back to a clear error if uv isn't available either.
if ! command -v pre-commit >/dev/null 2>&1; then
	if command -v uv >/dev/null 2>&1; then
		echo "pre-commit not found; installing it with uv..."
		uv tool install "pre-commit==4.6.0"
		# uv links tools into ~/.local/bin; make sure it's reachable this run.
		export PATH="$HOME/.local/bin:$PATH"
	else
		echo "Error: neither pre-commit nor uv is installed." >&2
		echo "Install uv first: bash .devcontainer/tools/uv.sh" >&2
		exit 1
	fi
fi

echo "Installing the pre-commit hook..."
pre-commit install

# Best-effort: pre-build the hook environments now so the first real commit isn't
# slowed by cloning/bootstrapping them. Needs network; a failure here is not fatal
# (the environments build lazily on first use instead).
if ! pre-commit install --install-hooks; then
	echo "Note: could not pre-build hook environments (offline?); they will build" >&2
	echo "      on your first commit instead." >&2
fi

echo "Done. Hooks are active; they run on every 'git commit'."
