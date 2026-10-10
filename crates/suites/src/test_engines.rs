//! The engine table this crate's tests build their catalogs over.
//!
//! The crate names no built-in table (core builds the catalog over
//! `test_cabinet_engines::BUILT_IN`), so a test here holds the catalog's logic to
//! fixture manifests under `src/testdata/engines/`: the built-in slugs, each in
//! the shape its real manifest has (`none` with no runtime, the rest with a package
//! and its docs), but not copies of their content. What the real manifests say is
//! held by core's `engine_catalog.test.rs`.

use std::path::Path;

use crate::engine::{EngineCatalog, EngineManifests};

/// The fixture manifest table, in `BUILT_IN_SLUGS` order.
pub(crate) const FIXTURE_ENGINES: EngineManifests = &[
    ("none", include_str!("testdata/engines/none/engine.toml")),
    (
        "simple-2d",
        include_str!("testdata/engines/simple-2d/engine.toml"),
    ),
    (
        "structured-2d",
        include_str!("testdata/engines/structured-2d/engine.toml"),
    ),
    (
        "simple-3d",
        include_str!("testdata/engines/simple-3d/engine.toml"),
    ),
    (
        "structured-3d",
        include_str!("testdata/engines/structured-3d/engine.toml"),
    ),
];

/// A catalog over the fixture table, reading versions from the default package
/// store.
pub(crate) fn fixture_catalog() -> EngineCatalog {
    EngineCatalog::from_manifests(FIXTURE_ENGINES, crate::seeding::package_store_dir())
}

/// A catalog over the fixture table, reading versions from `package_store`.
pub(crate) fn fixture_catalog_in(package_store: &Path) -> EngineCatalog {
    EngineCatalog::from_manifests(FIXTURE_ENGINES, package_store)
}
