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
set -euo pipefail
# shellcheck source=scripts/ci/tcab-lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tcab-lib.sh"
# shellcheck source=scripts/ci/cargo-lock.sh
source "$REPO_ROOT/scripts/ci/cargo-lock.sh"
# `--locked` only where no patch table shapes the build: inside the superrepo cargo writes the lock's
# `[[patch.unused]]` block in an order that is not stable between runs (scripts/ci/cargo-lock.sh).
mapfile -t locked < <(cargo_locked_args .)

case "${1:-}" in
	"")
		log "cargo build --all-targets"
		cargo build ${locked[@]+"${locked[@]}"} --workspace --all-targets
		;;
	--seed)
		status=0
		log "cargo clippy (the rust-clippy gate's command)"
		cargo clippy ${locked[@]+"${locked[@]}"} --workspace --all-targets -- -D warnings || status=1
		log "cargo doc (the rust-doc gate's command)"
		cargo doc ${locked[@]+"${locked[@]}"} --workspace --no-deps || status=1
		log "cargo nextest list (builds what the rust-test gate runs)"
		cargo nextest list ${locked[@]+"${locked[@]}"} --workspace >/dev/null || status=1
		exit "$status"
		;;
	*)
		echo "usage: scripts/ci/rust-build.sh [--seed]" >&2
		exit 2
		;;
esac
