#!/usr/bin/env bash
# Installs uv (Astral's Python package/tool manager) and, on top of it, the
# `pre-commit` framework used by this repo's git hooks (see scripts/setup-hooks.sh
# and .pre-commit-config.yaml).
#
# We use uv rather than the system pip because the base image ships no usable pip
# (`python3 -m pip` is absent) and uv is a single static binary that also manages
# its own Python, so nothing here depends on the host Python. `uv tool install`
# drops an isolated, PATH-visible `pre-commit` shim into ~/.local/bin.
#
# Both versions are pinned so a rebuilt container reproduces today's toolchain;
# override with the UV_VERSION / PRE_COMMIT_VERSION env vars when bumping.
set -euo pipefail

readonly UV_VERSION="${UV_VERSION:-0.11.29}"
readonly PRE_COMMIT_VERSION="${PRE_COMMIT_VERSION:-4.6.0}"

# The uv standalone installer places `uv`/`uvx` in ~/.local/bin (already on PATH
# via the Dockerfile). INSTALLER_NO_MODIFY_PATH keeps it from editing shell rc
# files, and UV_INSTALL_DIR pins the destination explicitly.
export INSTALLER_NO_MODIFY_PATH=1
export UV_INSTALL_DIR="$HOME/.local/bin"

mkdir -p "$HOME/.local/bin"
curl -LsSf "https://astral.sh/uv/${UV_VERSION}/install.sh" | sh

# `uv tool install` fetches a uv-managed CPython automatically if the container
# has no suitable interpreter, then installs the pinned pre-commit into an
# isolated environment and links its entry point into ~/.local/bin.
"$HOME/.local/bin/uv" tool install "pre-commit==${PRE_COMMIT_VERSION}" --force

echo "Installed uv ${UV_VERSION} and pre-commit ${PRE_COMMIT_VERSION} to $HOME/.local/bin"
