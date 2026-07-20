#!/usr/bin/env bash
# Fast pre-commit gate: refuse to commit changes to a frozen directory.
#
# A `.frozen` marker means runs have been recorded against that test-case
# version, so its contents must never change (scripts/lib/frozen.sh explains the
# mechanism). This is the local half of the gate; scripts/ci/frozen-check.sh is
# the backstop that also catches commits made with `--no-verify`.
#
# Invoked by pre-commit (see .pre-commit-config.yaml); also runnable by hand.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
# shellcheck source=/dev/null
source scripts/lib/frozen.sh

frozen_verify commit
