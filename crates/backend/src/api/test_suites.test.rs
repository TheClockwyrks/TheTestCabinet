use super::*;

use crate::suite_store::tests::sample_suite;

/// A store holding the given records, in its own temporary directory.
fn store_holding(records: &[StoredSuite]) -> (tempfile::TempDir, DefinitionStore) {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let store = DefinitionStore::open(dir.path()).expect("the store opens");
    for record in records {
        let version_dir = store.suite_version_dir(&record.slug, &record.version);
        store
            .write_suite_in(&version_dir, record)
            .expect("the record writes");
    }
    (dir, store)
}

/// One record marked experimental.
fn experimental(slug: &str, version: &str) -> StoredSuite {
    let mut record = sample_suite(slug, version);
    record.manifest.experimental = true;
    record
}

#[test]
fn the_listing_carries_each_versions_identity() {
    let (_dir, store) = store_holding(&[
        sample_suite("carom", "v1.0.0"),
        sample_suite("carom", "v1.1.0"),
    ]);

    let listed = suite_listing(&store, false).expect("the listing builds");

    assert_eq!(listed.test_suites.len(), 1);
    let suite = &listed.test_suites[0];
    assert_eq!(suite.slug, "carom");
    // Oldest first, so the newest — the one a row describes — is last.
    let versions: Vec<&str> = suite
        .versions
        .iter()
        .map(|version| version.version.as_str())
        .collect();
    assert_eq!(versions, vec!["v1.0.0", "v1.1.0"]);
    let newest = suite.versions.last().unwrap();
    assert_eq!(newest.name, "Carom");
    assert_eq!(newest.summary, "A pool-table arcade game.");
    assert_eq!(newest.tags, vec!["arcade".to_string()]);
    assert!(!newest.experimental);
}

#[test]
fn an_experimental_suite_is_offered_only_where_the_deployment_opted_in() {
    let (_dir, store) = store_holding(&[
        sample_suite("carom", "v1.0.0"),
        experimental("carom", "v1.1.0"),
        experimental("coil", "v1.0.0"),
    ]);

    let closed = suite_listing(&store, false).expect("the listing builds");
    let slugs: Vec<&str> = closed
        .test_suites
        .iter()
        .map(|suite| suite.slug.as_str())
        .collect();
    assert_eq!(
        slugs,
        vec!["carom"],
        "a suite left with no visible version is omitted with them"
    );
    assert_eq!(closed.test_suites[0].versions.len(), 1);

    let open = suite_listing(&store, true).expect("the listing builds");
    assert_eq!(open.test_suites.len(), 2);
    assert_eq!(open.test_suites[0].versions.len(), 2);
    assert!(open.test_suites[1].versions[0].experimental);
}

#[test]
fn a_version_whose_record_does_not_read_costs_that_version_alone() {
    let (_dir, store) = store_holding(&[
        sample_suite("carom", "v1.0.0"),
        sample_suite("carom", "v1.1.0"),
    ]);
    std::fs::write(
        store
            .suite_version_dir("carom", "v1.0.0")
            .join(".tcab")
            .join("suite.json"),
        b"{\"slug\":",
    )
    .expect("the record is truncated");

    let listed = suite_listing(&store, false).expect("the listing still builds");

    assert_eq!(listed.test_suites.len(), 1);
    assert_eq!(listed.test_suites[0].versions.len(), 1);
    assert_eq!(listed.test_suites[0].versions[0].version, "v1.1.0");
}

#[test]
fn an_experimental_version_reads_back_only_where_the_deployment_opted_in() {
    let (_dir, store) = store_holding(&[
        sample_suite("carom", "v1.0.0"),
        experimental("carom", "v1.1.0"),
    ]);

    let open = suite_version(&store, true, "carom", "v1.1.0").expect("the record reads back");
    assert!(open.suite.manifest.experimental);

    let closed = suite_version(&store, false, "carom", "v1.1.0")
        .expect_err("an experimental version is treated as if it does not exist");
    assert_eq!(closed.status, axum::http::StatusCode::NOT_FOUND);

    // The gate is the only thing withheld: a non-experimental version of the same
    // suite still reads back with the deployment closed.
    let visible = suite_version(&store, false, "carom", "v1.0.0").expect("the record reads back");
    assert!(!visible.suite.manifest.experimental);
}
