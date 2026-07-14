//! Unit tests for `tcab publish-reference` pure helpers.
//!
//! The build/deploy path drives real `sh`/`wrangler`/network and is exercised
//! through the shared `core` seam (`deploy_pages_build`) and its own tests, and the
//! lockfile write is covered by `core`'s `reference_lock` tests; here we pin the
//! pure logic this command adds — the Pages-project selection and the branch-alias
//! derivation — leaving the clap surface to `cli.test.rs`.

use super::*;

#[test]
fn deploy_branch_replaces_dots_with_dashes() {
    // A Pages branch alias becomes a DNS subdomain label, so the version's dots
    // must not survive into it.
    assert_eq!(
        deploy_branch("carom", "v1.0.1", "base"),
        "carom-v1-0-1-base"
    );
}

#[test]
fn deploy_branch_joins_slug_version_and_variant() {
    assert_eq!(
        deploy_branch("thunderhead", "v0.4.0", "no-fog"),
        "thunderhead-v0-4-0-no-fog"
    );
}

#[test]
fn deploy_branch_leaves_a_dotless_version_untouched() {
    assert_eq!(deploy_branch("pong", "v2", "base"), "pong-v2-base");
}

#[test]
fn references_pages_project_selects_by_env() {
    // The required `--env` picks the Pages project; prod and staging are distinct
    // so a staging publish never lands in front of the public gallery.
    assert_eq!(
        references_pages_project(DeployEnv::Prod),
        "test-cabinet-references"
    );
    assert_eq!(
        references_pages_project(DeployEnv::Staging),
        "test-cabinet-references-staging"
    );
}
