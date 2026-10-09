//! The ingest roots, and the prune guard a whole-catalog scan applies when a tree
//! it read was empty.

use super::*;

use tempfile::TempDir;

/// Write a file, creating parent directories.
fn write(path: &Path, contents: &str) {
    std::fs::create_dir_all(path.parent().expect("a parent")).expect("the parent is created");
    std::fs::write(path, contents).expect("the file is written");
}

/// Write a minimal authored end-to-end case version under `definitions`, which needs
/// no browser to ingest.
fn write_case(definitions: &Path, slug: &str) {
    let base = definitions
        .join("test-cases/end-to-end/easy")
        .join(slug)
        .join("v1.0.0");
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

/// Write a minimal game-jam version under `<definitions>/game-jams/<slug>/`.
fn write_jam(definitions: &Path, slug: &str) {
    let base = definitions.join("game-jams").join(slug).join("v1.0.0");
    write(&base.join("prompt.hbs"), "Make a game.");
    write(&base.join("changelog.md"), "Introduced.");
    write(
        &base.join("game-jam.toml"),
        &format!(
            "slug = \"{slug}\"\nname = \"Jam\"\ntags = []\n\
             prompt = \"prompt.hbs\"\nchangelog = \"changelog.md\"\n\
             max_runtime_hours = 1\n\
             [build]\ninstall = \"x\"\nbuild = \"y\"\n"
        ),
    );
}

/// Empty a tree in place, leaving the directory itself: the shape a root pointed at
/// the wrong directory, or a checkout that came out partial, takes.
fn empty_tree(dir: &Path) {
    std::fs::remove_dir_all(dir).expect("the tree is removed");
    std::fs::create_dir_all(dir).expect("the tree is created");
}

/// Write a group manifest under `<definitions>/test-case-groups/<slug>/`.
fn write_group(definitions: &Path, slug: &str, cases: &[&str]) {
    let members = cases
        .iter()
        .map(|case| format!("\"{case}\""))
        .collect::<Vec<_>>()
        .join(", ");
    write(
        &definitions
            .join("test-case-groups")
            .join(slug)
            .join("test-case-group.toml"),
        &format!("slug = \"{slug}\"\nname = \"{slug}\"\ncases = [{members}]\n"),
    );
}

/// The committed fixture suites tree, the directory holding `carom/`. Ingest never
/// writes to a suites tree, so a scan can read the committed copy in place.
fn suites_fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../contracts/fixtures/test-suite")
}

/// The case slugs the store holds, sorted.
fn stored_slugs(store: &DefinitionStore) -> Vec<String> {
    let mut slugs: Vec<String> = store
        .list_cases()
        .expect("the store lists")
        .into_iter()
        .map(|(slug, _)| slug)
        .collect();
    slugs.sort();
    slugs
}

/// The group slugs the store holds, in stored order.
fn stored_groups(store: &DefinitionStore) -> Vec<String> {
    store
        .read_test_case_groups()
        .expect("the groups read")
        .into_iter()
        .map(|group| group.slug)
        .collect()
}

/// Roots that read every tree from its own directory, none of them a checkout.
fn separate_roots(definitions: &Path, suites: &Path, cold: &Path) -> IngestRoots {
    IngestRoots {
        definitions: definitions.to_path_buf(),
        suites: suites.to_path_buf(),
        cold_storage: cold.to_path_buf(),
    }
}

// --- Roots ------------------------------------------------------------------

#[test]
fn the_default_roots_are_the_checkout_s_own_trees() {
    // nextest runs each test in its own process, so clearing the override here
    // touches no other test.
    // SAFETY: as above.
    unsafe { std::env::remove_var(test_cabinet_core::COLD_STORAGE_DIR_ENV) };
    let checkout = Path::new("/srv/checkout");
    let roots = IngestRoots::for_checkout(checkout);
    assert_eq!(roots.definitions, checkout);
    assert_eq!(roots.suites, checkout.join("test-suites"));
    assert_eq!(roots.cold_storage, checkout.join("cold-storage"));
    assert_eq!(roots.test_cases(), checkout.join("test-cases"));
    assert_eq!(roots.test_case_groups(), checkout.join("test-case-groups"));
    assert_eq!(
        roots.reference_lock(),
        checkout.join("test-cases/reference-builds.lock.json")
    );
}

#[test]
fn the_default_cold_storage_root_honours_the_capture_commands_override() {
    // SAFETY: this process is this test's alone under nextest, the repo's runner.
    unsafe { std::env::set_var(test_cabinet_core::COLD_STORAGE_DIR_ENV, "/mnt/media") };
    let roots = IngestRoots::for_checkout(Path::new("/srv/checkout"));
    assert_eq!(roots.cold_storage, Path::new("/mnt/media"));
}

#[test]
fn a_scan_reads_each_tree_from_its_own_root() {
    // Three directories, none of them a checkout holding the others: the authored
    // case, its group and its baselines are read from the definitions and
    // cold-storage roots, and the suite from the suites root.
    let definitions = TempDir::new().expect("a temporary directory");
    let cold = TempDir::new().expect("a temporary directory");
    write_case(definitions.path(), "alpha");
    write_group(definitions.path(), "solo", &["alpha"]);
    write(
        &cold
            .path()
            .join("test-cases/end-to-end/easy/alpha/v1.0.0")
            .join(test_cabinet_core::VALIDATION_BASELINE_DIR)
            .join("none/base/spin__still.png"),
        "png:still",
    );
    let store_dir = TempDir::new().expect("a temporary directory");
    let store = DefinitionStore::open(store_dir.path()).expect("the store opens");

    let roots = separate_roots(definitions.path(), &suites_fixture(), cold.path());
    let report = Ingestor::with_roots(roots, &store)
        .scan(&IngestRequest::default())
        .expect("the scan succeeds");

    assert!(
        report.refused_prunes.is_empty(),
        "{:?}",
        report.refused_prunes
    );
    assert!(store.has_version("alpha", "v1.0.0"));
    assert!(store.has_suite_version("carom", "v1.0.0"));
    assert!(store.has_version("carom-end-to-end", "v1.0.0"));
    assert_eq!(stored_groups(&store), ["solo"]);
    assert_eq!(
        store
            .read_validation_baseline("alpha", "v1.0.0", "none", "base", "spin__still.png")
            .expect("the baseline is stored"),
        b"png:still",
    );
}

#[test]
fn the_digest_covers_the_lockfile_under_the_definitions_root() {
    // The authored digest's companion is the lockfile beside the catalog it was
    // read from, so a lockfile edit under a relocated definitions root is a change a
    // `changed` scan picks up.
    let definitions = TempDir::new().expect("a temporary directory");
    let suites = TempDir::new().expect("a temporary directory");
    write_case(definitions.path(), "alpha");
    let store_dir = TempDir::new().expect("a temporary directory");
    let store = DefinitionStore::open(store_dir.path()).expect("the store opens");
    let roots = separate_roots(definitions.path(), suites.path(), suites.path());
    let changed = IngestRequest {
        mode: IngestMode::Changed,
        ..Default::default()
    };

    Ingestor::with_roots(roots.clone(), &store)
        .scan(&changed)
        .expect("the scan succeeds");
    write(&roots.reference_lock(), "{}");
    let report = Ingestor::with_roots(roots, &store)
        .scan(&changed)
        .expect("the scan succeeds");

    assert!(report.test_case_versions[0].ingested);
}

// --- The prune guard --------------------------------------------------------

#[test]
fn an_empty_authored_tree_keeps_the_stored_authored_versions() {
    let checkout = TempDir::new().expect("a temporary directory");
    write_case(checkout.path(), "alpha");
    write_case(checkout.path(), "beta");
    let store_dir = TempDir::new().expect("a temporary directory");
    let store = DefinitionStore::open(store_dir.path()).expect("the store opens");
    Ingestor::new(checkout.path(), &store)
        .scan(&IngestRequest::default())
        .expect("the scan succeeds");

    // The authored tree is still there but declares nothing: the shape a
    // definitions root pointed at the wrong directory takes.
    std::fs::remove_dir_all(checkout.path().join("test-cases")).expect("the tree is removed");
    std::fs::create_dir_all(checkout.path().join("test-cases")).expect("the tree is created");
    let report = Ingestor::new(checkout.path(), &store)
        .scan(&IngestRequest::default())
        .expect("the scan succeeds");

    assert_eq!(stored_slugs(&store), ["alpha", "beta"]);
    assert_eq!(
        report.refused_prunes.len(),
        1,
        "{:?}",
        report.refused_prunes
    );
    assert!(
        report.refused_prunes[0].starts_with("kept 2 stored authored test-case version(s)"),
        "{}",
        report.refused_prunes[0]
    );
    assert!(
        report.refused_prunes[0]
            .contains(&checkout.path().join("test-cases").display().to_string()),
        "the refusal names the tree it found empty: {}",
        report.refused_prunes[0]
    );
}

#[test]
fn an_authored_tree_with_one_version_left_still_prunes() {
    // The guard is about an empty tree, not about removals: a catalog that dropped
    // one of two cases prunes it as it always has.
    let checkout = TempDir::new().expect("a temporary directory");
    write_case(checkout.path(), "alpha");
    write_case(checkout.path(), "beta");
    let store_dir = TempDir::new().expect("a temporary directory");
    let store = DefinitionStore::open(store_dir.path()).expect("the store opens");
    Ingestor::new(checkout.path(), &store)
        .scan(&IngestRequest::default())
        .expect("the scan succeeds");

    std::fs::remove_dir_all(checkout.path().join("test-cases/end-to-end/easy/beta"))
        .expect("the case is removed");
    let report = Ingestor::new(checkout.path(), &store)
        .scan(&IngestRequest::default())
        .expect("the scan succeeds");

    assert_eq!(stored_slugs(&store), ["alpha"]);
    assert!(
        report.refused_prunes.is_empty(),
        "{:?}",
        report.refused_prunes
    );
}

#[test]
fn an_empty_authored_tree_still_ingests_the_suites_and_prunes_their_absent_cases() {
    // The guard keeps what the empty tree would have dropped and nothing more: the
    // suites tree is read and ingested as usual, and its own prune still runs.
    let definitions = TempDir::new().expect("a temporary directory");
    let empty_definitions = TempDir::new().expect("a temporary directory");
    std::fs::create_dir_all(empty_definitions.path().join("test-cases"))
        .expect("the tree is created");
    let no_cold = TempDir::new().expect("a temporary directory");
    write_case(definitions.path(), "alpha");
    let store_dir = TempDir::new().expect("a temporary directory");
    let store = DefinitionStore::open(store_dir.path()).expect("the store opens");
    Ingestor::with_roots(
        separate_roots(definitions.path(), &suites_fixture(), no_cold.path()),
        &store,
    )
    .scan(&IngestRequest::default())
    .expect("the scan succeeds");
    // A stored suite-defined version the suites tree does not declare.
    let stray = store.manifest_path("carom-end-to-end", "v0.9.0");
    std::fs::create_dir_all(stray.parent().expect("a parent")).expect("the parent is created");
    std::fs::copy(store.manifest_path("carom-end-to-end", "v1.0.0"), &stray)
        .expect("the manifest copies");

    let report = Ingestor::with_roots(
        separate_roots(empty_definitions.path(), &suites_fixture(), no_cold.path()),
        &store,
    )
    .scan(&IngestRequest::default())
    .expect("the scan succeeds");

    assert!(
        store.has_version("alpha", "v1.0.0"),
        "the authored case is kept"
    );
    assert!(store.has_suite_version("carom", "v1.0.0"));
    assert!(
        report
            .suite_versions
            .iter()
            .any(|suite| suite.slug == "carom"),
        "the suites tree is still read"
    );
    assert!(
        !store.has_version("carom-end-to-end", "v0.9.0"),
        "an absent suite-defined version is still pruned"
    );
    assert_eq!(
        report.refused_prunes.len(),
        1,
        "{:?}",
        report.refused_prunes
    );
}

#[test]
fn an_empty_suites_tree_keeps_the_stored_suites_and_the_cases_they_defined() {
    let checkout = TempDir::new().expect("a temporary directory");
    write_case(checkout.path(), "alpha");
    let missing = checkout.path().join("not-cloned-yet");
    let store_dir = TempDir::new().expect("a temporary directory");
    let store = DefinitionStore::open(store_dir.path()).expect("the store opens");
    let cold = checkout.path().join("cold-storage");
    Ingestor::with_roots(
        separate_roots(checkout.path(), &suites_fixture(), &cold),
        &store,
    )
    .scan(&IngestRequest::default())
    .expect("the scan succeeds");
    let defined: Vec<String> = stored_slugs(&store)
        .into_iter()
        .filter(|slug| slug.starts_with("carom-"))
        .collect();
    assert!(!defined.is_empty());

    // The suites root names a directory nothing has been cloned into.
    let report = Ingestor::with_roots(separate_roots(checkout.path(), &missing, &cold), &store)
        .scan(&IngestRequest::default())
        .expect("the scan succeeds");

    assert!(store.has_suite_version("carom", "v1.0.0"));
    for slug in &defined {
        assert!(store.has_version(slug, "v1.0.0"), "{slug} is kept");
    }
    assert!(store.has_version("alpha", "v1.0.0"));
    assert_eq!(
        report.refused_prunes.len(),
        1,
        "{:?}",
        report.refused_prunes
    );
    assert!(
        report.refused_prunes[0].starts_with(&format!(
            "kept 1 stored suite version(s) and {} case version(s)",
            defined.len()
        )),
        "{}",
        report.refused_prunes[0]
    );
    assert!(
        report.refused_prunes[0].contains(&missing.display().to_string()),
        "{}",
        report.refused_prunes[0]
    );
}

#[test]
fn an_empty_suites_tree_on_a_store_without_suites_refuses_nothing() {
    // An uninitialized test suites tree is an ordinary checkout: with nothing
    // suite-shaped in the store, there is nothing to keep and nothing to report.
    let checkout = TempDir::new().expect("a temporary directory");
    write_case(checkout.path(), "alpha");
    std::fs::create_dir_all(checkout.path().join("test-suites")).expect("the tree is created");
    let store_dir = TempDir::new().expect("a temporary directory");
    let store = DefinitionStore::open(store_dir.path()).expect("the store opens");

    for _ in 0..2 {
        let report = Ingestor::new(checkout.path(), &store)
            .scan(&IngestRequest::default())
            .expect("the scan succeeds");
        assert!(
            report.refused_prunes.is_empty(),
            "{:?}",
            report.refused_prunes
        );
    }
    assert_eq!(stored_slugs(&store), ["alpha"]);
}

#[test]
fn a_group_tree_that_declares_nothing_keeps_the_stored_groups() {
    let checkout = TempDir::new().expect("a temporary directory");
    write_case(checkout.path(), "alpha");
    write_group(checkout.path(), "solo", &["alpha"]);
    let store_dir = TempDir::new().expect("a temporary directory");
    let store = DefinitionStore::open(store_dir.path()).expect("the store opens");
    Ingestor::new(checkout.path(), &store)
        .scan(&IngestRequest::default())
        .expect("the scan succeeds");

    std::fs::remove_dir_all(checkout.path().join("test-case-groups"))
        .expect("the groups are removed");
    let report = Ingestor::new(checkout.path(), &store)
        .scan(&IngestRequest::default())
        .expect("the scan succeeds");

    assert_eq!(stored_groups(&store), ["solo"]);
    assert!(!report.test_case_groups_changed);
    assert_eq!(
        report.refused_prunes.len(),
        1,
        "{:?}",
        report.refused_prunes
    );
    assert!(
        report.refused_prunes[0].starts_with("kept the 1 stored test-case group(s)"),
        "{}",
        report.refused_prunes[0]
    );
}

#[test]
fn groups_whose_members_no_longer_resolve_keep_the_stored_groups() {
    // The other way a scan accepts no group: the folder is intact, but the catalog
    // it is checked against resolves none of its members.
    let checkout = TempDir::new().expect("a temporary directory");
    write_case(checkout.path(), "alpha");
    write_case(checkout.path(), "beta");
    write_group(checkout.path(), "pair", &["alpha", "beta"]);
    let store_dir = TempDir::new().expect("a temporary directory");
    let store = DefinitionStore::open(store_dir.path()).expect("the store opens");
    Ingestor::new(checkout.path(), &store)
        .scan(&IngestRequest::default())
        .expect("the scan succeeds");

    std::fs::remove_dir_all(checkout.path().join("test-cases/end-to-end/easy/beta"))
        .expect("the case is removed");
    let report = Ingestor::new(checkout.path(), &store)
        .scan(&IngestRequest::default())
        .expect("the scan succeeds");

    assert_eq!(stored_groups(&store), ["pair"]);
    assert_eq!(
        report.refused_prunes.len(),
        1,
        "{:?}",
        report.refused_prunes
    );
}

#[test]
fn a_group_set_still_reconciles_while_one_group_is_accepted() {
    let checkout = TempDir::new().expect("a temporary directory");
    write_case(checkout.path(), "alpha");
    write_group(checkout.path(), "first", &["alpha"]);
    write_group(checkout.path(), "second", &["alpha"]);
    let store_dir = TempDir::new().expect("a temporary directory");
    let store = DefinitionStore::open(store_dir.path()).expect("the store opens");
    Ingestor::new(checkout.path(), &store)
        .scan(&IngestRequest::default())
        .expect("the scan succeeds");

    std::fs::remove_dir_all(checkout.path().join("test-case-groups/second"))
        .expect("the group is removed");
    let report = Ingestor::new(checkout.path(), &store)
        .scan(&IngestRequest::default())
        .expect("the scan succeeds");

    assert_eq!(stored_groups(&store), ["first"]);
    assert!(report.test_case_groups_changed);
    assert!(
        report.refused_prunes.is_empty(),
        "{:?}",
        report.refused_prunes
    );
}

#[test]
fn a_partial_scan_reports_no_refusal() {
    // A partial scan prunes nothing, so it has nothing to refuse even against an
    // empty tree.
    let checkout = TempDir::new().expect("a temporary directory");
    write_case(checkout.path(), "alpha");
    let store_dir = TempDir::new().expect("a temporary directory");
    let store = DefinitionStore::open(store_dir.path()).expect("the store opens");
    Ingestor::new(checkout.path(), &store)
        .scan(&IngestRequest::default())
        .expect("the scan succeeds");

    let report = Ingestor::new(checkout.path(), &store)
        .scan(&IngestRequest {
            test_cases: Some(vec!["alpha".to_string()]),
            ..Default::default()
        })
        .expect("the scan succeeds");
    assert!(report.refused_prunes.is_empty());
}

#[test]
fn a_populated_jam_tree_does_not_vouch_for_an_emptied_case_tree() {
    // One catalog reads `test-cases/` and `game-jams/`, but each tree answers for
    // its own kind: a jam that came through cannot let an emptied case tree prune.
    let checkout = TempDir::new().expect("a temporary directory");
    write_case(checkout.path(), "alpha");
    write_case(checkout.path(), "beta");
    write_jam(checkout.path(), "jam");
    let store_dir = TempDir::new().expect("a temporary directory");
    let store = DefinitionStore::open(store_dir.path()).expect("the store opens");
    Ingestor::new(checkout.path(), &store)
        .scan(&IngestRequest::default())
        .expect("the scan succeeds");
    assert_eq!(stored_slugs(&store), ["alpha", "beta", "jam"]);

    empty_tree(&checkout.path().join("test-cases"));
    let report = Ingestor::new(checkout.path(), &store)
        .scan(&IngestRequest::default())
        .expect("the scan succeeds");

    assert_eq!(stored_slugs(&store), ["alpha", "beta", "jam"]);
    assert_eq!(
        report.refused_prunes.len(),
        1,
        "{:?}",
        report.refused_prunes
    );
    assert!(
        report.refused_prunes[0].starts_with("kept 2 stored authored test-case version(s)"),
        "{}",
        report.refused_prunes[0]
    );
}

#[test]
fn an_emptied_jam_tree_keeps_the_stored_jams() {
    let checkout = TempDir::new().expect("a temporary directory");
    write_case(checkout.path(), "alpha");
    write_case(checkout.path(), "beta");
    write_jam(checkout.path(), "jam");
    let store_dir = TempDir::new().expect("a temporary directory");
    let store = DefinitionStore::open(store_dir.path()).expect("the store opens");
    Ingestor::new(checkout.path(), &store)
        .scan(&IngestRequest::default())
        .expect("the scan succeeds");

    // The case tree still prunes as usual beside the guarded jam tree.
    std::fs::remove_dir_all(checkout.path().join("test-cases/end-to-end/easy/beta"))
        .expect("the case is removed");
    empty_tree(&checkout.path().join("game-jams"));
    let report = Ingestor::new(checkout.path(), &store)
        .scan(&IngestRequest::default())
        .expect("the scan succeeds");

    assert_eq!(stored_slugs(&store), ["alpha", "jam"]);
    assert_eq!(
        report.refused_prunes.len(),
        1,
        "{:?}",
        report.refused_prunes
    );
    assert!(
        report.refused_prunes[0].starts_with("kept 1 stored game-jam version(s)"),
        "{}",
        report.refused_prunes[0]
    );
    assert!(
        report.refused_prunes[0].contains(&checkout.path().join("game-jams").display().to_string()),
        "the refusal names the tree it found empty: {}",
        report.refused_prunes[0]
    );
}

#[test]
fn a_scan_that_refused_a_prune_records_no_catalog_token() {
    // The token claims the store holds that catalog; a refused prune leaves it
    // holding another one, so the next scan with the token must not skip.
    let checkout = TempDir::new().expect("a temporary directory");
    write_case(checkout.path(), "alpha");
    let store_dir = TempDir::new().expect("a temporary directory");
    let store = DefinitionStore::open(store_dir.path()).expect("the store opens");
    let tagged = |token: &str| IngestRequest {
        catalog_version: Some(token.to_string()),
        ..Default::default()
    };
    Ingestor::new(checkout.path(), &store)
        .scan(&tagged("first"))
        .expect("the scan succeeds");
    assert_eq!(store.catalog_version().as_deref(), Some("first"));

    empty_tree(&checkout.path().join("test-cases"));
    let report = Ingestor::new(checkout.path(), &store)
        .scan(&tagged("second"))
        .expect("the scan succeeds");
    assert_eq!(report.refused_prunes.len(), 1);
    assert_eq!(store.catalog_version().as_deref(), Some("first"));

    write_case(checkout.path(), "alpha");
    let report = Ingestor::new(checkout.path(), &store)
        .scan(&tagged("second"))
        .expect("the scan succeeds");
    assert!(report.refused_prunes.is_empty());
    assert!(
        report
            .test_case_versions
            .iter()
            .all(|version| version.ingested),
        "a token the store never recorded forces the rewrite: {:?}",
        report.test_case_versions
    );
    assert_eq!(store.catalog_version().as_deref(), Some("second"));
}

#[test]
fn a_store_in_another_record_format_is_exempt_from_the_guard() {
    // The promoted repair scan rewrites the store to hold only records this build
    // wrote, so an empty tree prunes what the store held rather than keep records
    // nothing here can read.
    let checkout = TempDir::new().expect("a temporary directory");
    write_case(checkout.path(), "alpha");
    write_case(checkout.path(), "beta");
    let store_dir = TempDir::new().expect("a temporary directory");
    let store = DefinitionStore::open(store_dir.path()).expect("the store opens");
    Ingestor::new(checkout.path(), &store)
        .scan(&IngestRequest::default())
        .expect("the scan succeeds");

    write(
        &store_dir
            .path()
            .join(crate::store::SIDECAR)
            .join("store-format"),
        "0",
    );
    assert!(store.needs_reingest());
    empty_tree(&checkout.path().join("test-cases"));
    let report = Ingestor::new(checkout.path(), &store)
        .scan(&IngestRequest::default())
        .expect("the scan succeeds");

    assert!(stored_slugs(&store).is_empty());
    assert!(
        report.refused_prunes.is_empty(),
        "{:?}",
        report.refused_prunes
    );
}
