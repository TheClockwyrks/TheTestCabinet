//! Tests for the engine catalogue: resolving each built-in, the runtime split
//! between an engine that vendors one and the `none` baseline, and the default
//! selection.

use super::*;

// --- catalog resolution -----------------------------------------------------

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
    assert_eq!(engine.package(), Some("@test-cabinet/simple-2d"));
    assert_eq!(engine.docs(), Some("docs"));
}

#[test]
fn an_unknown_slug_is_an_error_naming_the_valid_slugs() {
    let catalog = EngineCatalog::new();
    let err = catalog
        .resolve(&EngineSelection::new("unreal"))
        .expect_err("an unknown engine is refused");

    let message = err.to_string();
    assert!(
        message.contains("unreal"),
        "the message must name what was asked for: {message}"
    );
    // A typo on `--engine` should be fixable from the message alone, so every
    // slug that would have worked is listed.
    for slug in BUILT_IN_SLUGS {
        assert!(
            message.contains(slug),
            "the message must name built-in `{slug}`: {message}"
        );
    }
}

// --- selection --------------------------------------------------------------

#[test]
fn the_default_selection_is_none() {
    // A run that names no engine gets no runtime — the behaviour every case had
    // before engines existed.
    assert_eq!(EngineSelection::default(), EngineSelection::none());
    assert_eq!(EngineSelection::default().slug, NONE_SLUG);
}

// --- enumeration ------------------------------------------------------------

#[test]
fn all_lists_every_builtin_in_catalogue_order() {
    let catalog = EngineCatalog::new();
    let all = catalog.all();
    let slugs: Vec<&str> = all.iter().map(|manifest| manifest.slug.as_str()).collect();
    assert_eq!(slugs, BUILT_IN_SLUGS);
}

// --- slug shape -------------------------------------------------------------

#[test]
fn kebab_case_accepts_slugs_and_rejects_the_shapes_a_slug_must_not_take() {
    assert!(is_kebab_case("none"));
    assert!(is_kebab_case("simple-2d"));
    assert!(is_kebab_case("a1"));

    assert!(!is_kebab_case(""));
    assert!(!is_kebab_case("-lead"));
    assert!(!is_kebab_case("trail-"));
    assert!(!is_kebab_case("double--hyphen"));
    assert!(!is_kebab_case("Simple2D"));
    assert!(!is_kebab_case("simple_2d"));
    assert!(!is_kebab_case("simple 2d"));
}

// --- staged versions --------------------------------------------------------

/// A package store holding one staged package `name` whose `package.json`
/// declares `version` verbatim (so a test can stage a version that is not a
/// version at all).
fn store_with(name: &str, version: &str) -> tempfile::TempDir {
    let store = tempfile::tempdir().expect("temp store");
    let dir = store.path().join(name);
    std::fs::create_dir_all(&dir).expect("create staged package dir");
    std::fs::write(
        dir.join("package.json"),
        format!("{{\"name\":\"{name}\",\"version\":\"{version}\"}}"),
    )
    .expect("write staged package.json");
    store
}

#[test]
fn a_resolved_engine_reports_the_version_of_its_staged_package() {
    // The version is the *staged package's*, not a number copied into
    // `engine.toml` — the same file the seeder reads when it vendors the package
    // and records the version on the run, so the gate and the record can never
    // disagree.
    let store = store_with("@test-cabinet/simple-2d", "1.4.2");
    let engine = EngineCatalog::with_package_store(store.path())
        .resolve(&EngineSelection::new("simple-2d"))
        .expect("`simple-2d` resolves");

    assert_eq!(
        engine.version(),
        Some(&Version::parse("1.4.2").expect("version"))
    );
}

#[test]
fn the_engineless_engine_reports_no_version() {
    // Not a missing version: `none` vendors no package, so there is nothing to
    // have a version.
    let store = store_with("@test-cabinet/simple-2d", "1.4.2");
    let engine = EngineCatalog::with_package_store(store.path())
        .resolve(&EngineSelection::none())
        .expect("`none` resolves");

    assert!(!engine.provides_runtime());
    assert_eq!(engine.version(), None);
}

#[test]
fn an_engine_missing_from_the_store_resolves_without_a_version() {
    // A catalogue lookup is not a run: `tcab engines`, a case resolving its
    // declared slugs, and a `tcab validate` on a host that has staged nothing all
    // resolve engines without ever seeding one, so an empty store is not an error
    // here. The two places it matters refuse on their own.
    let store = tempfile::tempdir().expect("temp store");
    let engine = EngineCatalog::with_package_store(store.path())
        .resolve(&EngineSelection::new("simple-2d"))
        .expect("resolution does not depend on the store");

    assert!(engine.provides_runtime());
    assert_eq!(engine.version(), None);
}

#[test]
fn a_staged_version_that_is_not_a_semantic_version_reports_none() {
    let store = store_with("@test-cabinet/simple-2d", "nightly");
    let engine = EngineCatalog::with_package_store(store.path())
        .resolve(&EngineSelection::new("simple-2d"))
        .expect("resolution does not depend on the store");

    assert_eq!(engine.version(), None);
}
