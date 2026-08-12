#!/usr/bin/env bash
# Generate this crate's WIT bindings — `src/bindings.rs` — from `crates/gg/wit`.
#
# It is a pure function of that directory and the pinned `wit-bindgen` release, which is why it is
# generated rather than committed (see `.gitignore`), and why it is ITS OWN script rather than a
# step inside `build.sh`.
#
# WHY IT IS ITS OWN SCRIPT, AND THE REASON SURVIVED THE ARTIFACTS BECOMING GENERATED. Two callers
# need the bindings, and they are on two DIFFERENT rerun sets. `build.sh` compiles the library set
# into `gg-artifact-rust`'s `OUT_DIR`; `signatures.sh` reflects the catalogue with `rustdoc` into
# `crates/gg`'s, and `crates/gg/build.rs` runs it on EVERY build of `test-cabinet-gg`. A signature
# step that reached `build.sh` for its bindings would re-cut the whole library set every time the
# catalogue was reflected — collapsing two deliberately separate rerun sets into one, so that an
# edit to a doc comment paid for a `cargo build --target wasm32-unknown-unknown` of the entire
# curated crate closure. It would also make the reflection dirty an artifact build's declared
# inputs, which is how a build script comes to re-run forever.
#
# The argument used to be stated the other way round — that `build.sh` REWRITES committed artifacts
# under `crates/gg/src/sandbox/checkers/`, so a reflection reaching it would rewrite tracked bytes
# under the working tree of someone who was only compiling, into bytes that match nothing but their
# own machine (an `.rlib` embeds the absolute directory it was compiled in). Those artifacts are not
# committed any more, so that half is gone; the rerun-set half is what the split rests on now,
# and it is the stronger of the two. Splitting the one step both callers need out of the one with
# side effects is what keeps a build from being a rebuild.
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
