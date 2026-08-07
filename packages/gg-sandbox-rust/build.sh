#!/usr/bin/env bash
# Build the **Rust** program language's library set and commit it into `crates/gg`.
#
# What it produces, both under `crates/gg/src/sandbox/checkers/`:
#
#   rust.libraries.tar.gz   every `.rlib` a model's program is compiled against, gzipped.
#   rust.toolchain.json     what they were built by and what is in them.
#
# gg embeds both with `include_bytes!`/`include_str!` and unpacks the first, once per machine, into
# a shared read-only directory it then names on `rustc -L`. See
# `crates/gg/src/sandbox/language/rust.compile.rs`.
#
# WHY THE SET IS COMMITTED AND THE COMPILER IS NOT. `rustc` is ~376 MB with its wasm standard
# library and cannot ride inside a single static `tcab` binary, so it is installed into the gg
# toolchain image (`containers/gg-toolchains/Dockerfile`) and found on `PATH` at run time. The rlibs
# go the other way: they are ~700 KB, they carry this arm's SDK, and a tree that lived in the image
# could be a different vintage from the gg binary reading it — which, once the SDK is in them, would
# mean a model shown one surface in its prompt and compiled against another.
#
# Re-run it when: `crates/gg/wit/gg-sandbox.wit` changes, this package's `src/` changes, or
# `rust-toolchain.toml` bumps the compiler. The third is not optional and not a judgement call —
# an rlib is a compiler-version-private format and `rustc` refuses one built by a different
# release. `the_committed_library_set_was_built_by_this_checkouts_compiler` fails until it is done.
#
# Usage:
#   packages/gg-sandbox-rust/build.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HERE="$ROOT/packages/gg-sandbox-rust"
# shellcheck source=packages/gg-sandbox-rust/rust-version.sh
source "$HERE/rust-version.sh"

CHECKERS="$ROOT/crates/gg/src/sandbox/checkers"
BUILD="$HERE/.build"
STAGE="$BUILD/lib"

echo "==> gg Rust library set"
echo "    rustc        $GG_RUST_VERSION"
echo "    target       $GG_RUST_TARGET"
echo "    wit-bindgen  $GG_WIT_BINDGEN_VERSION"

observed="$(rustc --version | awk '{print $2}')"
if [ "$observed" != "$GG_RUST_VERSION" ]; then
	echo "error: this shell's rustc is $observed, and rust-toolchain.toml pins $GG_RUST_VERSION." >&2
	echo "       An rlib built by one release cannot be read by another, so the set must be" >&2
	echo "       built by the compiler every checkout uses. Run this from the repository root" >&2
	echo "       so rustup picks the pinned toolchain up." >&2
	exit 1
fi
if ! rustc --print target-libdir --target "$GG_RUST_TARGET" >/dev/null 2>&1; then
	echo "error: the $GG_RUST_TARGET standard library is not installed." >&2
	echo "       Run scripts/ci/install-rust-wasm.sh." >&2
	exit 1
fi

rm -rf "$BUILD"
mkdir -p "$STAGE"

# --- The bindings -----------------------------------------------------------
# Generated rather than committed, and by the CLI rather than by `wit_bindgen::generate!`. See
# `rust-version.sh` for the second half of that: the macro leaves a proc-macro dependency in the
# rlib's metadata, and a proc macro is a host `.so` no other architecture can load.
echo "==> generating bindings from crates/gg/wit"
BINDGEN_DIR="$BUILD/wit-bindgen"
mkdir -p "$BINDGEN_DIR"
case "$(uname -s)-$(uname -m)" in
Linux-x86_64) BINDGEN_ASSET="x86_64-linux" ;;
Linux-aarch64 | Linux-arm64) BINDGEN_ASSET="aarch64-linux" ;;
Darwin-x86_64) BINDGEN_ASSET="x86_64-macos" ;;
Darwin-arm64) BINDGEN_ASSET="aarch64-macos" ;;
*)
	echo "error: no pinned wit-bindgen build for $(uname -s)-$(uname -m)." >&2
	exit 1
	;;
esac
curl -sSfL "https://github.com/bytecodealliance/wit-bindgen/releases/download/v${GG_WIT_BINDGEN_VERSION}/wit-bindgen-${GG_WIT_BINDGEN_VERSION}-${BINDGEN_ASSET}.tar.gz" |
	tar -xz -C "$BINDGEN_DIR" --strip-components=1
BINDGEN="$BINDGEN_DIR/wit-bindgen"

# `--default-bindings-module gg::bindings` is what lets the `export!` macro be invoked from the
# program's own crate against bindings that live in this one — the arrangement the whole
# prebuilt-rlib strategy rests on, and the one that needs `--pub-export-macro` to be reachable at
# all.
"$BINDGEN" rust \
	--world sandbox \
	--pub-export-macro \
	--export-macro-name export \
	--default-bindings-module "gg::bindings" \
	--format \
	--out-dir "$HERE/src" \
	"$ROOT/crates/gg/wit"
mv "$HERE/src/sandbox.rs" "$HERE/src/bindings.rs"

# --- The library set --------------------------------------------------------
echo "==> compiling the library set for $GG_RUST_TARGET"
(
	cd "$HERE"
	CARGO_TARGET_DIR="$BUILD/target" cargo build --release --target "$GG_RUST_TARGET"
)

# NO PROC MACRO may have been built. One in the tree would be a host `.so` named in an rlib's
# metadata, and `rustc` then refuses the whole set on any other architecture — the failure that
# decided this arm's whole build topology (see `rust-version.sh`). Checked rather than trusted,
# because adding one is a one-line edit to the dependency list below and its consequence appears
# only on somebody else's machine.
HOST_DEPS="$BUILD/target/release/deps"
if compgen -G "$HOST_DEPS/*.so" >/dev/null || compgen -G "$HOST_DEPS/*.dylib" >/dev/null; then
	echo "error: a dependency in the curated set is (or pulls in) a PROC MACRO:" >&2
	ls "$HOST_DEPS"/*.so "$HOST_DEPS"/*.dylib 2>/dev/null >&2
	echo "       A proc macro is a host dynamic library. An rlib whose metadata names one" >&2
	echo "       cannot be loaded on any other architecture (E0463), which would make the" >&2
	echo "       committed set unusable in every run container. Remove it." >&2
	exit 1
fi

# Every rlib the leaf's link needs, under its plain `lib<name>.rlib` name: `rustc -L dependency=`
# finds a crate by either that or `lib<name>-<hash>.rlib`, and the plain name is what makes the
# shipped set readable by a human staring at it in a run container.
DEPS="$BUILD/target/$GG_RUST_TARGET/release/deps"
for rlib in "$DEPS"/*.rlib; do
	name="$(basename "$rlib")"
	# libfoo-0123abcd.rlib -> libfoo.rlib
	cp "$rlib" "$STAGE/${name%%-*}.rlib"
done
ls -la "$STAGE"

# --- The manifest -----------------------------------------------------------
# What the set was built by, in the words gg compares against at run time. `rustc` is the load-
# bearing one: it is what a mismatch is refused over.
#
# `extern` is the other load-bearing field, and it is the difference between a crate a MODEL may name
# and one that is merely present. `rustc -L dependency=` finds every rlib here when something already
# in the graph needs it; `--extern` is what puts a name in a program's own extern prelude. So the
# SDK and the CURATED SET get one and the transitive closure under them does not — otherwise a
# program could `use regex_syntax::…`, which is not a library this arm offers, merely one it carries.
#
# The curated set is read out of `Cargo.toml`: the dependencies declared after the first
# `# --- heading ---` line, which is the same marker `tools/signatures.py` groups the catalogue's
# library list by. One declaration, two readers.
curated="$(awk '
	/^\[dependencies\]/ { inside = 1; next }
	/^\[/ { inside = 0 }
	inside && /^# --- / { curated = 1; next }
	inside && curated && /^[a-zA-Z0-9_-]+ *=/ { name = $1; gsub(/-/, "_", name); print name }
' "$HERE/Cargo.toml")"
echo "==> curated crates a program may name: gg $(echo "$curated" | tr '\n' ' ')"

crates_json="$(
	for rlib in "$STAGE"/*.rlib; do
		name="$(basename "$rlib" .rlib)"
		name="${name#lib}"
		is_extern=false
		if [ "$name" = "gg" ]; then
			is_extern=true
		else
			for curated_name in $curated; do
				if [ "$name" = "$curated_name" ]; then is_extern=true; fi
			done
		fi
		printf '{"name":"%s","bytes":%s,"extern":%s}\n' \
			"$name" "$(wc -c <"$rlib" | tr -d ' ')" "$is_extern"
	done | paste -sd, -
)"
cat >"$CHECKERS/rust.toolchain.json" <<EOF
{
  "rustc": "$GG_RUST_VERSION",
  "target": "$GG_RUST_TARGET",
  "witBindgen": "$GG_WIT_BINDGEN_VERSION",
  "crates": [$crates_json]
}
EOF

# --- Pack -------------------------------------------------------------------
# Sorted names, fixed mtime, fixed owner: the tarball is content-addressed by gg (its digest keys
# the shared directory it is unpacked into), so two builds of the same inputs must produce the same
# bytes rather than two directories.
tar --sort=name \
	--mtime="UTC 1970-01-01" \
	--owner=0 --group=0 --numeric-owner \
	-C "$STAGE" -cf "$BUILD/rust.libraries.tar" .
gzip -9 -n -c "$BUILD/rust.libraries.tar" >"$CHECKERS/rust.libraries.tar.gz"

echo "==> wrote"
ls -la "$CHECKERS/rust.libraries.tar.gz" "$CHECKERS/rust.toolchain.json"
cat "$CHECKERS/rust.toolchain.json"
