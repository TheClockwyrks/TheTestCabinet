#!/usr/bin/env bash
# Reflect the **Swift** program language's signature catalogue out of the SDK's own documentation
# and write `crates/gg/src/sandbox/guests/swift.signatures.json`.
#
# WHAT READS THE DOCUMENTATION. `swiftc -emit-symbol-graph`, which is the same machinery DocC is
# built on: for every public declaration it emits the doc comment, the resolved types, the
# parameter list with each label and internal name, and — for a `- Parameters:` block — nothing at
# all, because a doc comment is text and DocC's parameter sections are a CONVENTION over it. So
# this step gets the types and the declarations from the graph and the per-parameter prose from
# the comment, and `tools/signatures.py` holds the convention to being a contract: a function that
# takes N arguments must document N, in order, under their own names, or the reflection fails.
#
# The graph is emitted for `wasm32-unknown-wasip1`, the target this arm really compiles to, so the
# types in it are the types a program is really compiled against.
#
# WHY IT WRITES EXACTLY ONE FILE. `scripts/ci/contract-drift.sh` runs this on every CI run and then
# diffs BOTH committed directories. A signature step that reached `build.sh` for the bindings it
# needs would re-cut this arm's guest and library archives on the way past and fail that gate on
# bytes nobody edited — measured on the Rust arm, which is why the bindings are their own script
# here as they are there.
#
# Usage:
#   packages/gg-sandbox-swift/signatures.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck source=packages/gg-sandbox-swift/swift-version.sh
source "$HERE/swift-version.sh"

OUT="$ROOT/crates/gg/src/sandbox/guests/swift.signatures.json"
GRAPH="$HERE/.build/symbol-graph"
BINDINGS="$HERE/.build/bindings"

SWIFT_HOME="$(gg_swift_home)"
SWIFTC="$SWIFT_HOME/toolchain/usr/bin/swiftc"
SDK="$SWIFT_HOME/sdk"
if [ ! -x "$SWIFTC" ]; then
	cat >&2 <<EOF
error: no Swift toolchain at $SWIFT_HOME.
       Run scripts/ci/install-swift.sh, or set TCAB_GG_SWIFT_HOME.
EOF
	exit 1
fi
export LD_LIBRARY_PATH="$SWIFT_HOME/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

"$HERE/bindings.sh"

echo "==> emitting the SDK's symbol graph"
rm -rf "$GRAPH"
mkdir -p "$GRAPH"
"$SWIFTC" \
	-target "$GG_SWIFT_TARGET" \
	-sdk "$SDK/WASI.sdk" \
	-resource-dir "$SDK/swift.xctoolchain/usr/lib/swift_static" \
	-wmo -parse-as-library -module-name gg \
	-import-objc-header "$BINDINGS/sandbox.h" \
	-emit-module -emit-module-path "$GRAPH/gg.swiftmodule" \
	-emit-symbol-graph -emit-symbol-graph-dir "$GRAPH" \
	"$HERE"/Sources/SDK/Modules/*.swift "$HERE"/Sources/SDK/Internal/*.swift
test -s "$GRAPH/gg.symbols.json"

echo "==> reflecting $OUT"
python3 "$HERE/tools/signatures.py" "$GRAPH/gg.symbols.json" "$HERE/libraries.txt" "$HERE" "$OUT"
