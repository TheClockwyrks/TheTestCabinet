#!/usr/bin/env bash
# Install the pinned `wit-bindgen` CLI, once, where every arm that needs it looks.
#
# WHO NEEDS IT. Four of gg's arms — Rust, Swift, C++ and C# — generate their guest bindings from
# `crates/gg/wit` with this executable, because none of them can be given the wire any other way: the
# Rust arm cannot use the `generate!` macro (it leaves a proc-macro dependency in the rlib metadata,
# which no other architecture can load) and the other three have no generator of their own language
# at all, so all three take the C generator and reach it through `extern "C"` or a bridging header.
#
# WHY IT IS INSTALLED RATHER THAN FETCHED BY THE ARM THAT WANTS IT. Until this script existed, each
# of the four `bindings.sh` fetched its own copy into its own package's `.build/`, guarded by nothing
# but "is the version-stamped directory already there". Three copies of one 20 MB executable, and —
# far worse — a GitHub release download reachable from inside `cargo build`, because a signature
# reflection calls `bindings.sh` on every build of `test-cabinet-gg`. `scripts/gg-signatures.sh`'s
# header used to admit exactly that. One pinned copy, installed by the same script that installs the
# other eleven toolchains, retires it: three fetches become zero, three copies become one.
#
# THE PIN IS THE ARMS', NOT THIS SCRIPT'S. Every one of the four `*-version.sh` files spells
# `GG_WIT_BINDGEN_VERSION`, and all four say the same thing in their own words: they all read the
# same `crates/gg/wit`, and two generators of different vintages reading it would be two chances for
# the wire to be described differently. This script therefore reads them ALL and refuses to install
# anything if they disagree — which is what makes one shared copy honest while four pins remain.
#
# The Rust arm's answer is not a literal, and the difference matters when reconciling a
# disagreement. Its rlibs LINK the `wit-bindgen` runtime crate, so `rust-version.sh` reads the
# version cargo resolved into `packages/gg-sandbox-rust/Cargo.lock` — the generator emitting calls
# into a runtime of another vintage is that arm's real hazard, and the lock is the only file that
# knows which runtime is actually linked. Reconcile that one with `cargo update -p wit-bindgen` in
# that package rather than by editing a version file that no longer states it.
#
# Idempotent: a matching version already installed is left alone, and the resolution the arms
# actually use lives in `scripts/gg-downloads.sh`, which this only warms.
#
# Usage:
#   scripts/ci/install-wit-bindgen.sh
#   GG_WIT_BINDGEN_INSTALL_DIR=/opt/gg/toolchains scripts/ci/install-wit-bindgen.sh
set -euo pipefail
# shellcheck source=scripts/ci/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

# Read the pin out of every arm that has one, in a subshell each, because these files `export` a
# common variable name and sourcing them in sequence would leave only the last one's value.
pins=""
for version_file in \
	packages/gg-sandbox-rust/rust-version.sh \
	packages/gg-sandbox-swift/swift-version.sh \
	packages/gg-sandbox-cpp/cpp-version.sh; do
	pin="$(
		# shellcheck source=/dev/null
		source "$REPO_ROOT/$version_file"
		echo "$GG_WIT_BINDGEN_VERSION"
	)"
	if [ -z "$pin" ]; then
		echo "error: $version_file does not set GG_WIT_BINDGEN_VERSION." >&2
		exit 1
	fi
	pins="$pins$version_file=$pin"$'\n'
done

# `packages/gg-sandbox-csharp/csharp-version.sh` is deliberately not in the list above: it sources
# the C++ arm's file for the wasi-sdk pin and inherits `GG_WIT_BINDGEN_VERSION` with it, so reading
# it would be reading the C++ arm's answer twice and calling it agreement.

distinct="$(echo "$pins" | cut -d= -f2 | sort -u | grep -c .)"
if [ "$distinct" -ne 1 ]; then
	echo "error: gg's arms pin different wit-bindgen releases:" >&2
	echo "$pins" >&2
	echo "       They all generate their bindings from the one crates/gg/wit, so two generators of" >&2
	echo "       different vintages would be two chances for the wire to be described differently." >&2
	echo "       Reconcile the pins before installing a shared copy of either." >&2
	exit 1
fi
VERSION="$(echo "$pins" | head -1 | cut -d= -f2)"

# shellcheck source=scripts/gg-downloads.sh
source "$REPO_ROOT/scripts/gg-downloads.sh"

BINARY="$(gg_wit_bindgen "$VERSION")"
echo "wit-bindgen $VERSION at $BINARY"
"$BINARY" --version
