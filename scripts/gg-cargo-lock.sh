# shellcheck shell=bash
#
# Cargo's lock file under the superrepo's patch table. Sourced, never executed.
#
# Named into the `scripts/gg-*.sh` family because gg's build shell is where it is load-bearing: the
# ECMAScript guest and the Rust arm's library set build their own locks inside an ordinary `cargo
# build`, and the images that build gg take that family as a whole. The project's CI scripts that
# run cargo over the workspace source it too.
#
#   cargo_locked_args <dir>                    # prints `--locked`, or nothing under a patch table
#   cargo_keeping_lock_order <lock> <cmd>...   # runs <cmd>, then puts back a lock it only reordered
#
# The superrepo's `.cargo/config.toml` carries a `[patch]` table per checked-out repository. Every
# Cargo workspace beneath it — the root one and the ones nested under `packages/` — records each
# patch its graph does not use under `[[patch.unused]]`, and cargo writes that block grouped by
# patched source in an order that is NOT stable between runs once more than one table is active. So
# `--locked` refuses, at random, whichever order it did not happen to produce. The repository kit's
# rule (`templates/repository/ci/src/the_test_cabinet_ci/lockfile.py`) is the one followed here: a
# build under a patch table runs without `--locked`, and the `dependency-graph` gate is what holds
# each lock to the checkouts, its unused patches compared as a set. `ci/src/the_test_cabinet_ci/
# lockfile.py` is the Python half of this file.
#
# Without `--locked` a build may write the lock back in the other order. That is noise to a working
# tree, but not to gg's artifact builds: a nested lock is a declared input of its arm's artifact crate
# (`crates/gg-sandbox-artifacts/build-support`), so a build that rewrote it would invalidate itself.
# `cargo_keeping_lock_order` puts such a lock back, bytes and modification time, when the rewrite
# changed nothing but the order of its lines. Cargo writes everything but the unused block in a
# stable order, so "the same lines, sorted" is "the same resolution, reordered".

# `--locked` unless a `[patch]` table in a `.cargo/config.toml` of <dir> or any parent shapes the
# build there, as cargo reads them. `CARGO_HOME`'s configuration is read too. A <dir> that does not
# exist yet is judged from its nearest existing parent.
cargo_locked_args() {
	local dir="${1:-.}" config
	while [ ! -d "$dir" ]; do
		dir="$(dirname "$dir")"
	done
	dir="$(cd "$dir" && pwd)"
	while :; do
		for config in "$dir/.cargo/config.toml" "$dir/.cargo/config"; do
			if [ -f "$config" ] && grep -qE '^[[:space:]]*\[patch[].]' "$config"; then
				return 0
			fi
		done
		[ "$dir" = / ] && break
		dir="$(dirname "$dir")"
	done
	for config in "${CARGO_HOME:-$HOME/.cargo}/config.toml" "${CARGO_HOME:-$HOME/.cargo}/config"; do
		if [ -f "$config" ] && grep -qE '^[[:space:]]*\[patch[].]' "$config"; then
			return 0
		fi
	done
	printf '%s\n' --locked
}

# Run <cmd>, and put <lock> back as it was when all <cmd> did to it was reorder its lines. Returns
# <cmd>'s status.
cargo_keeping_lock_order() {
	local lock="$1" backup status=0
	shift
	if [ ! -f "$lock" ]; then
		"$@"
		return
	fi
	backup="$(mktemp)"
	cp -p "$lock" "$backup"
	"$@" || status=$?
	if [ -f "$lock" ] && ! cmp -s "$lock" "$backup" &&
		cmp -s <(LC_ALL=C sort "$lock") <(LC_ALL=C sort "$backup"); then
		cp -p "$backup" "$lock"
	fi
	rm -f "$backup"
	return "$status"
}
