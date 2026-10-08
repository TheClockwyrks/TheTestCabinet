#!/usr/bin/env bash
# Installs Playwright's Chromium and the system libraries it links against, then
# starts it once to prove it runs.
#
#   scripts/ci/install-playwright-chromium.sh
#
# ci/images/rust-browser.Dockerfile runs this, as root, to give the Rust gate job
# a browser. Some of core's tests drive a real browser through the npm
# workspace's Playwright, in the Chromium it launches. With
# TCAB_REQUIRE_BROWSER=1, which that job sets once it runs in that image, a
# missing browser fails them rather than letting them skip (see
# crates/core/src/test_browser.rs). `npm ci` installs Playwright and downloads
# no browser, so the image has to carry one.
#
# The web image installs all three engines with .devcontainer/tools/browsers.sh
# and .devcontainer/system/browser-deps.sh. Those two run as different users in
# the devcontainer, and a Rust test needs only Chromium, so this script does both
# halves in one `install --with-deps chromium`. That is apt, so it needs root.
#
# The version is the PLAYWRIGHT_VERSION .devcontainer/docker-compose.yml pins, the
# one the image build passes in as a build argument. Run from a checkout without
# it set, the script reads the pin from that file. `web-browser-test` holds the
# workspace's `playwright` package to the same pin, so the Chromium build
# installed here is the one the workspace's Playwright looks for. Playwright
# installs into PLAYWRIGHT_BROWSERS_PATH when that is set, as the CI images set
# it, and into ~/.cache/ms-playwright otherwise.
#
# It sources no helper, tcab-lib.sh included, because the image build copies this
# one file and runs it outside any checkout.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly COMPOSE="$here/../../.devcontainer/docker-compose.yml"

if [[ -z "${PLAYWRIGHT_VERSION:-}" && -f "$COMPOSE" ]]; then
	PLAYWRIGHT_VERSION="$(sed -n 's/^ *PLAYWRIGHT_VERSION: *\(.*\)$/\1/p' "$COMPOSE")"
fi
if [[ -z "${PLAYWRIGHT_VERSION:-}" ]]; then
	echo "install-playwright-chromium.sh: PLAYWRIGHT_VERSION is not set and no pin was found in $COMPOSE" >&2
	exit 1
fi

if ! command -v npx >/dev/null; then
	echo "install-playwright-chromium.sh: no npx on PATH" >&2
	echo "  Node.js comes first: .devcontainer/languages/node/install.sh installs it." >&2
	exit 1
fi

playwright=(npx --yes "playwright@$PLAYWRIGHT_VERSION")

DEBIAN_FRONTEND=noninteractive "${playwright[@]}" install --with-deps chromium

# Start Chromium headless and render a page in it. A download for the wrong
# architecture and a missing system library both install quietly, and would
# first fail in a test days later without naming a cause.
shots="$(mktemp -d)"
trap 'rm -rf "$shots"' EXIT
if ! "${playwright[@]}" screenshot --browser chromium about:blank "$shots/chromium.png" >/dev/null 2>&1; then
	echo "install-playwright-chromium.sh: chromium does not start here" >&2
	echo "  dpkg --print-architecture: $(dpkg --print-architecture 2>/dev/null || echo unknown); uname -m: $(uname -m)" >&2
	exit 1
fi

echo "Installed Playwright $PLAYWRIGHT_VERSION's chromium to ${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}."
