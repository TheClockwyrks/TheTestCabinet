#!/usr/bin/env bash
# Installs the browser engines the workspace's Playwright launches: the web
# app's browser tests run against all three, and Chromium is also what the
# case-harness suite, the validator's browser driver and the served
# validator-project tests in the Rust suite launch.
#
# The set is named once, in ENGINES below, and system/browser-deps.sh installs
# the libraries for the same three. WebKit stands in for Safari. Apple
# publishes no Safari for Linux, and never will, so the engine underneath it is
# as close as this container gets: Playwright builds WebKit from the same
# upstream source Safari is built from, which is what makes a layout or
# rendering difference surface here rather than first on somebody's Mac.
# Nothing below claims to install Safari itself.
#
# Playwright puts the engines in ~/.cache/ms-playwright, which belongs to the
# container user, so this runs unprivileged and the downloads are baked into the
# image rather than fetched again on every machine that opens it. The web CI
# image has no container user and sets PLAYWRIGHT_BROWSERS_PATH to a shared
# directory instead, which Playwright reads here and again when a test asks for
# an engine. The system
# libraries they link against are apt's, installed as root beforehand by
# system/browser-deps.sh. The architecture is Playwright's to resolve, the way
# it resolves the package list — see "Architecture" in README.md.
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

# The engines, named here and read from here by everything below.
readonly ENGINES=(chromium firefox webkit)

# The image build passes the pin in as a build argument. Run by hand from a
# checkout, the pin is read from where the build gets it. See
# https://www.npmjs.com/package/playwright for the version list.
if [[ -z "${PLAYWRIGHT_VERSION:-}" && -f "$here/../docker-compose.yml" ]]; then
	PLAYWRIGHT_VERSION="$(sed -n 's/^ *PLAYWRIGHT_VERSION: *\(.*\)$/\1/p' "$here/../docker-compose.yml")"
fi
: "${PLAYWRIGHT_VERSION:?PLAYWRIGHT_VERSION must be set}"

npx --yes "playwright@$PLAYWRIGHT_VERSION" install "${ENGINES[@]}"

# Start each engine once, headless, and render a page in it. A download for the
# wrong architecture and a missing system library both install quietly, and
# would first fail in the test gate or under a person's fingers. Taking a
# screenshot exercises the whole path the tests use: the engine starts, a page
# loads, and pixels come back. See "Architecture" in README.md.
shots="$(mktemp -d)"
trap 'rm -rf "$shots"' EXIT

verify_launches() {
	local engine="$1"
	if ! npx --yes "playwright@$PLAYWRIGHT_VERSION" screenshot \
		--browser "$engine" about:blank "$shots/$engine.png" >/dev/null 2>&1; then
		echo "browsers.sh: $engine does not start in this image" >&2
		echo "  dpkg --print-architecture: $(dpkg --print-architecture); uname -m: $(uname -m)" >&2
		exit 1
	fi
}

for engine in "${ENGINES[@]}"; do
	verify_launches "$engine"
done

echo "Installed ${ENGINES[*]} to ${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}."
