//! Engines: the runtime a produced game is built on, and the catalog of the built-in
//! ones.
//!
//! The engine shapes are `test_cabinet_contracts::engine`'s, the catalog that
//! resolves a selection against a table of manifests is `test_cabinet_suites::engine`'s,
//! and the catalog bound to the built-in table is the engines repository's
//! `test_cabinet_engines::built_in_catalog`. This module re-exports all three at the
//! old path, so `test_cabinet_core::engine::EngineCatalog` and the rest name the same
//! items they always did.

pub use test_cabinet_engines::{built_in_catalog, built_in_catalog_in};
pub use test_cabinet_suites::engine::*;
