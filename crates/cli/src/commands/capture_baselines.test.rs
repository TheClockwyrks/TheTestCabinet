//! Unit tests for the `tcab capture-baselines` helpers shared with
//! `tcab publish-reference`.
//!
//! The build/capture path drives a real `sh` and a real browser and is exercised
//! through `core`'s own `capture_baseline_media` tests; here we pin the pure
//! selection logic both commands route through — version resolution and variant
//! targeting — leaving the clap surface to `cli.test.rs`.

use test_cabinet_core::{AssetKind, TestType};

use super::*;

/// Build a catalog-free [`TestCaseVersion`] with the given variants, each either
/// declaring a reference implementation or not, so the selection helpers can be
/// exercised without a fixture tree on disk. Everything the selection path does
/// not read is left empty (the same minimal-literal fixture style `core`'s
/// validator tests use).
fn test_case(variants: &[(&str, bool)]) -> TestCaseVersion {
    TestCaseVersion {
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
        sheet: None,
        voxel: None,
        model: None,
        ui: None,
        material: None,
        particle: None,
        audio: None,
        common_specs: Vec::new(),
        common_workspace: Vec::new(),
        init: None,
        asset_paths: Vec::new(),
        packages: Vec::new(),
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

/// One variant of the fixture case, declaring a reference implementation or not —
/// the single property variant selection turns on.
fn variant(slug: &str, has_reference: bool) -> Variant {
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
        reference_impl: has_reference.then(|| PathBuf::from(format!("reference-impl/{slug}"))),
    }
}

#[test]
fn select_targets_defaults_to_every_variant_with_a_reference() {
    // The default (and `--all-variants`) sweeps the case, skipping variants that
    // declare no reference implementation rather than failing on them.
    let case = test_case(&[("base", true), ("gyre", false), ("multi", true)]);

    let targets = select_targets(&case, None, false).expect("the sweep should find two targets");

    let slugs: Vec<&str> = targets.iter().map(|v| v.slug.as_str()).collect();
    assert_eq!(slugs, ["base", "multi"]);
}

#[test]
fn select_targets_honors_an_explicit_variant() {
    let case = test_case(&[("base", true), ("multi", true)]);

    let targets = select_targets(&case, Some("multi"), false).expect("an explicit target");

    let slugs: Vec<&str> = targets.iter().map(|v| v.slug.as_str()).collect();
    assert_eq!(slugs, ["multi"]);
}

#[test]
fn select_targets_rejects_an_explicit_variant_without_a_reference() {
    // Explicitly naming a variant that has nothing to capture is a mistake the
    // operator wants surfaced, not silently skipped the way a sweep skips it.
    let case = test_case(&[("base", true), ("gyre", false)]);

    let err = select_targets(&case, Some("gyre"), false)
        .expect_err("a variant with no reference implementation should be rejected");

    assert!(
        format!("{err:#}").contains("declares no `reference_implementation`"),
        "unexpected error: {err:#}"
    );
}

#[test]
fn select_targets_rejects_a_case_with_no_references_at_all() {
    let case = test_case(&[("base", false)]);

    let err = select_targets(&case, None, false)
        .expect_err("a case with no reference implementations has nothing to do");

    assert!(
        format!("{err:#}").contains("nothing to do"),
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
fn baseline_dir_is_variant_scoped_under_the_version_folder() {
    let mut case = test_case(&[("base", true)]);
    case.root = PathBuf::from("test-cases/end-to-end/easy/carom/v1.0.0");

    assert_eq!(
        baseline_dir(&case, "base"),
        PathBuf::from("test-cases/end-to-end/easy/carom/v1.0.0")
            .join(VALIDATION_BASELINE_DIR)
            .join("base")
    );
}
