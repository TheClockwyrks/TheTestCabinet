#!/usr/bin/env bash
# Installs the npm workspace, runs the front-end unit tests, and builds the front
# ends: the gallery (apps/site), the operator web console (apps/web), and the
# developer docs (apps/docs).
#
# Each `build` script runs `tsc -b` (type-checking) before `vite build`, so this
# both type-checks and produces the static bundle in one step (the docs are an
# Astro Starlight build that type-checks as it builds).
#
# The gallery is built through the root `build:site` script rather than
# `-w @test-cabinet/site`, because the site does not build on its own: it and the
# `@test-cabinet/ui` library it consumes from source import several workspace
# runtime packages that publish their types only from a built `dist/`, so those
# have to be built first, in dependency order. That order is the root script's job
# to know — see `apps/docs/src/content/docs/development/releasing.md`, which names
# it the single source of truth, and note that Cloudflare's git-connected gallery
# build runs the very same script. Duplicating the list here is how it went stale:
# `run-stats` and `share-links` were added to the root script and not to this one,
# leaving CI building the site against packages it had never built.
#
# The console and docs follow, and reuse those same built packages.
#
# The site is deliberately built with **no `TCAB_SNAPSHOT_URL`**, which is the
# empty-published-dataset path a fresh deployment takes. That is not merely
# tolerated, it is the point: it is the only place that path is exercised.
#
# This is the critical front-end validation that both Azure DevOps and GitHub run.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "npm ci"
npm ci

# The workspace unit tests (vitest), for every workspace that defines a `test`
# script. Run before the builds because a failing assertion is faster and more
# specific feedback than a failing bundle.
log "test the npm workspaces"
npm run test --workspaces --if-present

log "build @test-cabinet/site (and the runtime packages it depends on)"
npm run build:site

log "build @test-cabinet/web"
npm run build -w @test-cabinet/web

log "build @test-cabinet/docs"
npm run build -w @test-cabinet/docs
