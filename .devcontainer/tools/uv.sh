#!/usr/bin/env bash
# Installs uv (Astral's Python package/tool manager) and, on top of it, the
# `pre-commit` framework used by this repository's git hooks (see
# scripts/setup-hooks.sh and .pre-commit-config.yaml).
#
# We use uv rather than the system pip because the base image ships no usable pip
# (`python3 -m pip` is absent) and uv is a single static binary that also manages
# its own Python, so nothing here depends on the image's Python. `uv tool
# install` drops an isolated, PATH-visible `pre-commit` shim beside it.
#
# Every version is pinned so a rebuilt container reproduces today's toolchain;
# override with the UV_VERSION / PRE_COMMIT_VERSION env vars when bumping.
#
# PRE_COMMIT_VERSION below is the one place the pre-commit version is decided.
# Two other files repeat it and have to follow a bump: `minimum_pre_commit_version`
# in .pre-commit-config.yaml, and the fallback `uv tool install` in
# scripts/setup-hooks.sh for a clone working outside this container.
set -euo pipefail

readonly UV_VERSION="${UV_VERSION:-0.11.29}"
readonly PRE_COMMIT_VERSION="${PRE_COMMIT_VERSION:-4.6.0}"

# Where the two commands land. The devcontainer takes the default, ~/.local/bin,
# which the Dockerfile already puts on the PATH. The CI images under ci/images/
# override it to /usr/local/bin instead, because a CI image has no container
# user to own a home directory and a tool under /root is reachable only by root.
#
# UV_INSTALL_DIR is read by uv's own installer; UV_TOOL_BIN_DIR is read by
# `uv tool install` when it links an entry point. They are set to the same
# directory so that overriding one place moves everything this script installs,
# rather than scattering uv and its tools across two directories.
: "${UV_INSTALL_DIR:=$HOME/.local/bin}"
export UV_INSTALL_DIR
export UV_TOOL_BIN_DIR="$UV_INSTALL_DIR"

# INSTALLER_NO_MODIFY_PATH keeps the installer from editing shell rc files: an
# rc file is read by interactive shells alone, and every tool in the CI images
# is reached through the image's own PATH instead.
export INSTALLER_NO_MODIFY_PATH=1

mkdir -p "$UV_INSTALL_DIR"
curl -LsSf "https://astral.sh/uv/${UV_VERSION}/install.sh" | sh

# `uv tool install` fetches a uv-managed CPython automatically if the container
# has no suitable interpreter, then installs the pinned pre-commit into an
# isolated environment and links its entry point into UV_TOOL_BIN_DIR.
"$UV_INSTALL_DIR/uv" tool install "pre-commit==${PRE_COMMIT_VERSION}" --force

echo "Installed uv ${UV_VERSION} and pre-commit ${PRE_COMMIT_VERSION} to $UV_INSTALL_DIR"
