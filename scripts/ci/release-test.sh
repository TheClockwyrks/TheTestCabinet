#!/usr/bin/env bash
# Runs the `tcab` CLI's, core's, the suites crate's and the contracts crate's tests
# in release mode with cargo-nextest, the repository's runner (see
# .config/nextest.toml). It follows scripts/ci/release-build.sh, which compiled the test binaries at this
# profile, and runs on Linux and Windows: the cross-platform runtime surface
# (`host_path`, work-dir resolution, runtime detection) is covered by these tests
# on each platform.
#
# Doctests are scripts/ci/release-doctest.sh, because nextest does not run them.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tcab-lib.sh"

log "cargo nextest run --release (contracts + suites + core + CLI)"
cargo nextest run --release --locked -p test-cabinet-contracts -p test-cabinet-suites -p test-cabinet-core -p test-cabinet-cli
