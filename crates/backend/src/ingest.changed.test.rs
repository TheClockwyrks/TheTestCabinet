//! `changed` scans: a scan that rewrites exactly the versions whose checkout
//! content differs from what the store holds, across authored cases, game jams and
//! suite versions.

use super::*;

use tempfile::TempDir;

use crate::store::{IngestStamp, STORE_FORMAT, ingest_stamp_in, write_ingest_stamp_in};

/// Write a file, creating parent directories.
fn write(path: &Path, contents: &str) {
    std::fs::create_dir_all(path.parent().expect("a parent")).expect("the parent is created");
    std::fs::write(path, contents).expect("the file is written");
}

/// Append to a file.
fn append(path: &Path, contents: &str) {
    let mut existing = std::fs::read_to_string(path).expect("the file reads");
    existing.push_str(contents);
    std::fs::write(path, existing).expect("the file is written");
}

/// The folder of an authored end-to-end case version.
fn case_dir(checkout: &Path, folder: &str, version: &str) -> PathBuf {
    checkout
        .join("test-cases/end-to-end/easy")
        .join(folder)
        .join(version)
}

/// Write a minimal authored end-to-end case version, which needs no browser to
/// ingest.
fn write_case(checkout: &Path, slug: &str, version: &str) {
    let base = case_dir(checkout, slug, version);
    write(&base.join("prompt.hbs"), "Build it.");
    write(&base.join("changelog.md"), "Introduced.");
    write(&base.join("variants/base.toml"), "slug = \"base\"\n");
    write(
        &base.join("test-case.toml"),
        &format!(
            "slug = \"{slug}\"\nname = \"Case\"\ndifficulty = \"easy\"\ntags = []\n\
             prompt = \"prompt.hbs\"\nchangelog = \"changelog.md\"\n\
             variants = [\"variants/base.toml\"]\n\
             [build]\ninstall = \"x\"\nbuild = \"y\"\n\
             [[domain]]\nid = \"g\"\ndescription = \"d\"\n"
        ),
    );
}

/// The folder of a game jam version.
fn jam_dir(checkout: &Path, slug: &str, version: &str) -> PathBuf {
    checkout.join("game-jams").join(slug).join(version)
}

/// Write a minimal game jam version.
fn write_jam(checkout: &Path, slug: &str, version: &str) {
    let base = jam_dir(checkout, slug, version);
    write(
        &base.join("prompt.hbs"),
        "Build a game. You have {{time_limit_hours}} hours.",
    );
    write(&base.join("changelog.md"), "Introduced.");
    write(
        &base.join("game-jam.toml"),
        &format!(
            "slug = \"{slug}\"\nname = \"Trains\"\nprompt = \"prompt.hbs\"\n\
             changelog = \"changelog.md\"\nmax_runtime_hours = 8\n\
             [build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"\n"
        ),
    );
}

/// Copy the committed fixture suite into the checkout, as `carom@v1.0.0` and a
/// second version `carom@v1.1.0` with identical content.
fn write_suite(checkout: &Path) {
    let fixture =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../contracts/fixtures/test-suite");
    let suites = checkout.join(TEST_SUITES_DIR);
    copy_tree(&fixture, &suites).expect("the fixture copies");
    let next = suites.join("carom/versions/v1.1.0");
    copy_tree(&suites.join("carom/versions/v1.0.0"), &next).expect("the version copies");
    let manifest = next.join("version.toml");
    let raw = std::fs::read_to_string(&manifest).expect("the manifest reads");
    std::fs::write(
        &manifest,
        raw.replace("version = \"1.0.0\"", "version = \"1.1.0\""),
    )
    .expect("the manifest is written");
}

/// A checkout holding two versions of one case, a second case, a game jam and a
/// two-version suite.
fn checkout() -> TempDir {
    let dir = TempDir::new().expect("a temporary directory");
    write_case(dir.path(), "alpha", "v1.0.0");
    write_case(dir.path(), "alpha", "v2.0.0");
    write_case(dir.path(), "beta", "v1.0.0");
    write_jam(dir.path(), "trains", "v1.0.0");
    write_suite(dir.path());
    dir
}

/// A store in its own temporary directory.
fn store(dir: &TempDir) -> DefinitionStore {
    DefinitionStore::open(dir.path().join("store")).expect("the store opens")
}

/// Scan with the given request.
fn scan(checkout: &TempDir, store: &DefinitionStore, request: IngestRequest) -> IngestReport {
    Ingestor::new(checkout.path(), store)
        .scan(&request)
        .expect("the scan succeeds")
}

/// A whole-catalog `changed` scan.
fn changed() -> IngestRequest {
    IngestRequest {
        mode: IngestMode::Changed,
        ..Default::default()
    }
}

/// The test-case versions a report ingested, sorted.
fn ingested(report: &IngestReport) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = report
        .test_case_versions
        .iter()
        .filter(|v| v.ingested)
        .map(|v| (v.slug.clone(), v.version.clone()))
        .collect();
    out.sort();
    out
}

/// The suite versions a report ingested, sorted.
fn ingested_suites(report: &IngestReport) -> Vec<String> {
    let mut out: Vec<String> = report
        .suite_versions
        .iter()
        .filter(|suite| suite.ingested)
        .map(|suite| suite.version.clone())
        .collect();
    out.sort();
    out
}

/// Every definition the fixture suite lowers at `version`, sorted, from a report
/// that touched them.
fn suite_definitions(report: &IngestReport, version: &str) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = report
        .test_case_versions
        .iter()
        .filter(|v| v.slug.starts_with("carom-") && v.version == version && v.problem.is_none())
        .map(|v| (v.slug.clone(), v.version.clone()))
        .collect();
    out.sort();
    out
}

/// The authored versions of the checkout, sorted.
fn authored() -> Vec<(String, String)> {
    [
        ("alpha", "v1.0.0"),
        ("alpha", "v2.0.0"),
        ("beta", "v1.0.0"),
        ("trains", "v1.0.0"),
    ]
    .iter()
    .map(|(slug, version)| (slug.to_string(), version.to_string()))
    .collect()
}

/// Every version a report touched, sorted, leaving out the ones it reported a
/// problem for (the fixture's `performance` definition, which cannot be lowered).
fn everything(report: &IngestReport) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = report
        .test_case_versions
        .iter()
        .filter(|v| v.problem.is_none())
        .map(|v| (v.slug.clone(), v.version.clone()))
        .collect();
    out.sort();
    out
}

#[test]
fn ingest_stores_each_versions_digest_in_its_record() {
    let dir = checkout();
    let store = store(&dir);
    let report = scan(&dir, &store, IngestRequest::default());
    assert!(
        report
            .test_case_versions
            .iter()
            .filter(|v| v.problem.is_none())
            .all(|v| v.ingested)
    );

    let alpha = store
        .version_stamp("alpha", "v1.0.0")
        .expect("the case record is stamped");
    assert_eq!(
        alpha.digest,
        digest::authored_version_digest(&case_dir(dir.path(), "alpha", "v1.0.0"), dir.path())
            .expect("digest")
    );
    assert_eq!(alpha.format, STORE_FORMAT);
    assert_eq!(alpha.digest.len(), 64);

    let jam = store
        .version_stamp("trains", "v1.0.0")
        .expect("the jam record is stamped");
    assert_eq!(
        jam.digest,
        digest::authored_version_digest(&jam_dir(dir.path(), "trains", "v1.0.0"), dir.path())
            .expect("digest")
    );

    let ingestor = Ingestor::new(dir.path(), &store);
    let suite_digest = ingestor.suite_digest("carom", "v1.0.0").expect("digest");
    assert_eq!(
        store
            .suite_stamp("carom", "v1.0.0")
            .expect("the suite record is stamped")
            .digest,
        suite_digest
    );
    assert_eq!(
        store
            .version_stamp("carom-end-to-end", "v1.0.0")
            .expect("a lowered definition is stamped")
            .digest,
        suite_digest,
        "a lowered definition carries its suite version's digest"
    );
    assert_ne!(
        suite_digest,
        ingestor.suite_digest("carom", "v1.1.0").expect("digest"),
        "the two suite versions differ in their manifest"
    );
    // The stamp sits in the record's sidecar, which no artifact read serves.
    assert!(ingest_stamp_in(&store.version_dir("alpha", "v1.0.0")).is_file());
    assert!(
        store
            .read_artifact("alpha", "v1.0.0", ".tcab/ingest.json")
            .is_err()
    );
}

#[test]
fn a_changed_scan_with_no_edits_ingests_nothing_and_reports_every_target_unchanged() {
    let dir = checkout();
    let store = store(&dir);
    scan(&dir, &store, IngestRequest::default());

    let report = scan(&dir, &store, changed());
    assert!(ingested(&report).is_empty(), "{:?}", ingested(&report));
    assert!(ingested_suites(&report).is_empty());
    assert!(!report.test_case_versions.is_empty());
    assert!(
        report
            .test_case_versions
            .iter()
            .filter(|v| v.problem.is_none())
            .all(|v| v.reason == Some(SkipReason::Unchanged)),
        "every version is reported unchanged"
    );
    assert!(
        report
            .suite_versions
            .iter()
            .all(|suite| suite.reason == Some(SkipReason::Unchanged))
    );

    // A default scan's skips name no reason: it skipped what the store holds without
    // looking at the content.
    let default = scan(&dir, &store, IngestRequest::default());
    assert!(
        default
            .test_case_versions
            .iter()
            .all(|v| v.reason.is_none())
    );
}

#[test]
fn editing_one_file_of_an_authored_case_version_re_ingests_that_version_alone() {
    let dir = checkout();
    let store = store(&dir);
    scan(&dir, &store, IngestRequest::default());

    append(
        &case_dir(dir.path(), "alpha", "v1.0.0").join("changelog.md"),
        "\nEdited.",
    );
    let report = scan(&dir, &store, changed());
    assert_eq!(
        ingested(&report),
        [("alpha".to_string(), "v1.0.0".to_string())]
    );
    assert!(ingested_suites(&report).is_empty());
    assert!(
        store
            .read_manifest("alpha", "v1.0.0")
            .expect("the manifest reads")
            .changelog
            .contains("Edited."),
        "the edit reached the store"
    );

    // The rewrite advanced the stamp, so the next scan is quiet again.
    assert!(ingested(&scan(&dir, &store, changed())).is_empty());
}

#[test]
fn editing_one_file_of_a_game_jam_version_re_ingests_that_version_alone() {
    let dir = checkout();
    let store = store(&dir);
    scan(&dir, &store, IngestRequest::default());

    append(
        &jam_dir(dir.path(), "trains", "v1.0.0").join("prompt.hbs"),
        "\nMake it about trains.",
    );
    let report = scan(&dir, &store, changed());
    assert_eq!(
        ingested(&report),
        [("trains".to_string(), "v1.0.0".to_string())]
    );
}

#[test]
fn editing_one_file_of_a_suite_version_re_ingests_that_version_alone() {
    let dir = checkout();
    let store = store(&dir);
    let first = scan(&dir, &store, IngestRequest::default());
    let offered = suite_definitions(&first, "v1.1.0");
    assert!(!offered.is_empty());

    append(
        &dir.path()
            .join(TEST_SUITES_DIR)
            .join("carom/versions/v1.1.0/changelog.md"),
        "\nEdited.",
    );
    let report = scan(&dir, &store, changed());
    assert_eq!(
        ingested(&report),
        offered,
        "every definition of v1.1.0 alone"
    );
    assert_eq!(ingested_suites(&report), ["v1.1.0"]);
    assert!(
        store
            .read_suite("carom", "v1.1.0")
            .expect("the record reads")
            .changelog
            .contains("Edited.")
    );
}

#[test]
fn editing_a_suites_manifest_re_ingests_each_of_its_versions() {
    let dir = checkout();
    let store = store(&dir);
    let first = scan(&dir, &store, IngestRequest::default());

    // The edit goes through the path ingest digests the manifest from: the one
    // `<slug>/suite.toml` every exported version of the suite shares.
    let manifest = Ingestor::new(dir.path(), &store).suite_manifest_path("carom", "v1.0.0");
    assert_eq!(
        manifest,
        dir.path().join(TEST_SUITES_DIR).join("carom/suite.toml")
    );
    let raw = std::fs::read_to_string(&manifest).expect("the manifest reads");
    std::fs::write(
        &manifest,
        raw.replace("name = \"Carom\"", "name = \"Carom Deluxe\""),
    )
    .expect("the manifest is written");
    let report = scan(&dir, &store, changed());

    let mut expected = suite_definitions(&first, "v1.0.0");
    expected.extend(suite_definitions(&first, "v1.1.0"));
    expected.sort();
    assert_eq!(ingested(&report), expected);
    assert_eq!(ingested_suites(&report), ["v1.0.0", "v1.1.0"]);
    assert_eq!(
        store
            .read_suite("carom", "v1.0.0")
            .expect("the record reads")
            .suite
            .name,
        "Carom Deluxe"
    );
    assert_eq!(
        store
            .read_suite("carom", "v1.1.0")
            .expect("the record reads")
            .suite
            .name,
        "Carom Deluxe"
    );
}

#[test]
fn a_changed_scan_refuses_a_suite_version_that_no_longer_resolves_with_its_problem() {
    let dir = checkout();
    let store = store(&dir);
    scan(&dir, &store, IngestRequest::default());
    assert!(store.has_suite_version("carom", "v1.1.0"));

    // The stored record's stamp is untouched, but the checkout copy no longer
    // resolves: its version manifest disagrees with its folder.
    let manifest = dir
        .path()
        .join(TEST_SUITES_DIR)
        .join("carom/versions/v1.1.0/version.toml");
    let raw = std::fs::read_to_string(&manifest).expect("the manifest reads");
    std::fs::write(
        &manifest,
        raw.replace("version = \"1.1.0\"", "version = \"9.9.9\""),
    )
    .expect("the manifest is written");

    let mut events = Vec::new();
    let report = Ingestor::new(dir.path(), &store)
        .scan_with_progress(&changed(), |event| {
            if let IngestEvent::Version { version, .. } = event {
                events.push(version.clone());
            }
        })
        .expect("the scan succeeds");
    let refused = report
        .suite_versions
        .iter()
        .find(|suite| suite.version == "v1.1.0")
        .expect("the version is reported");
    assert!(!refused.ingested);
    assert!(
        refused.reason.is_none(),
        "a refusal is not an unchanged skip"
    );
    assert!(refused.problem.is_some(), "it carries its problem");
    let line = events
        .iter()
        .find(|v| v.slug == "carom" && v.version == "v1.1.0")
        .expect("the refusal is a version line of the feed");
    assert!(!line.ingested);
    assert!(line.problem.is_some());

    // The unchanged version is still skipped as unchanged, and the refused one is
    // pruned with the cases it was lowered into.
    assert!(ingested_suites(&report).is_empty());
    assert!(!store.has_suite_version("carom", "v1.1.0"));
    assert!(!store.has_version("carom-end-to-end", "v1.1.0"));
    assert!(store.has_version("carom-end-to-end", "v1.0.0"));
}

#[test]
fn editing_the_reference_builds_lockfile_re_ingests_every_authored_version() {
    let dir = checkout();
    let store = store(&dir);
    scan(&dir, &store, IngestRequest::default());

    write(
        &dir.path().join("test-cases/reference-builds.lock.json"),
        "{}",
    );
    let report = scan(&dir, &store, changed());
    assert_eq!(ingested(&report), authored());
    assert!(ingested_suites(&report).is_empty());
}

#[test]
fn a_changed_scan_against_a_store_written_in_another_catalog_version_re_ingests_every_target() {
    let dir = checkout();
    let store = store(&dir);
    let first = scan(&dir, &store, IngestRequest::default());
    let every = everything(&first);

    // The store has since moved to another catalog version without these records
    // being rewritten under it.
    store
        .set_catalog_version("another-commit")
        .expect("the marker is stamped");
    let partial = scan(
        &dir,
        &store,
        IngestRequest {
            test_cases: Some(vec!["alpha".to_string()]),
            mode: IngestMode::Changed,
            ..Default::default()
        },
    );
    assert_eq!(
        ingested(&partial),
        [
            ("alpha".to_string(), "v1.0.0".to_string()),
            ("alpha".to_string(), "v2.0.0".to_string())
        ]
    );
    let report = scan(&dir, &store, changed());
    assert_eq!(
        ingested(&report)
            .into_iter()
            .filter(|(slug, _)| slug != "alpha")
            .collect::<Vec<_>>(),
        every
            .iter()
            .filter(|(slug, _)| slug != "alpha")
            .cloned()
            .collect::<Vec<_>>(),
        "every other target is re-ingested"
    );
    assert_eq!(ingested_suites(&report), ["v1.0.0", "v1.1.0"]);
    assert!(ingested(&scan(&dir, &store, changed())).is_empty());
}

#[test]
fn a_changed_scan_tagged_with_a_new_catalog_version_re_ingests_every_target() {
    let dir = checkout();
    let store = store(&dir);
    let first = scan(
        &dir,
        &store,
        IngestRequest {
            catalog_version: Some("commit-a".to_string()),
            ..Default::default()
        },
    );
    let tagged = |token: &str| IngestRequest {
        mode: IngestMode::Changed,
        catalog_version: Some(token.to_string()),
        ..Default::default()
    };
    assert!(ingested(&scan(&dir, &store, tagged("commit-a"))).is_empty());
    assert_eq!(
        ingested(&scan(&dir, &store, tagged("commit-b"))),
        everything(&first)
    );
    assert!(ingested(&scan(&dir, &store, tagged("commit-b"))).is_empty());
}

#[test]
fn a_record_written_in_another_record_format_is_re_ingested() {
    let dir = checkout();
    let store = store(&dir);
    scan(&dir, &store, IngestRequest::default());

    let record = store.version_dir("beta", "v1.0.0");
    let stamp = store.version_stamp("beta", "v1.0.0").expect("stamped");
    write_ingest_stamp_in(
        &record,
        &IngestStamp {
            format: STORE_FORMAT - 1,
            ..stamp
        },
    )
    .expect("the stamp is rewritten");
    // A record from before stamps existed carries none at all.
    std::fs::remove_file(ingest_stamp_in(&store.version_dir("alpha", "v2.0.0")))
        .expect("the stamp is removed");

    let report = scan(&dir, &store, changed());
    assert_eq!(
        ingested(&report),
        [
            ("alpha".to_string(), "v2.0.0".to_string()),
            ("beta".to_string(), "v1.0.0".to_string())
        ]
    );
}

#[test]
fn a_changed_scan_of_a_store_stamped_with_another_format_re_ingests_every_target() {
    let dir = checkout();
    let store = store(&dir);
    let first = scan(&dir, &store, IngestRequest::default());
    std::fs::write(
        store.root().join(".tcab").join("store-format"),
        (STORE_FORMAT - 1).to_string(),
    )
    .expect("the marker is stamped");

    let report = scan(&dir, &store, changed());
    assert_eq!(ingested(&report), everything(&first));
}

#[test]
fn a_whole_catalog_changed_scan_prunes_as_a_whole_catalog_scan_does() {
    let dir = checkout();
    let store = store(&dir);
    scan(&dir, &store, IngestRequest::default());

    std::fs::remove_dir_all(dir.path().join("test-cases/end-to-end/easy/beta"))
        .expect("beta is dropped");
    std::fs::remove_dir_all(
        dir.path()
            .join(TEST_SUITES_DIR)
            .join("carom/versions/v1.1.0"),
    )
    .expect("a suite version is dropped");
    let protected = std::collections::HashSet::from([("trains".to_string(), "v1.0.0".to_string())]);
    std::fs::remove_dir_all(dir.path().join("game-jams/trains")).expect("the jam is dropped");

    let report = Ingestor::new(dir.path(), &store)
        .with_protected_cases(protected)
        .scan(&changed())
        .expect("the scan succeeds");
    assert!(ingested(&report).is_empty(), "nothing that remains changed");
    assert!(!store.has_version("beta", "v1.0.0"));
    assert!(!store.has_suite_version("carom", "v1.1.0"));
    assert!(!store.has_version("carom-end-to-end", "v1.1.0"));
    assert!(store.has_version("carom-end-to-end", "v1.0.0"));
    assert!(store.has_version("alpha", "v1.0.0"));
    assert!(
        store.has_version("trains", "v1.0.0"),
        "a run-referenced version is spared"
    );

    // A partial `changed` scan prunes nothing.
    std::fs::remove_dir_all(dir.path().join("test-cases/end-to-end/easy/alpha/v2.0.0"))
        .expect("a version is dropped");
    scan(
        &dir,
        &store,
        IngestRequest {
            test_cases: Some(vec!["alpha".to_string()]),
            mode: IngestMode::Changed,
            ..Default::default()
        },
    );
    assert!(store.has_version("alpha", "v2.0.0"));
}

#[test]
fn force_rewrites_every_target_in_changed_mode() {
    let dir = checkout();
    let store = store(&dir);
    let first = scan(&dir, &store, IngestRequest::default());
    let report = scan(
        &dir,
        &store,
        IngestRequest {
            force: true,
            mode: IngestMode::Changed,
            ..Default::default()
        },
    );
    assert_eq!(ingested(&report), everything(&first));
    assert_eq!(ingested_suites(&report), ["v1.0.0", "v1.1.0"]);
}

#[test]
fn a_changed_scan_ingests_a_target_the_store_holds_no_record_for() {
    let dir = checkout();
    let store = store(&dir);
    scan(&dir, &store, IngestRequest::default());
    write_case(dir.path(), "gamma", "v1.0.0");

    let report = scan(&dir, &store, changed());
    assert_eq!(
        ingested(&report),
        [("gamma".to_string(), "v1.0.0".to_string())]
    );
}

#[test]
fn a_scan_that_skips_stored_suite_versions_never_reads_their_files() {
    use std::os::unix::fs::PermissionsExt;

    let dir = checkout();
    // A `performance` definition cannot be lowered, so it is never stored and every
    // scan attempts it again. Dropping it leaves a suite version whose every record
    // is stored, which a scan skipping stored records has no reason to hash.
    for version in ["v1.0.0", "v1.1.0"] {
        std::fs::remove_file(
            dir.path()
                .join(TEST_SUITES_DIR)
                .join("carom/versions")
                .join(version)
                .join("test-cases/efficiency.toml"),
        )
        .expect("the performance definition is dropped");
    }
    let store = store(&dir);
    let tagged = |token: &str| IngestRequest {
        catalog_version: Some(token.to_string()),
        ..Default::default()
    };
    let first = scan(&dir, &store, tagged("c1"));
    assert_eq!(ingested_suites(&first), ["v1.0.0", "v1.1.0"]);
    assert!(
        first
            .test_case_versions
            .iter()
            .filter(|v| v.slug.starts_with("carom-"))
            .all(|v| v.ingested),
        "every definition the suite offers is stored"
    );

    // A file no digest can read: hashing the suite version would fail the scan.
    let unreadable = dir
        .path()
        .join(TEST_SUITES_DIR)
        .join("carom/versions/v1.0.0/unreadable.txt");
    write(&unreadable, "sealed");
    std::fs::set_permissions(&unreadable, std::fs::Permissions::from_mode(0o000))
        .expect("the file is sealed");

    let plain = scan(&dir, &store, IngestRequest::default());
    assert!(ingested(&plain).is_empty());
    assert!(ingested_suites(&plain).is_empty());
    let unchanged = scan(&dir, &store, tagged("c1"));
    assert!(ingested(&unchanged).is_empty());
    assert!(ingested_suites(&unchanged).is_empty());

    // A `changed` scan decides on content, so it does hash the suite version.
    assert!(
        Ingestor::new(dir.path(), &store).scan(&changed()).is_err(),
        "a changed scan reads the suite version's files"
    );
}
