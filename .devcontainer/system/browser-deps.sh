#!/usr/bin/env bash
# Installs the system libraries Chromium needs in order to start, which
# tools/browsers.sh then downloads the browser itself against.
#
# The package list is Playwright's own. `install-deps` resolves the names for
# whatever distribution it finds itself on, so a base image bump brings the
# right packages with it and there is no second list here to fall behind. That
# is why these packages are absent from system/apt.sh, where every other apt
# package in this image is installed.
#
# The ordering is the part worth stating, because it is why the devcontainer's
# Dockerfile changes user twice around this script. `install-deps` is apt, so it
# needs root; it is also `npx`, so it needs the Node.js that
# languages/node/install.sh unpacks into the container user's home, which happens
# in the unprivileged build step further up. Neither half can move, so that
# Dockerfile returns to root once Node exists and hands the build back to the
# container user afterwards. Root reads no shell profile and has no Node of its
# own, so this script puts the container user's bin directory on PATH itself.
#
# This runs at container build time, and is also what picks up a moved pin in a
# container built before it moved, without waiting for a rebuild:
#
#     sudo bash .devcontainer/system/browser-deps.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# The image build passes the pin in as a build argument. Run by hand from a
# checkout, the pin is read from where the build gets it.
if [[ -z "${PLAYWRIGHT_VERSION:-}" && -f "$here/../docker-compose.yml" ]]; then
	PLAYWRIGHT_VERSION="$(sed -n 's/^ *PLAYWRIGHT_VERSION: *//p' "$here/../docker-compose.yml")"
fi
: "${PLAYWRIGHT_VERSION:?PLAYWRIGHT_VERSION must be set}"

# Node lives under the container user's home, and root's PATH covers none of it.
# The build passes USERNAME in; a `sudo` run by hand names the same user in
# SUDO_USER.
readonly BROWSER_USER="${USERNAME:-${SUDO_USER:-}}"
if [[ -n "$BROWSER_USER" && -d "/home/$BROWSER_USER/.local/bin" ]]; then
	export PATH="/home/$BROWSER_USER/.local/bin:$PATH"
fi

if ! command -v npx >/dev/null; then
	echo "browser-deps.sh: no npx on PATH" >&2
	echo "  Node.js is installed by languages/node/install.sh, which runs first." >&2
	exit 1
fi

apt-get update -y
DEBIAN_FRONTEND=noninteractive \
	npx --yes "playwright@$PLAYWRIGHT_VERSION" install-deps chromium

echo "Installed the Chromium system libraries."
