#!/usr/bin/env bash
# Runs the `tcab` CLI's and core's doctests in release
# mode, the code examples inside their doc comments, which cargo-nextest does
# not execute. It follows scripts/ci/release-test.sh in the pipeline's binary
# jobs on Linux and Windows.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tcab-lib.sh"
# shellcheck source=scripts/gg-cargo-lock.sh
source "$REPO_ROOT/scripts/gg-cargo-lock.sh"
# `--locked` only where no patch table shapes the build: inside the superrepo cargo writes the lock's
# `[[patch.unused]]` block in an order that is not stable between runs (scripts/gg-cargo-lock.sh).
mapfile -t locked < <(cargo_locked_args .)

log "cargo test --release --doc (core + CLI)"
cargo test --release ${locked[@]+"${locked[@]}"} -p test-cabinet-driver -p test-cabinet-cli --doc
