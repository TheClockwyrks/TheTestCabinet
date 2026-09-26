#!/usr/bin/env bash
# Verifies the Rust formatting over the whole workspace. The first step of the
# pipeline's `rustlint` job, and the cheapest: it compiles nothing, so a
# formatting slip is reported in seconds rather than after clippy's compile.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "cargo fmt --check"
cargo fmt --all --check
