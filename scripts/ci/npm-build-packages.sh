#!/usr/bin/env bash
# Builds the workspace packages the front ends, the tests and the validators
# import: `run-record`, `run-stats`, `asset-contract`, the engine runtimes and the
# two rendering runtimes publish their entry points and their types from a built
# `dist/`, so on a clean checkout a test that imports one resolves to nothing and
# a validator that imports an engine sees every symbol as `any`.
#
# The list and the order are the root `build:packages` script's to know; it is
# the same list `build:site` builds before the gallery, kept in one place so it
# cannot go stale in two.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "build the workspace packages"
npm run build:packages
