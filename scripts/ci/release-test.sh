#!/usr/bin/env bash
# Runs the `tcab` CLI's and core's tests in release mode
# with cargo-nextest, the repository's runner (see .config/nextest.toml). It
# follows scripts/ci/release-build.sh, which compiled the test binaries at this
# profile, and runs on Linux and Windows: the cross-platform runtime surface
# (`host_path`, work-dir resolution, runtime detection) is covered by these tests
# on each platform.
#
# Doctests are scripts/ci/release-doctest.sh, because nextest does not run them.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tcab-lib.sh"
# shellcheck source=scripts/ci/cargo-lock.sh
source "$REPO_ROOT/scripts/ci/cargo-lock.sh"
# `--locked` only where no patch table shapes the build: inside the superrepo cargo writes the lock's
# `[[patch.unused]]` block in an order that is not stable between runs (scripts/ci/cargo-lock.sh).
mapfile -t locked < <(cargo_locked_args .)

log "cargo nextest run --release (core + CLI)"
cargo nextest run --release ${locked[@]+"${locked[@]}"} -p test-cabinet-driver -p test-cabinet-cli
