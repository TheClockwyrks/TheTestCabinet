#!/usr/bin/env bash
# Installs the npm workspace from the lockfile.
#
#   scripts/ci/npm-install.sh
#
# `npm ci` rather than `npm install`, so the tree is exactly what
# package-lock.json pins and a gate never judges a dependency release.
#
# It asserts no Node version. The Node it runs on is the toolchain image's, in
# the devcontainer and in every CI image alike, since each is built on the one
# TOOLCHAIN_IMAGE .devcontainer/docker-compose.yml names, so the two cannot
# drift apart.
#
# Run by the pipeline inside the CI image before the first gate; runnable by
# hand from any working directory.
set -euo pipefail

# shellcheck source=scripts/ci/lib.sh
# SC1091 is suppressed because this repository holds `lib.sh.jinja`, so the
# source above resolves in a render and not here.
# shellcheck disable=SC1091
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

if ! npm ci; then
	remediation "The install from the lockfile failed. Reproduce it with:" \
		"    npm ci"
	exit 1
fi
