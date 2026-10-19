#!/usr/bin/env bash
# Compiles gg's test binary, exactly the one scripts/ci/gg-test.sh runs: the Build
# step of the pipeline's `gg_tests_<k>_of_4` jobs, so what gg-test.sh then
# measures is the tests. `nextest run --no-run` with the same package and `--lib`
# builds what that run builds and nothing more. Building crates/gg compiles every
# program-language arm's guest, which is where the step's time goes; the
# toolchains that takes are provisioned by scripts/ci/gg-ci-toolchains.sh.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tcab-lib.sh"
# shellcheck source=scripts/gg-cargo-lock.sh
source "$REPO_ROOT/scripts/gg-cargo-lock.sh"
# `--locked` only where no patch table shapes the build: inside the superrepo cargo writes the lock's
# `[[patch.unused]]` block in an order that is not stable between runs (scripts/gg-cargo-lock.sh).
mapfile -t locked < <(cargo_locked_args .)

log "cargo nextest run --no-run -p test-cabinet-gg --lib"
cargo nextest run --no-run ${locked[@]+"${locked[@]}"} -p test-cabinet-gg --lib
