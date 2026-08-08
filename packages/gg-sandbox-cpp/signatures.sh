#!/usr/bin/env bash
# Reflect the **C++** program language's signature catalogue out of the SDK's own documentation
# and write `crates/gg/src/sandbox/guests/cpp.signatures.json`.
#
# WHAT READS THE DOCUMENTATION. `clang++` itself. clang carries a real documentation parser — the
# one `-Wdocumentation` diagnoses against and the one `libclang`'s comment API and `clang-doc` are
# built on — and `-ast-dump=json` prints what it built: which comment belongs to which declaration,
# each `\param`'s prose attached to the parameter it names, `\returns` and `\throws` as their own
# nodes, and `\copydoc` as a reference this arm's reflector resolves. So the per-parameter
# documentation slot here is the LANGUAGE's rather than a convention standing in for one, as it is
# on the Rust and PureScript arms.
#
# `-Werror=documentation` is what makes that a contract rather than a habit: clang refuses the
# reflection outright if a `\param` names an argument the function does not take, or if a documented
# function's arguments are documented in the wrong order — before this script ever gets to check the
# same things itself.
#
# WHY THE AST IS FILTERED. A translation unit that includes this SDK also includes half the standard
# library, and dumping the whole of one is ~300 MB for `<string>` alone. `-ast-dump-filter=gg` keeps
# the declarations whose name matches — which for this SDK is all of them, because its surface lives
# in `namespace gg`. 3 MB and half a second.
#
# WHY IT WRITES EXACTLY ONE FILE. `scripts/ci/contract-drift.sh` runs this on every CI run and then
# diffs BOTH committed directories. A signature step that reached `build.sh` for the bindings it
# needs would re-cut this arm's guest archive on the way past and fail that gate on bytes nobody
# edited — measured on the Rust arm, which is why the bindings are their own script here as they are
# there. Nothing below writes into `crates/gg/src/sandbox/checkers/`.
#
# Usage:
#   packages/gg-sandbox-cpp/signatures.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck source=packages/gg-sandbox-cpp/cpp-version.sh
source "$HERE/cpp-version.sh"

OUT="$ROOT/crates/gg/src/sandbox/guests/cpp.signatures.json"
WORK="$HERE/.build/reflect"
BINDINGS="$HERE/.build/bindings"

SDK_HOME="$(gg_wasi_sdk_home)"
CLANGXX="$SDK_HOME/bin/clang++"
if [ ! -x "$CLANGXX" ]; then
	cat >&2 <<EOF
error: no wasi-sdk at $SDK_HOME.
       Run scripts/ci/install-wasi-sdk.sh, or set TCAB_GG_WASI_SDK_HOME.
EOF
	exit 1
fi

"$HERE/bindings.sh" >/dev/null

echo "==> dumping the SDK's comment AST"
rm -rf "$WORK"
mkdir -p "$WORK"
# One translation unit that includes nothing but the SDK's umbrella header. It is compiled for the
# target this arm really compiles to, so the types in the dump are the types a program is really
# declared against.
printf '#include "sdk/gg.hpp"\n' >"$WORK/reflect.cpp"
(cd "$HERE" && "$CLANGXX" \
	--target="$GG_CPP_TARGET" -std="$GG_CPP_STD" -fsyntax-only \
	-Wdocumentation -Wdocumentation-pedantic -Werror=documentation \
	-I Sources -I "$BINDINGS" \
	-Xclang -ast-dump=json -Xclang -ast-dump-filter=gg \
	"$WORK/reflect.cpp") >"$WORK/ast.json"
test -s "$WORK/ast.json"

echo "==> reflecting $OUT"
# From this package's own directory, because the paths clang records in the dump are the ones it was
# given — and it is given `-I Sources` from here, so `Sources/sdk/objects/fs.hpp` is what a doc
# comment's source range is quoted out of.
(cd "$HERE" && python3 tools/signatures.py "$WORK/ast.json" Sources/prelude.hpp "$OUT")
