//! Tests for the built-in engine catalog: each built-in manifest resolves, the
//! runtime split between an engine that vendors one and the `none` baseline, and
//! the catalogue order.
//!
//! These hold what the real manifests in `engines/` say, through [`BUILT_IN`];
//! what the catalog does with a manifest is held by the suites crate's
//! `engine.test.rs` over a fixture table.

use test_cabinet_suites::engine::{BUILT_IN_SLUGS, EngineSelection, NONE_SLUG};
use test_cabinet_suites::prompt::TemplateEngine;

use super::*;

#[test]
fn every_builtin_slug_resolves() {
    let catalog = built_in_catalog();
    for slug in BUILT_IN_SLUGS {
        let engine = catalog
            .resolve(&EngineSelection::new(*slug))
            .unwrap_or_else(|err| panic!("resolve built-in engine `{slug}`: {err:?}"));
        // The manifest embedded under `engines/<slug>/` must claim that slug; the
        // load asserts it, and this is the guard that the assert ran on every one.
        assert_eq!(engine.slug(), *slug);
        assert!(!engine.manifest.name.trim().is_empty());
        assert!(!engine.manifest.description.trim().is_empty());
    }
}

#[test]
fn none_provides_no_runtime() {
    let catalog = built_in_catalog();
    let engine = catalog
        .resolve(&EngineSelection::none())
        .expect("`none` resolves");

    assert_eq!(engine.slug(), NONE_SLUG);
    assert!(
        !engine.provides_runtime(),
        "`none` is the baseline: it vendors nothing"
    );
    // Nothing to seed, nothing to bind a host interface to, nothing to document.
    assert_eq!(engine.package(), None);
    assert_eq!(engine.docs(), None);
}

#[test]
fn simple_2d_reports_its_package_and_docs() {
    let catalog = built_in_catalog();
    let engine = catalog
        .resolve(&EngineSelection::new("simple-2d"))
        .expect("`simple-2d` resolves");

    assert!(engine.provides_runtime());
    // These three are the seeding contract: what to copy out of the host package
    // store, what a driver binds to, and which directory is seeded as the
    // workspace's engine documentation.
    assert_eq!(engine.package(), Some("@clockwyrks/simple-2d"));
    assert_eq!(engine.docs(), Some("docs"));
}

#[test]
fn structured_2d_reports_its_package_and_docs() {
    let catalog = built_in_catalog();
    let engine = catalog
        .resolve(&EngineSelection::new("structured-2d"))
        .expect("`structured-2d` resolves");

    assert!(engine.provides_runtime());
    // These three are the seeding contract: what to copy out of the host package
    // store, what a driver binds to, and which directory is seeded as the
    // workspace's engine documentation.
    assert_eq!(engine.package(), Some("@clockwyrks/structured-2d"));
    assert_eq!(engine.docs(), Some("docs"));
}

#[test]
fn simple_3d_reports_its_package_and_docs() {
    let catalog = built_in_catalog();
    let engine = catalog
        .resolve(&EngineSelection::new("simple-3d"))
        .expect("`simple-3d` resolves");

    assert!(engine.provides_runtime());
    // These three are the seeding contract: what to copy out of the host package
    // store, what a driver binds to, and which directory is seeded as the
    // workspace's engine documentation.
    assert_eq!(engine.package(), Some("@clockwyrks/simple-3d"));
    assert_eq!(engine.docs(), Some("docs"));
}

#[test]
fn structured_3d_reports_its_package_and_docs() {
    let catalog = built_in_catalog();
    let engine = catalog
        .resolve(&EngineSelection::new("structured-3d"))
        .expect("`structured-3d` resolves");

    assert!(engine.provides_runtime());
    // These three are the seeding contract: what to copy out of the host package
    // store, what a driver binds to, and which directory is seeded as the
    // workspace's engine documentation.
    assert_eq!(engine.package(), Some("@clockwyrks/structured-3d"));
    assert_eq!(engine.docs(), Some("docs"));
}

#[test]
fn all_lists_every_builtin_in_catalogue_order() {
    let catalog = built_in_catalog();
    let all = catalog.all();
    let slugs: Vec<&str> = all.iter().map(|manifest| manifest.slug.as_str()).collect();
    assert_eq!(slugs, BUILT_IN_SLUGS);
}

#[test]
fn engineless_context_matches_the_none_engine() {
    // Selecting `none` explicitly and selecting nothing at all must be
    // indistinguishable to a template, which is what lets a case declare `none` in
    // its `engines` list for readability without changing a single rendered word.
    // This is the guard on the sentinel name the suites crate's `prompt` renders
    // for an engineless run: if `engines/none/engine.toml` were renamed, these two
    // would diverge.
    let none = built_in_catalog()
        .resolve(&EngineSelection::none())
        .expect("`none` resolves");
    let selected = serde_json::to_value(TemplateEngine::new(Some(&none), "")).expect("serialize");
    let unselected = serde_json::to_value(TemplateEngine::new(None, "")).expect("serialize");
    assert_eq!(selected, unselected);
    assert_eq!(selected["name"], "None");
}

#[test]
fn an_explicit_package_store_is_the_one_versions_are_read_from() {
    // An empty store stages nothing, so a runtime engine resolves with no version
    // rather than the default store's.
    let store = tempfile::tempdir().expect("a scratch store");
    let engine = built_in_catalog_in(store.path())
        .resolve(&EngineSelection::new("simple-2d"))
        .expect("`simple-2d` resolves");
    assert_eq!(engine.version(), None);
}
