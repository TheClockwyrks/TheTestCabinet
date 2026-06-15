//! Integration tests over the real `test-cases/` catalog.
//!
//! These resolve the bundled Pong test case through the catalog and seed a fresh
//! repository from it, asserting the seeding contract: the selected variant's
//! specs and the rendered reference images are present, the reference *source* is
//! withheld, and the repository has a single initial commit.

use std::path::{Path, PathBuf};

use test_cabinet_core::{
    FsRepoSeeder, RenderedReference, RepoSeeder, SeedRequest, TestCaseCatalog,
};

/// The repository's `test-cases/` directory.
fn catalog_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../test-cases")
}

#[test]
fn resolves_pong_from_its_manifest() {
    let catalog = TestCaseCatalog::new(catalog_root());

    let cases = catalog.list().expect("list catalog");
    assert!(
        cases.iter().any(|c| c.slug == "pong"),
        "pong should be listed"
    );

    let version = catalog.resolve_latest("pong").expect("resolve latest pong");
    assert_eq!(version.slug, "pong");
    // The prompt template and the decomposed common specs are resolved from the
    // manifest. Every variant seeds the overview spec and the standard mode.
    assert!(version.prompt_path.ends_with("prompt.hbs"));
    assert!(
        version
            .common_specs
            .iter()
            .any(|spec| spec.dest == Path::new("specs/overview.md")),
        "the overview spec should be a common spec"
    );
    assert!(
        version
            .common_specs
            .iter()
            .any(|spec| spec.dest == Path::new("specs/modes/standard.md")),
        "the standard mode should be common to every variant"
    );
    // Site-facing metadata is surfaced from the manifest. Carom declares all of
    // it, including a site-facing description that is resolved but never seeded.
    assert_eq!(version.name, "Carom");
    assert_eq!(version.difficulty, "easy");
    assert_eq!(version.tags, ["arcade", "2d", "paddle", "physics"]);
    assert!(
        version
            .description_path
            .as_ref()
            .is_some_and(|p| p.ends_with("description.md")),
        "the site-facing description should be resolved from the manifest"
    );
    // Three variants are offered: base (standard only), frenzy, and multi.
    let variant_slugs: Vec<&str> = version.variants.iter().map(|v| v.slug.as_str()).collect();
    assert_eq!(variant_slugs, ["base", "frenzy", "multi"]);
    // The frenzy variant adds the frenzy mode spec on top of the common specs.
    let frenzy = version.variant("frenzy").expect("frenzy variant");
    assert!(
        frenzy
            .specs
            .iter()
            .any(|spec| spec.dest == Path::new("specs/modes/frenzy.md")),
        "frenzy should add the frenzy mode spec"
    );
    // The three reference views are rendered to screenshots and seeded as visual
    // targets.
    assert_eq!(version.reference_views.len(), 3);
    assert!(version.reference_views.iter().any(|v| v.view == "title"));
    // Validation is opt-in: the manifest declares a single title check, with an
    // explicit display name.
    assert_eq!(version.checks.len(), 1);
    assert_eq!(version.checks[0].view, "title");
    assert_eq!(version.checks[0].name, "Title Screen");
    assert_eq!(version.checks[0].reference_view, "title");
}

#[test]
fn seeding_includes_spec_and_reference_images_but_not_source() {
    let catalog = TestCaseCatalog::new(catalog_root());
    let version = catalog
        .resolve("pong", "v1.0.0")
        .expect("resolve pong v1.0.0");

    // Seed the base variant: the common specs and nothing mode-specific beyond
    // the standard mode.
    let base = version.variant("base").expect("base variant");
    let specs = version.seeded_specs(base);

    // Stand in for a rendered reference screenshot. The seeder copies the file
    // verbatim, so its bytes do not need to be a real PNG for this contract test
    // — this keeps the test independent of a headless browser.
    let seed_base = tempfile::tempdir().expect("temp dir");
    let fake_image = seed_base.path().join("title-source.png");
    std::fs::write(&fake_image, b"not-a-real-png").expect("write fake image");
    let references = [RenderedReference {
        view: "title".to_string(),
        image_path: fake_image,
    }];

    let seeder = FsRepoSeeder::new(seed_base.path());
    let seeded = seeder
        .seed(&SeedRequest {
            test_case: &version,
            specs: &specs,
            references: &references,
        })
        .expect("seed pong");

    // The base variant's specs are seeded at their destination paths.
    assert!(seeded.path.join("specs/overview.md").is_file());
    assert!(seeded.path.join("specs/modes/standard.md").is_file());
    // The base variant does not seed the frenzy mode spec.
    assert!(!seeded.path.join("specs/modes/frenzy.md").exists());
    // The rendered reference image is seeded as a visual target, with a notice.
    assert!(seeded.path.join("reference/title.png").is_file());
    assert!(seeded.path.join("reference/README.md").is_file());
    // The reference *source* mockup is never seeded.
    assert!(!seeded.path.join("reference/menu.html").exists());
    // A single initial commit exists, with no remote and a recorded hash.
    assert!(!seeded.initial_commit.is_empty());
    assert!(seeded.path.join(".git").is_dir());
}
