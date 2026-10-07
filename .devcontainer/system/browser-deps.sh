#!/usr/bin/env bash
# Installs the system libraries the browser engines need in order to start,
# which tools/browsers.sh then downloads the engines themselves against. The
# set of engines is that script's ENGINES array, repeated here because the two
# run as different users and share nothing but this name.
#
# The package list is Playwright's own. `install-deps` resolves the names for
# whatever distribution it finds itself on, so a base image bump brings the
# right packages with it and there is no second list here to fall behind. That
# is why these packages are absent from system/apt.sh, where every other apt
# package in this image is installed.
#
# The ordering is the part worth stating, because it is why the Dockerfile
# changes user twice around this script. `install-deps` is apt, so it needs
# root; it is also `npx`, so it needs the Node.js that languages/node/install.sh
# unpacks into the container user's home, which happens in the unprivileged
# build step further down. Neither half can move, so the Dockerfile returns to
# root once Node exists and hands the build back to the container user
# afterwards. Root reads no shell profile and has no Node of its own, so this
# script puts the container user's bin directory on PATH itself.
#
# This runs at container build time, and is also what picks up a moved pin in a
# container built before it moved, without waiting for a rebuild:
#
#     sudo bash .devcontainer/system/browser-deps.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# The engines, which are the ones tools/browsers.sh installs.
readonly ENGINES=(chromium firefox webkit)

# The image build passes the pin in as a build argument. Run by hand from a
# checkout, the pin is read from where the build gets it. See
# https://www.npmjs.com/package/playwright for the version list.
if [[ -z "${PLAYWRIGHT_VERSION:-}" && -f "$here/../docker-compose.yml" ]]; then
	PLAYWRIGHT_VERSION="$(sed -n 's/^ *PLAYWRIGHT_VERSION: *\(.*\)$/\1/p' "$here/../docker-compose.yml")"
fi
: "${PLAYWRIGHT_VERSION:?PLAYWRIGHT_VERSION must be set}"

# In the devcontainer, Node lives under the container user's home and root's
# PATH covers none of it, so that user's bin directory is put on the PATH here.
# The build passes USERNAME in; a `sudo` run by hand names the same user in
# SUDO_USER. The web CI image has no container user and puts Node on the image's
# own PATH instead, so the directory is prepended only when there is a user to
# build it from, and what this insists on is `npx` resolving rather than who
# owns it.
readonly BROWSER_USER="${USERNAME:-${SUDO_USER:-}}"
if [ -n "$BROWSER_USER" ]; then
	export PATH="/home/$BROWSER_USER/.local/bin:$PATH"
fi

if ! command -v npx >/dev/null; then
	echo "browser-deps.sh: no npx on PATH" >&2
	echo "  Node.js is installed by languages/node/install.sh, which runs first." >&2
	exit 1
fi

apt-get update -y
DEBIAN_FRONTEND=noninteractive \
	npx --yes "playwright@$PLAYWRIGHT_VERSION" install-deps "${ENGINES[@]}"

echo "Installed the ${ENGINES[*]} system libraries."
