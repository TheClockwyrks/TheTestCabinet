//! The suite runtime's error type.
//!
//! Each variant is one of `test_cabinet_core::Error`'s, with the same fields and the
//! same message, and core converts one into the other variant for variant
//! (`impl From<test_cabinet_suites::Error> for test_cabinet_core::Error`). A failure
//! raised here therefore reads exactly as it did when this code was core's, whichever
//! crate's error a caller ends up holding.

use std::io;

use thiserror::Error;

/// Convenience result alias used throughout the crate.
pub type Result<T, E = Error> = std::result::Result<T, E>;

/// Errors the suite runtime raises.
///
/// The message grammar is core's: a clause naming the stage that was running, with
/// the detail from the layer below it behind a colon. Not `#[non_exhaustive]`: core
/// matches it exhaustively, so a variant added here is mapped there before it builds.
#[derive(Debug, Error)]
pub enum Error {
    /// A [test suite](crate::test_suite) version could not be resolved into a
    /// runnable test case: a file it declares is missing, disagrees with the folder
    /// that holds it, or carries something resolution cannot lower.
    ///
    /// The suite counterpart of core's `Error::InvalidTestCase`. A suite is many
    /// files, so this names the one that caused the failure alongside the suite
    /// coordinate — "the suite is invalid" is not something an author can act on.
    #[error("test suite `{suite}@{version}` is invalid: {file}: {detail}")]
    InvalidTestSuite {
        /// The suite slug.
        suite: String,
        /// The suite version, as the version folder names it (carrying its
        /// leading `v`).
        version: String,
        /// The file that caused the failure, relative to the version folder.
        file: String,
        /// Human-readable explanation of what was wrong.
        detail: String,
    },

    /// Rendering a prompt template failed.
    #[error("rendering the prompt for `{slug}@{version}`: {detail}")]
    PromptRender {
        /// The test case (or suite) slug.
        slug: String,
        /// The test case (or suite) version.
        version: String,
        /// Detail describing the failure.
        detail: String,
    },

    /// An [engine](crate::engine) could not be resolved: the requested slug is
    /// not one this build carries. The detail names the slug and every built-in,
    /// so a typo on `--engine` is fixable from the message alone.
    #[error("resolving the engine: {0}")]
    Engine(String),

    /// Reading what the run repository is seeded from failed: a staged package's
    /// manifest is unreadable or declares no version.
    #[error("seeding the run repository: {0}")]
    Seeding(String),

    /// An underlying I/O operation failed.
    #[error("host I/O: {0}")]
    Io(#[from] io::Error),
}
