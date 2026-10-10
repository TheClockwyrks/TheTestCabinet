//! # test-cabinet-suites
//!
//! The test-suite runtime: what reads a `test-suites/` checkout and turns an offered
//! definition into something a run executes, on the filesystem, in a process or in a
//! browser. See `docs/components/core/overview.md`.
//!
//! - [`test_suite`]: the suite catalog, the lowering of a definition onto a test case
//!   version, previews, a definition's prompt, the export rules held to an engine
//!   catalog, and the runner for a suite's validator project.
//! - [`engine`]: the engine catalog over a table of manifests it is handed, and the
//!   version each engine's staged package reports. The built-in table is
//!   `test_cabinet_engines::BUILT_IN`; core builds its default catalog over it.
//! - [`vitest_validator`], [`validator`] and [`browser`]: a case's or a suite's vitest
//!   project, the verdict units a checklist flattens into, and the static server and
//!   browser driver the validators use.
//! - [`prompt`]: a suite definition's prompt and the helpers an authored case's
//!   prompt shares with it.
//! - [`content_digest`] and [`content_labels`]: what an ingest keys a version by.
//!
//! The shapes these read and write are `test_cabinet_contracts`'. The run that
//! executes the result is `test_cabinet_core`'s, which depends on this crate and
//! re-exports every module at its old path, so `test_cabinet_core::test_suite::*`,
//! `test_cabinet_core::engine::EngineCatalog` and the rest keep naming the same items.
//! What names the built-in engines is core's: the catalog over the built-in table,
//! and the forms of the export rules, the suite catalog's resolution and the preview
//! completeness that use it (each `*_with` form here takes the catalog).

pub mod browser;
pub mod content_digest;
pub mod content_labels;
pub mod engine;
pub mod error;
pub mod execution;
pub mod fs;
pub mod prompt;
pub mod seeding;
pub mod test_suite;
pub mod validator;
pub mod vitest_validator;

/// What a test driving a real browser needs, and the `TCAB_REQUIRE_BROWSER`
/// rule for when it is missing. Exposed to other crates' tests by the
/// `test-support` feature.
#[cfg(any(test, feature = "test-support"))]
pub mod test_browser;

#[cfg(test)]
mod test_engines;

pub use error::{Error, Result};

// The contract modules the moved code names by their `crate::` paths, as it did in
// core, where they are re-exported at the same names.
use test_cabinet_contracts::{test_case, toolchain, validation};
