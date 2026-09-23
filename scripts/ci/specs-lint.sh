#!/usr/bin/env bash
# Lints the authored prose: Markdown style (markdownlint-cli2) over the test-case
# specifications, the game-jam briefs and the documentation site, and spelling
# (cspell) over the specs and briefs. Both tools are scoped by their own configs
# (.markdownlint-cli2.yaml and cspell.json).
# The Azure pipeline runs it as the `specs` gate.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "npm ci"
npm ci

log "lint specs (markdownlint + cspell)"
npm run lint:specs
