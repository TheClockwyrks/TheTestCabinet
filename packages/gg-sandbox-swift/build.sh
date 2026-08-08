#!/usr/bin/env bash
# Build the three artifacts gg carries inside its own binary for the **Swift** program language,
# and commit them under `crates/gg/src/sandbox/checkers/`:
#
#   swift.guest.tar.gz   the compile inputs every turn needs on disk — the bridging header, the
#                        generated WIT header, the compiled bindings object, the component-type
#                        object, and gg's shell (Swift SOURCE, compiled beside the model's
#                        program so a reply needs no prologue)
#   swift.adapter.wasm   the pinned `wasi_snapshot_preview1` REACTOR adapter, which turns the
#                        preview1 core module the Swift SDK emits into a preview 2 component
#   swift.toolchain.json what built the above, and what is in it
#
# WHY THESE RIDE INSIDE gg AND THE COMPILER DOES NOT. The same split every compiled arm here
# has. The Swift toolchain is ~1 GB and cannot live in a single static `tcab` binary, so it goes
# into the gg toolchain image (`containers/gg-toolchains/Dockerfile`). These artifacts go the
# other way — they are ~40 KB and they are a function of `crates/gg/wit`, which is gg's own
# wire. gg is copied as a single file into an ephemeral run container whose image was built
# separately, so bindings that lived in the image could be a different vintage from the binary
# reading them: a program compiled against one membrane and run against another.
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
BINDINGS="$HERE/.build/bindings"

SWIFT_HOME="$(gg_swift_home)"
CLANG="$SWIFT_HOME/toolchain/usr/bin/clang"
SDK="$SWIFT_HOME/sdk"
if [ ! -x "$CLANG" ]; then
	cat >&2 <<EOF
error: no Swift toolchain at $SWIFT_HOME.
       Run scripts/ci/install-swift.sh, or set TCAB_GG_SWIFT_HOME.
EOF
	exit 1
fi

"$HERE/bindings.sh"

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

echo "==> fetching the wasi_snapshot_preview1 reactor adapter $GG_WASMTIME_ADAPTER_VERSION"
curl -sSfL "$(gg_wasmtime_adapter_url)" -o "$CHECKERS/swift.adapter.wasm"
test -s "$CHECKERS/swift.adapter.wasm"

echo "==> writing $CHECKERS/swift.guest.tar.gz"
# Reproducible: a sorted entry list, a fixed timestamp, no owner and a gzip stream carrying
# neither a name nor an mtime. Two checkouts building the same inputs produce the same bytes, so
# a reviewer can tell an artifact that was rebuilt from one that merely changed.
tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner --mode='u=rw,go=r' \
	-C "$STAGE" -cf - gg-shell.h sandbox.h sandbox.o sandbox_component_type.o shell.swift |
	gzip -9 -n >"$CHECKERS/swift.guest.tar.gz"

echo "==> writing $CHECKERS/swift.toolchain.json"
python3 - "$STAGE" "$CHECKERS/swift.toolchain.json" <<PY
import json, os, sys

stage, out = sys.argv[1], sys.argv[2]
files = ["gg-shell.h", "sandbox.h", "sandbox.o", "sandbox_component_type.o", "shell.swift"]
manifest = {
    "swift": "$GG_SWIFT_VERSION",
    "wasmSdk": "$GG_SWIFT_WASM_SDK_VERSION",
    "target": "$GG_SWIFT_TARGET",
    "witBindgen": "$GG_WIT_BINDGEN_VERSION",
    "adapter": "$GG_WASMTIME_ADAPTER_VERSION",
    "files": [
        {"name": name, "bytes": os.path.getsize(os.path.join(stage, name))}
        for name in files
    ],
}
with open(out, "w") as handle:
    json.dump(manifest, handle, indent=2)
    handle.write("\n")
PY

ls -la "$CHECKERS"/swift.*
