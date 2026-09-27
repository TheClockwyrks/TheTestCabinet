#!/usr/bin/env bash
# Installs the npm workspace from the lockfile, on the Node the devcontainer
# pins.
#
#   scripts/ci/npm-install.sh
#
# The version assertion is what ties the Node this runs on to the image's: it
# reads NODE_VERSION out of the compose file's build arguments, so a workspace
# about to be installed on another Node stops here naming both versions rather
# than surfacing later as a gate that only fails on one machine.
#
# `npm ci` rather than `npm install`, so the tree is exactly what
# package-lock.json pins and a gate never judges a dependency release.
#
# Run by the pipeline inside the devcontainer before the first gate; runnable
# by hand from any working directory.
set -euo pipefail

# shellcheck source=scripts/ci/lib.sh
# SC1091 is suppressed because this repository holds `lib.sh.jinja`, so the
# source above resolves in a render and not here.
# shellcheck disable=SC1091
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

expected="$(build_arg NODE_VERSION)"
actual="$(node --version)"

if [ "$actual" != "v${expected}" ]; then
	echo >&2 "node is $actual and ${DEVCONTAINER_COMPOSE} pins v${expected}."
	remediation \
		"The Node the workspace installs on and the image's Node are one" \
		"version, decided by NODE_VERSION in ${DEVCONTAINER_COMPOSE}. Run this" \
		"in the devcontainer, or put that version on the PATH here."
	exit 1
fi

if ! npm ci; then
	remediation "The install from the lockfile failed. Reproduce it with:" \
		"    npm ci"
	exit 1
fi
