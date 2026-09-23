#!/usr/bin/env bash
# Runs the audio-pack lint (scripts/ci/audio-packs-check.mjs) in CI.
#
# The lint reads the committed manifests and containers/sample-packs/ only — no
# credentials, no network, no Rust — but it parses TOML through smol-toml, so it
# needs the npm workspace installed. That `npm ci` is the whole reason this
# wrapper exists; the check itself is the one command
# development/building.md documents.
#
# It runs in the Azure pipeline, and on the commit hook (.pre-commit-config.yaml
# invokes the checker directly, since a working tree already has node_modules),
# exactly as scripts/ci/frozen-check.sh backstops the frozen-paths.sh hook. It is
# the ONLY enforcement of the rule that every non-frozen full-stack version and
# every game jam declares `[audio] packs` at all, so it cannot live on one gate.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "npm ci"
npm ci

log "check every version's [audio] packs declaration"
node scripts/ci/audio-packs-check.mjs
