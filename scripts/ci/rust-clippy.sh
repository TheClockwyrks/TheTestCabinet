#!/usr/bin/env bash
# Runs Clippy over the whole workspace, every target, with warnings denied. The
# second step of the pipeline's `rustlint` job, which is a track of its own
# because this compiles the workspace end to end (gg's build script included) and
# takes twenty minutes doing it; on the critical path it would sit in front of
# the build and the tests without making either more trustworthy.
#
# Building crates/gg needs gg's program-language toolchains and the npm workspace
# installed, as scripts/ci/rust-build.sh explains: clippy runs build scripts like
# any other build.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "cargo clippy (warnings denied)"
cargo clippy --locked --workspace --all-targets -- -D warnings
