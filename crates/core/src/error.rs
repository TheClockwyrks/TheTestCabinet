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

    /// A requested variant did not exist for a resolved test case version.
    #[error("variant `{variant}` of test case `{slug}@{version}` was not found")]
    VariantNotFound {
        /// The test case slug.
        slug: String,
        /// The test case version.
        version: String,
        /// The variant slug that could not be resolved.
        variant: String,
    },

    /// Rendering a test case's prompt template failed.
    #[error("failed to render prompt for `{slug}@{version}`: {detail}")]
    PromptRender {
        /// The test case slug.
        slug: String,
        /// The test case version.
        version: String,
        /// Detail describing the failure.
        detail: String,
    },

    /// Rendering a test case's `.hbs` spec template failed during seeding.
    #[error("failed to render spec `{spec}` for `{slug}@{version}`: {detail}")]
    SpecRender {
        /// The test case slug.
        slug: String,
        /// The test case version.
        version: String,
        /// The spec source path that failed to render.
        spec: String,
        /// Detail describing the failure.
        detail: String,
    },

    /// One or more of a test case's reference mockups failed to render, so the
    /// run was refused before it started.
    ///
    /// The reference screenshots are seeded as the visual targets the harness
    /// builds against and are reused as the baselines validation scores against;
    /// starting a run with any of them missing would seed an incomplete target
    /// set and waste a harness session, so the run aborts here instead. The
    /// per-view failures are surfaced as warnings as they happen (see
    /// [`crate::reference`]).
    #[error(
        "could not render every reference view for `{slug}@{version}` \
         (missing: {}); refusing to start the run — see the warnings above",
        .missing.join(", ")
    )]
    ReferenceRenderIncomplete {
        /// The test case slug.
        slug: String,
        /// The test case version.
        version: String,
        /// The view slugs that failed to render.
        missing: Vec<String>,
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

    /// The harness session ran past the run's maximum runtime and was stopped.
    ///
    /// Every run is bounded by a maximum wall-clock duration so a session can
    /// never continue unbounded. The bound is the test case's
    /// `max_runtime_seconds` manifest field, overridable per invocation (for
    /// example by `tcab run --max-runtime`). When it elapses the run container is
    /// torn down and the run aborts with this error.
    #[error("agent harness `{slug}` exceeded the maximum runtime of {seconds}s and was stopped")]
    RunTimedOut {
        /// The harness slug whose session was stopped.
        slug: String,
        /// The maximum runtime, in seconds, that was exceeded.
        seconds: u64,
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

    /// A run's hand-written review (its writeup and rating) was missing or
    /// malformed.
    #[error("review error: {0}")]
    Review(String),

    /// Failed to (de)serialize a value, typically the run record.
    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    /// An underlying I/O operation failed.
    #[error("io error: {0}")]
    Io(#[from] io::Error),
}
