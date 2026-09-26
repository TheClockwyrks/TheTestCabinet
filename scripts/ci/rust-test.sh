#!/usr/bin/env bash
# Runs every Rust crate's unit and integration tests with cargo-nextest, the
# repository's runner (see .config/nextest.toml: two retries with a flaky result
# failing the run, fail-fast off, and a per-test hard timeout). It is the Test
# step of the pipeline's `rust` job, after scripts/ci/rust-build.sh has compiled
# the workspace and its test binaries, so what it measures is the tests.
#
# Doctests are scripts/ci/rust-doctest.sh, because nextest does not run them.
#
# This is the critical Rust validation the pipeline runs.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "cargo nextest run"
cargo nextest run --locked --workspace
