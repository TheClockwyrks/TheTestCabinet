//! Engines: the runtime a produced game is built on, and the catalog of the built-in
//! ones.
//!
//! See `docs/components/core/engines.md`. The engine shapes are
//! `test_cabinet_contracts::engine`'s and the catalog that resolves a selection
//! against a table of manifests is `test_cabinet_suites::engine`'s; this module
//! re-exports both whole, so `test_cabinet_core::engine::EngineCatalog` and the rest
//! name the same items they always did. What is core's is the table the default
//! catalog is built over: `test_cabinet_engines::BUILT_IN`, the `engines/`
//! manifests baked in at build time.
//!
//! [`EngineCatalog::new`](EngineCatalogExt::new) and
//! [`EngineCatalog::with_package_store`](EngineCatalogExt::with_package_store) are
//! [`EngineCatalogExt`]'s, so a caller brings the trait into scope
//! (`use test_cabinet_core::engine::EngineCatalogExt as _;`) and writes them as it
//! always did.

use std::path::PathBuf;

pub use test_cabinet_suites::engine::*;

/// The constructors of the catalog over the built-in engines.
///
/// The catalog type is the suites crate's, which names no table of its own, so the
/// constructors that name the built-in table are an extension trait here rather
/// than inherent methods there.
pub trait EngineCatalogExt {
    /// Build a catalog over the built-in engines, reading versions from the
    /// default host package store (the `TCAB_PACKAGE_STORE` override when set,
    /// otherwise the baked-image default), exactly as `FsRepoSeeder::new`
    /// ([`crate::seeding`]) does.
    fn new() -> Self;

    /// Build a catalog over the built-in engines, reading versions from an explicit
    /// package store rather than the default one. The counterpart of
    /// `FsRepoSeeder::with_package_store`, for tests and for a caller staging
    /// packages somewhere of its own; pair the two so the version a case's range is
    /// checked against is the version the run is seeded with.
    fn with_package_store(package_store: impl Into<PathBuf>) -> Self;
}

impl EngineCatalogExt for EngineCatalog {
    fn new() -> Self {
        Self::with_package_store(crate::seeding::package_store_dir())
    }

    fn with_package_store(package_store: impl Into<PathBuf>) -> Self {
        EngineCatalog::from_manifests(test_cabinet_engines::BUILT_IN, package_store)
    }
}

/// The catalog over the built-in engines, reading versions from the default host
/// package store: [`EngineCatalog::new`](EngineCatalogExt::new).
pub fn built_in_catalog() -> EngineCatalog {
    EngineCatalog::new()
}

#[cfg(test)]
#[path = "engine_catalog.test.rs"]
mod tests;
