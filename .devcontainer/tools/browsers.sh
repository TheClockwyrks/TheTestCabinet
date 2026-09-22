#!/usr/bin/env bash
# Installs the Chromium the workspace's Playwright launches: the case-harness
# suite in the front-end commit gate, the validator's browser driver, and the
# served validator-project tests in the Rust suite.
#
# Playwright puts browsers in ~/.cache/ms-playwright, which belongs to the
# container user, so this runs unprivileged and the download is baked into the
# image. Left to `postCreateCommand`'s `npm ci`, nothing would fetch it at all:
# `npm ci` installs Playwright but downloads no browser, and a rebuilt container
# then fails the commit gate with "Executable doesn't exist".
#
# The system libraries Chromium links against are apt's, installed as root
# beforehand by system/browser-deps.sh.
#
# PLAYWRIGHT_VERSION (docker-compose.yml) has to match the `playwright` the
# workspace installs (packages/case-harness, packages/browser-driver), because
# Playwright resolves a browser build per client version: a mismatch installs a
# Chromium the tests never ask for.
#
# This runs at container build time, and is also what picks up a moved pin in a
# container built before it moved, without waiting for a rebuild:
#
#     bash .devcontainer/tools/browsers.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# The image build passes the pin in as a build argument. Run by hand from a
# checkout, the pin is read from where the build gets it.
if [[ -z "${PLAYWRIGHT_VERSION:-}" && -f "$here/../docker-compose.yml" ]]; then
	PLAYWRIGHT_VERSION="$(sed -n 's/^ *PLAYWRIGHT_VERSION: *//p' "$here/../docker-compose.yml")"
fi
: "${PLAYWRIGHT_VERSION:?PLAYWRIGHT_VERSION must be set}"

npx --yes "playwright@$PLAYWRIGHT_VERSION" install chromium

# Start Chromium once, headless, and render a page in it. A download for the
# wrong architecture and a missing system library both install quietly, and
# would first fail in the commit gate. A screenshot exercises the whole path the
# tests use: the browser starts, a page loads, and pixels come back.
shots="$(mktemp -d)"
trap 'rm -rf "$shots"' EXIT
if ! npx --yes "playwright@$PLAYWRIGHT_VERSION" screenshot \
	--browser chromium about:blank "$shots/chromium.png" >/dev/null 2>&1; then
	echo "browsers.sh: chromium does not start in this image" >&2
	echo "  dpkg --print-architecture: $(dpkg --print-architecture); uname -m: $(uname -m)" >&2
	exit 1
fi

echo "Installed chromium to ${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}."
