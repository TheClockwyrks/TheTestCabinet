#!/usr/bin/env bash
# Runs the Node-side unit tests: the front-end suites (vitest) across every npm
# workspace that has any, plus the repository scripts' own suites.
#
# WHY THE SCRIPTS RUN HERE. `scripts/` is not an npm workspace, so
# `npm run test --workspaces` cannot reach it and the `node:test` suites under
# `scripts/lib/` would be executed by no gate at all. They are hermetic (no network,
# no ffmpeg, no R2) and take under a second, so they belong with the other Node tests
# rather than in a job of their own.
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

log "test the repository scripts"
npm run test:scripts
