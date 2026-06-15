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

pub mod container;
pub mod error;
pub mod event;
pub mod execution;
pub mod harness;
pub mod harness_registry;
pub mod metrics;
pub mod pricing;
pub mod publish;
pub mod run_record;
pub mod seeding;
pub mod test_case;
pub mod validation;
pub mod validator;

#[cfg(test)]
#[path = "lib.test.rs"]
mod tests;

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::Instant;

use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

pub use container::{CliArtifactCollector, CliContainerRuntime};
pub use error::{Error, Result};
pub use event::{
    EventFormat, EventKind, EventParser, EventSink, HarnessEvent, NoopEventSink,
    OrchestrationAction,
};
pub use execution::{
    ArtifactCollection, ArtifactCollector, ContainerHandle, ContainerRuntime, ContainerSpec,
    OutputSink, OutputStream, RepoSeeder, SeedRequest, SeededRepo,
};
pub use harness::{
    AgentHarness, Availability, HarnessInvocation, HarnessOutcome, HarnessRegistry, Usage,
};
pub use harness_registry::DefaultHarnessRegistry;
pub use metrics::{Cost, RunMetrics, TokenCounts, TokenPrices};
pub use pricing::OpenRouterPrices;
pub use publish::{NoopPublisher, PublishOutcome, PublishRequest, Publisher};
pub use run_record::{HarnessSlug, RunLinks, RunRecord, RunState, RunStatus, RunSubject};
pub use seeding::FsRepoSeeder;
pub use test_case::{ReferenceView, TestCase, TestCaseCatalog, TestCaseVersion};
pub use validation::{CapturedView, LoadCheck, ReferenceComparison, ValidationSummary, Validator};
pub use validator::BuildValidator;

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
    /// Looks up model prices for the comparable cost.
    pub prices: OpenRouterPrices,
    /// Directory each run's record and collected implementation are written to.
    pub output_dir: PathBuf,
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
    pub fn resolve(&self, request: &RunRequest) -> Result<TestCaseVersion> {
        match &request.test_case_version {
            Some(version) => self.catalog.resolve(&request.test_case_slug, version),
            None => self.catalog.resolve_latest(&request.test_case_slug),
        }
    }

    /// Seed a fresh git repository with the test case's specification and assets.
    pub fn seed(&self, test_case: &TestCaseVersion) -> Result<SeededRepo> {
        self.seeder.seed(&SeedRequest { test_case })
    }

    /// Start a container and drive the agent harness to completion against the
    /// seeded repository.
    ///
    /// The caller owns the returned [`ContainerHandle`] and must stop it. On any
    /// failure after the container starts, it is stopped before returning.
    pub async fn execute(
        &self,
        _test_case: &TestCaseVersion,
        seeded: &SeededRepo,
        request: &RunRequest,
        events: &mut dyn EventSink,
    ) -> Result<(ContainerHandle, HarnessOutcome)> {
        let slug = request.harness;
        let harness = self
            .harnesses
            .get(slug)
            .ok_or_else(|| Error::HarnessUnavailable {
                slug: slug.as_str().to_string(),
                detail: "no adapter is registered for this harness".to_string(),
            })?;

        // API-key authentication is the only supported mode for now.
        let api_key_env = harness
            .api_key_env()
            .ok_or_else(|| Error::HarnessUnavailable {
                slug: slug.as_str().to_string(),
                detail: "API-key authentication is not supported by this harness".to_string(),
            })?;
        let api_key = std::env::var(api_key_env).map_err(|_| Error::HarnessUnavailable {
            slug: slug.as_str().to_string(),
            detail: format!("environment variable {api_key_env} is not set"),
        })?;

        let availability = harness.check_availability(&self.runtime).await?;
        if !availability.available {
            return Err(Error::HarnessUnavailable {
                slug: slug.as_str().to_string(),
                detail: availability
                    .detail
                    .unwrap_or_else(|| "harness is unavailable".to_string()),
            });
        }

        let mut secrets = BTreeMap::new();
        secrets.insert(api_key_env.to_string(), api_key);
        let spec = ContainerSpec {
            image: harness.image(),
            repo_path: seeded.path.clone(),
            secrets,
            network_enabled: true,
        };

        let handle = self.runtime.start(&spec).await?;
        let invocation = HarnessInvocation {
            slug,
            model_id: request.model_id.clone(),
            prompt: build_prompt(_test_case),
        };
        match harness
            .invoke(&self.runtime, &handle, &invocation, events)
            .await
        {
            Ok(mut outcome) => {
                outcome.harness_version = availability.version;
                Ok((handle, outcome))
            }
            Err(err) => {
                let _ = self.runtime.stop(&handle).await;
                Err(err)
            }
        }
    }

    /// Collect run metrics from the harness outcome and elapsed wall-clock time.
    ///
    /// When the harness reported its own exact cost (see
    /// [`HarnessOutcome::reported_cost`]) that figure is used for both the
    /// comparable and actual cost and `prices` is ignored: such a harness drives
    /// a single provider directly, so its reported charge is already
    /// provider-stable. Otherwise the comparable cost is derived from the
    /// supplied OpenRouter `prices`.
    pub fn collect_metrics(
        &self,
        outcome: &HarnessOutcome,
        run_time_seconds: f64,
        prices: &TokenPrices,
    ) -> Result<RunMetrics> {
        let tokens = outcome.usage.tokens;
        let cost = match outcome.reported_cost {
            Some(reported) => Cost {
                comparable: reported,
                actual: reported,
            },
            None => {
                let comparable = Cost::comparable_from(&tokens, prices);
                // No harness-reported charge to record separately yet; the
                // comparable figure is the canonical, provider-stable value.
                Cost {
                    comparable,
                    actual: comparable,
                }
            }
        };
        Ok(RunMetrics {
            run_time_seconds,
            tokens,
            cost,
        })
    }

    /// Run the validation pass over the produced implementation.
    pub fn validate(
        &self,
        test_case: &TestCaseVersion,
        artifacts: &ArtifactCollection,
    ) -> Result<ValidationSummary> {
        self.validator.validate(test_case, artifacts)
    }

    /// Serialize the run record as camelCase JSON and store it, alongside a copy
    /// of the produced implementation, under the run's output directory.
    pub fn write_record(&self, record: &RunRecord, artifacts: &ArtifactCollection) -> Result<()> {
        let run_dir = self.output_dir.join(&record.id);
        std::fs::create_dir_all(&run_dir)?;

        let json = serde_json::to_string_pretty(record)?;
        std::fs::write(run_dir.join("run-record.json"), json)?;

        let implementation = run_dir.join("implementation");
        copy_tree(&artifacts.repo_path, &implementation)?;
        Ok(())
    }

    /// Publish a finished run: release code, publish the build, append the
    /// record.
    pub async fn publish(&self, request: &PublishRequest<'_>) -> Result<PublishOutcome> {
        self.publisher.publish(request).await
    }

    /// Drive an entire run end to end through every lifecycle stage.
    ///
    /// Normalized [events](crate::event) produced while the harness runs are
    /// emitted to `events` so callers can observe the run live. Pass
    /// [`NoopEventSink`] to ignore them.
    pub async fn run(&self, request: &RunRequest, events: &mut dyn EventSink) -> Result<RunRecord> {
        let started_at = OffsetDateTime::now_utc();
        let timer = Instant::now();

        let test_case = self.resolve(request)?;
        let seeded = self.seed(&test_case)?;
        let (handle, outcome) = self.execute(&test_case, &seeded, request, events).await?;

        // Collect the working tree, then always tear the container down.
        let artifacts = self.collector.collect(&handle).await;
        let _ = self.runtime.stop(&handle).await;
        let artifacts = artifacts?;

        let run_time_seconds = timer.elapsed().as_secs_f64();
        // A harness that reports its own exact cost needs no OpenRouter lookup;
        // its native model ID may not even appear in OpenRouter's catalog.
        let prices = if outcome.reported_cost.is_some() {
            TokenPrices::default()
        } else {
            // Map the model ID to the slug OpenRouter lists it under (for
            // example Codex's `gpt-5.5` becomes `openai/gpt-5.5`).
            let lookup_id = self
                .harnesses
                .get(request.harness)
                .map(|harness| harness.pricing_model_id(&request.model_id))
                .unwrap_or_else(|| request.model_id.clone());
            match self.prices.token_prices(&lookup_id).await {
                Ok(prices) => prices,
                Err(err) => {
                    eprintln!(
                        "warning: could not fetch OpenRouter prices for `{lookup_id}` ({err}); \
                         recording zero comparable cost"
                    );
                    TokenPrices::default()
                }
            }
        };
        let metrics = self.collect_metrics(&outcome, run_time_seconds, &prices)?;
        let validation = self.validate(&test_case, &artifacts)?;
        let finished_at = OffsetDateTime::now_utc();

        let record = RunRecord {
            id: uuid::Uuid::new_v4().to_string(),
            started_at: started_at.format(&Rfc3339).unwrap_or_default(),
            finished_at: finished_at.format(&Rfc3339).unwrap_or_default(),
            subject: RunSubject {
                test_case_slug: test_case.slug.clone(),
                test_case_version: test_case.version.clone(),
                harness_slug: request.harness,
                harness_version: outcome.harness_version.clone(),
                model_id: request.model_id.clone(),
            },
            metrics,
            validation,
            links: RunLinks::default(),
            status: RunStatus {
                state: RunState::Completed,
                detail: None,
            },
        };

        self.write_record(&record, &artifacts)?;
        Ok(record)
    }
}

/// Build the initial instruction handed to the harness for a test case.
///
/// The seeded repository's working directory holds the specification, so the
/// prompt points the harness at it rather than restating the spec.
fn build_prompt(test_case: &TestCaseVersion) -> String {
    let spec = test_case
        .spec_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("specification.md");
    format!(
        "Build the game described in `{spec}` in this repository. Implement a \
         complete, polished, playable browser game that builds to static files \
         with no backend and no API keys. Follow the specification exactly, and \
         include a README explaining how to install, run, and build it."
    )
}

/// Directory names that are never copied into the published implementation.
///
/// `node_modules` is regenerated from the lockfile by a fresh install, so
/// copying it only bloats the artifact and risks shipping platform-specific
/// binaries — or the broken tool shims a dereferencing copy would leave behind,
/// since a package manager's `.bin/*` entries are symlinks whose relative
/// imports only resolve from their real location.
const SKIPPED_DIRS: &[&str] = &["node_modules"];

/// Recursively copy a directory tree from `from` to `to`.
///
/// Symlinks are recreated as symlinks rather than dereferenced, so any links the
/// run produced keep pointing at their original targets instead of being
/// flattened into copies of the target's contents. Dependency directories listed
/// in [`SKIPPED_DIRS`] are omitted entirely.
fn copy_tree(from: &std::path::Path, to: &std::path::Path) -> Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let name = entry.file_name();
        if SKIPPED_DIRS.contains(&name.to_str().unwrap_or_default()) {
            continue;
        }
        let dest = to.join(&name);
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            copy_symlink(&entry.path(), &dest)?;
        } else if file_type.is_dir() {
            copy_tree(&entry.path(), &dest)?;
        } else {
            std::fs::copy(entry.path(), &dest)?;
        }
    }
    Ok(())
}

/// Recreate the symlink at `from` at the new location `to`, preserving its
/// target verbatim. The target is kept as-is (typically relative to the link's
/// own directory) so the recreated link resolves the same way the original did.
fn copy_symlink(from: &std::path::Path, to: &std::path::Path) -> Result<()> {
    let target = std::fs::read_link(from)?;
    #[cfg(unix)]
    std::os::unix::fs::symlink(&target, to)?;
    #[cfg(windows)]
    if from.is_dir() {
        std::os::windows::fs::symlink_dir(&target, to)?;
    } else {
        std::os::windows::fs::symlink_file(&target, to)?;
    }
    Ok(())
}
