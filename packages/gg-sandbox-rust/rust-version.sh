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
# `wasm32-unknown-unknown` and deliberately not `wasm32-wasip2`, even though the artifact is a
# component and components are what wasip2 emits. The choice is about IMPORTS: a wasip2 module
# imports `wasi:cli`, `wasi:io` and the rest whether or not the program touches them, because the
# target's own start-up does, and those imports would then have to be satisfied for every program.
# gg does link the whole WASI surface (see `sandbox::linker`), so that would work — but it would
# also mean the target, rather than the language, decided that a Rust program starts by
# initialising a WASI environment. `wasm32-unknown-unknown` imports nothing at all beyond what the
# program's own bindings declare, which is the honest shape for an arm whose artifact is the
# program.
GG_RUST_TARGET="wasm32-unknown-unknown"

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

export GG_RUST_VERSION GG_RUST_TARGET GG_WIT_BINDGEN_VERSION
