#!/usr/bin/env bash
# Lints the authored test-case specifications and game-jam briefs: Markdown style
# (markdownlint-cli2) and spelling (cspell). Both tools are scoped to test-cases/**
# and game-jams/** by their own configs (.markdownlint-cli2.yaml and cspell.json).
# This is non-critical
# validation: Azure DevOps runs it, GitHub leaves it to Azure.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "npm ci"
npm ci

log "lint specs (markdownlint + cspell)"
npm run lint:specs
