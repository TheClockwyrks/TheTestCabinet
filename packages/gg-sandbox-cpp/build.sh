#!/usr/bin/env bash
# Build the three artifacts gg carries inside its own binary for the **C++** program language, into
# `$GG_ARTIFACTS_OUT_DIR`:
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
# turn is time that buys nothing — which on an arm whose floor is ~90 ms would have several times
# multiplied it. The SDK's HEADERS go into the archive as source, under the `include/` root a
# program's own `#include <gg/files.hpp>` resolves against; its BODIES go in as one object. The shell's
# source is staged beside its object all the same — that predates the archive being generated, when
# a test compared the archive's copy against this checkout's to catch one nobody had re-cut, and it
# is kept because `cpp.compile.rs` compiles the shell's source alongside the model's program on the
# turn path.
#
# WHAT IS NOT BUILT HERE, deliberately: the **precompiled header**. `Sources/prelude.hpp` ships as
# source and the PCH is built **once per machine**, by the first compile, into a content-keyed
# shared toolchain directory. A PCH may only be read by the clang that wrote it and it records the
# absolute paths of every header it precompiled — so one built in this checkout could not be read by
# the wasi-sdk in a run image, and putting 28 MB of it in the archive would be shipping something no
# other machine can use. See `cpp.compile.rs`.
#
# THIS SET IS BYTE-REPRODUCIBLE, unlike the Swift arm's: clang stamps no per-invocation nonce into
# an object, and `-ffile-prefix-map` below removes the one thing that would otherwise record the
# checkout it was built in. NOTHING DEPENDS ON IT ANY MORE — `crates/gg-sandbox-artifacts/cpp`
# re-cuts this only when a declared input moved, and there is no committed copy left to diff against
# — but an artifact that changed when nothing did is one nobody can reason about, and the property
# costs one flag, so it is kept.
#
# Usage:
#   scripts/ci/install-wasi-sdk.sh          # once
#   scripts/gg-artifacts.sh                                   # every arm, into one directory
#   GG_ARTIFACTS_OUT_DIR=<dir> packages/gg-sandbox-cpp/build.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck source=packages/gg-sandbox-cpp/cpp-version.sh
source "$HERE/cpp-version.sh"

# The destination, which is required and has no default — see the file itself for why.
# shellcheck source=scripts/gg-artifacts-out-dir.sh
source "$ROOT/scripts/gg-artifacts-out-dir.sh"
# shellcheck source=scripts/gg-downloads.sh
source "$ROOT/scripts/gg-downloads.sh"

# ONE ARM, ONE PROCESS AT A TIME. This package's scratch is a fixed path inside the source tree
# rather than a `mktemp -d`, deliberately — it is a cache — and two cargo processes with two target
# directories do not serialise with each other. See `scripts/gg-scratch-lock.sh`.
# shellcheck source=scripts/gg-scratch-lock.sh
source "$ROOT/scripts/gg-scratch-lock.sh"
gg_lock_scratch "$HERE"

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
mkdir -p "$STAGE"

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
# THE MODEL-FACING INCLUDE ROOT. `cpp.compile.rs` puts exactly this directory on the per-turn
# `clang++ -I`, so what a program can reach with an `#include <…>` is what is copied here and
# nothing else: the umbrella `<gg.hpp>`, the thirteen module headers a catalogue entry states as
# its own import line, and `runtime.hpp`, which the umbrella includes by name.
#
# `wire.hpp` and `sandbox.h` are deliberately NOT here. They are the C the SDK is written against,
# no model-facing header includes either, and an include root is a claim about what a program may
# write.
mkdir -p "$STAGE/include/gg"
cp "$HERE"/Sources/sdk/gg.hpp "$HERE"/Sources/sdk/runtime.hpp "$STAGE/include/"
cp "$HERE"/Sources/sdk/gg/*.hpp "$STAGE/include/gg/"
cp "$BINDINGS/sandbox_component_type.o" "$STAGE/sandbox_component_type.o"
cp "$HERE/Sources/prelude.hpp" "$STAGE/prelude.hpp"
cp "$HERE/Sources/shell.cpp" "$STAGE/shell.cpp"

echo "==> checking the prelude precompiles"
# Not decoration: the PCH is what makes this arm affordable, and a header that parses as an
# ordinary include but cannot be precompiled would only be discovered by the first compile on a
# fresh machine. It is thrown away — the real one is built per machine, by the compiler that will
# read it.
"$CLANGXX" --target="$GG_CPP_TARGET" -std="$GG_CPP_STD" "${EH_FLAGS[@]}" "${HARDENING_FLAGS[@]}" \
	-x c++-header -O0 -g1 -o "$HERE/.build/prelude.check.pch" "$STAGE/prelude.hpp"
rm -f "$HERE/.build/prelude.check.pch"

echo "==> cpp.guest.tar.gz"
# Deterministic: a fixed mtime, a fixed owner and a sorted member list, so re-running this over
# unchanged sources produces byte-identical bytes and a diff means an edit.
tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner \
	-czf "$GG_ARTIFACTS_OUT_DIR/cpp.guest.tar.gz" -C "$STAGE" .

echo "==> cpp.adapter.wasm"
# COPIED FROM A CACHE, NOT DOWNLOADED. This used to `curl` a GitHub release asset unconditionally,
# with no marker of any kind, every single time this script ran — which was survivable while it was a
# developer's deliberate command and is not, now that it runs inside `cargo build`.
# `scripts/gg-downloads.sh` resolves the pinned file from an override, the toolchain image, or a
# version-stamped per-user cache, and only downloads on a machine no installer has touched. THE PIN
# IS STILL THIS ARM'S OWN — see `cpp-version.sh` on why the Swift arm keeping a separate one matters.
cp "$(gg_wasmtime_adapter "$GG_WASMTIME_ADAPTER_VERSION" "$(gg_wasmtime_adapter_url)")" \
	"$GG_ARTIFACTS_OUT_DIR/cpp.adapter.wasm"
test -s "$GG_ARTIFACTS_OUT_DIR/cpp.adapter.wasm"

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
} >"$GG_ARTIFACTS_OUT_DIR/cpp.toolchain.json"

# WHAT USED TO BE HERE: `cpp.sources.manifest.json`, a table of the SHA-256 of every file under
# `Sources/` beside the digest of the archive, so that a test could recompute the hashes from the
# checkout and fail when somebody had edited the SDK without re-running this script. That question —
# *is the committed archive older than the sources beside it?* — no longer has a subject. The
# archive is not committed: `crates/gg-sandbox-artifacts/cpp` runs this script into its own cargo
# `OUT_DIR` on every build whose declared inputs moved, and `crates/gg` embeds what lands there. An
# edit to a header, to `shell.cpp`, or to the flags in this file re-cuts the archive in the same
# `cargo build` that compiles the host.
#
# The narrow thing it covered is worth recording, because it is the one place this arm was blind:
# the archive carries the prelude, the shell and every SDK HEADER as source, and `cpp.compile.test.rs`
# compared all of them against the checkout — but `Sources/sdk/*.cpp` becomes `sdk.o`, so a change to
# what a function DOES with its declaration left alone was invisible to every gate. It is not
# invisible now, and not because anything watches it: `packages/gg-sandbox-cpp/Sources` is in this
# arm's rerun set, so an edit to a body rebuilds `sdk.o` rather than being reported on.
#
# `cpp.toolchain.json` above is NOT that manifest and does not go with it. It is a declaration of
# what is in the archive and what built it, `cpp.compile.rs` reads it at run time to place the files,
# and the tests that hold its header list to the prelude and its file list to the unpacked tree still
# run — those compare two things this script generates from two different sources, which is an
# agreement check rather than a staleness one.

echo "==> done"
ls -la "$GG_ARTIFACTS_OUT_DIR"/cpp.*
