#!/usr/bin/env bash
# Installs Anthropic's Claude Code CLI.
#
# The installer takes the release to fetch as its one argument, so the version
# is pinned here the way every other tool in this image is; without it the
# installer resolves the `stable` channel and a rebuild moves. See
# https://github.com/anthropics/claude-code/releases for the version list.
set -euo pipefail

: "${CLAUDE_CODE_VERSION:?CLAUDE_CODE_VERSION must be set}"

# Where the installer links the command: ~/.local/bin, the directory the
# Dockerfile puts on PATH for every process in the image, which is what a
# session started with `docker exec` or `podman exec` naming `claude` finds it
# by, with no shell to add anything to its PATH.
readonly BIN_PATH="$HOME/.local/bin/claude"

# The installer gives its download a fixed deadline, which a slow link can
# exceed although nothing is wrong with the release, so a failed attempt is
# made again, a bounded number of times, before the build fails.
readonly ATTEMPTS=3
attempt=1
until curl -fsSL https://claude.ai/install.sh | bash -s -- "$CLAUDE_CODE_VERSION"; do
	if ((attempt >= ATTEMPTS)); then
		echo "claude.sh: installing Claude Code ${CLAUDE_CODE_VERSION} failed ${ATTEMPTS} times" >&2
		exit 1
	fi
	attempt=$((attempt + 1))
	echo "claude.sh: the install failed; attempt ${attempt} of ${ATTEMPTS}" >&2
	sleep 10
done

# Run it once, from where a session finds it, so an installer that put the
# command anywhere else fails the build rather than the first session.
if ! claude_version="$("$BIN_PATH" --version 2>&1)"; then
	echo "claude.sh: Claude Code ${CLAUDE_CODE_VERSION} does not run from $BIN_PATH in this image" >&2
	exit 1
fi

echo "Installed Claude Code ${claude_version} to $BIN_PATH"
