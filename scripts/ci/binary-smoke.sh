#!/usr/bin/env bash
# Builds the `tcab` CLI in release mode — the exact profile shipped to users —
# runs its tests, and smoke-checks the produced binary. This is the gate that
# keeps a release from ever publishing a binary that fails to build, link, or
# even start.
#
# It runs on every target platform so a platform-specific break is caught before
# release: Azure DevOps runs it on Linux and Windows; GitHub runs it on macOS
# (Azure has no macOS agents). The checks are deliberately dependency-free — no
# container runtime, harness images, or API keys — so they validate the binary
# itself, reliably, on any agent. The cross-platform runtime surface
# (`host_path`, work-dir resolution, runtime detection) is covered by the unit
# tests this also runs on each platform.
#
# Critical validation: a failure here means the shipping binary is broken.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

# Release-mode test + build in one compile. Tests run optimized (the shipped
# profile) and the build then produces the binary from the same artifacts.
log "cargo test --release (core + CLI)"
cargo test --release --locked -p test-cabinet-core -p test-cabinet-cli

log "cargo build --release (tcab)"
cargo build --release --locked -p test-cabinet-cli

# Resolve the produced binary; it carries a .exe suffix on Windows.
bin="target/release/tcab"
if [[ ! -x "$bin" && -x "$bin.exe" ]]; then
	bin="$bin.exe"
fi
if [[ ! -x "$bin" ]]; then
	echo "expected a tcab binary under target/release/ but found none" >&2
	exit 1
fi

# Run the shared smoke check — the same one the release pipeline runs on each
# shipped artifact — so CI and release validate the binary identically.
log "smoke: $bin"
./scripts/ci/smoke-binary.sh "$bin"

log "binary smoke checks passed"
