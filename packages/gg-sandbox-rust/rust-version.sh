#!/usr/bin/env bash
# The pins the **Rust** program language's toolchain is built and run against.
#
# Sourced by `bindings.sh`, `build.sh` and `signatures.sh`, by
# `containers/gg-toolchains/Dockerfile` and by `scripts/ci/install-rust-wasm.sh`, so there is one
# list rather than five.
#
# WHY THE COMPILER VERSION IS NOT PINNED HERE. It is `rust-toolchain.toml`'s, read out of
# that file below, and that is the whole point: this arm ships **compiled rlibs** inside
# gg's binary, and an rlib is a compiler-version-private format — `rustc` refuses one built
# by any other release outright ("found crate ... compiled by an incompatible version"). So
# the compiler that builds the library set and the compiler that compiles a model's program
# against it must be the same release, and the cheapest way to guarantee that is to have
# only one release in the repository at all. Every checkout, every CI job and every gg run
# image therefore uses the compiler `rust-toolchain.toml` names.
#
# What that costs, stated plainly: bumping `rust-toolchain.toml` invalidates the library set,
# and it is re-cut before anything can link against it. This file is in the rerun set of
# `crates/gg-sandbox-artifacts/rust`, so a bump re-runs `packages/gg-sandbox-rust/build.sh`
# on the next `cargo build`; and that script refuses to produce a single rlib if the `rustc`
# on `PATH` is not the pinned one, so a machine whose toolchain and pin disagree fails there,
# by name, rather than three weeks later in a run container. That used to be asserted from
# the other end, by a test comparing the compiler recorded in `rust.toolchain.json` against
# the machine's; there is no longer an interval in which the two can differ.
set -euo pipefail

RUST_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# The compiler every checkout builds with — the single source of truth for this arm too.
GG_RUST_VERSION="$(sed -n 's/^channel = "\(.*\)"$/\1/p' "$RUST_ROOT/rust-toolchain.toml")"
if [ -z "$GG_RUST_VERSION" ]; then
	echo "error: could not read [toolchain] channel out of rust-toolchain.toml" >&2
	exit 1
fi

# The target a model's program is compiled to.
#
# `wasm32-wasip1`, and the WASI surface is the POINT rather than a side effect this target drags in.
# It used to be `wasm32-unknown-unknown`, argued for here on the grounds that it imports nothing
# beyond what the program's own bindings declare. That argument was answered by measurement, and the
# measurement is in `gg-runtime-failure-audit.md` and `gg-whole-programs-decisions.md`: a program
# compiled to `wasm32-unknown-unknown` HAS NO STANDARD ERROR. It is not that gg does not wire one —
# `membrane.rs` wires the guest's stderr and every other arm speaks to it — it is that std itself
# has nothing to speak with. `library/std/src/sys/stdio/mod.rs` matches no arm of its `cfg_select!`
# for that target and falls through to `unsupported.rs`, where `write` DISCARDS the bytes and
# reports success and `panic_output()` is a hard-coded `None`.
#
# What that cost was two of the five ways a program can fail. A `main` returning `Err` produced a
# clean turn with the message simply gone, and a `std::process::exit(1)` produced a bare trap with
# no status and no words. The only way to report either was for gg to INTERCEPT it — a panic hook,
# a catch chain — which the invariants forbid: what a model reads must be what its language emitted.
#
# On `wasm32-wasip1` the requirement is satisfied with nothing intercepted at all. A panic writes
#
#     thread 'main' (1) panicked at program.rs:6:5:
#
# to a real fd 2, in the model's own file and its own uncorrected coordinates, and gg keeps it; a
# `main` returning `Err` writes `Error: …` through std's own `Termination`; and an explicit exit
# arrives as `I32Exit`, so gg can name the status the program chose. The imports the target adds are
# satisfied by `sandbox::linker`, which links the whole WASI surface for the C++ and Swift arms
# already.
#
# NOT `wasm32-wasip2`, which emits a component directly: that would link through a
# `wasm-component-ld` bundling a different `wasm-encoder` from the `wit-component` gg links, so the
# component a run instantiates would be produced by a toolchain gg does not version. The p1 core
# module is encoded in gg's own process instead, with the adapter below — which is exactly what the
# C++ and Swift arms do.
GG_RUST_TARGET="wasm32-wasip1"

# The `wasi_snapshot_preview1` REACTOR adapter that turns the preview1 core module `rustc` emits
# into a preview 2 component.
#
# Pinned to the wasmtime release gg links, because the adapter and the runtime are two halves of one
# ABI. `build.sh` resolves it through `scripts/gg-downloads.sh` — an override, the toolchain image, a
# version-stamped per-user cache the installers warm, and only then a download — and copies it into
# this arm's artifact directory as `rust.adapter.wasm`, 52 KB, which gg `include_bytes!`s.
#
# THE REACTOR ADAPTER, although a binary crate is what a command component is made of. gg's world is
# `crates/gg/wit/gg-sandbox.wit`, whose export is `run` — this crate's `program::Program` answers it
# and calls the model's `main` itself — so the component has an entry point of gg's own and needs
# none of `wasi:cli/run`. That is what keeps this arm on the same host invocation path as the other
# ten, and it means the module's own `_start` is simply unused.
#
# The alternative would be a plain `wasi:cli/run` command component, which needs a COMMAND adapter
# pinned beside this one — and whose failure mode is silent: the reactor adapter encodes a module
# relying on `wasi:cli/run` without error and quietly yields a component with no entry point at all.
# One pin, already carried twice in this repository, is the cheaper and louder arrangement.
#
# It is this arm's OWN copy of a file the C++ and Swift arms also carry, and that duplication is
# deliberate on the same terms theirs is: each arm pins its adapter from its own version file, so
# bumping one arm's toolchain cannot silently move another arm's ABI.
GG_WASMTIME_ADAPTER_VERSION="45.0.3"

# The `wit-bindgen` release the guest bindings are generated with.
#
# A CLI rather than the `wit_bindgen::generate!` macro, and that is not a preference: the macro
# leaves a dependency on the `wit-bindgen-rust-macro` PROC MACRO in the rlib's metadata, and a
# proc macro is a HOST dynamic library. `rustc` then refuses to load the library set unless that
# `.so` is beside it, which would mean shipping one build of the set per host architecture
# (measured: `E0463: can't find crate for wit_bindgen_rust_macro which gg depends on`). Generating
# the bindings ahead of time leaves the set depending on nothing but the `wit-bindgen` runtime
# crate, which is ordinary Rust and architecture-free.
#
# READ OUT OF `Cargo.lock` RATHER THAN PINNED HERE, and this arm is the one where that is not a
# tidiness argument. Unlike the Swift, C++ and C# arms — which take the C generator and reach it
# through a header, so nothing of `wit-bindgen`'s is linked into them — this arm's rlibs LINK the
# `wit-bindgen` runtime crate, resolved by cargo from `Cargo.toml`'s `wit-bindgen = "0.60"` and
# recorded exactly in `Cargo.lock`. The generated `src/bindings.rs` and that runtime are two halves
# of one release: the generator emits calls into `wit_bindgen::rt`, whose shape is not stable
# across releases. So the CLI version was written down twice — a caret requirement cargo resolves,
# and an exact release this file handed to the downloader — with nothing comparing them, and the
# failure of a disagreement lands as an unresolved symbol or a silently different canonical ABI in
# a wasm module, several layers from either file. The lock is the copy that says what is actually
# linked, so it is the copy that decides which generator emits against it.
#
# Bumping the pin is therefore `cargo update -p wit-bindgen` in this package (or editing the
# requirement in `Cargo.toml`), and everything else follows.
GG_WIT_BINDGEN_VERSION="$(
	awk '/^name = "wit-bindgen"$/ { found = 1; next }
	     found && /^version = / { gsub(/[",]/, "", $3); print $3; exit }' \
		"$RUST_ROOT/packages/gg-sandbox-rust/Cargo.lock"
)"
if [ -z "$GG_WIT_BINDGEN_VERSION" ]; then
	echo "error: could not read the resolved wit-bindgen version out of" >&2
	echo "       packages/gg-sandbox-rust/Cargo.lock. That lock records the runtime crate this" >&2
	echo "       arm's rlibs link, and the generator has to be the same release." >&2
	exit 1
fi

export GG_RUST_VERSION GG_RUST_TARGET GG_WIT_BINDGEN_VERSION GG_WASMTIME_ADAPTER_VERSION

# Where the pinned reactor adapter is published. The same release asset the C++ and Swift arms
# resolve, named from this file's own pin.
gg_wasmtime_adapter_url() {
	echo "https://github.com/bytecodealliance/wasmtime/releases/download/v${GG_WASMTIME_ADAPTER_VERSION}/wasi_snapshot_preview1.reactor.wasm"
}
