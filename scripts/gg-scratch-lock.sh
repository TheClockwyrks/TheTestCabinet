# shellcheck shell=bash
#
# Serialise the two entry points that share one arm's scratch directory. Sourced, never executed.
#
#   gg_lock_scratch <package-dir>     # blocks until this process owns that arm's working tree
#
# WHAT THE PROBLEM ACTUALLY IS, because it is not the obvious one. Every arm's build and every arm's
# reflection use a FIXED scratch path inside the source tree — `packages/gg-sandbox-swift/.build`,
# `packages/gg-sandbox-rust/src/bindings.rs`, `packages/gg-sandbox/dist` — rather than a `mktemp -d`
# or the caller's `OUT_DIR`. That was correct and deliberate while these were a developer's
# occasional command: the scratch is a CACHE (vendored sources, a resolved package set, a wit-bindgen
# emit) and throwing it away between runs would make every build cost what a cold one costs.
#
# Moving the artifacts into the build made the destination per-invocation and left the workspace
# shared, and one cargo process is not the only thing that runs these. Cargo serialises the callers
# WITHIN one invocation — an arm's artifact crate builds strictly before `crates/gg`'s reflection —
# but two cargo processes with two target directories do not serialise with each other at all, and
# this repository routinely has two: rust-analyzer's flycheck against a terminal `cargo build`,
# `cargo clippy` against `cargo nextest`, or either of those against the by-hand
# `scripts/gg-artifacts.sh` that `scripts/gg-artifacts.sh`'s own header tells a person to run.
#
# The scripts `rm -rf` inside that shared tree, so the outcome is not merely a failed build. Measured,
# two concurrent runs of the Swift arm into two different `GG_ARTIFACTS_OUT_DIR`s: one exited 0 and
# the other died with `unable to open output file 'sandbox.o'`. The completeness check at the foot of
# every build asserts that each promised file is present and non-empty, which a tarball packed from a
# directory another process was halfway through deleting would satisfy — so the failure available
# here is an artifact that is *there*, *non-empty* and *wrong*, embedded in gg and discovered inside
# somebody's run. That is precisely the class of defect generating the artifacts was meant to end,
# and it would have been reintroduced one level down.
#
# WHY A LOCK RATHER THAN A PER-INVOCATION WORKSPACE. Because the caches are the point. Deriving each
# arm's scratch from `$GG_ARTIFACTS_OUT_DIR` would make every cargo `OUT_DIR` its own cold build:
# re-vendoring three Swift packages, re-resolving the PureScript package set and re-running
# `wit-bindgen` for four arms, on every fresh target directory. The two caches that genuinely must
# outlive a checkout have been moved OUT of the tree instead (`scripts/gg-downloads.sh` resolves the
# Swift library sources and Spago's store into the same version-stamped per-user prefix every other
# pinned download uses), and what is left inside the tree is scratch that is cheap to hold a lock
# over.
#
# WHAT IS LOCKED is the PACKAGE DIRECTORY itself, by opening it and taking an exclusive `flock` on
# that descriptor. A directory rather than a lockfile of our own invention, because a lockfile is a
# file that has to be created, gitignored and cleaned up, and three of these packages have no
# `.gitignore` at all — the directory is already there, is already exactly "this arm", and needs no
# permission to open. The lock lives as long as the shell that took it and the kernel drops it when
# that shell exits, including on a `kill -9`, which is the property a lockfile does not have.
#
# RE-ENTRANT ACROSS A PROCESS TREE, and it has to be: `build.sh` and `signatures.sh` both invoke
# `bindings.sh`, which takes the same lock so that running it BY HAND is safe too. A second `open` +
# `flock` on a lock the parent already holds is a deadlock rather than a no-op, so the arms already
# held are carried in an exported variable and a repeat is skipped.
#
# WITHOUT `flock` — a mac, or a stripped container — this degrades to no locking rather than to a
# failed build. `flock` is util-linux and every image that builds gg has it; a developer machine that
# does not is a machine running one build at a time, which is the case the lock was never for.

# Take (or notice we already hold) the exclusive lock on one arm's working tree.
gg_lock_scratch() {
	local dir="$1" resolved

	if [ ! -d "$dir" ]; then
		echo "error: gg_lock_scratch was given $dir, which is not a directory." >&2
		echo "       It takes the guest package's own directory — the thing whose scratch is" >&2
		echo "       being protected — and every caller passes its own \$HERE." >&2
		return 1
	fi
	# Absolute, so that the "already held" test compares one spelling of a path rather than the
	# assortment of relative ones the callers happen to have.
	resolved="$(cd "$dir" && pwd)"

	case ":${GG_SCRATCH_LOCKS_HELD:-}:" in
	*":$resolved:"*) return 0 ;;
	esac

	if ! command -v flock >/dev/null 2>&1; then
		return 0
	fi

	# A dynamically allocated descriptor, so that a caller which happens to use a fixed one of its
	# own cannot collide with this — and so that two arms locked by one process (nothing does that
	# today, and the by-hand orchestrators could) each keep their own.
	local fd
	exec {fd}<"$resolved"
	flock -x "$fd"
	export GG_SCRATCH_LOCKS_HELD="${GG_SCRATCH_LOCKS_HELD:+$GG_SCRATCH_LOCKS_HELD:}$resolved"
}
