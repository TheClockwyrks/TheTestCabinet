//! Test suites: the [format](https://docs.testcabinet.ai/test-suites/overview/) and
//! the runtime that runs one.
//!
//! The format, its typed model, the canonical TOML emitter and the export and
//! save rules live in `test_cabinet_contracts::test_suite`, which this module
//! re-exports whole; core re-exports this module whole in turn, so
//! `test_cabinet_core::test_suite::SuiteVersion` and the rest name the same items
//! they always did. What is here is what reaches the filesystem, a process or a
//! browser on a run's behalf: the catalog that reads a `test-suites/` checkout and
//! lowers its definitions onto runnable test cases, previews, the definition prompt,
//! the validator runner. Each part that checks a declared engine slug takes the
//! [engine catalog](crate::engine::EngineCatalog) it is checked against
//! ([`TestSuiteCatalog::resolve_with`], [`preview_completeness_with`], and the
//! contract's `*_with` export rules); the forms held to the built-in engines
//! (`validate`, `load_and_validate`, `TestSuiteCatalog::resolve` and the rest) are
//! `test_cabinet_core::test_suite`'s, because the built-in table is core's to name.

pub use test_cabinet_contracts::test_suite::*;

mod catalog;
mod defaults;
mod lowering;
mod preview;
mod prompt;
mod validators;

pub use catalog::{AuthoredLookup, TestSuite, TestSuiteCatalog, VersionIdentity};
pub use lowering::{SUITE_VARIANT_SLUG, catalog_identity};
pub use preview::{
    DefinitionCompleteness, preview_completeness_with, preview_files, preview_folder, preview_tree,
    preview_version,
};
pub use prompt::{
    is_suite_defined, preview_definition_prompt, render_definition_prompt,
    render_suite_definition_prompt,
};
pub use validators::run_suite_validators;

// The export rules' tests, over the committed fixture suite and the fixture engine
// table.
#[cfg(test)]
#[path = "validation.test.rs"]
mod validation_tests;
