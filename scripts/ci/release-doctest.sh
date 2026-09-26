#!/usr/bin/env bash
# Runs the `tcab` CLI's and core's doctests in release mode, the code examples
# inside their doc comments, which cargo-nextest does not execute. It follows
# scripts/ci/release-test.sh in the pipeline's binary jobs on Linux and Windows.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "cargo test --release --doc (core + CLI)"
cargo test --release --locked -p test-cabinet-core -p test-cabinet-cli --doc
