#!/usr/bin/env bash
# The pins the **ECMAScript guest** — the one in `guest/`, which the TypeScript, JavaScript and
# PureScript arms will stand on — is built against.
#
# Sourced by `build.sh`. Kept beside the package rather than inside the crate because two of the
# three pins are toolchain locations rather than Cargo dependencies, and `Cargo.lock` cannot hold
# them.
#
# WHY THIS GUEST EXISTS AT ALL, in one paragraph, because the pins below only make sense against it:
# gg's contract requires a program's every SDK name to come from an import the program wrote, and the
# incumbent engine (StarlingMonkey, via `componentize-js`) cannot evaluate a module at run time by
# any route — every route was tried against the built guest before this one was chosen. quickjs-ng
# can. Ruling D14 chose it. `guest/src/lib.rs` is the long form.
set -euo pipefail

GG_ECMASCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# The compiler the guest is built by, which is the repository's own — read from the same file the
# Rust arm reads it from, and for a weaker reason than that arm's. Nothing about this artifact is
# compiler-version-private: it is a `.wasm`, not an `.rlib`. The pin is here so that the guest a
# release ships was produced by the toolchain that checkout builds with, which is what makes a
# rebuild on another machine comparable.
GG_ECMASCRIPT_RUST_VERSION="$(sed -n 's/^channel = "\(.*\)"$/\1/p' "$GG_ECMASCRIPT_ROOT/rust-toolchain.toml")"
if [ -z "$GG_ECMASCRIPT_RUST_VERSION" ]; then
	echo "error: could not read [toolchain] channel out of rust-toolchain.toml" >&2
	exit 1
fi

# The target, and it is `wasm32-wasip1` for the reason `packages/gg-sandbox-rust/rust-version.sh`
# gives at length: a program compiled to `wasm32-unknown-unknown` HAS NO STANDARD ERROR, because
# std's `cfg_select!` falls through to `unsupported.rs` where a write is discarded and reported as a
# success. This guest's whole failure surface is standard error — ruling D8's capture-not-
# interception — so a target that silently swallows it would leave a model reading nothing.
GG_ECMASCRIPT_TARGET="wasm32-wasip1"

# The `wasi_snapshot_preview1` REACTOR adapter that turns the preview1 core module `rustc` emits into
# the preview 2 component gg's engine instantiates.
#
# Pinned to the wasmtime release gg links, because the adapter and the runtime are two halves of one
# ABI. THE REACTOR adapter and not the command one: gg's world exports `run`, so the component has an
# entry point of gg's own and needs none of `wasi:cli/run`. This arm's OWN copy of a pin three other
# arms also carry, deliberately — bumping one arm's toolchain must not silently move another's ABI.
GG_ECMASCRIPT_ADAPTER_VERSION="45.0.3"

# Where the wasi-sdk this build needs lives.
#
# **It is the C++ arm's, and this is the one place in this repository where an arm reads another
# arm's toolchain pin.** The reason is that it is not being used as a *program* compiler here: no
# model's code goes near it. It is a C compiler and a wasi-libc, needed to build ONE dependency —
# quickjs, which `rquickjs-sys` compiles from source — into this guest. Installing a second whole
# 200 MB clang tree, on every developer machine and in the CI image, to compile 100k lines of C that
# a model never sees, would be a real cost bought for a symmetry nothing depends on. Nothing links
# across the two arms and nothing about their outputs meets, so a C++ toolchain bump moves the
# instruction selection inside `libquickjs.a` and reaches nothing else.
#
# `cpp-version.sh` is therefore in this arm's rerun set, and `gg_wasi_sdk_home` below is its function.
# shellcheck source=packages/gg-sandbox-cpp/cpp-version.sh
source "$GG_ECMASCRIPT_ROOT/packages/gg-sandbox-cpp/cpp-version.sh"

# The `rquickjs` release, read out of the guest's own lockfile rather than written down twice.
#
# It decides which JavaScript engine a program on these arms runs on, which is a study parameter and
# not an implementation detail — the same argument the incumbent's `COMPONENTIZE_VERSION` makes. The
# lockfile is the copy that says what is actually compiled, so it is the copy that is read.
GG_ECMASCRIPT_RQUICKJS_VERSION="$(
	awk '/^name = "rquickjs"$/ { found = 1; next }
	     found && /^version = / { gsub(/[",]/, "", $3); print $3; exit }' \
		"$GG_ECMASCRIPT_ROOT/packages/gg-sandbox/guest/Cargo.lock"
)"
if [ -z "$GG_ECMASCRIPT_RQUICKJS_VERSION" ]; then
	echo "error: could not read the resolved rquickjs version out of" >&2
	echo "       packages/gg-sandbox/guest/Cargo.lock." >&2
	exit 1
fi

export GG_ECMASCRIPT_RUST_VERSION GG_ECMASCRIPT_TARGET GG_ECMASCRIPT_ADAPTER_VERSION
export GG_ECMASCRIPT_RQUICKJS_VERSION

# Where the pinned reactor adapter is published, from this file's own pin.
gg_ecmascript_adapter_url() {
	echo "https://github.com/bytecodealliance/wasmtime/releases/download/v${GG_ECMASCRIPT_ADAPTER_VERSION}/wasi_snapshot_preview1.reactor.wasm"
}

# **The two flags that replace a fork of quickjs**, and the measurement behind them.
#
# quickjs-ng disables its own stack-overflow check under `__wasi__`: `quickjs.c` sets
# `rt->stack_size = 0` in `JS_NewRuntime` and short-circuits `update_stack_limit` to "no limit". With
# that in force a runaway recursion in a model's program runs the *host's* wasm stack out instead,
# and the store dies with `wasm trap: call stack exhausted` — a resource fault naming nothing the
# model can act on, where a `RangeError` with the JavaScript frames was available.
#
# The obvious answer is to vendor a patched `rquickjs-sys`: two hunks, 5.9 MB of C in the repository,
# and a merge burden on every quickjs bump. `-U__wasi__` is those same two hunks with none of that.
# It is safe, and it is checked rather than assumed: `__wasi__` appears SIX times across the four
# translation units this build compiles (`quickjs.c` 75, 2015, 2761; `cutils.h` 64, 618, 663), and
# `rquickjs-sys`'s own `build.rs` already defines `EMSCRIPTEN=1` for this target — which decides four
# of the six identically either way. The two it does not decide are exactly the two the fork patches.
#
# `AR` is the second flag and is unrelated: the wasi-sdk tree
# `scripts/ci/install-wasi-sdk.sh` installs is pruned to the two binaries the C++ arm's turn path
# runs, and an archiver is not one of them. `cc-rs` needs one to build `libquickjs.a`, so this build
# names the system's — which is `binutils`, a package both the devcontainer and the CI image already
# install for other reasons, and which `build.sh` checks for by name.
gg_ecmascript_cflags() {
	echo "--sysroot=$(gg_wasi_sdk_home)/share/wasi-sysroot -U__wasi__"
}
