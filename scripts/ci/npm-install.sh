#!/usr/bin/env bash
# Installs the npm workspace from the lockfile: the one step every gate that runs
# Node runs first. It is its own step so that its duration is visible on its own,
# so that the gates after it run against one install rather than each deleting
# and re-creating node_modules, and so that a failing install reports as a failing
# install rather than as a failing gate.
#
# `npm ci` rather than `npm install`: it validates the whole workspace against
# package-lock.json and refuses to drift it.
#
# The Rust jobs run it too: building crates/gg reflects the TypeScript and
# JavaScript signature catalogues with the pinned `typescript` that lives here.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "npm ci"
npm ci
