//! Integration guard: every real manifest committed to the repo must parse and
//! resolve through the same loaders the running services use.
//!
//! The test-case + variant manifests are guarded separately in
//! `catalog_and_seeding.rs` (`every_catalog_case_and_variant_resolves`). This file
//! covers the remaining manifest kinds so that **no** committed manifest — of any
//! kind — can be malformed without a test failing:
//!
//!   - orchestrators (`orchestrators/<slug>/…`)      via [`OrchestratorCatalog`]
//!   - engines       (`engines/<slug>/engine.toml`)   via [`EngineCatalog`]
//!   - harnesses     (`harnesses/<slug>/harness.toml`) via [`DefaultHarnessRegistry`]
//!   - test-case groups (`test-case-groups/<slug>/test-case-group.toml`)
//!     via [`TestCaseGroupCatalog`]
//!
//! (Model configs no longer live on disk — they are seeded into and edited in the
//! backend store — so there is no `models/` manifest to guard here.)
//!
//! Each loader discovers or enumerates the real on-disk files, so a newly added
//! manifest is covered automatically and a schema drift (like a required field the
//! data no longer supplies) surfaces here rather than at ingest time in a service.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use test_cabinet_core::engine::{
    BUILT_IN_SLUGS as BUILT_IN_ENGINE_SLUGS, EngineCatalog, EngineSelection,
};
use test_cabinet_core::{
    BUILT_IN_SLUGS, DefaultHarnessRegistry, HarnessRegistry, HarnessSlug, OrchestratorCatalog,
    OrchestratorSelection, TestCaseCatalog, TestCaseGroupCatalog,
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

/// Every committed engine directory must be a built-in the catalogue knows, and
/// every built-in slug must resolve.
///
/// The engine catalogue is **closed** — there is no external-directory arm, and
/// the manifests are embedded at build time — so unlike the orchestrator test
/// this cannot discover a new directory and load it from disk. What it can do is
/// insist the two halves agree: an `engines/<slug>/` added on disk without being
/// wired into `BUILT_IN_SLUGS` (and so never compiled in, never resolvable, and
/// never validated) is caught here rather than at launch.
#[test]
fn every_engine_manifest_loads() {
    let catalog = EngineCatalog::new();

    let on_disk: BTreeSet<String> = subdirs(&repo_root().join("engines"))
        .iter()
        .filter_map(|path| path.file_name()?.to_str().map(str::to_owned))
        .collect();
    assert!(!on_disk.is_empty(), "no engine directories found");
    let known: BTreeSet<String> = BUILT_IN_ENGINE_SLUGS
        .iter()
        .map(|slug| (*slug).to_owned())
        .collect();
    assert_eq!(
        on_disk, known,
        "engines/ directories must match engine::BUILT_IN_SLUGS exactly"
    );

    // Resolving parses and validates the embedded manifest, so a malformed one
    // panics here (it is an authoring bug, not a runtime condition) and an
    // unknown slug returns an error.
    for slug in BUILT_IN_ENGINE_SLUGS {
        let engine = catalog
            .resolve(&EngineSelection::new(*slug))
            .unwrap_or_else(|err| panic!("resolve built-in engine {slug}: {err:?}"));
        assert_eq!(engine.slug(), *slug);
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

/// Every committed test-case-group manifest must load through the same catalogue
/// the services walk, and every member slug must resolve in the test-case
/// catalog (which covers test cases and game jams alike). The backend's ingest
/// enforces the same membership rule against its own checkout, rejecting an
/// invalid group at scan time; this is the repo-side gate that catches the
/// mistake before it is committed. Discovering the directories from disk means
/// a newly added `test-case-groups/<slug>/` is covered without touching this
/// test.
///
/// Note the member list names each case's manifest-declared **slug**, not its
/// folder: the catalog lists cases by identity (for example the `carom/`
/// folder's case is `pong`), and the run records that back a group's
/// leaderboard carry that identity.
#[test]
fn every_test_case_group_manifest_loads() {
    let root = repo_root();
    let groups = TestCaseGroupCatalog::new(root.join("test-case-groups"))
        .list()
        .unwrap_or_else(|err| panic!("load test-case groups: {err:?}"));
    assert!(!groups.is_empty(), "no test-case groups found");

    let known: BTreeSet<String> = TestCaseCatalog::new(root.join("test-cases"))
        .list()
        .unwrap_or_else(|err| panic!("list the test-case catalog: {err:?}"))
        .into_iter()
        .map(|case| case.slug)
        .collect();
    for group in &groups {
        for member in &group.cases {
            assert!(
                known.contains(member),
                "test-case group `{}` names member `{member}`, which does not resolve in \
                 the test-case catalog (member lists name a case's manifest-declared slug, \
                 not its folder)",
                group.slug
            );
        }
    }
}
