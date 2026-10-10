//! The built-in engine manifests.
//!
//! See `docs/components/core/engines.md`. An engine carries no in-tree Rust code:
//! it is a directory under `engines/` holding one `engine.toml`. This crate bakes
//! those manifests into the binary at build time, so a catalog needs no
//! filesystem access and a backend-driven worker (which has no checkout) resolves
//! the same engines as the CLI.
//!
//! It is data only. Parsing, validating and resolving a manifest is
//! `test_cabinet_suites::engine::EngineCatalog`'s, which takes a table of this
//! shape as an input; `test_cabinet_core::engine::built_in_catalog` is the catalog
//! over [`BUILT_IN`].

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

#[cfg(test)]
#[path = "lib.test.rs"]
mod tests;
