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
# It runs against a workspace scripts/ci/npm-install.sh has installed and whose
# packages scripts/ci/npm-build-packages.sh has built: the pinned `typescript`
# the checker resolves comes from the first, and the engine runtimes a validator
# imports publish their types from a built `dist/`, so without the second every
# symbol taken from an engine degrades to `any`. It needs no credentials, no
# network and no Rust.
#
# This is critical validation the Azure pipeline runs, a step of the `web` job.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "type-check every validator project"
npm run typecheck:validators
