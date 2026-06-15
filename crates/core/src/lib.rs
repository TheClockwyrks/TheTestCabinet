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

pub mod browser;
pub mod container;
pub mod error;
pub mod event;
pub mod execution;
pub mod harness;
pub mod harness_registry;
pub mod metrics;
pub mod models;
pub mod pricing;
pub mod prompt;
pub mod publish;
pub mod reference;
pub mod review;
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
    OutputSink, OutputStream, RepoSeeder, SeedRequest, SeededRepo, WORKSPACE_DIR,
};
pub use harness::{
    AgentHarness, Availability, HarnessInvocation, HarnessOutcome, HarnessRegistry, Usage,
};
pub use harness_registry::DefaultHarnessRegistry;
pub use metrics::{Cost, RunMetrics, TokenCounts, TokenPrices};
pub use models::{Model, ModelCatalog};
pub use pricing::OpenRouterPrices;
pub use prompt::render_prompt;
pub use publish::{
    GitHubPublisher, NoopPublisher, PublishConfig, PublishOutcome, PublishRequest, Publisher,
    SystemCommandRunner,
};
pub use reference::{BrowserRenderer, ReferenceRenderer, RenderedReference};
pub use review::{Rating, Writeup, parse_writeup};
pub use run_record::{
    HarnessSlug, RunEnvironment, RunLinks, RunRecord, RunState, RunStatus, RunSubject,
};
pub use seeding::FsRepoSeeder;
pub use test_case::{
    Check, CheckAction, ReferenceView, SpecFile, TestCase, TestCaseCatalog, TestCaseVersion,
    Variant,
};
pub use validation::{CapturedView, CheckResult, ValidationSummary, Validator};
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
    /// The variant of the test case to run. Selects which specs are seeded and is
    /// recorded in the run record.
    pub variant: String,
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
    /// Renders reference mockups to screenshots for seeding and validation.
    pub renderer: Box<dyn ReferenceRenderer>,
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

    /// Render the selected variant's reference mockups to screenshots, used both
    /// as seeded visual targets and as validation baselines. The set rendered is
    /// the common references plus the variant's own; see
    /// [`TestCaseVersion::references_for`].
    pub fn render_references(
        &self,
        test_case: &TestCaseVersion,
        variant: &Variant,
    ) -> Result<Vec<RenderedReference>> {
        self.renderer.render_references(test_case, variant)
    }

    /// Seed a fresh git repository with the selected variant's specs, the test
    /// case's assets, and the rendered reference screenshots. Obtain `specs` from
    /// [`TestCaseVersion::seeded_specs`] for the chosen `variant`, which is also
    /// the context for rendering any `.hbs` spec.
    pub fn seed(
        &self,
        test_case: &TestCaseVersion,
        variant: &Variant,
        specs: &[SpecFile],
        references: &[RenderedReference],
    ) -> Result<SeededRepo> {
        self.seeder.seed(&SeedRequest {
            test_case,
            variant,
            specs,
            references,
        })
    }

    /// Start a container and drive the agent harness to completion against the
    /// seeded repository.
    ///
    /// The caller owns the returned [`ContainerHandle`] and must stop it. On any
    /// failure after the container starts, it is stopped before returning.
    pub async fn execute(
        &self,
        test_case: &TestCaseVersion,
        variant: &Variant,
        seeded: &SeededRepo,
        request: &RunRequest,
        events: &mut dyn EventSink,
    ) -> Result<(ContainerHandle, HarnessOutcome, RunEnvironment)> {
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
        // The key is read from the host's `api_key_env` but injected into the
        // container under the variable the harness's CLI actually reads, which
        // can differ (Codex reads `CODEX_API_KEY`, not `OPENAI_API_KEY`).
        let container_key_env = harness.container_key_env().unwrap_or(api_key_env);
        secrets.insert(container_key_env.to_string(), api_key);
        let spec = ContainerSpec {
            image: harness.image(),
            repo_path: seeded.path.clone(),
            secrets,
            network_enabled: true,
        };

        let handle = self.runtime.start(&spec).await?;

        // Capture the container environment from inside the running container so
        // it reflects what the harness actually built in, not the host. Probes
        // are best-effort: a failure degrades to sensible defaults rather than
        // failing the run.
        let environment = self.probe_environment(&handle, harness.image()).await;

        let invocation = HarnessInvocation {
            slug,
            model_id: request.model_id.clone(),
            prompt: render_prompt(test_case, variant)?,
        };
        match harness
            .invoke(&self.runtime, &handle, &invocation, events)
            .await
        {
            Ok(mut outcome) => {
                outcome.harness_version = availability.version;
                Ok((handle, outcome, environment))
            }
            Err(err) => {
                let _ = self.runtime.stop(&handle).await;
                Err(err)
            }
        }
    }

    /// Probe a running container for its OS and Node.js version.
    ///
    /// Both probes are best-effort. A failed OS probe falls back to `unknown`
    /// and a failed Node.js probe to `None`; neither aborts the run. The
    /// container image is taken from the harness rather than probed.
    async fn probe_environment(
        &self,
        handle: &ContainerHandle,
        container_image: String,
    ) -> RunEnvironment {
        let os = self
            .runtime
            .exec(handle, &as_command(["cat", "/etc/os-release"]))
            .await
            .ok()
            .filter(|out| out.exit_code == 0)
            .and_then(|out| parse_pretty_name(&out.stdout))
            .unwrap_or_else(|| "unknown".to_string());

        let node_version = self
            .runtime
            .exec(handle, &as_command(["node", "--version"]))
            .await
            .ok()
            .filter(|out| out.exit_code == 0)
            .map(|out| out.stdout.trim().to_string())
            .filter(|version| !version.is_empty());

        RunEnvironment {
            os,
            container_image,
            node_version,
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

    /// Run the validation pass over the produced implementation, scoring each
    /// declared check against the rendered reference baselines.
    pub fn validate(
        &self,
        test_case: &TestCaseVersion,
        artifacts: &ArtifactCollection,
        references: &[RenderedReference],
    ) -> Result<ValidationSummary> {
        self.validator.validate(test_case, artifacts, references)
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
        // Select the variant up front so its specs are what gets seeded and its
        // slug is what the run record attributes the run to.
        let variant = test_case.variant(&request.variant)?.clone();
        let specs = test_case.seeded_specs(&variant);
        // Render the selected variant's reference mockups once: the screenshots
        // are both seeded as visual targets and reused as validation baselines
        // below. A variant may add references of its own on top of the common set.
        let references = self.render_references(&test_case, &variant)?;
        let seeded = self.seed(&test_case, &variant, &specs, &references)?;
        let (handle, outcome, environment) = self
            .execute(&test_case, &variant, &seeded, request, events)
            .await?;

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
        let validation = self.validate(&test_case, &artifacts, &references)?;
        let finished_at = OffsetDateTime::now_utc();

        let record = RunRecord {
            id: uuid::Uuid::new_v4().to_string(),
            started_at: started_at.format(&Rfc3339).unwrap_or_default(),
            finished_at: finished_at.format(&Rfc3339).unwrap_or_default(),
            subject: RunSubject {
                test_case_slug: test_case.slug.clone(),
                test_case_version: test_case.version.clone(),
                variant: variant.slug.clone(),
                harness_slug: request.harness,
                harness_version: outcome.harness_version.clone(),
                model_id: request.model_id.clone(),
            },
            environment,
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

/// Collect a fixed list of string slices into the owned `Vec<String>` the
/// [`ContainerRuntime`] exec methods take.
fn as_command<const N: usize>(parts: [&str; N]) -> Vec<String> {
    parts.iter().map(|p| p.to_string()).collect()
}

/// Extract the `PRETTY_NAME` value from the contents of an `/etc/os-release`
/// file, stripping the surrounding quotes the field is conventionally written
/// with. Returns `None` when no `PRETTY_NAME` line is present.
fn parse_pretty_name(os_release: &str) -> Option<String> {
    os_release.lines().find_map(|line| {
        line.strip_prefix("PRETTY_NAME=")
            .map(|value| value.trim().trim_matches('"').to_string())
    })
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
