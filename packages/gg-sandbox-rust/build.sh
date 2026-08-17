#!/usr/bin/env bash
# Build the **Rust** program language's library set, into `$GG_ARTIFACTS_OUT_DIR`:
#
#   rust.libraries.tar.gz   every `.rlib` a model's program is compiled against, gzipped.
#   rust.adapter.wasm       the pinned `wasi_snapshot_preview1` REACTOR adapter, which turns the
#                           preview1 core module `rustc` emits into the preview 2 component gg's
#                           engine instantiates.
#   rust.toolchain.json     what they were built by and what is in them.
#
# gg embeds both with `include_bytes!`/`include_str!` and unpacks the first, once per machine, into
# a shared read-only directory it then names on `rustc -L`. See
# `crates/gg/src/sandbox/language/rust.compile.rs`.
#
# WHY THE SET RIDES INSIDE gg's BINARY AND THE COMPILER DOES NOT. `rustc` is ~380 MB with its wasm standard
# library and cannot ride inside a single static `tcab` binary, so it is installed into the gg
# toolchain image (`containers/gg-toolchains/Dockerfile`) and found on `PATH` at run time. The rlibs
# go the other way: they are 9.4 MB gzipped — most of it `regex`, whose `regex-syntax` and
# `regex-automata` are 4.4 MB of the archive between them — they carry this arm's SDK, and a tree
# that lived in the image could be a different vintage from the gg binary reading it, which, once
# the SDK is in them, would mean a model shown one surface in its prompt and compiled against
# another.
#
# THE BINDINGS STEP IS ITS OWN SCRIPT, AND THAT IS STILL LOAD-BEARING. `signatures.sh` needs the
# bindings too, and it runs inside every `cargo build` of `test-cabinet-gg`; a reflection that
# reached THIS script for them would re-cut 9.4 MB of rlibs on the way past. `bindings.sh` is the one
# step both callers need, split out of the one that has side effects.
#
# It re-runs when: `crates/gg/wit/gg-sandbox.wit` changes, this package's `src/` changes, or
# `rust-toolchain.toml` bumps the compiler. The third is not optional and not a judgement call — an
# rlib is a compiler-version-private format and `rustc` refuses one built by a different release —
# and the check below fails by name rather than leaving it to a reader of this comment.
#
# Usage:
#   scripts/gg-artifacts.sh                                    # every arm, into one directory
#   GG_ARTIFACTS_OUT_DIR=<dir> packages/gg-sandbox-rust/build.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HERE="$ROOT/packages/gg-sandbox-rust"
# shellcheck source=packages/gg-sandbox-rust/rust-version.sh
source "$HERE/rust-version.sh"

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
#
# AND `CARGO_ENCODED_RUSTFLAGS` HAS TO GO WITH IT, which is not obvious and was not done. Cargo sets
# that variable in EVERY build script's environment — to the empty string when the outer build has no
# flags — and when it is present `rustc`'s invoker reads it and IGNORES `RUSTFLAGS` entirely. So
# under `crates/gg-sandbox-artifacts/rust`, which is the only path that produces what gg actually
# embeds, the line above did nothing at all: measured over three builds of one checkout, the
# standalone `scripts/gg-artifacts.sh` run wrote `/gg/cargo` into `libbase64.rlib` fourteen times and
# the `cargo build -p test-cabinet-gg` run wrote `/home/vscode` fourteen times instead, at a
# different size. Two things followed, and the second is the worse one: the shipped rlibs baked in
# the builder's home directory, which `rustc` then prints in diagnostics gg shows a MODEL; and
# `scripts/build-gg-static.sh` exports `RUSTFLAGS=-C target-feature=+crt-static` for the host binary,
# which arrived here encoded and was applied to a wasm compile nobody intended it
# for. Unsetting it is what makes this arm's compile decided here rather than by whatever invoked it.
unset CARGO_ENCODED_RUSTFLAGS
export RUSTFLAGS="--remap-path-prefix=$HERE=/gg/sdk --remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/gg/cargo"
echo "==> compiling the library set for $GG_RUST_TARGET"
# `--locked --offline`, because this runs inside an ordinary `cargo build`. This package has its OWN
# `Cargo.lock`, separate from the workspace's, so nothing else in this repository warms its registry
# closure — `scripts/ci/install-gg-build-tools.sh` runs `cargo fetch --locked` against exactly this
# manifest for that reason. `--locked` additionally refuses to UPDATE the lockfile, which matters
# beyond determinism: the lockfile is a declared input of this arm's artifact crate, and a build that
# rewrote its own input would invalidate itself and re-run for ever.
(
	cd "$HERE"
	CARGO_TARGET_DIR="$BUILD/target" cargo build --release --locked --offline \
		--target "$GG_RUST_TARGET"
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
	echo "       whole library set unusable in every run container. Remove it." >&2
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
cat >"$GG_ARTIFACTS_OUT_DIR/rust.toolchain.json" <<EOF
{
  "rustc": "$GG_RUST_VERSION",
  "target": "$GG_RUST_TARGET",
  "witBindgen": "$GG_WIT_BINDGEN_VERSION",
  "adapter": "$GG_WASMTIME_ADAPTER_VERSION",
  "crates": [$crates_json]
}
EOF

# --- The adapter ------------------------------------------------------------
# COPIED FROM A CACHE, NOT DOWNLOADED. `scripts/gg-downloads.sh` resolves the pinned file from an
# override, the toolchain image, or a version-stamped per-user cache, and only downloads on a
# machine no installer has touched. THE PIN IS THIS ARM'S OWN — see `rust-version.sh` for why the
# C++ and Swift arms keeping separate ones matters.
echo "==> rust.adapter.wasm"
cp "$(gg_wasmtime_adapter "$GG_WASMTIME_ADAPTER_VERSION" "$(gg_wasmtime_adapter_url)")" \
	"$GG_ARTIFACTS_OUT_DIR/rust.adapter.wasm"
test -s "$GG_ARTIFACTS_OUT_DIR/rust.adapter.wasm"

# --- Pack -------------------------------------------------------------------
# Sorted names, fixed mtime, fixed owner: the tarball is content-addressed by gg (its digest keys
# the shared directory it is unpacked into), so two builds of the same inputs must produce the same
# bytes rather than two directories. Together with the path remapping above that holds across
# checkouts and machines, not merely across two runs in one working copy.
tar --sort=name \
	--mtime="UTC 1970-01-01" \
	--owner=0 --group=0 --numeric-owner \
	-C "$STAGE" -cf "$BUILD/rust.libraries.tar" .
gzip -9 -n -c "$BUILD/rust.libraries.tar" >"$GG_ARTIFACTS_OUT_DIR/rust.libraries.tar.gz"

# --- What used to be here: the source manifest --------------------------------
# This step wrote `rust.sources.manifest.json`, a table of the SHA-256 of every file under `src/`
# beside the digest of the tarball, so that a test could recompute the hashes from the checkout and
# fail when somebody had edited the SDK without re-running this script. That question — *is the
# committed archive older than the sources beside it?* — no longer has a subject. The archive is not
# committed: `crates/gg-sandbox-artifacts/rust` runs this script into its own cargo `OUT_DIR` on
# every build whose declared inputs moved, and `crates/gg` embeds what lands there. An SDK edit
# re-cuts the rlibs in the same `cargo build` that compiles the host, so the state the manifest
# existed to name is not a state this repository can be in.
#
# It is worth recording WHY it mattered here more than anywhere else, because the reason has not gone
# away — it has just been answered differently. Every other compiled arm carries part of its SDK into
# its archive as source (the C++ headers, the Swift shell) and could be compared file for file. An
# `.rlib` carries none: `libgg.rlib` is compiled through and through, so nothing could read this
# arm's shipped surface back out. The digest table was the only thing that could see an SDK edit at
# all. What sees it now is cargo — `packages/gg-sandbox-rust/src` is in this arm's rerun set, and a
# rerun re-cuts the archive rather than reporting on it.
#
# The one check that was NOT about staleness stays, and it is the `rustc --version` comparison at the
# top of this file. An `.rlib` is a compiler-version-private format and `rustc` refuses one built by
# another release outright, so a set cut by the wrong compiler grounds every Rust program in a run.
# `rust.compile.test.rs` used to assert that from the other end, against the version recorded in the
# manifest; that assertion is gone with the manifest, because there is no longer any interval in
# which the recorded compiler and the running one can differ. The check up there is what enforces it
# now, on every build, before a single rlib is produced.

echo "==> wrote"
ls -la "$GG_ARTIFACTS_OUT_DIR/rust.libraries.tar.gz" "$GG_ARTIFACTS_OUT_DIR/rust.adapter.wasm" \
	"$GG_ARTIFACTS_OUT_DIR/rust.toolchain.json"
cat "$GG_ARTIFACTS_OUT_DIR/rust.toolchain.json"
