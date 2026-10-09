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
//! the validator runner, and the export rules held to the built-in
//! [engine catalog](crate::engine::EngineCatalog) ([`validate`], [`validate_tree`],
//! [`validate_preview_tree`] and [`load_and_validate`]).

pub use test_cabinet_contracts::test_suite::*;

mod catalog;
mod defaults;
mod lowering;
mod preview;
mod prompt;
mod validation;
mod validators;

pub use catalog::{AuthoredLookup, TestSuite, TestSuiteCatalog, VersionIdentity};
pub use lowering::{SUITE_VARIANT_SLUG, catalog_identity};
pub use preview::{
    DefinitionCompleteness, preview_completeness, preview_files, preview_folder, preview_tree,
    preview_version,
};
pub use prompt::{
    is_suite_defined, preview_definition_prompt, render_definition_prompt,
    render_suite_definition_prompt,
};
pub use validation::{
    PartialSuiteTreeExt, load_and_validate, validate, validate_preview_tree, validate_tree,
};
pub use validators::run_suite_validators;
