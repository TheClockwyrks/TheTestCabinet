#!/usr/bin/env bash
# Runs every Rust crate's unit and integration tests but gg's with cargo-nextest,
# the repository's runner (see .config/nextest.toml: two retries with a flaky
# result failing the run, fail-fast off, and a per-test hard timeout). It is the
# Test step of the pipeline's `rust` job, after scripts/ci/rust-build.sh has
# compiled the workspace and its test binaries, so what it measures is the tests.
#
# gg's suite is scripts/ci/gg-test.sh: most of its tests compile a program, and
# together they outgrow one pipeline job, so they run as the `gg_tests_<k>` jobs.
# Doctests are scripts/ci/rust-doctest.sh, because nextest does not run them.
#
# This is the critical Rust validation the pipeline runs.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "cargo nextest run (every crate but test-cabinet-gg)"
cargo nextest run --locked --workspace --exclude test-cabinet-gg
