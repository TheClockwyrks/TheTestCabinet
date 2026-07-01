//! Integration guard: every real manifest committed to the repo must parse and
//! resolve through the same loaders the running services use.
//!
//! The test-case + variant manifests are guarded separately in
//! `catalog_and_seeding.rs` (`every_catalog_case_and_variant_resolves`). This file
//! covers the remaining manifest kinds so that **no** committed manifest — of any
//! kind — can be malformed without a test failing:
//!
//!   - models        (`models/<slug>.toml`)         via [`ModelCatalog`]
//!   - orchestrators (`orchestrators/<slug>/…`)      via [`OrchestratorCatalog`]
//!   - harnesses     (`harnesses/<slug>/harness.toml`) via [`DefaultHarnessRegistry`]
//!
//! Each loader discovers or enumerates the real on-disk files, so a newly added
//! manifest is covered automatically and a schema drift (like a required field the
//! data no longer supplies) surfaces here rather than at ingest time in a service.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use test_cabinet_core::{
    BUILT_IN_SLUGS, DefaultHarnessRegistry, HarnessRegistry, HarnessSlug, ModelCatalog,
    OrchestratorCatalog, OrchestratorSelection,
};

/// The repository root (two levels up from this crate's `Cargo.toml`).
fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// Immediate subdirectory paths of `dir`, ignoring files and hidden entries.
fn subdirs(dir: &Path) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::fs::read_dir(dir)
        .unwrap_or_else(|err| panic!("read {}: {err}", dir.display()))
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir() && !is_hidden(path))
        .collect();
    dirs.sort();
    dirs
}

fn is_hidden(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with('.'))
}

/// Every committed model manifest must list and resolve. Guards `models/*.toml`
/// against schema drift — the model equivalent of a test case failing to ingest.
#[test]
fn every_model_manifest_resolves() {
    let catalog = ModelCatalog::new(repo_root().join("models"));
    let models = catalog.list().expect("list models");
    assert!(!models.is_empty(), "the model catalog should not be empty");
    for model in &models {
        catalog
            .resolve(&model.slug)
            .unwrap_or_else(|err| panic!("resolve model {}: {err:?}", model.slug));
    }
}

/// Every committed orchestrator directory must load from disk, and every built-in
/// slug must resolve. Discovering the directories from disk means a newly added
/// `orchestrators/<slug>/` is covered without touching this test.
#[test]
fn every_orchestrator_manifest_loads() {
    let catalog = OrchestratorCatalog::new();

    let dirs = subdirs(&repo_root().join("orchestrators"));
    assert!(!dirs.is_empty(), "no orchestrator directories found");
    for dir in &dirs {
        catalog
            .resolve(&OrchestratorSelection::external(dir))
            .unwrap_or_else(|err| panic!("load orchestrator {}: {err:?}", dir.display()));
    }

    // The built-ins the services embed must also resolve by slug.
    for slug in BUILT_IN_SLUGS {
        catalog
            .resolve(&OrchestratorSelection::builtin(*slug))
            .unwrap_or_else(|err| panic!("resolve built-in orchestrator {slug}: {err:?}"));
    }
}

/// Every committed harness manifest must parse (constructing the registry parses
/// every embedded `harness.toml`), and the on-disk `harnesses/` directories must
/// line up exactly with [`HarnessSlug::ALL`] — so a new or renamed harness dir that
/// is not wired into the enum (and thus never validated) is caught here.
#[test]
fn every_harness_manifest_parses_and_matches_the_enum() {
    // Constructing the registry parses every embedded harness manifest; an invalid
    // one panics inside `load_manifest`, failing this test.
    let registry = DefaultHarnessRegistry::new();
    for slug in HarnessSlug::ALL {
        assert!(
            registry.get(slug).is_some(),
            "registry is missing harness `{}`",
            slug.as_str()
        );
    }

    let on_disk: BTreeSet<String> = subdirs(&repo_root().join("harnesses"))
        .iter()
        .filter_map(|path| path.file_name()?.to_str().map(str::to_owned))
        .collect();
    let known: BTreeSet<String> = HarnessSlug::ALL
        .iter()
        .map(|slug| slug.as_str().to_owned())
        .collect();
    assert_eq!(
        on_disk, known,
        "harnesses/ directories must match HarnessSlug::ALL exactly"
    );
}
