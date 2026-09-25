#!/usr/bin/env bash
# Type-checks every test case's validator projects (scripts/typecheck-validators.mjs).
#
# A case's validators are TypeScript that nothing else in this repository
# compiles: they are never built, never bundled, and never seeded — they are
# staged into a produced tree and run by vitest, which transpiles without
# checking types. So `tsc` here is the only thing that ever tells a case author
# that a validator does not compile, and a validator that does not compile fails
# every review point it decides, on every run of that case.
#
# It needs the npm workspace installed for two reasons: the pinned `typescript`
# the checker resolves, and the packages the validators import (the engine
# runtimes, `@clockwyrks/case-harness`, vitest, `@napi-rs/canvas`). It needs no
# credentials, no network beyond that install, and no Rust.
#
# WHY THE PACKAGES ARE BUILT FIRST. The engine runtimes publish their types from
# a built `dist/`, so on a clean checkout a validator that imports
# `@clockwyrks/simple-2d` resolves no declarations and every symbol it takes from
# the engine degrades to `any`. The list of packages is the root `build:packages`
# script's to know, the same list `web-test.sh` builds.
#
# This is critical validation the Azure pipeline runs.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "npm ci"
npm ci

log "build the workspace packages the validators import"
npm run build:packages

log "type-check every validator project"
npm run typecheck:validators
