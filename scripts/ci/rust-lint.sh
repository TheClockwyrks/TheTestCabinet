#!/usr/bin/env bash
# Lints the Rust side of the workspace: verifies formatting, then runs Clippy and
# rustdoc with warnings denied.
#
# The rustdoc pass is what catches broken intra-doc links. The workspace denies
# `warnings` ([workspace.lints.rust] in the root Cargo.toml) and that group covers
# rustdoc's lints, so those are already hard errors — but only once something runs
# `cargo doc`. It is deliberately NOT doctests: `cargo test --doc` (in
# rust-test.sh) runs the code examples inside doc comments and says nothing about
# whether their links resolve. `--no-deps` keeps this to workspace crates only.
#
# `--document-private-items` is what makes that pass mean anything, and it is not
# a nicety: rustdoc otherwise walks only a crate's *public* surface, so a crate
# that exports almost nothing is linted almost not at all. `crates/gg` exposes
# exactly one `pub` item (`run_from_args`) and declares every module as private
# `mod`, and this was measured rather than assumed — a deliberately broken link
# planted in `crates/gg/src/sandbox/operations.rs` produced no warning and exit 0.
# The gate passed vacuously over ~44k doc-comment lines. Turning the flag on
# immediately reported 304 unresolved links in that crate, among them references
# to items deleted with the multi-model feature (`PRIMARY_SLOT`,
# `CAPABILITY_MULTI_MODEL`, `validate_slots`) — links that had been describing a
# world that no longer existed, with nothing able to say so.
#
# The flag is applied workspace-wide, over exactly the crate set the flagless
# invocation already covered, and no crate is exempted from it — an unexplained
# narrow gate is how the vacuous one survived this long. The other crates' newly
# visible private surfaces cost 31 further repairs (`core`, `backend`,
# `telemetry`, `migration`, `particle-core`, `foray-host`, `lattice-core`,
# `lattice-host`, `lattice-ref-transport`, `model-skin`), and every headless crate
# is now at zero. Two things worth knowing before the next repair: rustdoc still
# respects privacy when *resolving* a link, so pointing at a private item in a
# sibling module needs that item widened (`api::jobs::authorize_job` is now
# `pub(super)` for exactly that reason); and rustdoc never documents `#[cfg(test)]`
# items, so a link into a test-only gate module can never resolve and those read as
# a backticked source path instead.
#
# Formatting, clippy and rustdoc each cover the whole workspace.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "cargo fmt --check"
cargo fmt --all --check

log "cargo clippy (warnings denied)"
cargo clippy --locked --workspace --all-targets -- -D warnings

log "cargo doc (warnings denied)"
cargo doc --locked --workspace --no-deps --document-private-items
