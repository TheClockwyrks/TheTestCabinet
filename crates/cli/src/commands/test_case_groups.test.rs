//! Unit tests for the `tcab test-case-groups` listing.
//!
//! The catalogue itself is `core`'s to test
//! (`crates/core/src/test_case_group.test.rs`); what is pinned here is the part
//! this crate owns — the two renderings and the root resolution — plus a walk of
//! the repository's real catalogue, the same way `engines`' test reads this
//! crate's neighbors off disk.

use std::path::PathBuf;

use super::*;

fn group(slug: &str, name: &str, summary: Option<&str>, cases: &[&str]) -> TestCaseGroup {
    TestCaseGroup {
        slug: slug.to_string(),
        name: name.to_string(),
        summary: summary.map(str::to_string),
        rank: None,
        cases: cases.iter().map(|case| (*case).to_string()).collect(),
    }
}

#[test]
fn the_repository_catalogue_lists() {
    // The committed catalogue must render through the same loader this command
    // uses; membership against the case catalog is `manifests_are_valid`'s job.
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../test-case-groups");
    let listing = TestCaseGroupCatalog::new(root)
        .list()
        .expect("the repository's test-case-group catalogue loads");
    assert!(!listing.is_empty(), "no test-case groups found");
}

#[test]
fn the_table_aligns_columns_and_joins_members() {
    let listing = [
        group("td", "Tower Defense", None, &["meltdown", "valence"]),
        group("arcade-physics", "Arcade", None, &["pong"]),
    ];
    assert_eq!(
        render_table(&listing),
        "td              Tower Defense  meltdown, valence\n\
         arcade-physics  Arcade         pong\n"
    );
}

#[test]
fn the_json_listing_carries_members_and_a_null_absent_summary() {
    let listing = [
        group("td", "Tower Defense", Some("Waves."), &["meltdown"]),
        group("arcade", "Arcade \"fun\"", None, &["pong", "fathom"]),
    ];
    let json = render_json(&listing);
    // The hand-built output must be real JSON; parse it back to check.
    let parsed: serde_json::Value = serde_json::from_str(&json).expect("valid JSON");
    assert_eq!(
        parsed,
        serde_json::json!([
            { "slug": "td", "name": "Tower Defense", "summary": "Waves.", "cases": ["meltdown"] },
            { "slug": "arcade", "name": "Arcade \"fun\"", "summary": null, "cases": ["pong", "fathom"] },
        ])
    );
}

#[test]
fn the_groups_root_is_the_catalog_root_s_sibling() {
    // nextest runs each test in its own process, so setting the process
    // environment cannot race another test.
    // SAFETY: single-threaded at this point in the test process.
    unsafe { std::env::set_var("TCAB_TEST_CASES_DIR", "/checkout/test-cases") };
    assert_eq!(
        groups_root(),
        PathBuf::from("/checkout/test-case-groups"),
        "an overridden catalog root relocates the group catalogue beside it"
    );

    unsafe { std::env::remove_var("TCAB_TEST_CASES_DIR") };
    assert_eq!(
        groups_root(),
        PathBuf::from("test-case-groups"),
        "the default is the working directory's test-case-groups/"
    );
}
