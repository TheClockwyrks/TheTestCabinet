#!/usr/bin/env bash
# Installs the npm workspace and builds the front ends: the gallery (apps/site),
# the operator web console (apps/web), and the developer docs (apps/docs).
#
# Each `build` script runs `tsc -b` (type-checking) before `vite build`, so this
# both type-checks and produces the static bundle in one step (the docs are an
# Astro Starlight build that type-checks as it builds). The run-record package is
# built first because the site and console both import its compiled types and JS;
# the shared `@test-cabinet/ui` library is consumed from source, so it needs no
# separate build step. This is the critical front-end validation that both Azure
# DevOps and GitHub run.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "npm ci"
npm ci

log "build @test-cabinet/run-record"
npm run build -w @test-cabinet/run-record

log "build @test-cabinet/site"
npm run build -w @test-cabinet/site

log "build @test-cabinet/web"
npm run build -w @test-cabinet/web

log "build @test-cabinet/docs"
npm run build -w @test-cabinet/docs
