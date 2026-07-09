//! Unit tests for `tcab publish-reference` pure helpers.
//!
//! The build/deploy/record path drives real `sh`/`wrangler`/network and is
//! exercised through the shared `core` seams (`deploy_pages_build`,
//! `put_reference_build`) and their own tests; here we pin the pure logic this
//! command adds — the branch-alias derivation — leaving the clap surface to
//! `cli.test.rs`.

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
