#!/usr/bin/env bash
# Regenerate the COMMITTED signature catalogue for the Rust arm:
#
#   crates/gg/src/sandbox/guests/rust.signatures.json
#
# gg embeds that file and renders the responses-as-code system prompt and every documentation view
# from it, so it is the whole of what a model is told about this arm's surface. Every word of it is
# reflected out of the SDK's own declarations by `tools/signatures.py`, which reads the JSON
# `rustdoc` itself emits — so a doc comment edited without a regeneration is a diff CI fails on
# rather than a sentence that quietly stopped being true.
#
# WHAT IT NEEDS. This checkout's own `cargo` and `rustdoc`, the `wasm32-unknown-unknown` standard
# library (`scripts/ci/install-rust-wasm.sh`), and `src/bindings.rs` — which is generated rather than
# committed, so it runs `bindings.sh` first when that file is missing, fetching the pinned
# `wit-bindgen` once.
#
# WHAT IT MUST NOT DO IS REBUILD THE LIBRARY SET, and that is why the bindings live in their own
# script rather than inside `build.sh`. This runs inside `scripts/ci/contract-drift.sh`, whose last
# step is `git diff --exit-code` over `crates/gg/src/sandbox/checkers/` — the directory `build.sh`
# rewrites. A fresh checkout never has `src/bindings.rs`, so reaching `build.sh` for it would re-cut
# `rust.libraries.tar.gz` and `rust.toolchain.json` on every CI run, and the gate would then fail on
# an artifact nobody edited. It writes exactly one file: the catalogue named above.
#
# WHY `RUSTC_BOOTSTRAP=1`. `rustdoc`'s JSON output is unstable, and this repository pins a STABLE
# toolchain — deliberately, because an rlib is compiler-version-private and the arm must be built by
# the one compiler every checkout has. The alternative is a second toolchain in every developer's
# checkout and in CI, pinned separately, to read documentation out of a crate the first one compiles.
# The format version is asserted below, so a rustc bump that changes it fails here by name rather
# than producing a catalogue with a field missing.
#
# Usage:
#   packages/gg-sandbox-rust/signatures.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="$ROOT/crates/gg/src/sandbox/guests/rust.signatures.json"

# shellcheck source=packages/gg-sandbox-rust/rust-version.sh
source "$HERE/rust-version.sh"

# The rustdoc JSON format this reflector reads. It is a version of `rustdoc`'s output rather than of
# `rustdoc`, and it moves on its own schedule; pinning it here is what turns "the catalogue came out
# subtly wrong" into "this script stopped".
EXPECTED_FORMAT_VERSION=57

if ! rustc --print target-libdir --target "$GG_RUST_TARGET" >/dev/null 2>&1; then
	echo "error: the $GG_RUST_TARGET standard library is not installed." >&2
	echo "       Run scripts/ci/install-rust-wasm.sh." >&2
	exit 1
fi

if [ ! -f "$HERE/src/bindings.rs" ]; then
	echo "==> generating the WIT bindings (they are not committed)"
	"$HERE/bindings.sh"
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Documented for the same target a program is compiled to, so the types in the catalogue are the
# types a program is compiled against rather than a host build's.
echo "==> documenting the SDK with rustdoc"
(
	cd "$HERE"
	RUSTC_BOOTSTRAP=1 CARGO_TARGET_DIR="$WORK/target" \
		cargo rustdoc --quiet --target "$GG_RUST_TARGET" -- \
		-Zunstable-options --output-format json
)

DOC="$WORK/target/$GG_RUST_TARGET/doc/gg.json"
observed="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["format_version"])' "$DOC")"
if [ "$observed" != "$EXPECTED_FORMAT_VERSION" ]; then
	echo "error: rustdoc $GG_RUST_VERSION emits JSON format $observed, and this reflector reads" >&2
	echo "       format $EXPECTED_FORMAT_VERSION. Read tools/signatures.py against the new" >&2
	echo "       format, fix what moved, and update EXPECTED_FORMAT_VERSION here." >&2
	exit 1
fi

echo "==> reflecting the catalogue"
python3 "$HERE/tools/signatures.py" "$DOC" "$HERE/Cargo.toml" "$OUT"
