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
# function of the WIT directory and the pinned generator, and they are an input to two steps on two
# DIFFERENT rerun sets: `build.sh`, which relinks the 35 MB guest component into
# `gg-artifact-csharp`'s `OUT_DIR`, and this arm's signature step, which `crates/gg/build.rs` runs
# on every build of `test-cabinet-gg`. A signature step that reached the build script would relink
# that component every time a catalogue was reflected — this arm's build is the most expensive of
# the eleven, and it is the one that needs a whole .NET SDK on the machine.
# (This arm's `signatures.sh` in fact needs no bindings at all — Roslyn compiles the SDK against
# the installed reference assemblies — but the split is kept, because the rule is about which
# script is allowed side effects rather than about who happens to need what today.)
#
# Usage:
#   packages/gg-sandbox-csharp/bindings.sh          # -> .build/bindings/
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck source=packages/gg-sandbox-csharp/csharp-version.sh
source "$HERE/csharp-version.sh"

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
