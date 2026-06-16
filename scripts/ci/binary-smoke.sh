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

# A binary that cannot even print its version is broken at the most basic level
# (a missing dynamic dependency or loader mismatch surfaces right here).
log "smoke: $bin --version"
version="$("$bin" --version)"
if [[ -z "$version" ]]; then
	echo "tcab --version produced no output" >&2
	exit 1
fi
echo "$version"

# The binary is only sane if its subcommands are wired up. Check a few of the
# less generic ones so a parser that silently lost its commands is caught.
log "smoke: $bin --help"
help="$("$bin" --help)"
for subcommand in run validate harnesses publish catalog; do
	if ! grep -q -- "$subcommand" <<<"$help"; then
		echo "tcab --help is missing the '$subcommand' subcommand" >&2
		exit 1
	fi
done

log "binary smoke checks passed ($version)"
