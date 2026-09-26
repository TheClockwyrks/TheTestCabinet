#!/usr/bin/env bash
# Runs the Node-side unit tests: the front-end suites (vitest) across every npm
# workspace that has any, plus the repository scripts' own suites. A step of the
# pipeline's `web` job, after scripts/ci/npm-install.sh and
# scripts/ci/npm-build-packages.sh, so what it measures is the tests.
#
# WHY THE SCRIPTS RUN HERE. `scripts/` is not an npm workspace, so
# `npm run test --workspaces` cannot reach it and the `node:test` suites under
# `scripts/lib/` would be executed by no gate at all. They are hermetic (no network,
# no ffmpeg, no R2) and take under a second, so they belong with the other Node tests
# rather than in a job of their own.
#
# THE BROWSER. `packages/case-harness`'s suite drives a real Chromium through
# Playwright, and `npm ci` installs Playwright but downloads no browser. The
# browser is part of the machine: the CI image (ci/images/web.Dockerfile) and the
# devcontainer both install it at the Playwright version the workspace pins, so
# nothing here installs one.
#
# Type-checking is not this script's job: every front end is type-checked by its
# own build (each `build` script runs `tsc -b` first), which `web-build.sh` runs.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "test the npm workspaces"
npm run test --workspaces --if-present

log "test the repository scripts"
npm run test:scripts
