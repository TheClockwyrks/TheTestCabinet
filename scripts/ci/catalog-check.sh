#!/usr/bin/env bash
# Regenerates the catalog dataset from the test-case specs and fails if the
# committed dataset has drifted from what the specs produce.
#
# The site deploy regenerates the catalog itself, so the live site is never
# stale, but the committed apps/site/src/data/test-cases.json is what local dev
# and code review see — this keeps that snapshot honest. Only test-cases.json is
# compared: the catalog also rewrites reference PNGs (whose bytes vary by
# Chromium build) and model prices (which change over time), neither of which is
# reproducible byte-for-byte, whereas test-cases.json is fully determined by the
# specs.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

readonly DATASET="apps/site/src/data/test-cases.json"

log "npm ci"
npm ci

# Reference rendering shells out to the bundled Playwright driver, so install the
# Chromium build it expects (with its OS dependencies). Without it the references
# would be absent and the dataset would spuriously differ from the committed one.
# Run Playwright from the browser-driver workspace that pins it: its `playwright`
# is installed there, not hoisted to the root, so a bare `npx playwright` would
# miss it and fetch a different version whose Chromium revision the driver can't
# find.
log "playwright install chromium"
npm exec -w @test-cabinet/browser-driver -- playwright install --with-deps chromium

log "tcab catalog"
cargo run --locked -p test-cabinet-cli -- catalog

log "verify $DATASET is in sync"
if ! git diff --quiet -- "$DATASET"; then
	echo "::error::$DATASET is out of sync with test-cases/. Run 'tcab catalog' and commit the result." >&2
	git --no-pager diff -- "$DATASET"
	exit 1
fi
echo "$DATASET is in sync with the specs."
