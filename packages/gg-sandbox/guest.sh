#!/usr/bin/env bash
# Build the **ECMAScript guest** — quickjs-ng inside a `wit-bindgen` component declaring gg's own
# `sandbox` world — into `$GG_ARTIFACTS_OUT_DIR`:
#
#   ecmascript.core.wasm      the preview1 core module `rustc` emits
#   ecmascript.adapter.wasm   the pinned `wasi_snapshot_preview1` REACTOR adapter
#   ecmascript.guest.json     what built them, and what is in them
#
# gg embeds all three with `include_bytes!`/`include_str!` and encodes the component in its own
# process — see `crates/gg/src/sandbox/language/ecmascript.rs`.
#
# It is a STEP OF `build.sh` rather than a script anybody runs, called from step 2b, because it reads
# `dist/` — the SDK `build.sh` step 1 has just emitted — and baking a stale one would ship a guest
# whose surface is not the surface the catalogue describes. Run `packages/gg-sandbox/build.sh`.
#
# WHY IT IS A SEPARATE FILE at all: `build.sh` is one arm's recipe for five artifacts and was already
# 170 lines; this is 100 more, about a different toolchain, with its own pins and its own two
# preflight checks. Splitting it is the same call `packages/gg-sandbox-rust/bindings.sh` makes.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HERE="$ROOT/packages/gg-sandbox"
GUEST="$HERE/guest"

# shellcheck source=packages/gg-sandbox/ecmascript-version.sh
source "$HERE/ecmascript-version.sh"

if [ -z "${GG_ARTIFACTS_OUT_DIR:-}" ]; then
	# shellcheck source=scripts/gg-artifacts-out-dir.sh
	source "$ROOT/scripts/gg-artifacts-out-dir.sh"
fi
# shellcheck source=scripts/gg-downloads.sh
source "$ROOT/scripts/gg-downloads.sh"

echo "==> gg ECMAScript guest"
echo "    rustc      $GG_ECMASCRIPT_RUST_VERSION"
echo "    target     $GG_ECMASCRIPT_TARGET"
echo "    rquickjs   $GG_ECMASCRIPT_RQUICKJS_VERSION"
echo "    adapter    $GG_ECMASCRIPT_ADAPTER_VERSION"

# --- what this build needs, checked by name ---------------------------------
observed="$(rustc --version | awk '{print $2}')"
if [ "$observed" != "$GG_ECMASCRIPT_RUST_VERSION" ]; then
	echo "error: this shell's rustc is $observed, and rust-toolchain.toml pins $GG_ECMASCRIPT_RUST_VERSION." >&2
	echo "       Run this from the repository root so rustup picks the pinned toolchain up." >&2
	exit 1
fi
if ! rustc --print target-libdir --target "$GG_ECMASCRIPT_TARGET" >/dev/null 2>&1; then
	echo "error: the $GG_ECMASCRIPT_TARGET standard library is not installed." >&2
	echo "       Run scripts/ci/install-rust-wasm.sh." >&2
	exit 1
fi

WASI_SDK_HOME="$(gg_wasi_sdk_home)"
if [ ! -x "$WASI_SDK_HOME/bin/clang" ]; then
	echo "error: no clang at $WASI_SDK_HOME/bin/clang." >&2
	echo "       This guest compiles quickjs from C, so it needs the wasi-sdk the C++ arm" >&2
	echo "       installs — see the note in packages/gg-sandbox/ecmascript-version.sh for why" >&2
	echo "       it is that arm's tree and not a second one. Run scripts/ci/install-wasi-sdk.sh." >&2
	exit 1
fi
# The archiver `cc-rs` builds `libquickjs.a` with. The wasi-sdk tree is pruned to the two binaries
# the C++ arm's turn path runs and an archiver is not one of them, so this is the system's.
ARCHIVER="$(command -v llvm-ar || command -v ar || true)"
if [ -z "$ARCHIVER" ]; then
	echo "error: no \`ar\` (or \`llvm-ar\`) on PATH." >&2
	echo "       cc-rs archives quickjs's object files into a static library with one, and the" >&2
	echo "       wasi-sdk tree this repository installs is pruned of its own. It is in binutils," >&2
	echo "       which .devcontainer/system/apt.sh installs." >&2
	exit 1
fi

# --- the core module --------------------------------------------------------
BUILD="$GUEST/.build"
rm -rf "${BUILD:?}/target"

# `CARGO_ENCODED_RUSTFLAGS` has to go with `RUSTFLAGS`: cargo sets it in EVERY build script's
# environment — to the empty string when the outer build has no flags — and when it is present the
# `rustc` invoker reads it and IGNORES both `RUSTFLAGS` and the `rustflags` in `.cargo/config.toml`.
# That config is where this guest's 4 MiB shadow stack comes from, and a shadow stack silently back
# at wasm-ld's 64 KiB default would make a deep JavaScript recursion corrupt linear memory instead of
# raising a `RangeError`. `packages/gg-sandbox-rust/build.sh` carries the same unset, for the same
# reason, discovered the same way.
#
# The COMPILER this build uses must be decided here too, and not by whatever invoked it. `cargo
# clippy` sets `RUSTC_WORKSPACE_WRAPPER` in the environment it runs a build script in, and a nested
# `cargo build` inherits it — so the guest was compiled by `clippy-driver`, under the outer
# invocation's `-D warnings`, and the artifact a `cargo clippy` produced was not the artifact a
# `cargo build` produced. Unset for the same reason as the flags below: what this arm emits is
# decided by this script.
unset RUSTC_WRAPPER RUSTC_WORKSPACE_WRAPPER
unset CARGO_ENCODED_RUSTFLAGS RUSTFLAGS

# WHERE THIS WAS BUILT MUST NOT BE IN WHAT IT PRODUCES: a `.wasm` records the paths its sources were
# compiled from, so the same inputs built at two checkouts produce two different artifacts. Two
# prefixes cover it — this package and `CARGO_HOME` — exactly as the Rust arm's build script does.
export RUSTFLAGS="--remap-path-prefix=$GUEST=/gg/ecmascript --remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/gg/cargo"

# `--locked --offline`, because this runs inside an ordinary `cargo build`. This crate has its OWN
# `Cargo.lock`, and `scripts/ci/install-gg-build-tools.sh` runs `cargo fetch --locked` against
# exactly this manifest so the registry closure is warm.
(
	cd "$GUEST"
	WASI_SDK="$WASI_SDK_HOME" \
		AR_wasm32_wasip1="$ARCHIVER" \
		CFLAGS_wasm32_wasip1="$(gg_ecmascript_cflags)" \
		CARGO_TARGET_DIR="$BUILD/target" \
		cargo build --release --locked --offline --target "$GG_ECMASCRIPT_TARGET"
)

CORE="$BUILD/target/$GG_ECMASCRIPT_TARGET/release/gg_sandbox_ecmascript.wasm"
test -s "$CORE"
cp "$CORE" "$GG_ARTIFACTS_OUT_DIR/ecmascript.core.wasm"

# --- the adapter ------------------------------------------------------------
# COPIED FROM A CACHE, NOT DOWNLOADED. `scripts/gg-downloads.sh` resolves the pinned file from an
# override, the toolchain image, or a version-stamped per-user cache, and only downloads on a machine
# no installer has touched.
cp "$(gg_wasmtime_adapter "$GG_ECMASCRIPT_ADAPTER_VERSION" "$(gg_ecmascript_adapter_url)")" \
	"$GG_ARTIFACTS_OUT_DIR/ecmascript.adapter.wasm"
test -s "$GG_ARTIFACTS_OUT_DIR/ecmascript.adapter.wasm"

# --- the manifest -----------------------------------------------------------
# What built it, in the words a person comparing two builds needs, and the one field gg itself reads:
# `engine`, which the arm's own documentation quotes so a page cannot claim a version the artifact
# was not built with.
cat >"$GG_ARTIFACTS_OUT_DIR/ecmascript.guest.json" <<EOF
{
  "engine": "quickjs-ng via rquickjs $GG_ECMASCRIPT_RQUICKJS_VERSION",
  "rustc": "$GG_ECMASCRIPT_RUST_VERSION",
  "target": "$GG_ECMASCRIPT_TARGET",
  "adapter": "$GG_ECMASCRIPT_ADAPTER_VERSION",
  "wasiSdk": "$GG_WASI_SDK_VERSION",
  "coreBytes": $(wc -c <"$GG_ARTIFACTS_OUT_DIR/ecmascript.core.wasm" | tr -d ' ')
}
EOF

echo "==> wrote"
ls -la "$GG_ARTIFACTS_OUT_DIR/ecmascript.core.wasm" \
	"$GG_ARTIFACTS_OUT_DIR/ecmascript.adapter.wasm" \
	"$GG_ARTIFACTS_OUT_DIR/ecmascript.guest.json"
cat "$GG_ARTIFACTS_OUT_DIR/ecmascript.guest.json"
