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
# go the other way: they are 9.4 MB gzipped — most of it `regex`, whose `regex-syntax` and
# `regex-automata` are 4.4 MB of the archive between them — they carry this arm's SDK, and a tree
# that lived in the image could be a different vintage from the gg binary reading it, which, once
# the SDK is in them, would mean a model shown one surface in its prompt and compiled against
# another.
#
# NOTHING IN CI RUNS THIS. It is a developer's command, run deliberately and committed with its
# output, and `scripts/ci/contract-drift.sh` names this arm's artifacts in its `$declared` exemption
# for that reason. The bindings step both this script and `signatures.sh` need is `bindings.sh`, so
# the catalogue can be regenerated — which CI does do, on every run — without re-cutting a library
# set on the way past.
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

# Everything this build produces, and deliberately not `$BUILD` itself: the vendored `wit-bindgen`
# lives beside them under a version-stamped name, and re-fetching it on every build would be a
# network round trip for a file the pin already decides. `${BUILD:?}` because these are `rm -rf`
# arguments and an unset root would make them absolute.
rm -rf "${BUILD:?}/lib" "${BUILD:?}/target" "${BUILD:?}/rust.libraries.tar"
mkdir -p "$STAGE"

# --- The bindings -----------------------------------------------------------
"$HERE/bindings.sh"

# --- The library set --------------------------------------------------------
# WHERE THIS WAS BUILT MUST NOT BE IN WHAT IT PRODUCES. An `.rlib` records the absolute paths its
# sources were compiled from and the absolute directory `rustc` was run in, so the same inputs built
# at two checkouts produce two different archives — measured, before this remapping: `libgg.rlib`
# came out 1,111,590 bytes at one path and 1,116,390 at a longer one. That is the difference between
# an artifact a reviewer can rebuild and compare and one whose bytes only ever match on the machine
# that made them, and it is the difference gg's own content-addressing assumes away when it keys the
# directory it unpacks this tarball into by its digest.
#
# Two prefixes cover it: this package (which contains the sources and, via `CARGO_TARGET_DIR` below,
# every build script's `OUT_DIR`) and `CARGO_HOME` (the registry the curated crates are compiled
# from, which lives under a different user's `$HOME` on every machine). Cargo deliberately leaves
# the VALUES of `--remap-path-prefix` out of the unit hash it derives `-C metadata` from, so
# remapping does not itself reintroduce the path — verified by building at two roots and under two
# `$HOME`s and comparing every rlib's digest.
#
# It REPLACES an inherited `RUSTFLAGS` rather than appending to one, deliberately: a flag arriving
# from somebody's shell is exactly the kind of thing that would make one machine's set differ from
# another's, which is the property this whole paragraph is here to hold.
export RUSTFLAGS="--remap-path-prefix=$HERE=/gg/sdk --remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/gg/cargo"
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
#
# The rename strips the trailing `-<hash>` and nothing else, and refuses a name it does not
# recognise or a destination it has already written. Both refusals matter: `deps/` holding two
# builds of one crate — two versions in the graph, or a stale hash from an interrupted run — would
# otherwise leave the second silently overwriting the first, and the manifest below would then
# describe a set one crate short of what it names.
DEPS="$BUILD/target/$GG_RUST_TARGET/release/deps"
for rlib in "$DEPS"/*.rlib; do
	name="$(basename "$rlib")"
	# libfoo_bar-0123456789abcdef.rlib -> libfoo_bar.rlib
	if [[ ! "$name" =~ ^(lib[A-Za-z0-9_]+)-[0-9a-f]+\.rlib$ ]]; then
		echo "error: $name is not a <crate>-<hash> rlib name this script knows how to rename." >&2
		echo "       Renaming it by guesswork would put a crate in the set under a name" >&2
		echo "       'rustc -L dependency=' cannot find it by. Read the name and fix this." >&2
		exit 1
	fi
	plain="${BASH_REMATCH[1]}.rlib"
	if [ -e "$STAGE/$plain" ]; then
		echo "error: two rlibs in $DEPS want to be staged as $plain, so one would silently" >&2
		echo "       replace the other and the manifest would describe a set that is a crate" >&2
		echo "       short. Clear .build and rebuild; if it recurs, the dependency graph holds" >&2
		echo "       two versions of one crate and the curated set must choose one." >&2
		exit 1
	fi
	cp "$rlib" "$STAGE/$plain"
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
# bytes rather than two directories. Together with the path remapping above that holds across
# checkouts and machines, not merely across two runs in one working copy.
tar --sort=name \
	--mtime="UTC 1970-01-01" \
	--owner=0 --group=0 --numeric-owner \
	-C "$STAGE" -cf "$BUILD/rust.libraries.tar" .
gzip -9 -n -c "$BUILD/rust.libraries.tar" >"$CHECKERS/rust.libraries.tar.gz"

echo "==> wrote"
ls -la "$CHECKERS/rust.libraries.tar.gz" "$CHECKERS/rust.toolchain.json"
cat "$CHECKERS/rust.toolchain.json"
