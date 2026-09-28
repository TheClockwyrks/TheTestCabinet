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
# test binaries. `--all-targets` takes the test binaries in too, except gg's,
# whose `test = false` (crates/gg/Cargo.toml) leaves them to the gg_tests jobs.
#
# THE SEED warms the template's `rust` job. That job restores `target/` from
# its cache and saves it only when every one of its steps succeeded, so a cold
# run that outlasts its 60 minutes never warms itself. The pipeline runs this
# when no seed is cached for the Cargo.lock yet, in the same image, with the
# same job variables and at the same path, and caches the result under a key
# that job's restore key matches. So it runs the template gates' own commands
# (ci/gates/rust-clippy.py, rust-doc.py, rust-test.py), and each runs whether
# or not the one before it passed: a seed is worth having even when a lint
# fails. `cargo nextest list` builds exactly what `cargo nextest run` would.
# .cargo/config.toml's rustdoc flag reaches the doc build here and in the gate
# alike.
#
# Building crates/gg needs gg's program-language toolchains and the npm
# workspace installed: `crates/gg/build.rs` reflects each arm's signature
# catalogue out of that arm's own SDK. scripts/ci/gg-ci-toolchains.sh and
# scripts/ci/npm-install.sh provide them first.
set -euo pipefail
# shellcheck source=scripts/ci/tcab-lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tcab-lib.sh"

case "${1:-}" in
	"")
		log "cargo build --all-targets"
		cargo build --locked --workspace --all-targets
		;;
	--seed)
		status=0
		log "cargo clippy (the rust-clippy gate's command)"
		cargo clippy --locked --workspace --all-targets -- -D warnings || status=1
		log "cargo doc (the rust-doc gate's command)"
		cargo doc --locked --workspace --no-deps || status=1
		log "cargo nextest list (builds what the rust-test gate runs)"
		cargo nextest list --locked --workspace >/dev/null || status=1
		exit "$status"
		;;
	*)
		echo "usage: scripts/ci/rust-build.sh [--seed]" >&2
		exit 2
		;;
esac
