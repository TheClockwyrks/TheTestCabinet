#!/usr/bin/env bash
# Checks Prettier formatting over the whole checkout (scripts/format-check.mjs):
# packages, front ends, documentation, and every test case's specs, validators,
# seeded workspaces and reference implementations. Only what `.prettierignore`
# names and the frozen test-case versions are left out. Needs the npm workspace
# installed for the pinned `prettier`; no credentials, no Rust.
#
# The Azure pipeline runs it as the `format` gate.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "npm ci"
npm ci

log "check formatting (prettier)"
npm run lint:format
