#!/usr/bin/env bash
# Builds every Rust crate and every test binary in the workspace, and nothing
# else: the Build step of the pipeline's `rust` job, so that how long the
# workspace takes to compile is a number of its own rather than the first
# two-thirds of a test step.
#
# `--all-targets` is what makes the split honest. cargo-nextest compiles the test
# binaries it runs, so a Build step that built only the library and binary
# targets would leave that compile for the Test step to pay. Built here at the
# same profile, the test binaries are found already up to date.
#
# Building crates/gg needs gg's eleven program-language toolchains and the npm
# workspace installed: `crates/gg/build.rs` reflects each arm's signature
# catalogue out of that arm's own SDK on every build of the crate. The CI image
# (ci/images/rust.Dockerfile) carries the toolchains and scripts/ci/npm-install.sh
# runs first.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "cargo build --all-targets"
cargo build --locked --workspace --all-targets
