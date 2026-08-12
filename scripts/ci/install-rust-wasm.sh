#!/usr/bin/env bash
# Install the target gg's **Rust** program language compiles a model's program to, so a machine
# running gg's test suite can do what a gg run container does
# (containers/gg-toolchains/Dockerfile).
#
# WHY THIS EXISTS, when the compiler itself does not need installing. This arm is the one whose
# compiler a checkout already has: `rustc` is what builds this repository, and
# packages/gg-sandbox-rust deliberately has no compiler pin of its own because an `.rlib` is a
# compiler-version-private format — the compiled library set and the compiler that reads it must
# be the same release, and the cheapest way to guarantee that is to have exactly one Rust release
# in the repository, which `rust-toolchain.toml` names and this arm's artifact crate rebuilds
# against. What a checkout does NOT necessarily have is the `wasm32-unknown-unknown`
# STANDARD LIBRARY, which is a separate rustup component.
#
# WHY IT IS NOT `targets` IN rust-toolchain.toml, which would be one line and no script. A target
# named there is fetched on the first cargo invocation of every checkout — including inside
# `containers/tools` and the other `rust:<version>-bookworm` builder images, none of which
# cross-compile anything — so it would make several image builds network-dependent to serve one
# crate's tests. The other three compiled arms install explicitly for the same kind of reason, so
# this reads the same way they do.
#
# Idempotent: a target already installed is left alone, and a machine whose Rust is not managed by
# rustup is left alone too — it either already has the target (in which case nothing was needed) or
# fails in `rust.compile.test.rs` with a message naming this script.
#
# Usage:
#   scripts/ci/install-rust-wasm.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=packages/gg-sandbox-rust/rust-version.sh
source "$ROOT/packages/gg-sandbox-rust/rust-version.sh"

# WHETHER THE STANDARD LIBRARY IS THERE IS A QUESTION ABOUT THE DISK, NOT ABOUT rustc. `rustc
# --print target-libdir --target <triple>` COMPUTES a path from the target's name; it does not look
# for it. Measured in `docker.io/library/rust:1-bookworm`, an image that has exactly one target
# installed, it printed
# `/usr/local/rustup/toolchains/1.96.0-…/lib/rustlib/wasm32-unknown-unknown/lib` and exited 0 while
# that directory did not exist. Asking it as a yes/no question therefore answered "yes" everywhere,
# which made this script a no-op on precisely the machines that needed it — and the cost of that was
# paid several minutes later and one layer down, as `cargo rustdoc --target wasm32-unknown-unknown`
# failing to find `core` inside gg's build script. So look at the directory rustc names: rustup
# creates it when the component is installed and removes it when the component is removed, so its
# presence is the fact, and a rustc that is not managed by rustup answers this correctly too.
target_libdir() { rustc --print target-libdir --target "$GG_RUST_TARGET" 2>/dev/null; }

if [ -d "$(target_libdir)" ]; then
	echo "rustc already has the $GG_RUST_TARGET standard library"
	exit 0
fi

if ! command -v rustup >/dev/null 2>&1; then
	echo "error: the $GG_RUST_TARGET standard library is missing and rustup is not installed." >&2
	echo "       gg's Rust program-language arm compiles a model's program to that target." >&2
	exit 1
fi

echo "installing the $GG_RUST_TARGET standard library for rustc $GG_RUST_VERSION"
rustup target add --toolchain "$GG_RUST_VERSION" "$GG_RUST_TARGET"
# And confirm it landed where this checkout's rustc will look for it, which is not the same
# statement as "rustup exited 0": `--toolchain "$GG_RUST_VERSION"` names the release
# rust-toolchain.toml pins, and a machine whose active toolchain is some other one would have
# installed the component somewhere this repository never compiles against.
if [ ! -d "$(target_libdir)" ]; then
	echo "error: rustup installed $GG_RUST_TARGET for $GG_RUST_VERSION, but this checkout's rustc" >&2
	echo "       still finds no standard library at $(target_libdir)." >&2
	echo "       That means the active toolchain is not $GG_RUST_VERSION — check rust-toolchain.toml" >&2
	echo "       against \`rustup show\`." >&2
	exit 1
fi
