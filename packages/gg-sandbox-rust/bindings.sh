#!/usr/bin/env bash
# Generate this crate's WIT bindings — `src/bindings.rs` — from `crates/gg/wit`.
#
# It is a pure function of that directory and the pinned `wit-bindgen` release, which is why it is
# generated rather than committed (see `.gitignore`), and why it is ITS OWN script rather than a
# step inside `build.sh`.
#
# WHY IT IS ITS OWN SCRIPT. Two callers need the bindings and only one of them may write anything
# else. `build.sh` compiles the library set and REWRITES two committed artifacts under
# `crates/gg/src/sandbox/checkers/`. `signatures.sh` reflects the catalogue with `rustdoc` and must
# write exactly one file, because it runs inside `scripts/ci/contract-drift.sh` — whose final step
# is `git diff --exit-code` over that same checkers directory. A signature step that reached
# `build.sh` for its bindings would therefore re-cut the library set on every CI run and fail the
# gate on bytes nobody edited: an `.rlib` embeds the absolute directory it was compiled in, so a
# checkout at any other path produces a different tarball. Splitting the one step both callers need
# out of the one that has side effects is what keeps the drift gate honest.
#
# WHY THE CLI RATHER THAN `wit_bindgen::generate!`. See `rust-version.sh`: the macro leaves a
# proc-macro dependency in the rlib's metadata, and a proc macro is a host `.so` no other
# architecture can load.
#
# Usage:
#   packages/gg-sandbox-rust/bindings.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck source=packages/gg-sandbox-rust/rust-version.sh
source "$HERE/rust-version.sh"

# Version-stamped, so a bumped pin fetches rather than reusing the last release's binary, and so a
# second run of this script inside one CI job costs nothing.
BINDGEN_DIR="$HERE/.build/wit-bindgen-$GG_WIT_BINDGEN_VERSION"
BINDGEN="$BINDGEN_DIR/wit-bindgen"

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

# `--default-bindings-module gg::bindings` is what lets the `export!` macro be invoked from the
# program's own crate against bindings that live in this one — the arrangement the whole
# prebuilt-rlib strategy rests on, and the one that needs `--pub-export-macro` to be reachable at
# all.
echo "==> generating bindings from crates/gg/wit"
"$BINDGEN" rust \
	--world sandbox \
	--pub-export-macro \
	--export-macro-name export \
	--default-bindings-module "gg::bindings" \
	--format \
	--out-dir "$HERE/src" \
	"$ROOT/crates/gg/wit"
mv "$HERE/src/sandbox.rs" "$HERE/src/bindings.rs"
