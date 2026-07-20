#!/usr/bin/env bash
# Verifies that no frozen directory has been modified.
#
# A `.frozen` marker means runs have been recorded against that test-case
# version, so editing it silently invalidates results already scored against it
# (scripts/lib/frozen.sh explains the mechanism). The pre-commit hook catches
# this locally; this is the backstop for commits made with `--no-verify` or on a
# machine without the hooks installed.
#
# The check reads the checked-out index rather than diffing against a base
# branch, so it needs no merge base, no fetch depth, and no toolchain — and it
# holds on every branch and every history shape.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
# shellcheck source=/dev/null
source scripts/lib/frozen.sh

log "verify frozen test-case versions are unchanged"
frozen_verify ci
echo "All frozen directories match their recorded digests."
