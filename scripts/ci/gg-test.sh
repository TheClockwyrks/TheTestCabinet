#!/usr/bin/env bash
# Runs gg's test suite with cargo-nextest, whole or as one hash partition of it:
#
#   scripts/ci/gg-test.sh        # every test in crates/gg
#   scripts/ci/gg-test.sh 2/4    # partition 2 of 4, by test-name hash
#
# Most of gg's tests compile a program in one of its language arms, so the suite
# is the bulk of the workspace's test time and outgrows one pipeline job. The
# pipeline runs it as the `gg_tests_<k>` jobs, one partition each (the
# `ggTestPartitions` variable in azure-pipelines.yml names them), after
# scripts/ci/gg-test-build.sh has compiled the crate and its tests. Every other
# crate's tests are scripts/ci/rust-test.sh.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

usage() {
	echo "usage: scripts/ci/gg-test.sh [k/N]" >&2
	exit 1
}
[[ $# -le 1 ]] || usage
partition=()
if [[ $# -eq 1 ]]; then
	[[ "$1" =~ ^[1-9][0-9]*/[1-9][0-9]*$ ]] || usage
	partition=(--partition "hash:$1")
fi

log "cargo nextest run -p test-cabinet-gg${1:+ (partition hash:$1)}"
cargo nextest run --locked -p test-cabinet-gg ${partition[@]+"${partition[@]}"}
