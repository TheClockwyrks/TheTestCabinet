#!/usr/bin/env bash
# Runs the code examples inside the workspace's doc comments. cargo-nextest does
# not execute doctests, so they are a step of their own, in the pipeline's
# `rustdoc` job beside the rustdoc pass that checks the same comments' links.
#
# Doctests compile every crate at the test profile as they go, which is why they
# sit on a job of their own rather than after the suite on the critical path.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "cargo test --doc"
cargo test --locked --workspace --doc
