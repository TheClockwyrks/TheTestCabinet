#!/usr/bin/env bash
# Build the four artifacts gg carries inside its own binary for the **Swift** program language, into
# `$GG_ARTIFACTS_OUT_DIR`:
#
#   swift.guest.tar.gz     the compile inputs every turn needs on disk — the shell's header and
#                          the clang module map that names it, the generated WIT header, the
#                          compiled bindings object, the component-type object, gg's shell (Swift
#                          SOURCE, compiled beside the model's program so a reply needs no
#                          prologue), and the SDK as a prebuilt module (`gg.swiftmodule` + `gg.o`)
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
# alone. Little depends on the bytes being stable — an artifact crate rebuilds only when a declared
# input moved — but it is why comparing two runs' output tells you nothing.
#
# THE BINDINGS STEP IS ITS OWN SCRIPT, AND THAT IS STILL LOAD-BEARING. `signatures.sh` needs the
# bindings too, and it runs inside every `cargo build` of `test-cabinet-gg`; a reflection that
# reached THIS script for them would rewrite megabytes of non-reproducible archive on the way past.
# `bindings.sh` is the one step both callers need, split out of the one that has side effects.
#
# Usage:
#   scripts/gg-artifacts.sh                                     # every arm, into one directory
#   GG_ARTIFACTS_OUT_DIR=<dir> packages/gg-sandbox-swift/build.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck source=packages/gg-sandbox-swift/swift-version.sh
source "$HERE/swift-version.sh"

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
LIBS="$HERE/.build/libs"
BINDINGS="$HERE/.build/bindings"

# The three vendored packages' sources, which are NOT under `.build/` and are the one thing here
# that is not: they are a pinned download, so they live in the same version-stamped per-user prefix
# `wit-bindgen` and the wasmtime adapter do. See `gg_swift_library` in `scripts/gg-downloads.sh` for
# why a cache inside the package was a network call on every fresh checkout.
VENDOR="$(gg_swift_libraries_dir)"

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

# The three source trees, resolved out of the shared pinned prefix rather than fetched into this
# package. `gg_swift_library` is stamped by the release URL and downloads only on a machine no
# installer has warmed, which on the surfaces that matter is none of them:
# `scripts/ci/install-gg-build-tools.sh` fetches all three, the CI image bakes them and
# `scripts/ci/hydrate-gg-toolchains.sh` carries them.
COLLECTIONS_TREE="$(gg_swift_library swift-collections "$GG_SWIFT_COLLECTIONS_VERSION" "$(gg_swift_collections_url)")"
ALGORITHMS_TREE="$(gg_swift_library swift-algorithms "$GG_SWIFT_ALGORITHMS_VERSION" "$(gg_swift_algorithms_url)")"
NUMERICS_TREE="$(gg_swift_library swift-numerics "$GG_SWIFT_NUMERICS_VERSION" "$(gg_swift_numerics_url)")"

SHIMS="$NUMERICS_TREE/Sources/_NumericsShims"

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
COLLECTIONS="$COLLECTIONS_TREE/Sources"
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
NUMERICS="$NUMERICS_TREE/Sources"
echo "==> _NumericsShims"
(cd "$LIBS" && "$CLANG" --target="$GG_SWIFT_TARGET" --sysroot="$SDK/WASI.sdk" -O2 \
	-I "$SHIMS/include" -c "$SHIMS/_NumericsShims.c" -o "$LIBS/_NumericsShims.o")
library RealModule "$NUMERICS/RealModule"
library ComplexModule "$NUMERICS/ComplexModule"
library Algorithms "$ALGORITHMS_TREE/Sources/Algorithms"

echo "==> libgglibs.a"
# A static archive, and that is the whole reason an unused library costs a program nothing: `lld`
# pulls MEMBERS, so a program that imports none of these links none of them. Passing the objects
# directly instead would add ~2.7 MB to every artifact on this arm, used or not — measured, and
# the reason this is an archive rather than a directory of objects.
(cd "$LIBS" && rm -f libgglibs.a && ar crsD libgglibs.a ./*.o)
test -s "$LIBS/libgglibs.a"

# The clang module map `RealModule` resolves `_NumericsShims` through, which a program importing
# it needs on the include path. Copied into the tree so the archive is self-contained.
mkdir -p "$LIBS/include"
cp "$SHIMS/include/_NumericsShims.h" "$SHIMS/include/module.modulemap" "$LIBS/include/"

echo "==> writing swift.libraries.tar.gz"
# `X` rather than `x`: the archive carries a DIRECTORY (`include/`, the clang module map
# `RealModule` resolves its shims through), and a directory without its execute bit is one
# nothing can reach a file inside — including gg's own sealing walk, which fails on it by name.
(cd "$LIBS" && tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner \
	--mode='u=rwX,go=rX' -cf - libgglibs.a include ./*.swiftmodule) |
	gzip -9 -n >"$GG_ARTIFACTS_OUT_DIR/swift.libraries.tar.gz"

# ------------------------------------------------------------------------------------------------
# The guest: the bindings, the shell, and the SDK
# ------------------------------------------------------------------------------------------------

echo "==> compiling the WIT bindings for $GG_SWIFT_TARGET"
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp "$BINDINGS/sandbox.h" "$BINDINGS/sandbox_component_type.o" "$STAGE/"
cp "$HERE/Sources/gg-shell.h" "$HERE/Sources/module.modulemap" "$HERE/Sources/shell.swift" \
	"$STAGE/"
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

echo "==> compiling the SDK as the module a program imports"
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

echo "==> the wasi_snapshot_preview1 reactor adapter $GG_WASMTIME_ADAPTER_VERSION"
# COPIED FROM A CACHE, NOT DOWNLOADED. This used to `curl` a GitHub release asset unconditionally,
# with no marker of any kind, every single time this script ran. `scripts/gg-downloads.sh` resolves
# the pinned file from an override, the toolchain image, or a version-stamped per-user cache, and
# only downloads on a machine no installer has touched. THE PIN IS STILL THIS ARM'S OWN — see
# `swift-version.sh`, and the C++ arm's, on why the two arms keeping separate pins matters.
cp "$(gg_wasmtime_adapter "$GG_WASMTIME_ADAPTER_VERSION" "$(gg_wasmtime_adapter_url)")" \
	"$GG_ARTIFACTS_OUT_DIR/swift.adapter.wasm"
test -s "$GG_ARTIFACTS_OUT_DIR/swift.adapter.wasm"

echo "==> writing swift.guest.tar.gz"
# A sorted entry list, a fixed timestamp, no owner and a gzip stream carrying neither a name nor
# an mtime — so the only thing that varies between two builds of one tree is what `swiftc` itself
# stamps into an object, which is the module hash named at the top of this file.
tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner --mode='u=rw,go=r' \
	-C "$STAGE" -cf - gg-shell.h gg.o gg.swiftmodule module.modulemap sandbox.h sandbox.o \
	sandbox_component_type.o shell.swift |
	gzip -9 -n >"$GG_ARTIFACTS_OUT_DIR/swift.guest.tar.gz"

echo "==> writing swift.toolchain.json"
python3 - "$STAGE" "$LIBS" "$GG_ARTIFACTS_OUT_DIR/swift.toolchain.json" <<PY
import json, os, sys

stage, libs, out = sys.argv[1], sys.argv[2], sys.argv[3]
files = [
    "gg-shell.h", "gg.o", "gg.swiftmodule", "module.modulemap", "sandbox.h", "sandbox.o",
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

# WHAT USED TO BE HERE: `swift.sources.manifest.json`, a table of the SHA-256 of every file under
# `Sources/` beside the digests of the three artifacts, so that a test could recompute the hashes
# from the checkout and fail when somebody had edited the SDK without re-running this script. That
# question — *are the committed archives older than the sources beside them?* — no longer has a
# subject. They are not committed: `crates/gg-sandbox-artifacts/swift` runs this script into its own
# cargo `OUT_DIR` on every build whose declared inputs moved, and `crates/gg` embeds what lands
# there.
#
# It covered the widest hole of the three compiled arms and that is worth recording.
# `swift.toolchain.json` answers what the artifacts were built BY, and `swift.compile.test.rs` could
# compare the three files the guest archive happens to carry verbatim — `shell.swift`,
# `gg-shell.h` and `module.modulemap` — against the checkout. The SDK does NOT ride in as source: it is `gg.o` and `gg.swiftmodule`, which is the whole
# model-facing surface, and nothing could read it back out. An edit to `Sources/SDK/**` matched
# nothing anything could compare. What answers it now is cargo — `packages/gg-sandbox-swift/Sources`
# is in this arm's rerun set, so an SDK edit re-cuts `gg.swiftmodule` rather than being reported on.
#
# `swift.toolchain.json` above is NOT that manifest and does not go with it. It is a declaration of
# what is in the archives and what built them, `swift.compile.rs` reads it at run time to place the
# files and to name the library modules, and the tests that hold it to the unpacked tree still run.

ls -la "$GG_ARTIFACTS_OUT_DIR"/swift.*
