#!/usr/bin/env bash
# Runs the front-end unit tests (vitest) across every npm workspace that has any,
# plus the two type-checks no build covers.
#
# WHY THE PACKAGES ARE BUILT FIRST. The workspace runtime packages —
# `run-record`, `run-stats`, `share-links`, and the two runtimes — publish their
# entry points from a built `dist/`, so on a clean checkout (which is what CI is)
# a test that imports one resolves to nothing and the suite fails to collect. The
# order they are built in is the root `build:packages` script's to know; it is the
# same list `build:site` builds before the gallery, kept in one place so it cannot
# go stale in two.
#
# WHAT IS TYPE-CHECKED HERE. Every front end is type-checked by its own build (each
# `build` script runs `tsc -b` first), so `web-build.sh` covers the gallery, the
# console, and the docs. Two things have no build in that sense and would otherwise
# be checked by nothing: the `tcab.ai` Worker (`apps/edge`), and the gallery's
# Cloudflare Pages Functions (`functions/`), which sit outside every workspace
# because Pages resolves them from the repository root. Both are checked here,
# where the workspace is already installed.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "npm ci"
npm ci

log "build the workspace runtime packages the tests import"
npm run build:packages

log "test the npm workspaces"
npm run test --workspaces --if-present

log "typecheck the short-link Worker and the gallery's Pages Functions"
npm run typecheck -w @test-cabinet/edge
npx --no-install tsc -p functions
