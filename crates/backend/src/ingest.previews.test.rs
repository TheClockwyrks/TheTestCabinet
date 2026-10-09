//! Preview ingest: the suite trees The Spec Cabinet writes to the suites checkout's
//! `.previews/<slug>/v0.0.0-preview.<draft>/`, beside a copy of the suite manifest,
//! read only by an ingestor configured with [`Ingestor::with_previews`].
//!
//! Each checkout holds the committed fixture suite at `carom/` and a preview of the
//! draft `main` built from its exported `v1.0.0`: the same tree, its `version.toml`
//! declaring the preview version and `experimental = true`.

use super::*;

use tempfile::TempDir;

use crate::store::DefinitionStore;

/// The version a preview of the draft `main` is ingested under.
const PREVIEW: &str = "v0.0.0-preview.main";

/// The committed fixture suites checkout — the directory holding `carom/`.
fn fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../contracts/fixtures/test-suite")
}

/// `.previews/carom/` inside `checkout`.
fn preview_dir(checkout: &TempDir) -> PathBuf {
    checkout
        .path()
        .join(TEST_SUITES_DIR)
        .join(PREVIEWS_DIR)
        .join("carom")
}

/// Write (or replace) the preview of `main`, as The Spec Cabinet does: the suite
/// manifest copy, and the tree carrying the preview version and `experimental`.
fn write_preview(checkout: &TempDir) {
    let dir = preview_dir(checkout);
    let tree = dir.join(PREVIEW);
    if tree.exists() {
        std::fs::remove_dir_all(&tree).expect("the previous preview is replaced");
    }
    copy_tree(&fixture().join("carom/versions/v1.0.0"), &tree).expect("the tree copies");
    std::fs::copy(fixture().join("carom/suite.toml"), dir.join("suite.toml"))
        .expect("the suite manifest copies");
    let manifest = tree.join("version.toml");
    let text = std::fs::read_to_string(&manifest).expect("the version manifest reads");
    let text = text.replace("version = \"1.0.0\"", "version = \"0.0.0-preview.main\"")
        + "experimental = true\n";
    std::fs::write(&manifest, text).expect("the version manifest writes");
}

/// A checkout holding an empty `test-cases/` tree, the fixture suite, and a preview.
fn checkout() -> TempDir {
    let dir = TempDir::new().expect("a temporary directory");
    std::fs::create_dir_all(dir.path().join("test-cases")).expect("the authored tree");
    copy_tree(&fixture(), &dir.path().join(TEST_SUITES_DIR)).expect("the fixture copies");
    write_preview(&dir);
    dir
}

/// A store in its own temporary directory.
fn store(dir: &TempDir) -> DefinitionStore {
    DefinitionStore::open(dir.path().join("store")).expect("the store opens")
}

/// Scan with previews read or not.
fn scan(
    checkout: &TempDir,
    store: &DefinitionStore,
    previews: bool,
    request: &IngestRequest,
) -> Result<IngestReport> {
    Ingestor::new(checkout.path(), store)
        .with_previews(previews)
        .scan(request)
}

/// A scan of the given `testCases` entries.
fn targeted(entries: &[&str]) -> IngestRequest {
    IngestRequest {
        test_cases: Some(entries.iter().map(ToString::to_string).collect()),
        ..Default::default()
    }
}

/// The `(identity, version)` pairs a report ingested, sorted.
fn ingested(report: &IngestReport) -> Vec<(String, String)> {
    let mut pairs: Vec<(String, String)> = report
        .test_case_versions
        .iter()
        .filter(|version| version.ingested)
        .map(|version| (version.slug.clone(), version.version.clone()))
        .collect();
    pairs.sort();
    pairs
}

/// The definitions of the fixture's exported version that ingest, as the identities
/// a preview of it ingests too.
fn preview_definitions(store: &DefinitionStore) -> Vec<String> {
    store
        .read_suite("carom", PREVIEW)
        .expect("the preview's suite record reads")
        .test_cases
        .into_iter()
        .map(|case| case.id)
        .filter(|id| store.has_version(id, PREVIEW))
        .collect()
}

#[test]
fn a_whole_catalog_scan_with_previews_on_stores_the_previews_definitions() {
    let dir = checkout();
    let store = store(&dir);
    let report = scan(&dir, &store, true, &IngestRequest::default()).expect("the scan succeeds");

    let versions: Vec<&str> = report
        .suite_versions
        .iter()
        .map(|suite| suite.version.as_str())
        .collect();
    assert_eq!(versions, ["v1.0.0", PREVIEW]);
    assert!(store.has_suite_version("carom", PREVIEW));
    assert!(store.has_suite_version("carom", "v1.0.0"));

    let manifest = store
        .read_manifest("carom-end-to-end", PREVIEW)
        .expect("the preview's definition is stored under the suite slug");
    assert_eq!(manifest.version, PREVIEW);
    let coordinate = manifest.suite.expect("a lowered version names its suite");
    assert_eq!(coordinate.suite, "carom");
    assert_eq!(coordinate.suite_version, PREVIEW);
    assert!(!preview_definitions(&store).is_empty());
}

#[test]
fn a_targeted_scan_of_a_preview_stores_its_definitions_alone() {
    let dir = checkout();
    let store = store(&dir);
    let report = scan(
        &dir,
        &store,
        true,
        &targeted(&["carom@v0.0.0-preview.main"]),
    )
    .expect("the scan succeeds");

    assert_eq!(report.suite_versions.len(), 1);
    assert_eq!(report.suite_versions[0].version, PREVIEW);
    assert!(store.has_suite_version("carom", PREVIEW));
    assert!(store.has_version("carom-end-to-end", PREVIEW));
    assert!(
        ingested(&report)
            .iter()
            .all(|(_, version)| version == PREVIEW)
    );
    assert!(!store.has_suite_version("carom", "v1.0.0"));
}

#[test]
fn with_previews_off_the_previews_folder_is_never_read() {
    use std::os::unix::fs::PermissionsExt;

    let dir = checkout();
    let store = store(&dir);
    let previews = dir.path().join(TEST_SUITES_DIR).join(PREVIEWS_DIR);
    // A folder nothing may list or enter: any read of it would fail the scan.
    std::fs::set_permissions(&previews, std::fs::Permissions::from_mode(0o000))
        .expect("the previews folder is locked");

    let whole = scan(&dir, &store, false, &IngestRequest::default());
    let targeted = scan(
        &dir,
        &store,
        false,
        &targeted(&["carom@v0.0.0-preview.main"]),
    );
    let locked_on = scan(&dir, &store, true, &IngestRequest::default());
    std::fs::set_permissions(&previews, std::fs::Permissions::from_mode(0o755))
        .expect("the previews folder is unlocked");

    let whole = whole.expect("a whole-catalog scan never touches the previews folder");
    assert!(whole.suite_versions.iter().all(|s| s.version == "v1.0.0"));
    assert!(!store.has_suite_version("carom", PREVIEW));
    assert!(!store.has_version("carom-end-to-end", PREVIEW));

    let error = targeted.expect_err("a preview is not a target when previews are off");
    assert!(error.to_string().contains("carom"), "{error}");
    assert!(!store.has_version("carom-end-to-end", PREVIEW));

    // The lock is what the scans above were up against: one reading previews trips
    // over it.
    assert!(
        locked_on.is_err(),
        "a scan reading previews reads the locked folder"
    );
}

#[test]
fn a_preview_definition_is_listed_only_where_experimental_versions_are_allowed() {
    let dir = checkout();
    let store = store(&dir);
    scan(&dir, &store, true, &IngestRequest::default()).expect("the scan succeeds");

    assert!(store.is_experimental("carom-end-to-end", PREVIEW));
    assert_eq!(
        store
            .list_visible_versions("carom-end-to-end", false)
            .expect("the versions list"),
        ["v1.0.0"]
    );
    assert_eq!(
        store
            .list_visible_versions("carom-end-to-end", true)
            .expect("the versions list"),
        ["v0.0.0-preview.main", "v1.0.0"]
    );
    let hidden = store.list_visible_cases(false).expect("the cases list");
    assert!(
        hidden
            .iter()
            .flat_map(|(_, versions)| versions)
            .all(|version| version != PREVIEW)
    );
    assert!(
        store
            .read_suite("carom", PREVIEW)
            .expect("the record reads")
            .manifest
            .experimental,
        "the preview's suite record is experimental, so the suite reads gate it too"
    );
}

#[test]
fn replacing_a_preview_and_forcing_its_ingest_serves_the_new_content() {
    let dir = checkout();
    let store = store(&dir);
    let target = targeted(&["carom@v0.0.0-preview.main"]);
    scan(&dir, &store, true, &target).expect("the scan succeeds");

    write_preview(&dir);
    let changelog = preview_dir(&dir).join(PREVIEW).join("changelog.md");
    std::fs::write(&changelog, "Replaced by a newer preview of the draft.\n")
        .expect("the changelog writes");

    // Without `force` the stored preview stands, which is why previewing forces.
    scan(&dir, &store, true, &target).expect("the scan succeeds");
    assert!(
        !store
            .read_suite("carom", PREVIEW)
            .expect("the record reads")
            .changelog
            .contains("Replaced")
    );

    let forced = IngestRequest {
        force: true,
        ..target
    };
    scan(&dir, &store, true, &forced).expect("the scan succeeds");
    assert!(
        store
            .read_suite("carom", PREVIEW)
            .expect("the record reads")
            .changelog
            .contains("Replaced")
    );
    assert!(
        store
            .read_manifest("carom-end-to-end", PREVIEW)
            .expect("the definition reads")
            .changelog
            .contains("Replaced")
    );
}

#[test]
fn a_removed_preview_is_pruned_by_a_whole_catalog_scan() {
    let dir = checkout();
    let store = store(&dir);
    scan(&dir, &store, true, &IngestRequest::default()).expect("the scan succeeds");
    assert!(store.has_version("carom-end-to-end", PREVIEW));

    std::fs::remove_dir_all(preview_dir(&dir).join(PREVIEW)).expect("the preview is removed");

    // A partial scan has not seen the whole catalog, so it concludes nothing.
    scan(&dir, &store, true, &targeted(&["carom@v1.0.0"])).expect("the scan succeeds");
    assert!(store.has_suite_version("carom", PREVIEW));

    scan(&dir, &store, true, &IngestRequest::default()).expect("the scan succeeds");
    assert!(!store.has_suite_version("carom", PREVIEW));
    assert!(!store.has_version("carom-end-to-end", PREVIEW));
    assert!(store.has_suite_version("carom", "v1.0.0"));
    assert!(store.has_version("carom-end-to-end", "v1.0.0"));
}

#[test]
fn a_removed_preview_a_run_references_survives_the_prune() {
    let dir = checkout();
    let store = store(&dir);
    scan(&dir, &store, true, &IngestRequest::default()).expect("the scan succeeds");

    std::fs::remove_dir_all(preview_dir(&dir).join(PREVIEW)).expect("the preview is removed");
    let protected =
        std::collections::HashSet::from([("carom-end-to-end".to_string(), PREVIEW.to_string())]);
    Ingestor::new(dir.path(), &store)
        .with_previews(true)
        .with_protected_cases(protected)
        .scan(&IngestRequest::default())
        .expect("the scan succeeds");

    assert!(
        store.has_version("carom-end-to-end", PREVIEW),
        "the run's case stays resolvable for import"
    );
    assert!(
        store.has_suite_version("carom", PREVIEW),
        "the preview a referenced case was lowered from is kept with it"
    );
    assert!(
        preview_definitions(&store) == ["carom-end-to-end"],
        "an unreferenced definition of the preview is still pruned"
    );
}

#[test]
fn a_changed_scan_digests_a_preview_against_its_suite_manifest_copy() {
    let dir = checkout();
    let store = store(&dir);
    scan(&dir, &store, true, &IngestRequest::default()).expect("the scan succeeds");
    let changed = IngestRequest {
        mode: IngestMode::Changed,
        ..Default::default()
    };

    let copy = preview_dir(&dir).join("suite.toml");
    let raw = std::fs::read_to_string(&copy).expect("the copy reads");
    std::fs::write(
        &copy,
        raw.replace("name = \"Carom\"", "name = \"Carom Preview\""),
    )
    .expect("the copy writes");
    let report = scan(&dir, &store, true, &changed).expect("the scan succeeds");
    assert!(!ingested(&report).is_empty());
    assert!(
        ingested(&report)
            .iter()
            .all(|(_, version)| version == PREVIEW),
        "editing the copy re-ingests the preview alone"
    );
    assert_eq!(
        store
            .read_suite("carom", PREVIEW)
            .expect("the record reads")
            .suite
            .name,
        "Carom Preview"
    );

    let own = dir.path().join(TEST_SUITES_DIR).join("carom/suite.toml");
    let raw = std::fs::read_to_string(&own).expect("the manifest reads");
    std::fs::write(
        &own,
        raw.replace("name = \"Carom\"", "name = \"Carom Deluxe\""),
    )
    .expect("the manifest writes");
    let report = scan(&dir, &store, true, &changed).expect("the scan succeeds");
    assert!(!ingested(&report).is_empty());
    assert!(
        ingested(&report)
            .iter()
            .all(|(_, version)| version == "v1.0.0"),
        "the suite folder's manifest is not what a preview is read against"
    );
}
