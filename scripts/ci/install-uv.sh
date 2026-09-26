#!/usr/bin/env bash
# Install uv (Astral's Python package/tool manager) from its official installer,
# so a CI agent has the same Python toolchain the devcontainer does
# (.devcontainer/tools/uv.sh). Pinned to UV_VERSION so the two match.
#
# It is uv rather than pip because this repo's Python work does not run against a
# shared interpreter: the devcontainer's base image ships no usable pip at all
# (`python3 -m pip` is absent, and `python3 -m venv` has no ensurepip), and a
# `pip install` into a CI agent's system Python is refused on modern Ubuntu
# (PEP 668). uv is a single static binary that brings its own CPython, so every
# machine that runs `packages/gg-sandbox-python/signatures.sh` gets the same one.
#
# Idempotent: a matching version already on PATH (the devcontainer's, or a cache
# restore) is left as-is.
set -euo pipefail

UV_VERSION="${UV_VERSION:-0.11.29}"

if command -v uv >/dev/null 2>&1 && uv --version 2>/dev/null | grep -q "$UV_VERSION"; then
	echo "uv $UV_VERSION already installed"
	exit 0
fi

# The standalone installer places `uv`/`uvx` in UV_INSTALL_DIR;
# INSTALLER_NO_MODIFY_PATH keeps it from editing shell rc files, which a
# non-interactive CI shell would never read anyway.
export INSTALLER_NO_MODIFY_PATH=1
export UV_INSTALL_DIR="$HOME/.local/bin"

mkdir -p "$UV_INSTALL_DIR"
echo "Installing uv $UV_VERSION -> $UV_INSTALL_DIR"
curl -LsSf "https://astral.sh/uv/${UV_VERSION}/install.sh" | sh
"$UV_INSTALL_DIR/uv" --version
