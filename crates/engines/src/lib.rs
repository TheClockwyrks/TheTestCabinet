//! The built-in engines: their manifests, and the catalog over them.
//!
//! See `docs/components/engines/overview.md`. An engine carries no in-tree Rust
//! code: it is a directory under `engines/` holding one `engine.toml`. This crate
//! bakes those manifests into the binary at build time ([`BUILT_IN`]), so a catalog
//! needs no filesystem access and a backend-driven worker (which has no checkout)
//! resolves the same engines as the CLI.
//!
//! Parsing, validating and resolving a manifest is
//! `test_cabinet_suites::engine::EngineCatalog`'s, which takes a table of this
//! shape as an input and names no table of its own. [`built_in_catalog`] binds that
//! catalog to the authored engines, and every caller that resolves an engine
//! selection, or checks the engines a test case or suite declares, takes it from
//! here.

use std::path::PathBuf;

use test_cabinet_suites::engine::EngineCatalog;

/// Every built-in engine's manifest, as `(slug, engine.toml source)`, in
/// catalogue order: the order of `test_cabinet_contracts::engine::BUILT_IN_SLUGS`.
pub const BUILT_IN: &[(&str, &str)] = &[
    ("none", include_str!("../../../engines/none/engine.toml")),
    (
        "simple-2d",
        include_str!("../../../engines/simple-2d/engine.toml"),
    ),
    (
        "structured-2d",
        include_str!("../../../engines/structured-2d/engine.toml"),
    ),
    (
        "simple-3d",
        include_str!("../../../engines/simple-3d/engine.toml"),
    ),
    (
        "structured-3d",
        include_str!("../../../engines/structured-3d/engine.toml"),
    ),
];

/// The catalog over the built-in engines, reading each engine's version from the
/// default host package store: the `TCAB_PACKAGE_STORE` override when set,
/// otherwise the baked-image default (`test_cabinet_suites::seeding::package_store_dir`),
/// the store the driver's seeder vendors from.
pub fn built_in_catalog() -> EngineCatalog {
    built_in_catalog_in(test_cabinet_suites::seeding::package_store_dir())
}

/// The catalog over the built-in engines, reading each engine's version from an
/// explicit `package_store`.
///
/// For tests and for a caller staging packages somewhere of its own; pair it with
/// a seeder over the same store, so the version a case's range is checked against
/// is the version the run is seeded with.
pub fn built_in_catalog_in(package_store: impl Into<PathBuf>) -> EngineCatalog {
    EngineCatalog::from_manifests(BUILT_IN, package_store)
}

#[cfg(test)]
#[path = "lib.test.rs"]
mod tests;

#[cfg(test)]
#[path = "lib.catalog.test.rs"]
mod catalog_tests;
