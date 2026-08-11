#!/usr/bin/env bash
# Build the four artifacts gg carries inside its own binary for the **Swift** program language,
# and commit them under `crates/gg/src/sandbox/checkers/`:
#
#   swift.guest.tar.gz     the compile inputs every turn needs on disk — the bridging header, the
#                          generated WIT header, the compiled bindings object, the component-type
#                          object, gg's shell (Swift SOURCE, compiled beside the model's program
#                          so a reply needs no prologue), and the SDK as a prebuilt module
#                          (`gg.swiftmodule` + `gg.o`)
#   swift.libraries.tar.gz the curated library set, compiled for this arm's target: one static
#                          archive plus the `.swiftmodule` a program's `import` resolves against
#   swift.adapter.wasm     the pinned `wasi_snapshot_preview1` REACTOR adapter, which turns the
#                          preview1 core module the Swift SDK emits into a preview 2 component
#   swift.toolchain.json   what built the above, and what is in it
#
# WHY THESE RIDE INSIDE gg AND THE COMPILER DOES NOT. The same split every compiled arm here
# has. The Swift toolchain is ~835 MB and cannot live in a single static `tcab` binary, so it goes
# into the gg toolchain image (`containers/gg-toolchains/Dockerfile`). These artifacts go the
# other way — they are a function of `crates/gg/wit` and of this package's own `Sources/`, which
# is gg's own wire and gg's own surface. gg is copied as a single file into an ephemeral run
# container whose image was built separately, so bindings that lived in the image could be a
# different vintage from the binary reading them: a program compiled against one membrane and run
# against another, or shown one SDK in its prompt and compiled against a different one.
#
# WHY THE SDK IS A PREBUILT MODULE RATHER THAN SOURCE COMPILED BESIDE THE PROGRAM. Two reasons,
# and the second is the one that decided it.
#
#   * ~2,000 lines of SDK type-checked on every turn is a per-turn cost that buys nothing, on the
#     one arm that already pays the most per turn.
#   * A separate module is what makes the SDK **shadowable**. Swift resolves a name in the current
#     module before one imported from another, so a program that declares its own `fs`, its own
#     `DirEntry` or its own `log` wins — where source compiled into the program's own module
#     would be a redeclaration error on the model's own line. That is the same property the Rust
#     arm gets from glob-importing its prelude.
#
# THIS SET IS NOT BYTE-REPRODUCIBLE, and that is a property of `swiftc` rather than of this
# script. Every object it emits carries a random 16-byte module hash that no flag disables, so two
# runs of this script over identical sources produce different bytes. `-file-prefix-map` is still
# applied, so nothing records the path of the checkout it was built in; what varies is the hash
# alone. Re-run this only when something really changed, and expect the diff to be larger than
# what you edited.
#
# NOTHING IN CI RUNS THIS. It is a developer's command, run deliberately and committed with its
# output, and `scripts/ci/contract-drift.sh` names this arm's artifacts in its `$declared`
# exemption for that reason. The bindings step both this script and `signatures.sh` need is
# `bindings.sh`, so the catalogue can be reflected — which now happens inside every `cargo build` of
# `test-cabinet-gg`, because `crates/gg/build.rs` runs it — without re-cutting a library set on the
# way past. That split stopped being a convenience when the catalogue stopped being committed: this
# script's own output is not byte-reproducible, so a reflection that reached it would rewrite
# megabytes of archive under anybody who typed `cargo build`.
#
# Usage:
#   packages/gg-sandbox-swift/build.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck source=packages/gg-sandbox-swift/swift-version.sh
source "$HERE/swift-version.sh"

CHECKERS="$ROOT/crates/gg/src/sandbox/checkers"
STAGE="$HERE/.build/stage"
LIBS="$HERE/.build/libs"
VENDOR="$HERE/.build/vendor"
BINDINGS="$HERE/.build/bindings"

SWIFT_HOME="$(gg_swift_home)"
SWIFTC="$SWIFT_HOME/toolchain/usr/bin/swiftc"
CLANG="$SWIFT_HOME/toolchain/usr/bin/clang"
SDK="$SWIFT_HOME/sdk"
if [ ! -x "$CLANG" ]; then
	cat >&2 <<EOF
error: no Swift toolchain at $SWIFT_HOME.
       Run scripts/ci/install-swift.sh, or set TCAB_GG_SWIFT_HOME.
EOF
	exit 1
fi
# The toolchain's own `lld` links against shared libraries that travel with it rather than with
# the distribution — the same escape hatch `swift.compile.rs` documents, for the same reason.
export LD_LIBRARY_PATH="$SWIFT_HOME/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
if ! command -v ar >/dev/null 2>&1; then
	cat >&2 <<'EOF'
error: no `ar` on PATH.
       The library set is one static archive, and a static archive is what makes an unused
       library cost a program nothing: the linker pulls members, so a program that imports
       none of them links none of them. The pruned Swift toolchain ships no `llvm-ar`, and
       `lld` reads an ordinary GNU archive perfectly well, so this uses the system one.
EOF
	exit 1
fi

# The Swift SDK for WebAssembly, named explicitly rather than through `--swift-sdk` — which
# resolves an installed SDK out of a per-user store this script would then have to populate.
SDK_ARGS=(
	-target "$GG_SWIFT_TARGET"
	-sdk "$SDK/WASI.sdk"
	-resource-dir "$SDK/swift.xctoolchain/usr/lib/swift_static"
)
# `-Osize` because every one of these objects is on the critical path of an artifact the engine
# recompiles on every turn, and `-wmo` because a module is the unit either way.
BUILD_ARGS=(-Osize -wmo -parse-as-library)

"$HERE/bindings.sh"

# ------------------------------------------------------------------------------------------------
# The curated library set
# ------------------------------------------------------------------------------------------------

fetch() {
	local name="$1"
	local url="$2"
	local stamp="$VENDOR/$name/.stamp"
	if [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$url" ]; then
		return 0
	fi
	echo "==> fetching $name"
	rm -rf "${VENDOR:?}/$name"
	mkdir -p "$VENDOR/$name"
	curl -sSfL "$url" | tar -xz -C "$VENDOR/$name" --strip-components=1
	echo "$url" >"$stamp"
}

fetch swift-collections "$(gg_swift_collections_url)"
fetch swift-algorithms "$(gg_swift_algorithms_url)"
fetch swift-numerics "$(gg_swift_numerics_url)"

SHIMS="$VENDOR/swift-numerics/Sources/_NumericsShims"

# One Swift module of the library set, compiled from a source directory.
#
# Run from `$LIBS` with the sources named absolutely, and every path this machine contributes
# remapped onto a fixed logical root, so nothing records the checkout it was built in.
library() {
	local module="$1" sources="$2"
	echo "==> $module"
	find "$sources" -name '*.swift' -print0 | (
		cd "$LIBS" && xargs -0 "$SWIFTC" "${SDK_ARGS[@]}" "${BUILD_ARGS[@]}" \
			-I "$LIBS" -Xcc -I -Xcc "$SHIMS/include" \
			-file-prefix-map "$VENDOR=/gg/vendor" \
			-module-name "$module" -emit-module -emit-module-path "$LIBS/$module.swiftmodule" \
			-c -o "$LIBS/$module.o"
	)
	test -s "$LIBS/$module.o"
}

rm -rf "$LIBS"
mkdir -p "$LIBS"

# Dependency order. `Collections` is an umbrella that re-exports the five below it, and
# `InternalCollectionsUtilities` is what every one of them is built on.
COLLECTIONS="$VENDOR/swift-collections/Sources"
library InternalCollectionsUtilities "$COLLECTIONS/InternalCollectionsUtilities"
library DequeModule "$COLLECTIONS/DequeModule"
library OrderedCollections "$COLLECTIONS/OrderedCollections"
library HeapModule "$COLLECTIONS/HeapModule"
library BitCollections "$COLLECTIONS/BitCollections"
library HashTreeCollections "$COLLECTIONS/HashTreeCollections"
library RopeModule "$COLLECTIONS/RopeModule"
library Collections "$COLLECTIONS/Collections"

# `RealModule` is `swift-algorithms`' own dependency — `randomSample` needs a `log` — and is a
# perfectly good library in its own right, so it is declared rather than hidden.
NUMERICS="$VENDOR/swift-numerics/Sources"
echo "==> _NumericsShims"
(cd "$LIBS" && "$CLANG" --target="$GG_SWIFT_TARGET" --sysroot="$SDK/WASI.sdk" -O2 \
	-I "$SHIMS/include" -c "$SHIMS/_NumericsShims.c" -o "$LIBS/_NumericsShims.o")
library RealModule "$NUMERICS/RealModule"
library ComplexModule "$NUMERICS/ComplexModule"
library Algorithms "$VENDOR/swift-algorithms/Sources/Algorithms"

echo "==> libgglibs.a"
# A static archive, and that is the whole reason an unused library costs a program nothing: `lld`
# pulls MEMBERS, so a program that imports none of these links none of them. Passing the objects
# directly instead would add ~2.7 MB to every artifact on this arm, used or not — measured, and
# the reason this is an archive rather than a directory of objects.
(cd "$LIBS" && rm -f libgglibs.a && ar crsD libgglibs.a ./*.o)
test -s "$LIBS/libgglibs.a"

# The clang module map `RealModule` resolves `_NumericsShims` through, which a program importing
# it needs on the include path. Copied into the tree so the committed archive is self-contained.
mkdir -p "$LIBS/include"
cp "$SHIMS/include/_NumericsShims.h" "$SHIMS/include/module.modulemap" "$LIBS/include/"

echo "==> writing $CHECKERS/swift.libraries.tar.gz"
# `X` rather than `x`: the archive carries a DIRECTORY (`include/`, the clang module map
# `RealModule` resolves its shims through), and a directory without its execute bit is one
# nothing can reach a file inside — including gg's own sealing walk, which fails on it by name.
(cd "$LIBS" && tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner \
	--mode='u=rwX,go=rX' -cf - libgglibs.a include ./*.swiftmodule) |
	gzip -9 -n >"$CHECKERS/swift.libraries.tar.gz"

# ------------------------------------------------------------------------------------------------
# The guest: the bindings, the shell, and the SDK
# ------------------------------------------------------------------------------------------------

echo "==> compiling the WIT bindings for $GG_SWIFT_TARGET"
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp "$BINDINGS/sandbox.h" "$BINDINGS/sandbox_component_type.o" "$STAGE/"
cp "$HERE/Sources/gg-shell.h" "$HERE/Sources/shell.swift" "$STAGE/"
# Compiled here rather than per turn because it is 3,000 lines of generated C that never
# changes between programs — about 90 ms a turn that buys nothing. `-O2` because this object is
# on every program's critical path and is linked into every artifact. The resource directory is
# the HOST clang's (the SDK bundle ships a `lib` but no `include`, so `stddef.h` would not
# resolve); only the LINK needs the SDK's, and that is `swift.compile.rs`'s business.
#
# Run from the staging directory with a relative input so nothing records this checkout's path.
(cd "$STAGE" && "$CLANG" --target="$GG_SWIFT_TARGET" --sysroot="$SDK/WASI.sdk" -O2 \
	-c "$BINDINGS/sandbox.c" -o sandbox.o)
test -s "$STAGE/sandbox.o"

echo "==> compiling the SDK as the module a program's scope is re-exported from"
# Against `sandbox.h` rather than `gg-shell.h`: the SDK calls the generated imports and has no
# business knowing about the model program's entry point, which is the only thing the other
# header adds.
(cd "$STAGE" && "$SWIFTC" "${SDK_ARGS[@]}" "${BUILD_ARGS[@]}" \
	-file-prefix-map "$HERE=/gg/sdk" \
	-module-name gg -import-objc-header "$STAGE/sandbox.h" \
	-emit-module -emit-module-path "$STAGE/gg.swiftmodule" -c -o "$STAGE/gg.o" \
	"$HERE"/Sources/SDK/Modules/*.swift "$HERE"/Sources/SDK/Internal/*.swift)
test -s "$STAGE/gg.o"
test -s "$STAGE/gg.swiftmodule"

echo "==> fetching the wasi_snapshot_preview1 reactor adapter $GG_WASMTIME_ADAPTER_VERSION"
curl -sSfL "$(gg_wasmtime_adapter_url)" -o "$CHECKERS/swift.adapter.wasm"
test -s "$CHECKERS/swift.adapter.wasm"

echo "==> writing $CHECKERS/swift.guest.tar.gz"
# A sorted entry list, a fixed timestamp, no owner and a gzip stream carrying neither a name nor
# an mtime — so the only thing that varies between two builds of one tree is what `swiftc` itself
# stamps into an object, which is the module hash named at the top of this file.
tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner --mode='u=rw,go=r' \
	-C "$STAGE" -cf - gg-shell.h gg.o gg.swiftmodule sandbox.h sandbox.o \
	sandbox_component_type.o shell.swift |
	gzip -9 -n >"$CHECKERS/swift.guest.tar.gz"

echo "==> writing $CHECKERS/swift.toolchain.json"
python3 - "$STAGE" "$LIBS" "$CHECKERS/swift.toolchain.json" <<PY
import json, os, sys

stage, libs, out = sys.argv[1], sys.argv[2], sys.argv[3]
files = [
    "gg-shell.h", "gg.o", "gg.swiftmodule", "sandbox.h", "sandbox.o",
    "sandbox_component_type.o", "shell.swift",
]
modules = sorted(
    name[: -len(".swiftmodule")]
    for name in os.listdir(libs)
    if name.endswith(".swiftmodule")
)
manifest = {
    "swift": "$GG_SWIFT_VERSION",
    "wasmSdk": "$GG_SWIFT_WASM_SDK_VERSION",
    "target": "$GG_SWIFT_TARGET",
    "witBindgen": "$GG_WIT_BINDGEN_VERSION",
    "adapter": "$GG_WASMTIME_ADAPTER_VERSION",
    "packages": {
        "swift-collections": "$GG_SWIFT_COLLECTIONS_VERSION",
        "swift-algorithms": "$GG_SWIFT_ALGORITHMS_VERSION",
        "swift-numerics": "$GG_SWIFT_NUMERICS_VERSION",
    },
    "modules": modules,
    "files": [
        {"name": name, "bytes": os.path.getsize(os.path.join(stage, name))}
        for name in files
    ],
}
with open(out, "w") as handle:
    json.dump(manifest, handle, indent=2)
    handle.write("\n")
PY

echo "==> writing $CHECKERS/swift.sources.manifest.json"
# What the four artifacts were built FROM, beside what they were built BY. `swift.toolchain.json`
# above answers the second question; the first was answered only for the two files the archive
# happens to carry verbatim, `shell.swift` and `gg-shell.h`, which `swift.compile.test.rs` compares
# against this checkout. The SDK itself does NOT ride in as source — it is `gg.o` and
# `gg.swiftmodule`, and it is the whole model-facing surface — so before this manifest an edit to
# `Sources/SDK/**` committed without a rebuild left every program compiled against the old module
# while the catalogue reflected the new source, with nothing to say so.
#
# `build.sh` records ITSELF, because the recipe is an input as much as the sources are: the compile
# arguments and the `library` module list that decides what the library archive contains both live
# here, so an edit to either changes what the artifacts are with no source under `Sources/` moving.
# An edit that fails the gate until the script is re-run is the intended reading.
node "$ROOT/scripts/gg-artifact-manifest.mjs" \
	--arm swift \
	--rebuild packages/gg-sandbox-swift/build.sh \
	--artifact "$CHECKERS/swift.guest.tar.gz" \
	--artifact "$CHECKERS/swift.libraries.tar.gz" \
	--artifact "$CHECKERS/swift.adapter.wasm" \
	--source-root "$HERE/Sources" \
	--source-file "$HERE/libraries.txt" \
	--source-file "$HERE/build.sh" \
	--wit "$ROOT/crates/gg/wit" \
	--pin "swift=$GG_SWIFT_VERSION" \
	--pin "target=$GG_SWIFT_TARGET" \
	--pin "witBindgen=$GG_WIT_BINDGEN_VERSION" \
	--pin "adapter=$GG_WASMTIME_ADAPTER_VERSION" \
	--pin "swiftCollections=$GG_SWIFT_COLLECTIONS_VERSION" \
	--pin "swiftAlgorithms=$GG_SWIFT_ALGORITHMS_VERSION" \
	--pin "swiftNumerics=$GG_SWIFT_NUMERICS_VERSION" \
	--out "$CHECKERS/swift.sources.manifest.json"

ls -la "$CHECKERS"/swift.*
