#!/usr/bin/env bash
# Idempotent one-shot setup for this repo's git hooks.
#
# Run this once after cloning (the devcontainer runs it for you on create). It
# installs the pre-commit framework's hooks into .git/hooks: the commit hook, so
# the gates in .pre-commit-config.yaml run on every `git commit`, and the push
# hook, so the one gate that judges a push, submodule-remotes, runs on every
# `git push`. Safe to re-run any time.
#
# Because git never runs committed hooks until something wires them into a clone,
# this is the single command that does that wiring.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# pre-commit is baked into the toolchain image the devcontainer is built on
# (TOOLCHAIN_IMAGE in .devcontainer/docker-compose.yml). If it's missing (e.g.
# running outside the devcontainer), install it via uv, and fall back to a
# clear error if uv isn't available either.
if ! command -v pre-commit >/dev/null 2>&1; then
	if command -v uv >/dev/null 2>&1; then
		echo "pre-commit not found; installing it with uv..."
		# Keep this version on the pre-commit the toolchain image holds, which
		# the template pins; a clone that falls through to here should end up
		# with the same framework the devcontainer has, not a newer one that
		# judges the hooks differently.
		uv tool install "pre-commit==4.6.0"
		# uv links tools into ~/.local/bin; make sure it's reachable this run.
		export PATH="$HOME/.local/bin:$PATH"
	else
		echo "Error: neither pre-commit nor uv is installed." >&2
		echo "Install uv first (https://docs.astral.sh/uv/), or work in the devcontainer," >&2
		echo "whose toolchain image carries both." >&2
		exit 1
	fi
fi

# Both hook types are named, as .pre-commit-config.yaml's
# `default_install_hook_types` names them, so a clone set up by an older copy of
# this script, which installed the commit hook alone, gains the push hook too.
HOOK_TYPES=(--hook-type pre-commit --hook-type pre-push)

echo "Installing the pre-commit and pre-push hooks..."
pre-commit install "${HOOK_TYPES[@]}"

# Best-effort: pre-build the hook environments now so the first real commit or
# push isn't slowed by cloning/bootstrapping them. Needs network; a failure here is not fatal
# (the environments build lazily on first use instead).
if ! pre-commit install "${HOOK_TYPES[@]}" --install-hooks; then
	echo "Note: could not pre-build hook environments (offline?); they will build" >&2
	echo "      on your first commit or push instead." >&2
fi

echo "Done. Hooks are active; they run on every 'git commit' and 'git push'."
