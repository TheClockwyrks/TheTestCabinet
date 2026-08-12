#!/usr/bin/env bash
#
# Build every gg program language's artifacts into one directory.
#
#   scripts/gg-artifacts.sh [OUT_DIR]        # default: target/gg-artifacts
#
# THE LIST OF ARMS IS `scripts/gg-arms.sh`, which this sources — the same table
# `scripts/gg-signatures.sh` reflects catalogues from. This script is that one's sibling: where it
# runs each package's `signatures.sh` to produce what a model is TOLD an arm offers, this runs each
# package's `build.sh` to produce what the model's program actually meets.
#
# WHAT AN ARTIFACT IS. Whatever a turn on that arm needs on disk and cannot fetch: a guest component
# with a whole language runtime baked into it, a compiled library set a program is linked or
# type-checked against, a compiler small enough to travel inside gg's own binary. gg is copied as a
# SINGLE FILE into an ephemeral run container, so everything the turn path needs is embedded in it
# with `include_bytes!`/`include_str!` — which is why these are files rather than an image layer, and
# why an arm's artifacts and the gg that describes them must be one vintage.
#
# WHO RUNS IT, AND WHY THERE ARE EXACTLY TWO ANSWERS — the same two `gg-signatures.sh` has, for the
# same reasons:
#
#   1. THE BUILD. Every arm has an artifact crate under `crates/gg-sandbox-artifacts/`, whose build
#      script runs that one arm's `build.sh` into its own `$OUT_DIR` and publishes the directory to
#      `crates/gg` through cargo's `links`/`DEP_*` channel; `crates/gg` embeds from there. NOTHING
#      any arm produces is committed — the set is complete, and `crates/gg/src/sandbox/guests/` does
#      not exist any more — so a build of gg cannot embed an artifact older than the sources in the
#      same checkout, and there is no drift to gate. See
#      `crates/gg-sandbox-artifacts/build-support`, which is the whole of that mechanism.
#
#      Note what that means for THIS script: the build does not run it. It runs the same per-arm
#      `build.sh` scripts, one crate each, which is what buys per-arm staleness and lets cargo run
#      them concurrently. This script is the whole-set entry point for the second caller.
#
#   2. A PERSON, by hand, to LOOK AT one — or to warm every arm before working offline, or to time
#      the set, or to hand a directory of artifacts to something outside the build. This is not a
#      fallback: an artifact is a binary nobody can review by reading, so being able to put the whole
#      set somewhere and open it is the only inspection available.
#
#          scripts/gg-artifacts.sh                  # -> target/gg-artifacts/
#          scripts/gg-artifacts.sh /tmp/artifacts   # -> anywhere else you like
#
# ONE DIRECTORY, FLAT, AND NO `guests/` OR `checkers/` UNDER IT. Those two directories were a filing
# convention for committed files, and every artifact in them is already named for the arm and the
# kind — `swift.guest.tar.gz`, `typescript.tsc.js`, `csharp.component.wasm`. With nothing committed
# there is nothing to file, and a flat directory is what makes the per-arm build scripts' one
# destination variable enough on its own.
#
# WHAT IT NEEDS. Every arm's build toolchain, which is a superset of what a reflection needs:
# `scripts/ci/install-gg-toolchains.sh` installs ten arms' worth, and the eleventh — C#, which needs
# a whole .NET SDK and an unpruned wasi-sdk to relink Mono — is `scripts/ci/install-gg-build-
# toolchains.sh`, kept separate so the run-toolchain list keeps its meaning and the run images stay
# their size. Each arm below checks its own toolchain and names it if it is missing.
#
# THE NETWORK IT WANTS, WHICH IS NONE, on a machine those two installers have run on. That is a
# requirement rather than an aspiration, because `crates/gg-sandbox-artifacts/*` runs these scripts
# inside an ordinary `cargo build`, and a build that reaches the internet halfway through is a build
# that fails on an aeroplane. Every fetch any of these scripts ever made is now resolved from a
# pinned, version-stamped prefix an installer warms: the wasmtime reactor adapter
# (`install-adapter.sh`), `wit-bindgen` (`install-wit-bindgen.sh`), the npm- and uv-delivered build
# tools, the Rust arm's own cargo registry closure, the Swift arm's three vendored source packages
# and Spago's package store (all four `install-gg-build-tools.sh`). What is left reaches a cache, not
# a registry.
#
# THE LAST TWO OF THOSE ARE WHY THIS PARAGRAPH IS WORTH RE-READING RATHER THAN TRUSTING. Both were
# cached before they were warmed, and both cached INSIDE the repository — the Swift sources in
# `packages/gg-sandbox-swift/.build/vendor`, Spago's store in `~/.cache` behind a stamp in
# `packages/gg-sandbox-purescript/.build`. On a developer's machine that is indistinguishable from
# provisioned. It is a `git clean` and a fresh CI checkout away from three GitHub fetches and two
# `git clone`s in the middle of `cargo build`, which is what it was doing. A cache is not a warm
# prefix unless something an operator RUNS puts it there.
set -euo pipefail

# Repo root, independent of the caller's working directory: every arm below is named relative to it,
# and several of them change directory on the way to their own toolchain.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# The arms. Sourced rather than restated — see `scripts/gg-arms.sh`.
# shellcheck source=scripts/gg-arms.sh
source "$ROOT/scripts/gg-arms.sh"

# The default lives under `target/`, which is already gitignored and already the directory this
# repository throws build output into — so a developer who runs this to look at an artifact does not
# have to think about cleaning up after it, and no arrangement of `git add` can commit one.
#
# The per-arm scripts have NO default at all, deliberately: see the note on `GG_ARTIFACTS_OUT_DIR` in
# any of them. A default there would let somebody who ran `packages/gg-sandbox-swift/build.sh` out of
# muscle memory re-create megabytes of deleted files as untracked ones inside `crates/gg/src`, which
# a `git add -A` would then re-commit — reinstating exactly the state this arrangement abolishes.
OUT_DIR="${1:-target/gg-artifacts}"
mkdir -p "$OUT_DIR"
# Absolute from here on. Several builds run from a package directory, a `mktemp -d` or a staging
# tree, and a relative destination would mean a different place in each.
OUT_DIR="$(cd "$OUT_DIR" && pwd)"
export GG_ARTIFACTS_OUT_DIR="$OUT_DIR"

# EMPTY THE DESTINATION FIRST, for the reason `gg-signatures.sh` empties its own: the check at the
# foot of this file is only a check if absence is real. The destination is not a scratch directory
# that starts empty — a person re-runs this into the same `target/gg-artifacts` every time — so on
# any machine that has run it once, the previous run's files are already sitting there, non-empty. An
# arm that exited 0 having written nothing, or having written under a name the host does not embed,
# would otherwise leave the last run's artifact in place and pass.
#
# Only the files this table promises are removed, never the directory and never anything else in it:
# a caller is entitled to point this at a directory of their own, and `rm -rf "$OUT_DIR"` on a path
# taken from `$1` is a footgun with a very long barrel.
for arm in "${GG_ARM_IDS[@]}"; do
	for artifact in ${GG_ARM_ARTIFACTS[$arm]}; do
		rm -f "$OUT_DIR/$artifact"
	done
done

# Build every arm, in the order `gg-arms.sh` declares them, saying which one before it starts: these
# are tens of seconds each and the Swift one is twenty on a fast machine.
#
# SEQUENTIAL, and that is this script rather than the build. Cargo runs the artifact crates' build
# scripts concurrently, which is most of why the arms get a crate each rather than one step of
# `crates/gg/build.rs` — a cold artifact build costs about what the slowest arm costs. Here the point
# is a readable log and a failure attributable to one arm, and a person running the whole set by hand
# is doing it once.
for arm in "${GG_ARM_IDS[@]}"; do
	script="${GG_ARM_PACKAGE[$arm]}/build.sh"
	echo "==> ${GG_ARM_LABEL[$arm]}"
	if [ ! -x "$ROOT/$script" ]; then
		echo "error: the $arm arm's row in scripts/gg-arms.sh names ${GG_ARM_PACKAGE[$arm]}," >&2
		echo "       and there is no executable $script there. Every arm's artifacts are built by" >&2
		echo "       exactly one script with exactly that name; there is no second producer." >&2
		exit 1
	fi
	if ! "$ROOT/$script"; then
		echo >&2
		echo "error: the ${GG_ARM_LABEL[$arm]} arm's artifact build failed ($script)." >&2
		echo "       If the message above names a missing toolchain, run" >&2
		echo "       scripts/ci/install-gg-toolchains.sh — or, for the csharp arm," >&2
		echo "       scripts/ci/install-gg-build-toolchains.sh — and try again." >&2
		exit 1
	fi
done

# Every artifact this script promises to have produced. Not a drift check — there is nothing to drift
# from — but a check that each arm did what its row says it does. An arm that exits 0 having written
# nothing, or having written under a name the host does not embed, would otherwise be discovered as
# an `include_bytes!` of a file that is not there, several layers from the thing that went wrong.
# Deliberately paranoid about emptiness as well as absence: a zero-byte guest component is the worst
# outcome available here, because it fails at instantiation inside somebody's run rather than here.
missing=0
for arm in "${GG_ARM_IDS[@]}"; do
	for artifact in ${GG_ARM_ARTIFACTS[$arm]}; do
		if [ ! -s "$OUT_DIR/$artifact" ]; then
			echo "error: $artifact is missing or empty in $OUT_DIR." >&2
			echo "       The $arm arm reported success, so this is its build.sh writing the wrong" >&2
			echo "       file rather than a toolchain that is not installed. Its row in" >&2
			echo "       scripts/gg-arms.sh is what says it should be there." >&2
			missing=$((missing + 1))
		fi
	done
done
((missing == 0)) || exit 1

echo
# By package rather than by arm, because those are different numbers here and saying "eleven" would
# be wrong: `packages/gg-sandbox` builds ONE component that serves both the TypeScript and the
# JavaScript arm, so there are eleven arms and ten sets of artifacts. `gg-signatures.sh` is where the
# other count lives, and it says eleven for the same reason.
echo "Wrote the artifacts of ${#GG_ARM_IDS[@]} guest packages to $OUT_DIR:"
for arm in "${GG_ARM_IDS[@]}"; do
	for artifact in ${GG_ARM_ARTIFACTS[$arm]}; do
		printf '  %-32s %10s bytes\n' "$artifact" "$(wc -c <"$OUT_DIR/$artifact")"
	done
done
