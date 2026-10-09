//! Suite ingest, driven by the committed fixture suite at
//! `crates/contracts/fixtures/test-suite/carom/`: a `suite.toml`, one exported version
//! at `versions/v1.0.0/`, and a `drafts/main/` tree ingest never reads.
//!
//! The fixture offers one definition of every fully specified type plus one of a
//! type the format leaves to be determined, so a scan over it covers both what
//! ingest lowers and what it reports as a problem.

use super::*;

use tempfile::TempDir;

use crate::store::DefinitionStore;

/// The committed fixture suites checkout — the directory holding `carom/`.
fn fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../contracts/fixtures/test-suite")
}

/// A checkout holding an empty `test-cases/` tree and the fixture suite, so a
/// whole-catalog scan sees suites and nothing else.
fn checkout() -> TempDir {
    let dir = TempDir::new().expect("a temporary directory");
    std::fs::create_dir_all(dir.path().join("test-cases")).expect("the authored tree");
    copy_tree(&fixture(), &dir.path().join(TEST_SUITES_DIR)).expect("the fixture copies");
    dir
}

/// A store in its own temporary directory.
fn store(dir: &TempDir) -> DefinitionStore {
    DefinitionStore::open(dir.path().join("store")).expect("the store opens")
}

/// Scan `checkout` into `store` with the given request.
fn scan(checkout: &TempDir, store: &DefinitionStore, request: IngestRequest) -> IngestReport {
    Ingestor::new(checkout.path(), store)
        .scan(&request)
        .expect("the scan succeeds")
}

/// A whole-catalog scan.
fn full() -> IngestRequest {
    IngestRequest::default()
}

/// A scan of the given `testCases` entries.
fn targeted(entries: &[&str]) -> IngestRequest {
    IngestRequest {
        test_cases: Some(entries.iter().map(ToString::to_string).collect()),
        ..Default::default()
    }
}

/// The reported versions that carry no problem: every definition the fixture offers
/// but the `performance` one.
fn lowerable(report: &IngestReport) -> impl Iterator<Item = &IngestedVersion> {
    report
        .test_case_versions
        .iter()
        .filter(|case| case.problem.is_none())
}

/// Scan `checkout` into `store`, collecting every `version` event the progress
/// feed emits beside the `start` total.
fn scan_events(
    checkout: &TempDir,
    store: &DefinitionStore,
    request: IngestRequest,
) -> (usize, Vec<IngestedVersion>, IngestReport) {
    let mut total = 0;
    let mut events = Vec::new();
    let report = Ingestor::new(checkout.path(), store)
        .scan_with_progress(&request, |event| match event {
            IngestEvent::Start { total: count } => total = count,
            IngestEvent::Version { version, .. } => events.push(version.clone()),
        })
        .expect("the scan succeeds");
    (total, events, report)
}

/// Rewrite one fragment of one file of the checkout's suites tree.
fn rewrite(checkout: &TempDir, rel: &str, from: &str, to: &str) {
    let path = checkout.path().join(TEST_SUITES_DIR).join(rel);
    let text = std::fs::read_to_string(&path).expect("the file reads");
    assert!(text.contains(from), "`{from}` is not in {rel}");
    std::fs::write(&path, text.replace(from, to)).expect("the file writes");
}

/// The catalog identities a report ingested, skipped, or reported a problem for,
/// sorted.
fn slugs(report: &IngestReport) -> Vec<String> {
    let mut slugs: Vec<String> = report
        .test_case_versions
        .iter()
        .map(|version| version.slug.clone())
        .collect();
    slugs.sort();
    slugs
}

#[test]
fn a_suite_version_ingests_every_definition_it_offers_with_its_coordinate() {
    let dir = checkout();
    let store = store(&dir);

    let report = scan(&dir, &store, full());

    // Every definition the fixture offers becomes a test-case version under its
    // catalog identity, except the `performance` one, whose keys the format leaves
    // to be determined: it cannot be lowered, so it is reported with its problem
    // rather than failing the scan.
    assert!(
        slugs(&report).contains(&"carom-end-to-end".to_string()),
        "{:?}",
        slugs(&report)
    );
    assert_eq!(slugs(&report).len(), 10);
    assert_eq!(
        report
            .test_case_versions
            .iter()
            .filter(|case| case.ingested)
            .count(),
        9
    );
    let efficiency = report
        .test_case_versions
        .iter()
        .find(|case| case.slug == "carom-efficiency")
        .expect("the unlowerable definition is reported");
    assert!(!efficiency.ingested);
    let problem = efficiency
        .problem
        .as_deref()
        .expect("it carries its problem");
    assert!(problem.contains("test-cases/efficiency.toml"), "{problem}");
    assert!(!store.has_version("carom-efficiency", "v1.0.0"));
    // The draft beside the exported version is never read.
    assert!(!slugs(&report).contains(&"carom-sketch".to_string()));

    let manifest = store
        .read_manifest("carom-end-to-end", "v1.0.0")
        .expect("the lowered version is stored");
    let coordinate = manifest.suite.expect("the suite coordinate is recorded");
    assert_eq!(coordinate.suite, "carom");
    assert_eq!(coordinate.suite_version, "v1.0.0");
    assert_eq!(coordinate.definition, "end-to-end");

    // The suite's own record is keyed beside the definitions, not among them.
    assert_eq!(report.suite_versions.len(), 1);
    let record = store
        .read_suite("carom", "v1.0.0")
        .expect("the suite record");
    assert_eq!(record.suite.name, "Carom");
    assert_eq!(record.manifest.version.as_deref(), Some("1.0.0"));
    assert_eq!(record.test_cases.len(), 10);
    assert_eq!(record.test_cases[0].id, "carom-ball");
    assert_eq!(record.description.trim_start().chars().next(), Some('#'));
    assert!(!record.changelog.is_empty());
    assert!(!record.specifications.is_empty());
    assert!(
        record.specifications.iter().any(|spec| spec
            .manifest
            .requirements
            .iter()
            .any(|requirement| { !requirement.validators.is_empty() })),
        "a requirement carries the validator modules it claims"
    );
    assert_eq!(record.reference_implementations, vec!["none", "simple-2d"]);
    assert!(!record.assets.is_empty() && !record.demos.is_empty());

    // The bytes the record points at are stored beside it, under the paths the byte
    // routes take.
    let showcase = record.showcase.expect("the fixture declares a showcase");
    for media in &showcase.media {
        store
            .read_suite_file("carom", "v1.0.0", &format!("showcase/{media}"))
            .unwrap_or_else(|err| panic!("`{media}` is served: {err}"));
    }
    store
        .read_suite_file("carom", "v1.0.0", "assets/ball/ball.vox")
        .expect("an asset file is served");
}

#[test]
fn a_lowered_version_holds_every_file_its_manifest_keys() {
    // The seeded materials a run fetches by key: the rendered specification
    // documents (which exist nowhere in the suites checkout) and the starter
    // workspace files, including the suite's assets an end to end run is seeded
    // with.
    let dir = checkout();
    let store = store(&dir);
    scan(&dir, &store, full());

    let manifest = store.read_manifest("carom-end-to-end", "v1.0.0").unwrap();
    for spec in &manifest.common_specs {
        let bytes = store
            .read_artifact("carom-end-to-end", "v1.0.0", &spec.source)
            .unwrap_or_else(|err| panic!("`{}` is served: {err}", spec.source));
        assert!(!bytes.is_empty());
        assert!(
            spec.source.starts_with("specs/"),
            "a rendered specification is keyed where it seeds: {}",
            spec.source
        );
    }
    let files = manifest.workspace.files().collect::<Vec<_>>();
    assert!(!files.is_empty());
    for file in files {
        store
            .read_artifact("carom-end-to-end", "v1.0.0", &file.source)
            .unwrap_or_else(|err| panic!("`{}` is served: {err}", file.source));
    }
    // And the specs route renders each seeded body for the implicit variant, the
    // way it renders an authored version's.
    for spec in &manifest.common_specs {
        let body = store
            .read_rendered_spec(
                "carom-end-to-end",
                "v1.0.0",
                spec,
                "base",
                "Base",
                None,
                None,
                None,
            )
            .unwrap_or_else(|err| panic!("`{}` renders: {err}", spec.dest));
        assert!(body.contains("## Requirements"), "{}", spec.dest);
    }
    // The validator project and the debug API declaration ride along, so the
    // validation pass has them without reaching the checkout.
    store
        .read_artifact(
            "carom-end-to-end",
            "v1.0.0",
            "validators/ball/constant-speed.ts",
        )
        .expect("the validator project is stored");
    store
        .read_artifact("carom-end-to-end", "v1.0.0", "debug-api.toml")
        .expect("the debug API declaration is stored");
}

#[test]
fn a_second_scan_skips_an_unchanged_suite_and_force_re_ingests_it() {
    let dir = checkout();
    let store = store(&dir);

    let first = scan(&dir, &store, full());
    assert!(first.suite_versions.iter().all(|suite| suite.ingested));
    assert!(lowerable(&first).all(|case| case.ingested));

    let second = scan(&dir, &store, full());
    assert!(
        second.suite_versions.iter().all(|suite| !suite.ingested),
        "an unchanged suite version is skipped"
    );
    assert!(second.test_case_versions.iter().all(|case| !case.ingested));

    let forced = scan(
        &dir,
        &store,
        IngestRequest {
            force: true,
            ..Default::default()
        },
    );
    assert!(forced.suite_versions.iter().all(|suite| suite.ingested));
    assert!(lowerable(&forced).all(|case| case.ingested));
}

#[test]
fn a_store_in_another_record_format_re_ingests_the_whole_catalog() {
    let dir = checkout();
    let store = store(&dir);
    scan(&dir, &store, full());
    assert!(store.is_servable());

    // Stamp the store with the format a previous build wrote: it now holds records
    // this build cannot claim to read, so it is unservable (what `/readyz` reports)
    // until a scan rewrites it — and the next scan does, whatever it was asked for.
    std::fs::write(
        store.root().join(".tcab").join("store-format"),
        (crate::store::STORE_FORMAT - 1).to_string(),
    )
    .expect("the marker is stamped");
    assert!(store.needs_reingest());
    assert!(!store.is_servable());

    let repaired = scan(
        &dir,
        &store,
        IngestRequest {
            test_cases: Some(vec!["carom@v1.0.0".to_string()]),
            ..Default::default()
        },
    );
    assert!(
        lowerable(&repaired).all(|case| case.ingested),
        "a store in another format is repaired by a forced whole-catalog scan"
    );
    assert!(store.is_servable());
}

#[test]
fn an_entry_naming_a_suite_expands_to_every_definition_it_declares() {
    let dir = checkout();
    let store = store(&dir);

    let by_suite = scan(
        &dir,
        &store,
        IngestRequest {
            test_cases: Some(vec!["carom".to_string()]),
            ..Default::default()
        },
    );
    assert_eq!(by_suite.test_case_versions.len(), 10);
    assert_eq!(lowerable(&by_suite).count(), 9);
    assert_eq!(by_suite.suite_versions.len(), 1);

    let by_version = scan(
        &dir,
        &store,
        IngestRequest {
            test_cases: Some(vec!["carom@v1.0.0".to_string()]),
            force: true,
            ..Default::default()
        },
    );
    assert_eq!(by_version.test_case_versions.len(), 10);
    assert!(lowerable(&by_version).all(|case| case.ingested));
    assert_eq!(by_version.suite_versions.len(), 1);
    assert!(store.has_version("carom-end-to-end", "v1.0.0"));
    assert!(store.has_suite_version("carom", "v1.0.0"));
}

#[test]
fn an_entry_naming_neither_tree_still_reports_the_authored_error() {
    let dir = checkout();
    let store = store(&dir);

    let error = Ingestor::new(dir.path(), &store)
        .scan(&IngestRequest {
            test_cases: Some(vec!["not-a-thing".to_string()]),
            ..Default::default()
        })
        .expect_err("an unknown entry is an error");
    assert!(
        error.to_string().contains("not-a-thing"),
        "the error names the entry: {error}"
    );
}

#[test]
fn a_whole_catalog_scan_prunes_a_suite_version_the_checkout_dropped() {
    let dir = checkout();
    let store = store(&dir);
    scan(&dir, &store, full());
    assert!(store.has_suite_version("carom", "v1.0.0"));

    std::fs::remove_dir_all(dir.path().join(TEST_SUITES_DIR).join("carom"))
        .expect("the suite is dropped from the checkout");
    let report = scan(&dir, &store, full());

    assert!(report.suite_versions.is_empty());
    assert!(!store.has_suite_version("carom", "v1.0.0"));
    assert!(!store.has_version("carom-end-to-end", "v1.0.0"));
}

#[test]
fn a_suite_versions_reference_builds_survive_a_re_ingest_and_go_with_its_prune() {
    let dir = checkout();
    let store = store(&dir);
    scan(&dir, &store, full());
    let archive = crate::suite_store::reference_builds::tests::gzipped_tar(&[(
        "index.html",
        b"<html></html>",
    )]);
    store
        .store_suite_reference_build("carom", "v1.0.0", "none", archive.as_slice())
        .expect("the build stores");

    // Ingest stays a copy of the checkout, and the builds are not in the checkout: a
    // forced re-ingest of the version keeps what was uploaded for it.
    scan(
        &dir,
        &store,
        IngestRequest {
            force: true,
            ..Default::default()
        },
    );
    assert_eq!(
        store
            .list_suite_reference_builds("carom", "v1.0.0")
            .expect("the builds list"),
        vec!["none".to_string()]
    );

    std::fs::remove_dir_all(dir.path().join(TEST_SUITES_DIR).join("carom"))
        .expect("the suite is dropped from the checkout");
    scan(&dir, &store, full());

    assert!(!store.has_suite_version("carom", "v1.0.0"));
    assert!(
        !store
            .suite_reference_build_dir("carom", "v1.0.0", "none")
            .exists(),
        "the prune that drops the version drops its builds"
    );
}

#[test]
fn a_suite_version_a_run_references_survives_the_prune() {
    let dir = checkout();
    let store = store(&dir);
    scan(&dir, &store, full());

    std::fs::remove_dir_all(dir.path().join(TEST_SUITES_DIR).join("carom"))
        .expect("the suite is dropped from the checkout");
    // The pair a run references is the lowered test-case version; the suite version
    // it names is protected through the coordinate on that version's manifest.
    let protected =
        std::collections::HashSet::from([("carom-end-to-end".to_string(), "v1.0.0".to_string())]);
    Ingestor::new(dir.path(), &store)
        .with_protected_cases(protected)
        .scan(&full())
        .expect("the scan succeeds");

    assert!(store.has_version("carom-end-to-end", "v1.0.0"));
    assert!(
        store.has_suite_version("carom", "v1.0.0"),
        "the suite version a referenced case was lowered from is kept with it"
    );
    assert!(
        !store.has_version("carom-ball", "v1.0.0"),
        "an unreferenced definition of the same suite is still pruned"
    );
}

#[test]
fn a_suite_version_that_does_not_validate_is_skipped_with_its_problem() {
    let dir = checkout();
    let store = store(&dir);
    let manifest = dir
        .path()
        .join(TEST_SUITES_DIR)
        .join("carom/versions/v1.0.0/version.toml");
    let broken = std::fs::read_to_string(&manifest).unwrap().replace(
        "description = \"description.md\"",
        "description = \"gone.md\"",
    );
    std::fs::write(&manifest, broken).unwrap();

    let report = scan(&dir, &store, full());

    assert_eq!(report.suite_versions.len(), 1);
    let refused = &report.suite_versions[0];
    assert!(!refused.ingested);
    let problem = refused
        .problem
        .as_deref()
        .expect("the refusal carries its problem");
    assert!(
        problem.contains("test-suites/carom/versions/v1.0.0"),
        "{problem}"
    );
    assert!(problem.contains("gone.md"), "{problem}");
    assert!(!store.has_suite_version("carom", "v1.0.0"));
    assert!(
        report.test_case_versions.is_empty(),
        "a refused version offers no definitions"
    );
}

#[test]
fn a_lowered_version_holds_the_suite_it_was_lowered_from() {
    // A run of a suite-defined case is judged against its suite, not only seeded
    // from it: the prompt is rendered from the definition and the specifications
    // it selects, and one requirement outcome is recorded per requirement those
    // specifications declare. So the suite's own declaration is stored beside the
    // seeded materials, and `suite-files` lists exactly what the driver fetches to
    // rebuild the version folder in its definition store.
    let dir = checkout();
    let store = store(&dir);
    scan(&dir, &store, full());

    let keys = store
        .list_suite_files("carom-end-to-end", "v1.0.0")
        .expect("the listing succeeds");
    for expected in [
        "suite.toml",
        "version.toml",
        "debug-api.toml",
        "debug-api/ball.toml",
        "specifications/ball-physics/specification.toml",
        "specifications/ball-physics/spin/specification.toml",
        "test-cases/end-to-end.toml",
        "validators/vitest.config.ts",
        "validators/ball/constant-speed.ts",
    ] {
        assert!(
            keys.iter().any(|key| key == expected),
            "`{expected}` should be listed, got: {keys:?}"
        );
    }
    // Everything listed is servable, which is what makes the listing a fetch plan.
    for key in &keys {
        store
            .read_artifact("carom-end-to-end", "v1.0.0", key)
            .unwrap_or_else(|err| panic!("`{key}` is served: {err}"));
    }
    // And the rebuilt folder reads back as the suite version it came from.
    let root = store.version_dir("carom-end-to-end", "v1.0.0");
    let suite = test_cabinet_core::test_suite::load_suite_manifest_of(&root)
        .expect("the stored tree carries its suite manifest");
    let loaded = test_cabinet_core::test_suite::SuiteVersion::load(&suite, &root)
        .expect("the stored suite loads");
    assert_eq!(loaded.suite.slug, "carom");
    assert_eq!(loaded.manifest.version.as_deref(), Some("1.0.0"));
    assert!(
        loaded
            .test_cases
            .iter()
            .any(|case| case.slug == "end-to-end")
    );
}

#[test]
fn an_authored_version_lists_no_suite_files() {
    // The absent `version.toml` is the whole answer: an authored version was lowered
    // from no suite, so a driver materializing one fetches nothing extra.
    let dir = checkout();
    let store = store(&dir);
    scan(&dir, &store, full());

    assert!(
        store
            .list_suite_files("carom-nothing-here", "v1.0.0")
            .expect("an absent version lists nothing")
            .is_empty()
    );
}

#[test]
fn a_definition_that_fails_to_lower_appears_in_the_progress_feed_with_its_problem() {
    let dir = checkout();
    let store = store(&dir);

    let (total, events, _) = scan_events(&dir, &store, full());

    assert_eq!(total, events.len(), "every scanned version is one event");
    let efficiency = events
        .iter()
        .find(|event| event.slug == "carom-efficiency")
        .expect("the unlowerable definition is an event");
    assert!(!efficiency.ingested);
    let problem = efficiency
        .problem
        .as_deref()
        .expect("the event carries its problem");
    assert!(problem.contains("test-cases/efficiency.toml"), "{problem}");
    assert!(problem.contains("performance"), "{problem}");
}

#[test]
fn a_suite_version_that_fails_to_resolve_appears_in_the_progress_feed_with_its_problem() {
    let dir = checkout();
    let store = store(&dir);
    rewrite(
        &dir,
        "carom/versions/v1.0.0/version.toml",
        "version = \"1.0.0\"",
        "version = \"1.2.0\"",
    );

    for request in [full(), targeted(&["carom@v1.0.0"]), targeted(&["carom"])] {
        let (total, events, report) = scan_events(&dir, &store, request);

        assert_eq!(total, 1);
        assert_eq!(events.len(), 1, "{events:?}");
        let refused = &events[0];
        assert_eq!(
            (refused.slug.as_str(), refused.version.as_str()),
            ("carom", "v1.0.0")
        );
        assert!(!refused.ingested);
        let problem = refused
            .problem
            .as_deref()
            .expect("the event carries its problem");
        assert!(problem.contains("version.toml"), "{problem}");
        assert!(problem.contains("1.2.0"), "{problem}");
        assert!(report.test_case_versions.is_empty());
        assert!(!store.has_suite_version("carom", "v1.0.0"));
    }
}

#[test]
fn a_stored_suite_version_that_no_longer_resolves_is_reported_by_an_unforced_scan() {
    let dir = checkout();
    let store = store(&dir);
    scan(&dir, &store, full());
    assert!(store.has_suite_version("carom", "v1.0.0"));
    assert!(store.has_version("carom-end-to-end", "v1.0.0"));

    rewrite(
        &dir,
        "carom/versions/v1.0.0/version.toml",
        "version = \"1.0.0\"",
        "version = \"1.2.0\"",
    );

    // A targeted scan reports the problem too, but prunes nothing.
    for request in [targeted(&["carom@v1.0.0"]), targeted(&["carom"])] {
        let (total, events, report) = scan_events(&dir, &store, request);
        assert_eq!(total, 1);
        assert_eq!(events.len(), 1, "{events:?}");
        let problem = events[0]
            .problem
            .as_deref()
            .expect("the event carries its problem");
        assert!(problem.contains("1.2.0"), "{problem}");
        assert!(report.test_case_versions.is_empty());
        assert!(store.has_suite_version("carom", "v1.0.0"));
    }

    let (total, events, report) = scan_events(&dir, &store, full());

    assert_eq!(total, 1);
    assert_eq!(events.len(), 1, "{events:?}");
    let refused = &events[0];
    assert_eq!(
        (refused.slug.as_str(), refused.version.as_str()),
        ("carom", "v1.0.0")
    );
    assert!(!refused.ingested);
    let problem = refused
        .problem
        .as_deref()
        .expect("the event carries its problem");
    assert!(problem.contains("version.toml"), "{problem}");
    assert!(problem.contains("1.2.0"), "{problem}");
    assert_eq!(report.suite_versions.len(), 1);
    assert!(report.suite_versions[0].problem.is_some());
    assert!(!store.has_suite_version("carom", "v1.0.0"));
    assert!(!store.has_version("carom-end-to-end", "v1.0.0"));
}

#[test]
fn a_suite_whose_manifest_disagrees_with_its_folder_is_reported_against_suite_toml() {
    let dir = checkout();
    let store = store(&dir);
    rewrite(
        &dir,
        "carom/suite.toml",
        "slug = \"carom\"",
        "slug = \"pool\"",
    );

    let (_, events, _) = scan_events(&dir, &store, full());

    assert_eq!(events.len(), 1, "{events:?}");
    let problem = events[0]
        .problem
        .as_deref()
        .expect("the event carries its problem");
    assert!(problem.contains("suite.toml"), "{problem}");
    assert!(problem.contains("pool"), "{problem}");
}

#[test]
fn drafts_are_never_ingested() {
    let dir = checkout();
    let store = store(&dir);
    let draft = dir.path().join(TEST_SUITES_DIR).join("carom/drafts/main");
    assert!(draft.join("test-cases/sketch.toml").is_file());

    let report = scan(&dir, &store, full());
    assert_eq!(report.suite_versions.len(), 1);
    assert_eq!(report.suite_versions[0].version, "v1.0.0");
    assert!(!store.has_version("carom-sketch", "v1.0.0"));
    assert!(!store.has_suite_version("carom", "main"));

    // A draft named as a target is not a suite version either, so it resolves as
    // the unknown entry it is.
    let error = Ingestor::new(dir.path(), &store)
        .scan(&targeted(&["carom@main"]))
        .expect_err("a draft is not a target");
    assert!(error.to_string().contains("carom"), "{error}");
}

#[test]
fn a_folder_without_a_suite_manifest_is_not_ingested() {
    let dir = checkout();
    let store = store(&dir);
    std::fs::remove_file(dir.path().join(TEST_SUITES_DIR).join("carom/suite.toml"))
        .expect("the suite manifest is removed");

    let report = scan(&dir, &store, full());
    assert!(report.suite_versions.is_empty());
    assert!(report.test_case_versions.is_empty());
}

#[test]
fn a_whole_catalog_scan_prunes_an_exported_version_the_checkout_dropped() {
    let dir = checkout();
    let store = store(&dir);
    scan(&dir, &store, full());
    assert!(store.has_suite_version("carom", "v1.0.0"));

    // The suite stays, but its only exported version goes: the folder no longer
    // holds a `version.toml`.
    std::fs::remove_file(
        dir.path()
            .join(TEST_SUITES_DIR)
            .join("carom/versions/v1.0.0/version.toml"),
    )
    .expect("the version manifest is removed");
    let report = scan(&dir, &store, full());

    assert!(report.suite_versions.is_empty());
    assert!(!store.has_suite_version("carom", "v1.0.0"));
    assert!(!store.has_version("carom-end-to-end", "v1.0.0"));
}

#[test]
fn a_whole_catalog_scan_prunes_a_version_that_now_fails_to_resolve() {
    let dir = checkout();
    let store = store(&dir);
    scan(&dir, &store, full());
    assert!(store.has_suite_version("carom", "v1.0.0"));

    rewrite(
        &dir,
        "carom/versions/v1.0.0/version.toml",
        "description = \"description.md\"",
        "description = \"gone.md\"",
    );
    let report = scan(
        &dir,
        &store,
        IngestRequest {
            force: true,
            ..Default::default()
        },
    );

    assert!(report.suite_versions[0].problem.is_some());
    assert!(!store.has_suite_version("carom", "v1.0.0"));
    assert!(!store.has_version("carom-end-to-end", "v1.0.0"));
}
