#!/usr/bin/env bash
# Install the pinned `wasi_snapshot_preview1` REACTOR adapter, once, where the arms that need it look.
#
# WHAT IT IS. 52 KB of wasm, published as an asset of every wasmtime release, that turns the preview1
# core module a toolchain emits into something `wit_component` can encode as a preview 2 component.
# The C++ and Swift arms both need one, because neither wasi-sdk's `wasm32-wasip1` nor the Swift SDK
# for WebAssembly emits a component directly, and gg does the encoding itself rather than trusting a
# `wasm-component-ld` whose `wasm-encoder` it does not version.
#
# WHY IT IS INSTALLED RATHER THAN FETCHED BY THE BUILD. It was the worst-behaved download in this
# repository: two `build.sh` scripts, each `curl`ing the same file, unconditionally, with NO cache
# marker of any kind — so re-running either arm's build re-fetched it every time. That was tolerable
# while those builds were a developer's deliberate command. It is not, now that they run inside an
# ordinary `cargo build`.
#
# TWO PINS, ONE DOWNLOAD, AND THAT IS DELIBERATE. `packages/gg-sandbox-cpp/cpp-version.sh` and
# `packages/gg-sandbox-swift/swift-version.sh` each declare `GG_WASMTIME_ADAPTER_VERSION` and each
# argues that the duplication is the point: the adapter and the wasmtime gg links are two halves of
# one ABI, and the whole value of a per-arm pin is that bumping one arm's toolchain cannot silently
# move another arm's. So this script reads BOTH and refuses to install anything if they disagree,
# rather than picking one — which is what lets the two arms share a cached file without either of
# them learning about the other. The bytes are identical today (confirmed by digest); the day they
# are not, this is what says so.
#
# Idempotent: a matching version already cached is left alone. The resolution the arms actually use
# lives in `scripts/gg-downloads.sh`, which this only warms.
#
# Usage:
#   scripts/ci/install-adapter.sh
#   GG_ADAPTER_INSTALL_DIR=/opt/gg/toolchains/adapters scripts/ci/install-adapter.sh
set -euo pipefail
# shellcheck source=scripts/ci/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

# Each in a subshell, because the two files export the same variable names and the second would
# otherwise overwrite the first — which is exactly the disagreement this is here to detect.
CPP_VERSION="$(
	# shellcheck source=packages/gg-sandbox-cpp/cpp-version.sh
	source "$REPO_ROOT/packages/gg-sandbox-cpp/cpp-version.sh"
	echo "$GG_WASMTIME_ADAPTER_VERSION"
)"
SWIFT_VERSION="$(
	# shellcheck source=packages/gg-sandbox-swift/swift-version.sh
	source "$REPO_ROOT/packages/gg-sandbox-swift/swift-version.sh"
	echo "$GG_WASMTIME_ADAPTER_VERSION"
)"
ADAPTER_URL="$(
	# shellcheck source=packages/gg-sandbox-cpp/cpp-version.sh
	source "$REPO_ROOT/packages/gg-sandbox-cpp/cpp-version.sh"
	gg_wasmtime_adapter_url
)"

if [ "$CPP_VERSION" != "$SWIFT_VERSION" ]; then
	echo "error: the cpp arm pins the wasmtime adapter at $CPP_VERSION and the swift arm at $SWIFT_VERSION." >&2
	echo "       Both pins are deliberate — see either version file — but one cached copy cannot" >&2
	echo "       serve two releases. Install the two separately, or reconcile the pins." >&2
	exit 1
fi

# shellcheck source=scripts/gg-downloads.sh
source "$REPO_ROOT/scripts/gg-downloads.sh"

ADAPTER="$(gg_wasmtime_adapter "$CPP_VERSION" "$ADAPTER_URL")"
echo "wasi_snapshot_preview1.reactor $CPP_VERSION at $ADAPTER ($(wc -c <"$ADAPTER") bytes)"
