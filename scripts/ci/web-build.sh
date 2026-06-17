#!/usr/bin/env bash
# Installs the npm workspace and builds the websites: the gallery (apps/site)
# and the developer docs (apps/docs).
#
# The site's `build` script runs `tsc -b` (type-checking) before `vite build`,
# so this both type-checks and produces the static bundle in one step. The
# run-record package is built first because the site imports its compiled types
# and JS. The docs are an independent Astro Starlight build with no such
# dependency. This is the critical website validation that both Azure DevOps and
# GitHub run.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "npm ci"
npm ci

log "build @test-cabinet/run-record"
npm run build -w @test-cabinet/run-record

log "build @test-cabinet/site"
npm run build -w @test-cabinet/site

log "build @test-cabinet/docs"
npm run build -w @test-cabinet/docs
