//! Crate-wide error type.
//!
//! A single [`Error`] enum is shared across orchestration, harness invocation,
//! execution, validation, and publishing so callers can match on failure modes
//! without depending on stage-specific error types.

use std::io;

use thiserror::Error;

/// Convenience result alias used throughout the crate.
pub type Result<T, E = Error> = std::result::Result<T, E>;

/// Errors that can occur anywhere in the run lifecycle.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum Error {
    /// A requested test case slug was not present in the catalog.
    #[error("test case `{slug}` was not found in the catalog")]
    TestCaseNotFound {
        /// The slug that could not be resolved.
        slug: String,
    },

    /// A requested test case version did not exist for an existing slug.
    #[error("version `{version}` of test case `{slug}` was not found")]
    TestCaseVersionNotFound {
        /// The test case slug.
        slug: String,
        /// The version that could not be resolved.
        version: String,
    },

    /// A test case version was structurally invalid (for example, missing a
    /// specification).
    #[error("test case `{slug}@{version}` is invalid: {detail}")]
    InvalidTestCase {
        /// The test case slug.
        slug: String,
        /// The test case version.
        version: String,
        /// Human-readable explanation of what was wrong.
        detail: String,
    },

    /// The requested agent harness could not be located on the host.
    #[error("agent harness `{slug}` is not available: {detail}")]
    HarnessUnavailable {
        /// The harness slug that was requested.
        slug: String,
        /// Detail describing why it was considered unavailable.
        detail: String,
    },

    /// The agent harness was located but failed while running.
    #[error("agent harness `{slug}` invocation failed: {detail}")]
    HarnessInvocation {
        /// The harness slug that was invoked.
        slug: String,
        /// Detail describing the failure.
        detail: String,
    },

    /// The container runtime abstraction reported a failure.
    #[error("container runtime error: {0}")]
    ContainerRuntime(String),

    /// Seeding the run's repository failed.
    #[error("failed to seed run repository: {0}")]
    Seeding(String),

    /// Collecting the produced artifacts failed.
    #[error("failed to collect run artifacts: {0}")]
    ArtifactCollection(String),

    /// Validation could not be carried out (distinct from validation finding
    /// problems with the implementation).
    #[error("validation error: {0}")]
    Validation(String),

    /// Publishing the run failed.
    #[error("publish error: {0}")]
    Publish(String),

    /// Failed to (de)serialize a value, typically the run record.
    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    /// An underlying I/O operation failed.
    #[error("io error: {0}")]
    Io(#[from] io::Error),
}
