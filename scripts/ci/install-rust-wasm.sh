#!/usr/bin/env bash
# Install the target gg's **Rust** program language compiles a model's program to, so a machine
# running gg's test suite can do what a gg run container does
# (containers/gg-toolchains/Dockerfile).
#
# WHY THIS EXISTS, when the compiler itself does not need installing. This arm is the one whose
# compiler a checkout already has: `rustc` is what builds this repository, and
# packages/gg-sandbox-rust deliberately has no compiler pin of its own because an `.rlib` is a
# compiler-version-private format — the committed library set and the compiler that reads it must
# be the same release, and the cheapest way to guarantee that is to have exactly one Rust release
# in the repository. What a checkout does NOT necessarily have is the `wasm32-unknown-unknown`
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

if rustc --print target-libdir --target "$GG_RUST_TARGET" >/dev/null 2>&1; then
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
rustc --print target-libdir --target "$GG_RUST_TARGET" >/dev/null
