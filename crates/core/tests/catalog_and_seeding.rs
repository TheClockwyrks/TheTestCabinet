//! Integration tests over the real `test-cases/` catalog.
//!
//! These resolve the bundled Pong test case through the catalog and seed a fresh
//! repository from it, asserting the seeding contract: the specification is
//! present, the reference visuals are withheld, and the repository has a single
//! initial commit.

use std::path::PathBuf;

use test_cabinet_core::{FsRepoSeeder, RepoSeeder, SeedRequest, TestCaseCatalog};

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
    assert!(version.spec_path.ends_with("specification.md"));
    // The three reference views declared in the manifest are available for
    // validation but are not part of the seeded set.
    assert_eq!(version.reference_views.len(), 3);
    assert!(version.reference_views.iter().any(|v| v.view == "title"));
}

#[test]
fn seeding_includes_the_spec_and_excludes_references() {
    let catalog = TestCaseCatalog::new(catalog_root());
    let version = catalog
        .resolve("pong", "v1.0.0")
        .expect("resolve pong v1.0.0");

    let seed_base = tempfile::tempdir().expect("temp dir");
    let seeder = FsRepoSeeder::new(seed_base.path());
    let seeded = seeder
        .seed(&SeedRequest {
            test_case: &version,
        })
        .expect("seed pong");

    // The specification is seeded at the repository root.
    assert!(seeded.path.join("specification.md").is_file());
    // The reference visuals are never seeded.
    assert!(!seeded.path.join("reference").exists());
    // A single initial commit exists, with no remote and a recorded hash.
    assert!(!seeded.initial_commit.is_empty());
    assert!(seeded.path.join(".git").is_dir());
}
