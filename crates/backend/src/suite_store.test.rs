use super::*;

use tempfile::TempDir;

/// A store in its own temporary directory.
fn temp_store() -> (TempDir, DefinitionStore) {
    let dir = TempDir::new().expect("a temporary directory");
    let store = DefinitionStore::open(dir.path()).expect("the store opens");
    (dir, store)
}

/// A minimal stored record for `(slug, version)`.
pub(crate) fn sample_suite(slug: &str, version: &str) -> StoredSuite {
    StoredSuite {
        slug: slug.to_string(),
        version: version.to_string(),
        suite: SuiteManifest {
            slug: slug.to_string(),
            name: "Carom".to_string(),
        },
        manifest: VersionManifest {
            version: Some(version.trim_start_matches('v').to_string()),
            tags: vec!["arcade".to_string()],
            summary: "A pool-table arcade game.".to_string(),
            description: "description.md".to_string(),
            changelog: "changelog.md".to_string(),
            experimental: false,
        },
        description: "## Carom".to_string(),
        changelog: "Introduced.".to_string(),
        specifications: Vec::new(),
        test_cases: Vec::new(),
        assets: Vec::new(),
        demos: Vec::new(),
        reference_implementations: vec!["none".to_string()],
        showcase: None,
    }
}

/// Write one record into the store as an ingested version.
fn store_suite(store: &DefinitionStore, record: &StoredSuite) {
    let dir = store.suite_version_dir(&record.slug, &record.version);
    store
        .write_suite_in(&dir, record)
        .expect("the record writes");
}

#[test]
fn a_record_round_trips_and_its_versions_list_oldest_first() {
    let (_dir, store) = temp_store();
    store_suite(&store, &sample_suite("carom", "v1.0.0"));
    store_suite(&store, &sample_suite("carom", "v1.10.0"));
    store_suite(&store, &sample_suite("carom", "v1.9.0"));

    assert!(store.has_suite_version("carom", "v1.0.0"));
    let read = store.read_suite("carom", "v1.0.0").expect("it reads back");
    assert_eq!(read, sample_suite("carom", "v1.0.0"));
    // Compared component-wise, so `v1.10.0` sorts after `v1.9.0`.
    assert_eq!(
        store.list_suites().expect("the suites list"),
        vec![(
            "carom".to_string(),
            vec![
                "v1.0.0".to_string(),
                "v1.9.0".to_string(),
                "v1.10.0".to_string(),
            ]
        )]
    );
}

#[test]
fn an_absent_suite_version_is_not_found() {
    let (_dir, store) = temp_store();
    let error = store
        .read_suite("carom", "v1.0.0")
        .expect_err("nothing is ingested");
    assert!(matches!(error, BackendError::NotFound(_)), "{error:?}");
}

#[test]
fn a_stored_file_is_served_and_a_path_leaving_the_version_is_refused() {
    let (_dir, store) = temp_store();
    let record = sample_suite("carom", "v1.0.0");
    store_suite(&store, &record);
    let dir = store.suite_version_dir("carom", "v1.0.0");
    std::fs::create_dir_all(dir.join("showcase")).unwrap();
    std::fs::write(dir.join("showcase/title.png"), b"png").unwrap();

    assert_eq!(
        store
            .read_suite_file("carom", "v1.0.0", "showcase/title.png")
            .expect("the media is served"),
        b"png"
    );
    let escaping = store
        .read_suite_file("carom", "v1.0.0", "../../../etc/passwd")
        .expect_err("a key leaving the version is refused");
    assert!(
        matches!(escaping, BackendError::BadRequest(_)),
        "{escaping:?}"
    );
    let sidecar = store
        .read_suite_file("carom", "v1.0.0", ".tcab/suite.json")
        .expect_err("the record is served by its endpoint, not as bytes");
    assert!(matches!(sidecar, BackendError::NotFound(_)), "{sidecar:?}");
}

#[test]
fn removing_the_last_version_removes_the_suite_with_it() {
    let (_dir, store) = temp_store();
    store_suite(&store, &sample_suite("carom", "v1.0.0"));
    store_suite(&store, &sample_suite("carom", "v1.1.0"));

    store
        .remove_suite_version("carom", "v1.0.0")
        .expect("the version is removed");
    assert!(!store.has_suite_version("carom", "v1.0.0"));
    assert!(store.has_suite_version("carom", "v1.1.0"));

    store
        .remove_suite_version("carom", "v1.1.0")
        .expect("the last version is removed");
    assert!(store.list_suites().expect("the suites list").is_empty());
    assert!(!store.root().join(SUITES_DIR).join("carom").exists());
    // A version that is already absent is a no-op.
    store
        .remove_suite_version("carom", "v1.1.0")
        .expect("removing an absent version is a no-op");
}
