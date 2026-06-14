//! # test-cabinet-core
//!
//! The headless orchestration library for The Test Cabinet. It owns the full run
//! lifecycle: resolving a test case version, seeding a run's repository,
//! executing the run in a container, invoking the agent harness, collecting
//! metrics, running validation, writing the run record, and publishing.
//!
//! See `docs/application.md`. The command line interface and the desktop shell
//! are thin layers on top of this core; keeping orchestration here is what makes
//! batch runs and unattended sweeps possible.

pub mod error;
pub mod execution;
pub mod harness;
pub mod metrics;
pub mod publish;
pub mod run_record;
pub mod test_case;
pub mod validation;

pub use error::{Error, Result};
pub use execution::{
    ArtifactCollection, ArtifactCollector, ContainerHandle, ContainerRuntime, ContainerSpec,
    RepoSeeder, SeedRequest, SeededRepo,
};
pub use harness::{
    AgentHarness, Availability, HarnessInvocation, HarnessOutcome, HarnessRegistry, Usage,
};
pub use metrics::{Cost, RunMetrics, TokenCounts, TokenPrices};
pub use publish::{PublishOutcome, PublishRequest, Publisher};
pub use run_record::{HarnessSlug, RunLinks, RunRecord, RunState, RunStatus, RunSubject};
pub use test_case::{ReferenceView, TestCase, TestCaseCatalog, TestCaseVersion};
pub use validation::{CapturedView, LoadCheck, ReferenceComparison, ValidationSummary, Validator};

/// What to run, with what, against which model.
///
/// This is the user-facing description of a run; the [`Orchestrator`] turns it
/// into a [`RunRecord`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunRequest {
    /// The test case slug to run.
    pub test_case_slug: String,
    /// The exact test case version, or `None` to use the latest.
    pub test_case_version: Option<String>,
    /// The agent harness to drive.
    pub harness: HarnessSlug,
    /// The opaque model ID to pass to the harness.
    pub model_id: String,
}

/// Drives a single run through its full lifecycle.
///
/// The orchestrator wires together the swappable seams — test case catalog,
/// repo seeder, container runtime, harness registry, validator, and publisher —
/// and sequences them: resolve, seed, execute, collect metrics, validate, write
/// record, publish.
pub struct Orchestrator<S, R, C, V, P>
where
    S: RepoSeeder,
    R: ContainerRuntime,
    C: ArtifactCollector,
    V: Validator,
    P: Publisher,
{
    /// Resolves test case slugs and versions.
    pub catalog: TestCaseCatalog,
    /// Seeds fresh per-run repositories.
    pub seeder: S,
    /// Starts and drives run containers.
    pub runtime: R,
    /// Collects the produced working tree.
    pub collector: C,
    /// Looks up harness implementations by slug.
    pub harnesses: Box<dyn HarnessRegistry>,
    /// Runs the validation pass.
    pub validator: V,
    /// Publishes finished runs.
    pub publisher: P,
}

impl<S, R, C, V, P> Orchestrator<S, R, C, V, P>
where
    S: RepoSeeder,
    R: ContainerRuntime,
    C: ArtifactCollector,
    V: Validator,
    P: Publisher,
{
    /// Resolve a [`RunRequest`] into an exact, immutable [`TestCaseVersion`].
    pub fn resolve(&self, _request: &RunRequest) -> Result<TestCaseVersion> {
        todo!("resolve slug + version against the catalog")
    }

    /// Seed a fresh git repository with the test case's specification and assets.
    pub fn seed(&self, _test_case: &TestCaseVersion) -> Result<SeededRepo> {
        todo!("seed a fresh repo via the RepoSeeder (spec + assets only)")
    }

    /// Start a container and drive the agent harness to completion against the
    /// seeded repository.
    pub async fn execute(
        &self,
        _test_case: &TestCaseVersion,
        _seeded: &SeededRepo,
        _request: &RunRequest,
    ) -> Result<(ContainerHandle, HarnessOutcome)> {
        todo!("start container, look up harness, invoke a single session")
    }

    /// Collect run metrics from the harness outcome and elapsed wall-clock time.
    pub fn collect_metrics(
        &self,
        _outcome: &HarnessOutcome,
        _run_time_seconds: f64,
    ) -> Result<RunMetrics> {
        todo!("normalize usage into RunMetrics and derive comparable cost")
    }

    /// Run the validation pass over the produced implementation.
    pub fn validate(
        &self,
        _test_case: &TestCaseVersion,
        _artifacts: &ArtifactCollection,
    ) -> Result<ValidationSummary> {
        todo!("delegate to the Validator over the collected artifacts")
    }

    /// Assemble and write out the run record for a finished run.
    pub fn write_record(&self, _record: &RunRecord) -> Result<()> {
        todo!("serialize the run record (camelCase JSON) and store it")
    }

    /// Publish a finished run: release code, publish the build, append the
    /// record.
    pub async fn publish(&self, _request: &PublishRequest<'_>) -> Result<PublishOutcome> {
        todo!("delegate to the Publisher (idempotent)")
    }

    /// Drive an entire run end to end through every lifecycle stage.
    pub async fn run(&self, _request: &RunRequest) -> Result<RunRecord> {
        todo!(
            "sequence: resolve -> seed -> execute -> collect metrics -> \
             validate -> write record"
        )
    }
}
