//! Tests for the test-case-group catalogue: walking a directory of manifests,
//! the display order, and every self-contained validation rule.

use std::fs;

use super::*;

/// Build a catalogue root holding one directory per `(dir, manifest)` pair and
/// return both the temp dir (kept alive) and the catalogue rooted at it.
fn catalog_with(manifests: &[(&str, &str)]) -> (tempfile::TempDir, TestCaseGroupCatalog) {
    let dir = tempfile::tempdir().expect("temp dir");
    for (slug, manifest) in manifests {
        let group_dir = dir.path().join(slug);
        fs::create_dir_all(&group_dir).expect("create group dir");
        fs::write(group_dir.join(MANIFEST_FILE), manifest).expect("write manifest");
    }
    let catalog = TestCaseGroupCatalog::new(dir.path());
    (dir, catalog)
}

/// Assert `catalog.list()` fails with an [`Error::TestCaseGroup`] whose message
/// contains `needle`.
fn assert_rejected(catalog: &TestCaseGroupCatalog, needle: &str) {
    let err = catalog.list().expect_err("list should fail");
    assert!(
        matches!(err, Error::TestCaseGroup(_)),
        "unexpected error variant: {err:?}"
    );
    assert!(
        format!("{err}").contains(needle),
        "error `{err}` does not mention `{needle}`"
    );
}

// --- loading ----------------------------------------------------------------

#[test]
fn a_full_manifest_loads() {
    let (_dir, catalog) = catalog_with(&[(
        "tower-defense",
        "slug = \"tower-defense\"\nname = \"Tower Defense\"\n\
         summary = \"Waves, towers, and mazes.\"\nrank = 1\n\
         cases = [\"meltdown\", \"valence\"]\n",
    )]);
    let groups = catalog.list().expect("list");
    assert_eq!(
        groups,
        vec![TestCaseGroup {
            slug: "tower-defense".to_string(),
            name: "Tower Defense".to_string(),
            summary: Some("Waves, towers, and mazes.".to_string()),
            rank: Some(1),
            cases: vec!["meltdown".to_string(), "valence".to_string()],
        }]
    );
}

#[test]
fn summary_and_rank_are_optional() {
    let (_dir, catalog) = catalog_with(&[(
        "arcade",
        "slug = \"arcade\"\nname = \"Arcade\"\ncases = [\"pong\"]\n",
    )]);
    let groups = catalog.list().expect("list");
    assert_eq!(groups[0].summary, None);
    assert_eq!(groups[0].rank, None);
}

#[test]
fn files_and_hidden_entries_at_the_root_are_ignored() {
    // The real folder holds a README beside the group directories; discovery
    // must not try to read a manifest out of it (or out of a `.hidden/` dir).
    let (dir, catalog) = catalog_with(&[(
        "arcade",
        "slug = \"arcade\"\nname = \"Arcade\"\ncases = [\"pong\"]\n",
    )]);
    fs::write(dir.path().join("README.md"), "# Test-Case Groups\n").expect("write readme");
    fs::create_dir(dir.path().join(".hidden")).expect("create hidden dir");
    let groups = catalog.list().expect("list");
    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].slug, "arcade");
}

#[test]
fn a_missing_root_is_an_error() {
    // Pointing the catalogue at a directory that is not there is a
    // configuration mistake, not an empty catalogue.
    let dir = tempfile::tempdir().expect("temp dir");
    let catalog = TestCaseGroupCatalog::new(dir.path().join("nope"));
    assert_rejected(&catalog, "could not read test-case-groups directory");
}

#[test]
fn a_directory_without_a_manifest_is_an_error() {
    // Unlike a test-case version dir (where leftover build artifacts can
    // linger), a group directory holds nothing but its manifest, so a missing
    // one is an authoring mistake rather than debris to skip.
    let (dir, catalog) = catalog_with(&[(
        "arcade",
        "slug = \"arcade\"\nname = \"Arcade\"\ncases = [\"pong\"]\n",
    )]);
    fs::create_dir(dir.path().join("empty")).expect("create empty dir");
    assert_rejected(&catalog, "could not read test-case-group.toml");
}

// --- display order ----------------------------------------------------------

#[test]
fn groups_sort_by_rank_then_name_with_unranked_last() {
    let (_dir, catalog) = catalog_with(&[
        // Directory names are chosen so a walk order that leaked through would
        // be caught: alphabetically the unranked group comes first.
        (
            "aa-unranked",
            "slug = \"aa-unranked\"\nname = \"AA Unranked\"\ncases = [\"pong\"]\n",
        ),
        (
            "second",
            "slug = \"second\"\nname = \"Second\"\nrank = 2\ncases = [\"pong\"]\n",
        ),
        (
            "first",
            "slug = \"first\"\nname = \"First\"\nrank = 1\ncases = [\"pong\"]\n",
        ),
        // Same rank as `second`: the name breaks the tie.
        (
            "also-second",
            "slug = \"also-second\"\nname = \"Also Second\"\nrank = 2\ncases = [\"pong\"]\n",
        ),
    ]);
    let order: Vec<String> = catalog
        .list()
        .expect("list")
        .into_iter()
        .map(|group| group.slug)
        .collect();
    assert_eq!(order, ["first", "also-second", "second", "aa-unranked"]);
}

// --- validation -------------------------------------------------------------

#[test]
fn an_unknown_field_is_rejected() {
    let (_dir, catalog) = catalog_with(&[(
        "arcade",
        "slug = \"arcade\"\nname = \"Arcade\"\ncases = [\"pong\"]\ncolor = \"red\"\n",
    )]);
    assert_rejected(&catalog, "invalid test-case-group.toml");
}

#[test]
fn a_slug_that_disagrees_with_the_directory_is_rejected() {
    let (_dir, catalog) = catalog_with(&[(
        "arcade",
        "slug = \"arcade-games\"\nname = \"Arcade\"\ncases = [\"pong\"]\n",
    )]);
    assert_rejected(
        &catalog,
        "declares slug `arcade-games` but lives in the `arcade` directory",
    );
}

#[test]
fn a_malformed_slug_is_rejected() {
    let (_dir, catalog) = catalog_with(&[(
        "Arcade",
        "slug = \"Arcade\"\nname = \"Arcade\"\ncases = [\"pong\"]\n",
    )]);
    assert_rejected(&catalog, "not a valid slug");
}

#[test]
fn an_empty_name_is_rejected() {
    let (_dir, catalog) = catalog_with(&[(
        "arcade",
        "slug = \"arcade\"\nname = \"  \"\ncases = [\"pong\"]\n",
    )]);
    assert_rejected(&catalog, "empty name");
}

#[test]
fn an_empty_summary_is_rejected() {
    let (_dir, catalog) = catalog_with(&[(
        "arcade",
        "slug = \"arcade\"\nname = \"Arcade\"\nsummary = \"\"\ncases = [\"pong\"]\n",
    )]);
    assert_rejected(&catalog, "empty summary");
}

#[test]
fn an_empty_member_list_is_rejected() {
    let (_dir, catalog) = catalog_with(&[(
        "arcade",
        "slug = \"arcade\"\nname = \"Arcade\"\ncases = []\n",
    )]);
    assert_rejected(&catalog, "declares no member cases");
}

#[test]
fn a_malformed_member_slug_is_rejected() {
    let (_dir, catalog) = catalog_with(&[(
        "arcade",
        "slug = \"arcade\"\nname = \"Arcade\"\ncases = [\"Pong!\"]\n",
    )]);
    assert_rejected(&catalog, "member `Pong!` is not a valid slug");
}

#[test]
fn a_duplicate_member_is_rejected() {
    let (_dir, catalog) = catalog_with(&[(
        "arcade",
        "slug = \"arcade\"\nname = \"Arcade\"\ncases = [\"pong\", \"fathom\", \"pong\"]\n",
    )]);
    assert_rejected(&catalog, "member `pong` is listed more than once");
}

#[test]
fn one_invalid_group_fails_the_whole_list() {
    // The set is loaded at gates where a partial answer would read as a
    // complete one, so a malformed manifest fails the list rather than being
    // skipped.
    let (_dir, catalog) = catalog_with(&[
        (
            "arcade",
            "slug = \"arcade\"\nname = \"Arcade\"\ncases = [\"pong\"]\n",
        ),
        ("broken", "slug = \"broken\"\n"),
    ]);
    assert_rejected(&catalog, "test-case group `broken`");
}

// --- serialization ----------------------------------------------------------

#[test]
fn a_group_roundtrips_through_json_without_optional_noise() {
    // The backend's definition store writes the ingested set as JSON through
    // this shape; absent options must stay absent (not `null`) and survive the
    // roundtrip.
    let group = TestCaseGroup {
        slug: "arcade".to_string(),
        name: "Arcade".to_string(),
        summary: None,
        rank: None,
        cases: vec!["pong".to_string()],
    };
    let json = serde_json::to_string(&group).expect("serialize");
    assert!(!json.contains("summary"), "unexpected key in {json}");
    assert!(!json.contains("rank"), "unexpected key in {json}");
    let back: TestCaseGroup = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(back, group);
}
