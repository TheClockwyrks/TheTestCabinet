#!/usr/bin/env bash
# Generate this arm's WIT bindings — `sandbox.c`, `sandbox.h` and `sandbox_component_type.o` —
# from `crates/gg/wit`, with the **C** generator.
#
# WHY C, FOR A C# ARM, AND WHY THAT IS THE WHOLE ANSWER TO THE ONE QUESTION THIS ARM HAD.
# Binding a custom WIT world from managed .NET code has no supported path: `dotnet/runtime#113868`
# says so and was closed unresolved. This arm does not need one. The component gg instantiates is
# **C** — Mono's own runtime plus gg's shell — and C is what `wit-bindgen` generates for. The
# managed half never binds a WIT world at all: it reaches gg through `mono_add_internal_call`,
# which is Mono's own embedding API and has been since Mono had one. The unbuilt piece was only
# ever unbuilt on the assumption that the *managed* side had to do the binding.
#
# WHY IT IS ITS OWN SCRIPT, as `packages/gg-sandbox-cpp/bindings.sh` is. The bindings are a pure
# function of the WIT directory and the pinned generator, and they are an input to two steps that
# must not share side effects: `build.sh`, which rewrites a committed artifact, and — when this
# arm's SDK lands — a signature step run inside `scripts/ci/contract-drift.sh`, whose final act is
# a `git diff --exit-code`.
#
# Usage:
#   packages/gg-sandbox-csharp/bindings.sh          # -> .build/bindings/
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck source=packages/gg-sandbox-csharp/csharp-version.sh
source "$HERE/csharp-version.sh"

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
