#!/usr/bin/env bash
# Builds the `tcab` CLI and its tests in release mode, the exact profile shipped
# to users. The first step of the pipeline's binary jobs, on Linux and Windows:
# the release build is the slow part of that gate and its duration is a number
# worth having on its own. The tests (scripts/ci/release-test.sh and
# release-doctest.sh) and the smoke check (scripts/ci/binary-smoke.sh) follow.
#
# `--all-targets` builds the test binaries nextest will run, so the test step
# finds them up to date. The scope is the CLI and the core it links, not the
# workspace: only `tcab` ships as a binary.
#
# `bash` runs Git Bash on the Windows agent, so this one script drives both.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "cargo build --release --all-targets (core + CLI)"
cargo build --release --locked -p test-cabinet-core -p test-cabinet-cli --all-targets
