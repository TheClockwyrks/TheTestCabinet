#!/usr/bin/env bash
# Build the three artifacts gg carries inside its own binary for the **C++** program language,
# and commit them under `crates/gg/src/sandbox/checkers/`:
#
#   cpp.guest.tar.gz     the compile inputs every turn needs on disk — the generated WIT header,
#                        gg's hand-written SDK as headers plus a prebuilt wasm object, the prelude
#                        every program is compiled against, gg's shell as both SOURCE and a
#                        prebuilt object, the compiled bindings object, and the component-type
#                        object that names the world
#   cpp.adapter.wasm     the pinned `wasi_snapshot_preview1` REACTOR adapter, which turns the
#                        preview1 core module wasi-sdk emits into a preview 2 component
#   cpp.toolchain.json   what built the above, and what is in it
#
# WHY THESE RIDE INSIDE gg AND THE COMPILER DOES NOT. The same split every compiled arm here has.
# wasi-sdk is ~650 MB unpacked and cannot live in a single static `tcab` binary, so it goes into
# the gg toolchain image (`containers/gg-toolchains/Dockerfile`). These artifacts go the other way
# — they are a function of `crates/gg/wit` and of this package's own `Sources/`, which is gg's own
# wire. gg is copied as a single file into an ephemeral run container whose image was built
# separately, so bindings that lived in the image could be a different vintage from the binary
# reading them: a program compiled against one membrane and run against another.
#
# WHY THE SHELL, THE SDK AND THE BINDINGS ARE PREBUILT OBJECTS. None of the three is a function of
# the model's program, and compiling 3,269 lines of generated C plus the SDK's own bodies on every
# turn is time that buys nothing — which on an arm whose floor is ~85 ms would have several times
# multiplied it. The SDK's HEADERS go into the archive as source, because they are what the prelude
# precompiles and what a program is declared against; its BODIES go in as one object. The shell's
# source is committed beside its object all the same, so `cpp.compile.test.rs` can fail by name
# when the archive's copy is not this checkout's rather than letting every program be compiled
# against a stale one.
#
# WHAT IS NOT BUILT HERE, deliberately: the **precompiled header**. `Sources/prelude.hpp` is
# committed as source and the PCH is built **once per machine**, by the first compile, into a
# content-keyed shared toolchain directory. A PCH may only be read by the clang that wrote it and
# it records the absolute paths of every header it precompiled — so one built in this checkout
# could not be read by the wasi-sdk in a run image, and committing 26 MB of it would be committing
# something no other machine can use. See `cpp.compile.rs`.
#
# THIS SET IS BYTE-REPRODUCIBLE, unlike the Swift arm's: clang stamps no per-invocation nonce into
# an object, and `-ffile-prefix-map` below removes the one thing that would otherwise record the
# checkout it was built in. Re-running this script over unchanged sources produces unchanged bytes,
# which is what makes a diff here mean something.
#
# NOTHING IN CI RUNS THIS. It is a developer's command, run deliberately and committed with its
# output, and `scripts/ci/contract-drift.sh` names this arm's artifacts in its `$declared`
# exemption for that reason.
#
# Usage:
#   scripts/ci/install-wasi-sdk.sh          # once
#   packages/gg-sandbox-cpp/build.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck source=packages/gg-sandbox-cpp/cpp-version.sh
source "$HERE/cpp-version.sh"

CHECKERS="$ROOT/crates/gg/src/sandbox/checkers"
STAGE="$HERE/.build/stage"
BINDINGS="$HERE/.build/bindings"
SDK_HOME="$(gg_wasi_sdk_home)"
CLANG="$SDK_HOME/bin/clang"
CLANGXX="$SDK_HOME/bin/clang++"

if [ ! -x "$CLANGXX" ]; then
	echo "error: no wasi-sdk at $SDK_HOME — run scripts/ci/install-wasi-sdk.sh" >&2
	exit 1
fi

INSTALLED="$("$CLANGXX" --version | head -1)"
case "$INSTALLED" in
*"$GG_WASI_SDK_VERSION"* | *wasi-sdk*) ;;
*)
	echo "error: $CLANGXX is not a wasi-sdk clang: $INSTALLED" >&2
	exit 1
	;;
esac

# The exception-handling flags, which are this arm's one non-obvious compile decision and are
# spelled once here and once in `cpp.compile.rs` — the two must agree, and a test compiles a
# program that throws to say so.
#
# `-fwasm-exceptions` selects the wasm exception-handling proposal rather than dropping exceptions
# on the floor, and `-wasm-use-legacy-eh=false` selects the STANDARDISED encoding: clang 22 still
# defaults to the legacy `try`/`catch` instructions, and wasmtime 45 refuses those outright
# ("legacy_exceptions feature required for try instruction") while accepting the standard
# `try_table` form. Measured both ways against the runtime gg actually links.
EH_FLAGS=(-fwasm-exceptions -mllvm -wasm-use-legacy-eh=false)

# libc++'s bounds and precondition checks. wasi-sdk ships libc++ configured to check NOTHING —
# its `__config_site` sets `_LIBCPP_HARDENING_MODE_DEFAULT` to `none` — and gg turns them on for
# every compile, because an out-of-bounds container access is the most common shape of the one
# failure this arm cannot otherwise say anything about. It is spelled here as well as in
# `cpp.compile.rs` because a translation unit compiled under a different hardening mode from the
# ones it is linked with is a mixture libc++ supports and nobody should have to think about.
HARDENING_FLAGS=(-D_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_EXTENSIVE)

echo "==> bindings"
"$HERE/bindings.sh" >/dev/null

rm -rf "$STAGE"
mkdir -p "$STAGE" "$CHECKERS"

echo "==> compiling the generated bindings for $GG_CPP_TARGET"
# `-Os`: this object is linked into every artifact the arm ever produces and the engine compiles
# those bytes on every turn, so its size is a per-turn cost. It is compiled once, so what the
# optimiser costs here is paid by nobody.
"$CLANG" --target="$GG_CPP_TARGET" -Os -ffunction-sections -fdata-sections \
	"${EH_FLAGS[@]}" -ffile-prefix-map="$HERE"=/gg-sandbox-cpp \
	-I"$BINDINGS" -c -o "$STAGE/sandbox.o" "$BINDINGS/sandbox.c"

echo "==> compiling gg's SDK for $GG_CPP_TARGET"
# One object rather than one per source, because `wasm-ld` is told `--gc-sections` and every
# function is in its own section: an artifact for a program that calls two of the SDK's thirty-eight
# functions carries two of them, whether they arrived in one object or in three.
SDK_SOURCES=("$HERE"/Sources/sdk/*.cpp)
SDK_OBJECTS=()
for source in "${SDK_SOURCES[@]}"; do
	object="$STAGE/$(basename "$source" .cpp).part.o"
	"$CLANGXX" --target="$GG_CPP_TARGET" -std="$GG_CPP_STD" -Os -ffunction-sections \
		-fdata-sections "${EH_FLAGS[@]}" "${HARDENING_FLAGS[@]}" \
		-ffile-prefix-map="$HERE"=/gg-sandbox-cpp \
		-I"$BINDINGS" -I"$HERE/Sources" -c -o "$object" "$source"
	SDK_OBJECTS+=("$object")
done
# Relocatable link, so the archive carries ONE `sdk.o` rather than a member per source file — which
# keeps the manifest's file list a statement about the arm rather than about how its sources happen
# to be split today.
"$SDK_HOME/bin/wasm-ld" --relocatable -o "$STAGE/sdk.o" "${SDK_OBJECTS[@]}"
rm -f "${SDK_OBJECTS[@]}"

echo "==> compiling gg's shell for $GG_CPP_TARGET"
"$CLANGXX" --target="$GG_CPP_TARGET" -std="$GG_CPP_STD" -Os -ffunction-sections -fdata-sections \
	"${EH_FLAGS[@]}" "${HARDENING_FLAGS[@]}" -ffile-prefix-map="$HERE"=/gg-sandbox-cpp \
	-I"$BINDINGS" -I"$HERE/Sources" -c -o "$STAGE/shell.o" "$HERE/Sources/shell.cpp"

cp "$BINDINGS/sandbox.h" "$STAGE/sandbox.h"
mkdir -p "$STAGE/sdk/gg"
cp "$HERE"/Sources/sdk/*.hpp "$STAGE/sdk/"
cp "$HERE"/Sources/sdk/gg/*.hpp "$STAGE/sdk/gg/"
cp "$BINDINGS/sandbox_component_type.o" "$STAGE/sandbox_component_type.o"
cp "$HERE/Sources/prelude.hpp" "$STAGE/prelude.hpp"
cp "$HERE/Sources/shell.cpp" "$STAGE/shell.cpp"

echo "==> checking the prelude precompiles"
# Not decoration: the PCH is what makes this arm affordable, and a header that parses as an
# ordinary include but cannot be precompiled would only be discovered by the first compile on a
# fresh machine. It is thrown away — the real one is built per machine, by the compiler that will
# read it.
"$CLANGXX" --target="$GG_CPP_TARGET" -std="$GG_CPP_STD" "${EH_FLAGS[@]}" "${HARDENING_FLAGS[@]}" \
	-I"$STAGE" -x c++-header -O0 -g1 -o "$HERE/.build/prelude.check.pch" "$STAGE/prelude.hpp"
rm -f "$HERE/.build/prelude.check.pch"

echo "==> cpp.guest.tar.gz"
# Deterministic: a fixed mtime, a fixed owner and a sorted member list, so re-running this over
# unchanged sources produces byte-identical bytes and a diff means an edit.
tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner \
	-czf "$CHECKERS/cpp.guest.tar.gz" -C "$STAGE" .

echo "==> cpp.adapter.wasm"
curl -sSfL "$(gg_wasmtime_adapter_url)" -o "$CHECKERS/cpp.adapter.wasm"
test -s "$CHECKERS/cpp.adapter.wasm"

echo "==> cpp.toolchain.json"
{
	printf '{\n'
	printf '  "wasiSdk": "%s",\n' "$GG_WASI_SDK_VERSION"
	printf '  "clang": "%s",\n' "$("$CLANGXX" --version | head -1 | sed 's/^clang version //; s/ (.*//')"
	printf '  "target": "%s",\n' "$GG_CPP_TARGET"
	printf '  "std": "%s",\n' "$GG_CPP_STD"
	printf '  "witBindgen": "%s",\n' "$GG_WIT_BINDGEN_VERSION"
	printf '  "adapter": "%s",\n' "$GG_WASMTIME_ADAPTER_VERSION"
	printf '  "headers": [\n'
	# The library set a model may use, read out of the prelude that actually ships it rather than
	# restated here — the same rule every other arm's library manifest follows, and the one place
	# a hand-kept second list would let a model be told about a header it has not got.
	grep -o '^#include <[^>]*>' "$HERE/Sources/prelude.hpp" | sed 's/^#include <//; s/>$//' | sort |
		awk '{ printf "    \"%s\"%s\n", $0, (NR == n ? "" : ",") }' n="$(grep -c '^#include <' "$HERE/Sources/prelude.hpp")"
	printf '  ],\n'
	printf '  "files": [\n'
	first=1
	while IFS= read -r path; do
		[ $first -eq 1 ] || printf ',\n'
		first=0
		printf '    { "name": "%s", "bytes": %s }' "$path" "$(stat -c%s "$STAGE/$path")"
	done < <(cd "$STAGE" && find . -type f | sed 's|^\./||' | sort)
	printf '\n  ]\n}\n'
} >"$CHECKERS/cpp.toolchain.json"

echo "==> cpp.sources.manifest.json"
# What the artifacts were built FROM, beside what they were built BY. This arm is the best covered
# of the three compiled ones already — the archive carries the prelude, the shell and every SDK
# HEADER as source, and `cpp.compile.test.rs` compares all of them against this checkout file for
# file. What it carries none of is the SDK's BODIES: `Sources/sdk/*.cpp` becomes `sdk.o`, so a
# change to what a function does, with its declaration left alone, was invisible to every gate.
#
# `build.sh` records ITSELF, because the recipe is an input as much as the sources are. The
# exception-handling and hardening flags are set here and this file says at length that they must
# agree with `cpp.compile.rs`'s; the `--disable`d capabilities and the archive's construction are
# here too. An edit to any of them changes what the artifact is with no source under `Sources/`
# moving, so an edit that fails the gate until the script is re-run is the intended reading.
node "$ROOT/scripts/gg-artifact-manifest.mjs" \
	--arm cpp \
	--rebuild packages/gg-sandbox-cpp/build.sh \
	--artifact "$CHECKERS/cpp.guest.tar.gz" \
	--artifact "$CHECKERS/cpp.adapter.wasm" \
	--source-root "$HERE/Sources" \
	--source-file "$HERE/build.sh" \
	--wit "$ROOT/crates/gg/wit" \
	--pin "wasiSdk=$GG_WASI_SDK_VERSION" \
	--pin "target=$GG_CPP_TARGET" \
	--pin "std=$GG_CPP_STD" \
	--pin "witBindgen=$GG_WIT_BINDGEN_VERSION" \
	--pin "adapter=$GG_WASMTIME_ADAPTER_VERSION" \
	--out "$CHECKERS/cpp.sources.manifest.json"

echo "==> done"
ls -la "$CHECKERS"/cpp.*
