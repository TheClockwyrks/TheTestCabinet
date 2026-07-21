//! Crate-wide error type.
//!
//! A single [`enum@Error`] enum is shared across orchestration, harness invocation,
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

    /// Two catalog folders declared the same `slug`, so the identity is
    /// ambiguous. A slug is a case's stable identity and must be unique across the
    /// whole catalog.
    #[error(
        "slug `{slug}` is declared by more than one test-case folder (`{folder_a}` and `{folder_b}`); a slug must be unique across the catalog"
    )]
    DuplicateSlug {
        /// The slug declared by two folders.
        slug: String,
        /// One folder declaring it.
        folder_a: String,
        /// The other folder declaring it.
        folder_b: String,
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

    /// The harness stopped producing any output for long enough to be considered
    /// hung, and was killed.
    ///
    /// Distinct from [`HarnessInvocation`](Self::HarnessInvocation): the harness
    /// did not fail, it stopped responding — a stalled provider request, a
    /// subagent that never returns — and would otherwise have occupied its run
    /// slot until an external limit reaped it. See
    /// [`exec_stream`](crate::exec_stream) for the watchdog that detects this and
    /// why the run must end on our timer rather than the platform's.
    #[error("agent harness `{slug}` produced no output for {seconds}s and was stopped as hung")]
    HarnessHung {
        /// The harness slug that stopped responding.
        slug: String,
        /// How long the harness was silent, in seconds, before it was killed.
        seconds: u64,
    },

    /// The harness session ran past the run's maximum runtime and was stopped.
    ///
    /// Every run is bounded by a maximum wall-clock duration so a session can
    /// never continue unbounded. The bound is the test case's
    /// `max_runtime_hours` manifest field, overridable per invocation (for
    /// example by `tcab run --max-runtime`). When it elapses the run container is
    /// torn down and the run aborts with this error.
    #[error("agent harness `{slug}` exceeded the maximum runtime of {seconds}s and was stopped")]
    RunTimedOut {
        /// The harness slug whose session was stopped.
        slug: String,
        /// The maximum runtime, in seconds, that was exceeded.
        seconds: u64,
    },

    /// The harness's install command failed inside the run container before the
    /// session could start. The detail carries the exit code and captured output
    /// so a broken install can be diagnosed. The container is torn down before
    /// this is returned.
    #[error("harness `{slug}` install failed: {detail}")]
    HarnessInstall {
        /// The harness slug whose install command failed.
        slug: String,
        /// Detail describing the failure (exit code and captured output).
        detail: String,
    },

    /// The harness's install command exceeded the run's maximum runtime before
    /// it finished. The container is torn down before this is returned.
    #[error("harness `{slug}` install exceeded the maximum runtime of {seconds}s and was stopped")]
    HarnessInstallTimedOut {
        /// The harness slug whose install command was stopped.
        slug: String,
        /// The maximum runtime, in seconds, that was exceeded.
        seconds: u64,
    },

    /// The test case's init command failed inside the run container. The detail
    /// carries the exit code and captured output so a broken setup step can be
    /// diagnosed. The container is torn down before this is returned.
    #[error("init command failed: {0}")]
    Init(String),

    /// The test case's init command exceeded the run's maximum runtime before it
    /// finished. The container is torn down before this is returned.
    #[error("init command exceeded the maximum runtime of {seconds}s and was stopped")]
    InitTimedOut {
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

    /// An account operation against the auth service failed: a registration or
    /// login was rejected (bad credentials, a taken username), or the service
    /// could not be reached. The detail carries the service's explanation.
    #[error("auth error: {0}")]
    Auth(String),

    /// An orchestrator could not be resolved (an unknown built-in slug, or an
    /// external `--orchestrator-dir` whose manifest or runner could not be read
    /// or parsed). The detail names the slug or directory and what was wrong.
    #[error("orchestrator error: {0}")]
    Orchestrator(String),

    /// A non-default orchestrator was requested for a test type that does not
    /// support orchestrator selection. For now selection is limited to the
    /// end-to-end test type; every other type always runs `one-shot`. The run is
    /// refused before any container is started.
    #[error(
        "orchestrator `{slug}` is not supported for the {test_type} test type \
         (orchestrator selection is limited to end-to-end test cases; other test \
         types always run one-shot)"
    )]
    OrchestratorUnsupportedForTestType {
        /// The requested orchestrator slug (empty for an external directory).
        slug: String,
        /// The test type that does not support orchestrator selection.
        test_type: crate::test_case::TestType,
    },

    /// Failed to (de)serialize a value, typically the run record.
    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    /// An underlying I/O operation failed.
    #[error("io error: {0}")]
    Io(#[from] io::Error),
}
