#!/usr/bin/env bash
# Builds every Rust target in the workspace, and with --seed also builds what
# the template's `rust` job compiles: the Build and Seed steps of the pipeline's
# `rust_build` job (.azure/project/jobs.yml).
#
#   scripts/ci/rust-build.sh          # link every crate, binary and test binary
#   scripts/ci/rust-build.sh --seed   # clippy, rustdoc and the test build, as the gates run them
#
# THE BUILD is the only check anywhere that links every target of the
# workspace: clippy and rustdoc stop at metadata, and nextest links only the
# test binaries. `--all-targets` takes the test binaries in too.
#
# THE SEED warms the template's `rust` job. That job restores `target/` from
# its cache and saves it only when every one of its steps succeeded, so a cold
# run that outlasts its timeout never warms itself. The pipeline runs this
# when no seed is cached for the Cargo.lock yet, in the same image, with the
# same job variables and at the same path, and caches the result under a key
# that job's restore key matches. So it runs the template gates' own commands
# (ci/gates/rust-clippy.py, rust-doc.py, rust-test.py), and each runs whether
# or not the one before it passed: a seed is worth having even when a lint
# fails. `cargo nextest list` builds exactly what `cargo nextest run` would.
# .cargo/config.toml's rustdoc flag reaches the doc build here and in the gate
# alike.
#
# THE LOCK stays as committed. Both jobs' build-output cache keys hash
# Cargo.lock, and Cache@2 resolves the key once at the restore and again at the
# save: a lock the build rewrote is a different key, and the save is refused.
# Under the superrepo's patch table cargo rewrites the lock's
# `[[patch.unused]]` block in a different order on each run
# (scripts/ci/cargo-lock.sh), so every cargo command runs through
# `cargo_keeping_lock_order`, which puts a merely reordered lock back, bytes and
# modification time. A lock that changed in more than order is a resolution
# the commit did not record: the step fails and names it, since that is the
# dependency-graph gate's finding and not the cache's.
set -euo pipefail
# shellcheck source=scripts/ci/tcab-lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tcab-lib.sh"
# shellcheck source=scripts/ci/cargo-lock.sh
source "$REPO_ROOT/scripts/ci/cargo-lock.sh"
# `--locked` only where no patch table shapes the build: inside the superrepo cargo writes the lock's
# `[[patch.unused]]` block in an order that is not stable between runs (scripts/ci/cargo-lock.sh).
mapfile -t locked < <(cargo_locked_args .)

lock="$REPO_ROOT/Cargo.lock"
committed="$(mktemp)"
trap 'rm -f "$committed"' EXIT
have_lock=0
if [ -f "$lock" ]; then
	cp -p "$lock" "$committed"
	have_lock=1
fi

# cargo <args>, putting back a lock it only reordered.
run_cargo() {
	cargo_keeping_lock_order "$lock" cargo "$@"
}

# Succeeds when the lock is byte for byte the one the step started from;
# otherwise says how it differs (sorted, so order is not the difference) and fails.
lock_kept() {
	[ "$have_lock" = 1 ] || return 0
	if [ -f "$lock" ] && cmp -s "$lock" "$committed"; then
		return 0
	fi
	{
		echo "error: cargo changed Cargo.lock in more than the order of its lines."
		echo "The committed lock does not record the resolution this build made, and the"
		echo "build-output cache key (which hashes Cargo.lock) would no longer match at the save."
		echo "Run the dependency-graph gate (uv run --project ci gate run dependency-graph)"
		echo "and commit the lock it settles on. The lines that differ, sorted (- committed, + now):"
		if [ -f "$lock" ]; then
			diff <(LC_ALL=C sort "$committed") <(LC_ALL=C sort "$lock") | grep -E '^[<>]' |
				sed -e 's/^< /-/' -e 's/^> /+/' | head -n 40
		else
			echo "  (Cargo.lock was removed)"
		fi
	} >&2
	return 1
}

case "${1:-}" in
	"")
		status=0
		log "cargo build --all-targets"
		run_cargo build ${locked[@]+"${locked[@]}"} --workspace --all-targets || status=$?
		lock_kept || [ "$status" -ne 0 ] || status=1
		exit "$status"
		;;
	--seed)
		status=0
		log "cargo clippy (the rust-clippy gate's command)"
		run_cargo clippy ${locked[@]+"${locked[@]}"} --workspace --all-targets -- -D warnings || status=1
		log "cargo doc (the rust-doc gate's command)"
		run_cargo doc ${locked[@]+"${locked[@]}"} --workspace --no-deps || status=1
		log "cargo nextest list (builds what the rust-test gate runs)"
		run_cargo nextest list ${locked[@]+"${locked[@]}"} --workspace >/dev/null || status=1
		lock_kept || status=1
		exit "$status"
		;;
	*)
		echo "usage: scripts/ci/rust-build.sh [--seed]" >&2
		exit 2
		;;
esac
