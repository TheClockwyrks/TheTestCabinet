#!/usr/bin/env bash
# Runs the front-end unit tests (vitest) across every npm workspace that has any.
#
# WHY THE PACKAGES ARE BUILT FIRST. The workspace runtime packages —
# `run-record`, `run-stats`, and the two runtimes — publish their entry points
# from a built `dist/`, so on a clean checkout (which is what CI is) a test that
# imports one resolves to nothing and the suite fails to collect. The order they
# are built in is the root `build:packages` script's to know; it is the same list
# `build:site` builds before the gallery, kept in one place so it cannot go stale
# in two.
#
# Type-checking is not this script's job: every front end is type-checked by its
# own build (each `build` script runs `tsc -b` first), which `web-build.sh` runs.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "npm ci"
npm ci

log "build the workspace runtime packages the tests import"
npm run build:packages

log "test the npm workspaces"
npm run test --workspaces --if-present
