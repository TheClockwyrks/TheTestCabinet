#!/usr/bin/env bash
# Generate this arm's WIT bindings — `sandbox.c`, `sandbox.h` and `sandbox_component_type.o` —
# from `crates/gg/wit`, with the **C** generator.
#
# WHY C, for a C++ arm. `wit-bindgen` has no C++ generator, and this arm does not need one:
# calling C is what `extern "C"` is for, and it costs a program nothing. The canonical ABI is
# generated once as C, compiled to a wasm object at build time, and reached from C++ through
# `Sources/sdk/wire.hpp`. The alternative was hand-writing the lowering, which is a second
# implementation of a specification `wit-bindgen` already implements — and one that would drift
# from `crates/gg/wit` on its own schedule.
#
# WHY IT IS ITS OWN SCRIPT, as `packages/gg-sandbox-rust/bindings.sh` and
# `packages/gg-sandbox-swift/bindings.sh` are. The bindings are a pure function of the WIT
# directory and the pinned generator, and they are an input to two steps on two DIFFERENT rerun
# sets: `build.sh`, which cuts this arm's guest archive into `gg-artifact-cpp`'s `OUT_DIR`, and
# `signatures.sh`, which reflects this arm's catalogue into `crates/gg`'s and is run by
# `crates/gg/build.rs` on EVERY build of `test-cabinet-gg`. A signature step that reached the build
# script for its bindings would therefore re-cut a nine-second `clang++` build every time a
# catalogue was reflected, collapsing two deliberately separate rerun sets into one — and would
# make the reflection dirty an artifact build's declared inputs, which is how a build script comes
# to re-run forever. (The argument used to run through those archives being COMMITTED, so that a
# reflection would rewrite tracked bytes under the working tree of someone who was only compiling.
# They are generated now; the rerun-set reason is what the split rests on.)
#
# Usage:
#   packages/gg-sandbox-cpp/bindings.sh          # -> .build/bindings/
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck source=packages/gg-sandbox-cpp/cpp-version.sh
source "$HERE/cpp-version.sh"

# The generator, resolved out of the ONE pinned copy every arm shares rather than fetched into this
# package. Four arms need this executable and each used to keep its own — three copies of one 20 MB
# binary, and three GitHub downloads reachable from inside `cargo build`, because this script runs on
# every build of `test-cabinet-gg`. `scripts/ci/install-wit-bindgen.sh` is what puts it there, and
# it checks that all four arms' pins agree before it installs anything.
# shellcheck source=scripts/gg-downloads.sh
source "$ROOT/scripts/gg-downloads.sh"

# ONE ARM, ONE PROCESS AT A TIME. This package's scratch is a fixed path inside the source tree
# rather than a `mktemp -d`, deliberately — it is a cache — and two cargo processes with two target
# directories do not serialise with each other. See `scripts/gg-scratch-lock.sh`.
# shellcheck source=scripts/gg-scratch-lock.sh
source "$ROOT/scripts/gg-scratch-lock.sh"
gg_lock_scratch "$HERE"
BINDGEN="$(gg_wit_bindgen "$GG_WIT_BINDGEN_VERSION")"
OUT_DIR="$HERE/.build/bindings"

echo "==> generating C bindings from crates/gg/wit"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
"$BINDGEN" c --world sandbox "$ROOT/crates/gg/wit" --out-dir "$OUT_DIR"

test -s "$OUT_DIR/sandbox.c"
test -s "$OUT_DIR/sandbox.h"
test -s "$OUT_DIR/sandbox_component_type.o"
echo "==> $OUT_DIR"
