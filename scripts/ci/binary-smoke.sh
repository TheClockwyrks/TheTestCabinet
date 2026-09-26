#!/usr/bin/env bash
# Smoke-checks the release `tcab` binary scripts/ci/release-build.sh produced: the
# last step of the pipeline's binary jobs, on Linux and Windows, and the one that
# keeps a release from ever publishing a binary that fails to start. On a release
# tag the pipeline publishes this very binary, so CI and release validate it
# identically.
#
# The checks are deliberately dependency-free (no container runtime, run-container
# image or API keys), so they validate the binary itself, reliably, on any agent.
#
# Critical validation: a failure here means the shipping binary is broken.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

# Resolve the produced binary. Cargo writes it under the *configured* target
# directory, which is `target/` on the CI agents but is redirected by
# `CARGO_TARGET_DIR` in the devcontainer (a shared, cached volume outside the
# workspace), so hardcoding `target/` would make this gate unrunnable in the very
# environment a developer would reach for to reproduce a CI failure.
# `scripts/build-gg-static.sh` resolves its artifact the same way. The binary
# carries a .exe suffix on Windows.
target_dir="${CARGO_TARGET_DIR:-target}"
bin="$target_dir/release/tcab"
if [[ ! -x "$bin" && -x "$bin.exe" ]]; then
	bin="$bin.exe"
fi
if [[ ! -x "$bin" ]]; then
	echo "expected a tcab binary under $target_dir/release/ but found none; run scripts/ci/release-build.sh first" >&2
	exit 1
fi

log "smoke: $bin"
./scripts/ci/smoke-binary.sh "$bin"

log "binary smoke checks passed"
