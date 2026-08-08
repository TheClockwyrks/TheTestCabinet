#!/usr/bin/env bash
# Build the three artifacts gg carries inside its own binary for the **C++** program language,
# and commit them under `crates/gg/src/sandbox/checkers/`:
#
#   cpp.guest.tar.gz     the compile inputs every turn needs on disk — the generated WIT header,
#                        the prelude every program is compiled against, gg's shell as both SOURCE
#                        and a prebuilt wasm object, the compiled bindings object, and the
#                        component-type object that names the world
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
# WHY THE SHELL AND THE BINDINGS ARE PREBUILT OBJECTS. Neither is a function of the model's
# program, and compiling 3,269 lines of generated C on every turn is ~90 ms that buys nothing —
# which on an arm whose floor is ~85 ms would have doubled it. The shell's SOURCE is committed
# beside its object all the same, so `cpp.compile.test.rs` can fail by name when the archive's copy
# is not this checkout's rather than letting every program be compiled against a stale one.
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

echo "==> compiling gg's shell for $GG_CPP_TARGET"
"$CLANGXX" --target="$GG_CPP_TARGET" -std="$GG_CPP_STD" -Os -ffunction-sections -fdata-sections \
	"${EH_FLAGS[@]}" "${HARDENING_FLAGS[@]}" -ffile-prefix-map="$HERE"=/gg-sandbox-cpp \
	-I"$BINDINGS" -I"$HERE/Sources" -c -o "$STAGE/shell.o" "$HERE/Sources/shell.cpp"

cp "$BINDINGS/sandbox.h" "$STAGE/sandbox.h"
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
	for path in "$STAGE"/*; do
		[ $first -eq 1 ] || printf ',\n'
		first=0
		printf '    { "name": "%s", "bytes": %s }' "$(basename "$path")" "$(stat -c%s "$path")"
	done
	printf '\n  ]\n}\n'
} >"$CHECKERS/cpp.toolchain.json"

echo "==> done"
ls -la "$CHECKERS"/cpp.*
