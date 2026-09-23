//! Unit tests for the `tcab capture-baselines` helpers shared with
//! `tcab publish-reference`.
//!
//! The build/capture path drives a real `sh` and a real browser and is exercised
//! through `core`'s own `capture_baseline_media` tests; here we pin the pure
//! selection logic both commands route through — version resolution and variant
//! targeting — and the two decisions that put the command's verdict in its exit
//! status, leaving the clap surface to `cli.test.rs`.

use test_cabinet_core::{AssetDimension, AssetKind, EngineSupport, NONE_SLUG, TestType};

use super::*;

/// Build a catalog-free [`TestCaseVersion`] with the given variants, each either
/// declaring a reference implementation or not, so the selection helpers can be
/// exercised without a fixture tree on disk. Everything the selection path does
/// not read is left empty (the same minimal-literal fixture style `core`'s
/// validator tests use).
fn test_case(variants: &[(&str, &[&str])]) -> TestCaseVersion {
    TestCaseVersion {
        toolchain: None,
        slug: "carom".to_string(),
        version: "v1.0.0".to_string(),
        name: "Carom".to_string(),
        difficulty: "easy".to_string(),
        tags: Vec::new(),
        summary: None,
        description_path: None,
        changelog_path: PathBuf::new(),
        root: PathBuf::new(),
        prompt_path: PathBuf::from("prompt.hbs"),
        max_runtime_seconds: 1800,
        test_type: TestType::EndToEnd,
        experimental: false,
        engine_format: false,
        build: None,
        instrumentation: None,
        canvas: None,
        tool: None,
        output: None,
        contract: None,
        sandbox: None,
        simulation: None,
        r#match: None,
        replay: None,
        asset_kind: AssetKind::Sprite,
        asset_dimension: AssetDimension::TwoD,
        sheet: None,
        voxel: None,
        model: None,
        ui: None,
        material: None,
        particle: None,
        audio: None,
        audio_packs: Vec::new(),
        common_specs: Vec::new(),
        common_workspace: Default::default(),
        init: None,
        asset_paths: Vec::new(),
        packages: Vec::new(),
        // Both built-in engines, so a fixture variant can declare a reference for
        // either — selection expands a variant across the engines it published for
        // and holds `--engine` against this set.
        engines: vec![
            EngineSupport::unbounded(NONE_SLUG),
            EngineSupport::unbounded("simple-2d"),
        ],
        variants: variants.iter().map(|v| variant(v.0, v.1)).collect(),
        common_references: Vec::new(),
        common_proofs: Vec::new(),
        checks: Vec::new(),
        common_review_items: Vec::new(),
        domains: Vec::new(),
        cases: Vec::new(),
        errata: Vec::new(),
    }
}

/// One variant of the fixture case, declaring a reference implementation for each
/// engine in `engines` — the property selection turns on.
fn variant(slug: &str, engines: &[&str]) -> Variant {
    Variant {
        slug: slug.to_string(),
        name: slug.to_string(),
        description: None,
        specs: Vec::new(),
        workspace: None,
        references: Vec::new(),
        proofs: Vec::new(),
        review_items: Vec::new(),
        domains: Vec::new(),
        voxel: None,
        showcase: None,
        // Keyed by engine, as resolution produces it: a variant has one reference
        // build per engine, and both commands work in that pair.
        reference_impls: engines
            .iter()
            .map(|engine| {
                (
                    (*engine).to_string(),
                    PathBuf::from(format!("references/{engine}/{slug}")),
                )
            })
            .collect(),
    }
}

/// The `variant@engine` label of every selected target, in selection order.
fn labels(targets: &[Target<'_>]) -> Vec<String> {
    targets.iter().map(Target::label).collect()
}

#[test]
fn select_targets_defaults_to_every_variant_and_engine_with_a_reference() {
    // The default (and `--all-variants`) sweeps the case, skipping variants that
    // declare no reference implementation rather than failing on them, and yielding
    // one target per engine a variant did publish for.
    let case = test_case(&[
        ("base", &["none", "simple-2d"][..]),
        ("gyre", &[][..]),
        ("multi", &["none"][..]),
    ]);

    let targets = select_targets(&case, None, None, false).expect("the sweep should find three");

    assert_eq!(
        labels(&targets),
        ["base@none", "base@simple-2d", "multi@none"]
    );
}

#[test]
fn select_targets_honors_an_explicit_variant() {
    let case = test_case(&[("base", &["none"][..]), ("multi", &["none"][..])]);

    let targets = select_targets(&case, Some("multi"), None, false).expect("an explicit target");

    assert_eq!(labels(&targets), ["multi@none"]);
}

#[test]
fn select_targets_honors_an_explicit_engine() {
    // Narrowing to one engine publishes just that build, across every variant that
    // has one — the flag that lets a re-deploy touch a single runtime.
    let case = test_case(&[
        ("base", &["none", "simple-2d"][..]),
        ("gyre", &["none", "simple-2d"][..]),
    ]);

    let targets =
        select_targets(&case, None, Some("simple-2d"), false).expect("one engine, both variants");

    assert_eq!(labels(&targets), ["base@simple-2d", "gyre@simple-2d"]);
}

#[test]
fn select_targets_rejects_an_engine_the_case_does_not_support() {
    // A typo resolves to an empty sweep otherwise, which reads as "nothing to do"
    // and hides the mistake.
    let case = test_case(&[("base", &["none"][..])]);

    let err = select_targets(&case, None, Some("unreal"), false)
        .expect_err("an unsupported engine should be rejected");

    assert!(
        format!("{err:#}").contains("does not support engine `unreal`"),
        "unexpected error: {err:#}"
    );
}

#[test]
fn select_targets_reports_an_engine_no_variant_published_for() {
    let case = test_case(&[("base", &["none"][..])]);

    let err = select_targets(&case, None, Some("simple-2d"), false)
        .expect_err("no variant published for that engine");

    assert!(
        format!("{err:#}").contains("for engine `simple-2d`"),
        "unexpected error: {err:#}"
    );
}

#[test]
fn select_targets_rejects_an_explicit_variant_without_a_reference() {
    // Explicitly naming a variant that has nothing to capture is a mistake the
    // operator wants surfaced, not silently skipped the way a sweep skips it.
    let case = test_case(&[("base", &["none"][..]), ("gyre", &[][..])]);

    let err = select_targets(&case, Some("gyre"), None, false)
        .expect_err("a variant with no reference implementation should be rejected");

    assert!(
        format!("{err:#}").contains("declares no `reference_implementation`"),
        "unexpected error: {err:#}"
    );
}

#[test]
fn select_targets_rejects_a_case_with_no_references_at_all() {
    let case = test_case(&[("base", &[][..])]);

    let err = select_targets(&case, None, None, false)
        .expect_err("a case with no reference implementations has nothing to do");

    assert!(
        format!("{err:#}").contains("declares a `reference_implementation`"),
        "unexpected error: {err:#}"
    );
}

#[test]
fn resolve_version_prefers_an_explicit_version() {
    // An explicit version short-circuits the catalog entirely, so this needs no
    // fixture tree — which is exactly the property that makes it worth pinning.
    let catalog = TestCaseCatalog::new(PathBuf::from("does-not-exist"));

    let version =
        resolve_version(&catalog, "carom", Some("v1.0.1")).expect("an explicit version resolves");

    assert_eq!(version, "v1.0.1");
}

#[test]
fn baseline_dir_is_engine_and_variant_scoped_under_the_mirrored_cold_storage_path() {
    let mut case = test_case(&[("base", &["none"][..])]);
    case.root = PathBuf::from("test-cases/end-to-end/easy/carom/v1.0.0");
    let cold = ColdStorage::at("", "cold-storage");

    assert_eq!(
        baseline_dir(&cold, &case, "none", "base").expect("the version is in the checkout"),
        PathBuf::from("cold-storage/test-cases/end-to-end/easy/carom/v1.0.0")
            .join(test_cabinet_core::VALIDATION_BASELINE_DIR)
            .join("none")
            .join("base")
    );
}

#[test]
fn baseline_dir_follows_an_overridden_cold_storage_root() {
    let mut case = test_case(&[("base", &["none"][..])]);
    case.root = PathBuf::from("/repo/test-cases/end-to-end/easy/carom/v1.0.0");
    let cold = ColdStorage::at("/repo", "/mnt/media");

    assert_eq!(
        baseline_dir(&cold, &case, "none", "base").expect("the version is in the checkout"),
        PathBuf::from(
            "/mnt/media/test-cases/end-to-end/easy/carom/v1.0.0/validation-baseline/none/base"
        )
    );
}

#[test]
fn baseline_dir_refuses_a_version_outside_the_checkout() {
    let mut case = test_case(&[("base", &["none"][..])]);
    case.root = PathBuf::from("/elsewhere/test-cases/end-to-end/easy/carom/v1.0.0");
    let cold = ColdStorage::at("/repo", "/repo/cold-storage");

    assert!(baseline_dir(&cold, &case, "none", "base").is_err());
}

#[test]
fn an_uninitialized_submodule_directory_is_refused() {
    // nextest runs each test in its own process, so clearing the override here
    // touches no other test.
    unsafe { std::env::remove_var(COLD_STORAGE_DIR_ENV) };
    let checkout = tempfile::tempdir().expect("tempdir");
    let root = checkout.path().join("cold-storage");
    let cold = ColdStorage::at(checkout.path(), &root);

    assert!(
        ensure_cold_storage(&cold).is_err(),
        "a missing root is refused"
    );
    std::fs::create_dir(&root).expect("create the empty submodule directory");
    assert!(
        ensure_cold_storage(&cold).is_err(),
        "the empty directory git leaves for an uninitialized submodule is refused"
    );
    std::fs::write(root.join(".git"), "gitdir: ../.git/modules/cold-storage\n")
        .expect("mark the submodule checked out");
    ensure_cold_storage(&cold).expect("a checked-out submodule is accepted");
}

#[test]
fn two_engines_of_one_variant_capture_into_separate_directories() {
    // The reason the engine is in the path at all: a variant has one reference
    // implementation per engine, and they are different builds. Sharing a directory
    // would have each sweep overwrite the last — and `generate_baseline` clears the
    // directory before it writes, so the loser would not even be a stale mixture but
    // simply gone.
    let mut case = test_case(&[("base", &["none", "simple-2d"][..])]);
    case.root = PathBuf::from("test-cases/end-to-end/easy/carom/v1.0.0");

    let cold = ColdStorage::at("", "cold-storage");

    assert_ne!(
        baseline_dir(&cold, &case, "none", "base").expect("resolves"),
        baseline_dir(&cold, &case, "simple-2d", "base").expect("resolves"),
    );
}

#[test]
fn a_sweep_with_nothing_unclean_reports_no_fault() {
    assert_eq!(sweep_summary(&[], 3), None);
}

#[test]
fn a_sweep_summary_names_the_targets_that_failed() {
    // The count alone would send the operator back through a log that is mostly
    // install and build output to find which reference build to look at.
    let failed = vec!["base@none".to_string(), "hard@simple-2d".to_string()];
    assert_eq!(
        sweep_summary(&failed, 4).as_deref(),
        Some("2 of 4 reference build(s) failed to capture: base@none, hard@simple-2d"),
    );
}

#[test]
fn a_capture_whose_units_all_ran_clean_reports_no_fault() {
    assert_eq!(capture_fault(&[]), None);
}

#[test]
fn a_capture_fault_names_the_units_that_did_not_run_clean() {
    // The reference implementation is the case's own answer, so a unit it could not
    // answer clean is a fault in the case, and the item id is what the author fixes.
    let unclean = vec!["ball-spin".to_string(), "rail-bounce".to_string()];
    assert_eq!(
        capture_fault(&unclean).as_deref(),
        Some(
            "2 baseline unit(s) did not run clean against the reference implementation: \
             ball-spin, rail-bounce"
        ),
    );
}

#[test]
fn an_overridden_root_needs_only_to_exist() {
    let media = tempfile::tempdir().expect("tempdir");
    // nextest runs each test in its own process, so the override is this test's alone.
    unsafe { std::env::set_var(COLD_STORAGE_DIR_ENV, media.path()) };
    let cold = ColdStorage::for_checkout("/repo");

    assert_eq!(cold.root(), media.path());
    ensure_cold_storage(&cold).expect("an existing override directory is accepted");
}
