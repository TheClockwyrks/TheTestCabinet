#!/usr/bin/env bash
# Idempotent one-shot setup for this repo's git hooks.
#
# Run this once after cloning (the devcontainer runs it for you on create). It
# installs the pre-commit framework's hooks into .git/hooks so the gates in
# .pre-commit-config.yaml run: the fast ones on every `git commit`, the two heavy
# Rust gates (clippy, rustdoc) on `git push`. Both hook types are installed by the
# one `pre-commit install` below, because the config declares
# `default_install_hook_types: [pre-commit, pre-push]`. Safe to re-run any time —
# and worth re-running on a clone set up before the pre-push hook existed, which
# would otherwise never run the heavy gates at all.
#
# Because git never runs committed hooks until something wires them into a clone,
# this is the single command that does that wiring.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# pre-commit is baked into the devcontainer image (.devcontainer/tools/uv.sh). If
# it's missing (e.g. running outside the devcontainer), install it via uv, and
# fall back to a clear error if uv isn't available either.
if ! command -v pre-commit >/dev/null 2>&1; then
	if command -v uv >/dev/null 2>&1; then
		echo "pre-commit not found; installing it with uv..."
		# Keep this version on PRE_COMMIT_VERSION in .devcontainer/tools/uv.sh,
		# which is where the image's own pre-commit is pinned; a clone that falls
		# through to here should end up with the same framework the devcontainer
		# has, not a newer one that judges the hooks differently.
		uv tool install "pre-commit==4.6.0"
		# uv links tools into ~/.local/bin; make sure it's reachable this run.
		export PATH="$HOME/.local/bin:$PATH"
	else
		echo "Error: neither pre-commit nor uv is installed." >&2
		echo "Install uv first: bash .devcontainer/tools/uv.sh" >&2
		exit 1
	fi
fi

echo "Installing the pre-commit and pre-push hooks..."
pre-commit install

# Best-effort: pre-build the hook environments now so the first real commit or
# push isn't slowed by cloning/bootstrapping them. Needs network; a failure here is not fatal
# (the environments build lazily on first use instead).
if ! pre-commit install --install-hooks; then
	echo "Note: could not pre-build hook environments (offline?); they will build" >&2
	echo "      on your first commit or push instead." >&2
fi

echo "Done. Hooks are active: the fast gates run on every 'git commit', and the"
echo "heavy Rust gates (clippy, rustdoc) run on 'git push'."
