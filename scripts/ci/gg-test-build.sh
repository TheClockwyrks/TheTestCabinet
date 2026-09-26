#!/usr/bin/env bash
# Compiles gg and its test binaries: the Build step of the pipeline's `gg_tests_<k>`
# jobs, so what scripts/ci/gg-test.sh then measures is the tests. Building
# crates/gg compiles every program-language arm's guest, which is where the step's
# time goes; the toolchains that takes are scripts/ci/install-gg-toolchains.sh's,
# and the Rust CI image carries them.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "cargo build -p test-cabinet-gg --all-targets"
cargo build --locked -p test-cabinet-gg --all-targets
