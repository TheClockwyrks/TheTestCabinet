#!/usr/bin/env bash
# Runs rustdoc over the whole workspace with warnings denied. This is what
# catches broken intra-doc links: the workspace denies `warnings`
# ([workspace.lints.rust] in the root Cargo.toml) and that group covers rustdoc's
# lints, so they are hard errors, but only once something runs `cargo doc`. It is
# deliberately not the doctests (scripts/ci/rust-doctest.sh runs those, beside
# this in the pipeline's `rustdoc` job): doctests run the code examples inside
# doc comments and say nothing about whether their links resolve. `--no-deps`
# keeps this to workspace crates.
#
# `--document-private-items` is what makes the pass mean anything, and it is not
# a nicety: rustdoc otherwise walks only a crate's public surface, so a crate
# that exports almost nothing is linted almost not at all. `crates/gg` exposes
# exactly one `pub` item and declares every module as private `mod`, and this
# was measured rather than assumed: a deliberately broken link planted in
# `crates/gg/src/sandbox/operations.rs` produced no warning and exit 0, and the
# gate passed vacuously over ~44k doc-comment lines. Turning the flag on reported
# 304 unresolved links in that crate, among them references to items long
# deleted. The flag applies workspace-wide, with no crate exempted, because an
# unexplained narrow gate is how the vacuous one survived.
#
# Two things worth knowing before the next repair: rustdoc still respects
# privacy when resolving a link, so pointing at a private item in a sibling
# module needs that item widened; and rustdoc never documents `#[cfg(test)]`
# items, so a link into a test-only module can never resolve and those read as a
# backticked source path instead.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "cargo doc (warnings denied)"
cargo doc --locked --workspace --no-deps --document-private-items
