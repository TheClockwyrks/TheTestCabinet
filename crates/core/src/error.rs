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

    /// The harness stopped the run on one of its own configured execution
    /// ceilings and exited on the code that says so.
    ///
    /// Distinct from [`HarnessInvocation`](Self::HarnessInvocation), which is any
    /// other non-zero exit. A ceiling is a safeguard the run's own configuration
    /// armed — a turn count, a wall-clock budget, a spend, a tolerance for failing
    /// turns — so a run that breached one did not malfunction, it ran into a bound
    /// somebody chose. That makes it a [`RunState::LimitExceeded`](crate::run_record::RunState::LimitExceeded)
    /// rather than a [`RunState::HarnessError`](crate::run_record::RunState::HarnessError),
    /// and it is the reason the two are held apart at all: a harness error is retried,
    /// and retrying this one spends another attempt on the same configuration to reach
    /// the same ceiling.
    ///
    /// Only [gg](crate::gg) reports it, because gg is the only harness whose ceilings
    /// the Test Cabinet configures. The detail carries the terminal status the session
    /// ended under, which is where the breached ceiling and its figures are recorded.
    #[error("agent harness `{slug}` stopped the run on a configured execution ceiling: {detail}")]
    HarnessLimitExceeded {
        /// The harness slug whose ceiling stopped the run.
        slug: String,
        /// Detail describing the stop (the session's terminal status).
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

    /// An R2 request failed: the object store could not be reached, or it
    /// rejected a signed `PutObject`/`ListObjectsV2`. Carries the key or prefix
    /// and the store's own explanation.
    #[error("r2 error: {0}")]
    R2(String),

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

    /// An [engine](crate::engine) could not be resolved: the requested slug is
    /// not one this build carries. The detail names the slug and every built-in,
    /// so a typo on `--engine` is fixable from the message alone.
    #[error("engine error: {0}")]
    Engine(String),

    /// An engine was requested that the test case version does not support.
    ///
    /// A case declares the engines it supports as a **compatibility gate**: its
    /// specs carry the statements specific to building under those engines, and
    /// its validation drives their host interfaces. Running it under an engine it
    /// never declared would score a build against checks written for a different
    /// runtime, so the run is refused before any container is started. The
    /// message names the engines the case *does* support, so the fix is one step.
    #[error(
        "engine `{slug}` is not supported by test case `{test_case}` {version} \
         (supported engines: {supported_list})",
        supported_list = supported.join(", ")
    )]
    EngineUnsupportedForCase {
        /// The requested engine slug.
        slug: String,
        /// The test case that does not support it.
        test_case: String,
        /// The case version whose manifest declares the supported set.
        version: String,
        /// The engines that version does declare, in manifest order.
        supported: Vec<String>,
    },

    /// The selected engine *is* one the test case version supports, but the
    /// version of it the host would stage falls outside the range that version
    /// declared for it.
    ///
    /// The second half of the same compatibility gate as
    /// [`Self::EngineUnsupportedForCase`], and refused in the same place: before
    /// any container is started. A case pins a range because its specification and
    /// its validators were written against a particular engine contract — the
    /// minimum is the earliest contract they were written against, the maximum the
    /// version whose behaviour broke a check they depend on — so a run outside it
    /// would be scored against checks written for a different runtime just as
    /// surely as a run on an engine the case never declared. The message names the
    /// version that would have been staged *and* the range, because the fix is
    /// either restaging the engine or running a case version that accepts it.
    #[error(
        "engine `{slug}` version {engine_version} is outside the versions test case \
         `{test_case}` {version} supports ({range})"
    )]
    EngineVersionUnsupportedForCase {
        /// The requested engine slug.
        slug: String,
        /// The version of that engine in the host package store.
        engine_version: String,
        /// The test case whose declared range excludes it.
        test_case: String,
        /// The case version whose manifest declares the range.
        version: String,
        /// The declared range, rendered for a person to act on.
        range: String,
    },

    /// The test case version declares a version range for the selected engine, but
    /// the host has no readable version for that engine to check against it.
    ///
    /// A staging fault, not a selection mistake: the engine resolved, the case
    /// supports it, and the only missing thing is the `version` of its package in
    /// the host package store. The run is refused rather than admitted because a
    /// declared range is a claim that only *some* engine versions are safe for this
    /// case, and running without checking it would spend a harness session on a
    /// pairing nobody verified. An engine the case declared with no range is
    /// unaffected — there is nothing to check — and the seeder refuses the same
    /// store with the restaging instructions once a run gets that far.
    #[error(
        "engine `{slug}` has no staged version in the host package store, so it cannot be \
         checked against the range test case `{test_case}` {version} declares for it \
         ({range}); rebuild the packages (`npm run build:packages`) and restage them \
         (`node scripts/stage-tcab-packages.mjs`)"
    )]
    EngineVersionUnknown {
        /// The requested engine slug.
        slug: String,
        /// The test case whose declared range could not be checked.
        test_case: String,
        /// The case version whose manifest declares the range.
        version: String,
        /// The declared range, rendered for a person to act on.
        range: String,
    },

    /// A [test-case group](crate::test_case_group) could not be loaded: the
    /// `test-case-groups/` catalogue was unreadable, or a group's manifest was
    /// malformed or broke an invariant (a slug disagreeing with its directory,
    /// an empty member list, a duplicate member). The detail names the group
    /// directory and what was wrong.
    #[error("test-case group error: {0}")]
    TestCaseGroup(String),

    /// A **gg** run was misconfigured: the gg configuration invariant does not
    /// hold. A gg run (harness [`Gg`](crate::run_record::HarnessSlug::Gg)) must
    /// carry a [capability set](crate::gg::GgCapabilitySet), and a non-gg run must
    /// not. Raised by [`RunRequest::validate`](crate::RunRequest::validate) at the
    /// top of a run, before any container work.
    #[error("gg configuration error: {0}")]
    GgConfiguration(String),

    /// A **gg** run reached execution but the direct gg executor is not yet wired.
    ///
    /// gg is invoked directly rather than through the
    /// [orchestrator](crate::orchestrator)/`AgentHarness` path, so its executor is
    /// built as its own branch in [`RunEngine::execute`](crate::RunEngine::execute).
    /// Until that branch lands (Stage D2) a gg run that gets as far as execution
    /// fails clearly here rather than falling through to the third-party-harness
    /// path.
    #[error("gg executor is not yet wired (Stage D2): {0}")]
    GgExecutorUnimplemented(String),

    /// A **gg** run's replay [journal](crate::gg_session_journal) could not be
    /// folded into a [record](crate::gg_session_record::GgSessionRecord).
    ///
    /// Only for the damage that cannot be *reported* — a pool index that skips,
    /// an entry naming a body that was never written, a format this build does
    /// not assemble. A journal that merely stops early is not an error: it
    /// assembles into a record carrying a
    /// [truncation](crate::gg_session_record::GgSessionTruncation). Assembly runs at the
    /// [post-run seam](crate::post_run), so this never fails the run it
    /// describes — it costs the run its replay artifact and nothing else.
    #[error("gg capture journal `{path}` {detail}")]
    GgSessionJournal {
        /// The journal that could not be assembled.
        path: String,
        /// What was wrong with it, as a predicate completing the message.
        detail: String,
    },

    /// A finished run's [code analysis](crate::code_analysis) could not be
    /// produced.
    ///
    /// Only for the ways the *stage* can fail: writing the document out, or a
    /// panic escaping the thread a parser was pointed at model-written source on.
    /// The analysis itself never fails — every degradation it can suffer (a tree
    /// that is not a repository, a file that will not parse, a cap that fires) is
    /// reported *in* the result, because a caller that gets an error learns
    /// nothing about the tree. Like the replay assembly this runs at the
    /// [post-run seam](crate::post_run), so it never fails the run it describes:
    /// it costs the run its `codeAnalysis` and nothing else.
    #[error("code analysis failed: {0}")]
    CodeAnalysis(String),

    /// Failed to (de)serialize a value, typically the run record.
    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    /// An underlying I/O operation failed.
    #[error("io error: {0}")]
    Io(#[from] io::Error),
}
