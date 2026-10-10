//! Tests for the built-in engine catalog: each built-in manifest resolves, the
//! runtime split between an engine that vendors one and the `none` baseline, and
//! the catalogue order.
//!
//! These hold what the real manifests in `engines/` say, through
//! `test_cabinet_engines::BUILT_IN`; what the catalog does with a manifest is held by
//! the suites crate's `engine.test.rs` over a fixture table.

use super::*;

#[test]
fn every_builtin_slug_resolves() {
    let catalog = EngineCatalog::new();
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
    let catalog = EngineCatalog::new();
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
    let catalog = EngineCatalog::new();
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
    let catalog = EngineCatalog::new();
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
    let catalog = EngineCatalog::new();
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
    let catalog = EngineCatalog::new();
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
    let catalog = EngineCatalog::new();
    let all = catalog.all();
    let slugs: Vec<&str> = all.iter().map(|manifest| manifest.slug.as_str()).collect();
    assert_eq!(slugs, BUILT_IN_SLUGS);
}
