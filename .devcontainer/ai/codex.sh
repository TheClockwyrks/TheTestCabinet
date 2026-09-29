#!/usr/bin/env bash
# Installs OpenAI's Codex CLI.
#
# This script must be run after the Node installer.
set -euo pipefail

# See https://www.npmjs.com/package/@openai/codex for the version list. Pinned
# like every other tool in this image so a rebuild reproduces today's toolchain
# rather than whatever the registry publishes that morning.
: "${CODEX_VERSION:?CODEX_VERSION must be set}"

readonly BIN_PATH="$HOME/.local/bin/codex"

mkdir -p "$HOME/.local/bin"
npm install -g "@openai/codex@${CODEX_VERSION}"

# npm links its global binaries into the Node installation's own bin directory,
# which is on no PATH a process started in this container is given: a session
# started with `docker exec` or `podman exec` naming `codex` runs no shell that
# could add it. Symlink the command into ~/.local/bin, the directory the
# Dockerfile puts on PATH for every process in the image, as ai/claude.sh's
# installer does for `claude`.
npm_prefix="$(npm prefix -g)"
readonly npm_prefix
ln -sf "$npm_prefix/bin/codex" "$BIN_PATH"

# Run it once, from where a session finds it. The npm package is a launcher
# that picks an optional dependency matching the platform it was installed on,
# so an install that resolved no such dependency succeeds and only fails when a
# session starts. See "Architecture" in .devcontainer/README.md.
if ! codex_version="$("$BIN_PATH" --version 2>&1)"; then
	echo "codex.sh: @openai/codex@${CODEX_VERSION} does not run from $BIN_PATH in this image" >&2
	echo "  dpkg --print-architecture: $(dpkg --print-architecture); uname -m: $(uname -m)" >&2
	exit 1
fi

echo "Installed ${codex_version} to $BIN_PATH"
