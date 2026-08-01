//! Tests for the crate's outermost surface: the identity this binary ships under.
//!
//! `gg`'s version is not decoration. `core` reads it out of the run container
//! (`gg --version`) and records it as a run's
//! [`harness_version`](test_cabinet_core::run_record::RunSubject::harness_version) —
//! the only field that says which harness build produced a result — and, in a cluster
//! run, `core` also *asks GitHub for* a release named by its own version. Those two
//! crates are versioned independently, nothing at the type level ties them together,
//! and every way they can disagree fails silently. So the coupling is asserted here,
//! from the side that knows what the binary really is.

use test_cabinet_core::gg_exec::{DEFAULT_RELEASE_VERSION, release_asset_url};

/// The version this binary reports — what lands in a run record — and what `core`
/// will fetch from GitHub must be the same string.
///
/// Drift is invisible until a cluster run: `core` would request an asset tag that was
/// never cut (the run dies at gg's install step), or one that was cut for a *different*
/// build than the corpus is about to attribute its results to. Bumping one crate's
/// `version` and not the other's is exactly the mistake this catches, at compile-and-test
/// time rather than in production.
#[test]
fn the_default_release_version_matches_this_binary() {
    assert_eq!(env!("CARGO_PKG_VERSION"), DEFAULT_RELEASE_VERSION);
}

/// The version must be a real one. `0.0.0` — the workspace default every member crate
/// inherited before gg had a release pipeline — makes `harness_version` a constant
/// across the entire recorded corpus and names a release tag that will never exist.
#[test]
fn this_binary_reports_a_real_version() {
    assert_ne!(env!("CARGO_PKG_VERSION"), "0.0.0");
}

/// The URL `core` resolves for a default cluster install names *this* build, at the
/// tag `.github/workflows/release.yml` cuts (`v{version}`), with the asset name that
/// workflow's gg job uploads (`gg-{target}`).
///
/// The release legs cannot be exercised here, so this is the standing check that the
/// download side still agrees with the publish side: if the workflow's asset naming or
/// tag scheme changes, this string is what has to change with it.
#[test]
fn the_resolved_download_url_names_this_binarys_release_asset() {
    assert_eq!(
        release_asset_url(
            "TheClockwyrks/test-cabinet",
            DEFAULT_RELEASE_VERSION,
            "x86_64-unknown-linux-musl"
        ),
        format!(
            "https://github.com/TheClockwyrks/test-cabinet/releases/download/v{}/gg-x86_64-unknown-linux-musl",
            env!("CARGO_PKG_VERSION")
        )
    );
}
