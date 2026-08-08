#!/usr/bin/env bash
# Generate this arm's WIT bindings — `sandbox.c`, `sandbox.h` and `sandbox_component_type.o` —
# from `crates/gg/wit`, with the **C** generator.
#
# WHY C, for a Swift arm. `wit-bindgen` has no Swift generator. Swift imports C natively, so
# the canonical ABI is generated once as C, compiled to a wasm object, and reached from Swift
# through a bridging header (`Sources/gg-shell.h`). The alternative was hand-writing the
# lowering in Swift, which is a second implementation of a specification `wit-bindgen` already
# implements — and one that would drift from `crates/gg/wit` on its own schedule.
#
# WHY IT IS ITS OWN SCRIPT, as `packages/gg-sandbox-rust/bindings.sh` is. The bindings are a
# pure function of the WIT directory and the pinned generator, and they are an input to two
# different steps that must not share side effects: `build.sh`, which REWRITES committed
# artifacts under `crates/gg/src/sandbox/checkers/`, and — when this arm's SDK lands — a
# signature step that runs inside `scripts/ci/contract-drift.sh`, whose final act is a
# `git diff --exit-code` over that same directory. A signature step that reached the build
# script for its bindings would re-cut the committed artifacts on every CI run and fail the
# gate on bytes nobody edited.
#
# Usage:
#   packages/gg-sandbox-swift/bindings.sh          # -> .build/bindings/
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck source=packages/gg-sandbox-swift/swift-version.sh
source "$HERE/swift-version.sh"

# Version-stamped, so a bumped pin fetches rather than reusing the last release's binary, and
# so a second run of this script inside one CI job costs nothing.
BINDGEN_DIR="$HERE/.build/wit-bindgen-$GG_WIT_BINDGEN_VERSION"
BINDGEN="$BINDGEN_DIR/wit-bindgen"
OUT_DIR="$HERE/.build/bindings"

if [ ! -x "$BINDGEN" ]; then
	case "$(uname -s)-$(uname -m)" in
	Linux-x86_64) BINDGEN_ASSET="x86_64-linux" ;;
	Linux-aarch64 | Linux-arm64) BINDGEN_ASSET="aarch64-linux" ;;
	Darwin-x86_64) BINDGEN_ASSET="x86_64-macos" ;;
	Darwin-arm64) BINDGEN_ASSET="aarch64-macos" ;;
	*)
		echo "error: no pinned wit-bindgen build for $(uname -s)-$(uname -m)." >&2
		exit 1
		;;
	esac
	echo "==> fetching wit-bindgen $GG_WIT_BINDGEN_VERSION ($BINDGEN_ASSET)"
	rm -rf "$BINDGEN_DIR"
	mkdir -p "$BINDGEN_DIR"
	curl -sSfL "https://github.com/bytecodealliance/wit-bindgen/releases/download/v${GG_WIT_BINDGEN_VERSION}/wit-bindgen-${GG_WIT_BINDGEN_VERSION}-${BINDGEN_ASSET}.tar.gz" |
		tar -xz -C "$BINDGEN_DIR" --strip-components=1
fi

echo "==> generating C bindings from crates/gg/wit"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
"$BINDGEN" c --world sandbox "$ROOT/crates/gg/wit" --out-dir "$OUT_DIR"

test -s "$OUT_DIR/sandbox.c"
test -s "$OUT_DIR/sandbox.h"
test -s "$OUT_DIR/sandbox_component_type.o"
echo "==> $OUT_DIR"
