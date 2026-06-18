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

pub mod backend_client;
pub mod browser;
pub mod container;
pub mod error;
pub mod event;
pub mod execution;
pub mod harness;
pub mod harness_registry;
mod host_path;
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
use std::future::Future;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

pub use backend_client::{
    BackendClient, HttpBackendClient, PrerenderedReferenceRenderer, PublishAck, PublishedReview,
    PublishedRun, ResolvedArtifact, ResolvedReference, RunPage, materialize_version,
};
pub use container::{CliArtifactCollector, CliContainerRuntime};
pub use error::{Error, Result};
pub use event::{
    EventFormat, EventKind, EventParser, EventSink, HarnessEvent, NoopEventSink,
    OrchestrationAction,
};
pub use execution::{
    ArtifactCollection, ArtifactCollector, ContainerHandle, ContainerRuntime, ContainerSpec,
    OutputSink, OutputStream, RawOutputLine, RepoSeeder, SeedRequest, SeededRepo, WORKSPACE_DIR,
};
pub use harness::{
    AgentHarness, Availability, HarnessInvocation, HarnessOutcome, HarnessRegistry, Usage,
};
pub use harness_registry::DefaultHarnessRegistry;
pub use metrics::{Cost, RunMetrics, TokenCounts, TokenPrices};
pub use models::{Model, ModelCatalog};
pub use pricing::{ModelDetails, OpenRouterPrices};
pub use prompt::render_prompt;
pub use publish::{
    BackendPublisher, CommandOutput, CommandRunner, NoopPublisher, PublishConfig, PublishOutcome,
    PublishRequest, Publisher, SystemCommandRunner, implementation_dir, parse_wrangler_url,
    run_slug,
};
pub use reference::{BrowserRenderer, ReferenceRenderer, RenderedReference};
pub use review::{Rating, ReviewVerdict, VerdictStatus, Writeup, missing_verdicts, parse_writeup};
pub use run_record::{
    HarnessSlug, RunEnvironment, RunLinks, RunRecord, RunState, RunStatus, RunSubject, RunTooling,
};
pub use seeding::FsRepoSeeder;
pub use test_case::{
    Check, CheckAction, ReferenceView, ReviewItem, SpecFile, TestCase, TestCaseCatalog,
    TestCaseVersion, Variant,
};
pub use validation::{CapturedView, CheckResult, StepResult, ValidationSummary, Validator};
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
    /// Optional override for the maximum harness runtime, in seconds. `None`
    /// uses the resolved test case's `max_runtime_seconds` default; `Some`
    /// replaces it for this run (for example `tcab run --max-runtime`). Either
    /// way the run is bounded, so a session can never continue unbounded.
    pub max_runtime_override: Option<u64>,
    /// An explicit per-run override for the harness container image: a full,
    /// pullable reference the runtime pulls. `None` — the usual case — resolves
    /// the image from the environment via [`AgentHarness::image`]
    /// ([`resolve_harness_image`](crate::harness::resolve_harness_image)), which
    /// consults no backend. Whatever image actually runs is recorded (resolved to
    /// its registry digest where it has one) as [`RunEnvironment::container_image`].
    pub container_image: Option<String>,
}

impl RunRequest {
    /// The maximum harness runtime, in seconds, in effect for this run: the
    /// per-invocation [`Self::max_runtime_override`] when set, otherwise the
    /// resolved case's [`TestCaseVersion::max_runtime_seconds`] default. Always
    /// positive, so the harness session is always bounded.
    pub fn effective_max_runtime(&self, test_case: &TestCaseVersion) -> u64 {
        self.max_runtime_override
            .unwrap_or(test_case.max_runtime_seconds)
    }
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

        // The image is the run's explicit per-run override when it carries one,
        // else the image resolved from the environment by the harness layer (a
        // registry reference, resolved without any backend). The runtime pulls it,
        // so both the availability probe and the session run in the same image.
        let image = request
            .container_image
            .clone()
            .unwrap_or_else(|| harness.image());

        let availability = harness.check_availability(&self.runtime, &image).await?;
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
            image: image.clone(),
            repo_path: seeded.path.clone(),
            secrets,
            network_enabled: true,
        };

        let handle = self.runtime.start(&spec).await?;

        // Record the exact image bytes the run used. When the image was launched
        // by a mutable tag, resolve it to the registry digest now that it is
        // pulled, so the run record pins what actually ran; fall back to the
        // launch reference for a local build that has no registry digest.
        let recorded_image = self
            .runtime
            .image_digest(&image)
            .await
            .ok()
            .flatten()
            .unwrap_or(image);

        // Capture the container environment from inside the running container so
        // it reflects what the harness actually built in, not the host. Probes
        // are best-effort: a failure degrades to sensible defaults rather than
        // failing the run. The resolved image is recorded as the run's
        // `containerImage`.
        let environment = self.probe_environment(&handle, recorded_image).await;

        let invocation = HarnessInvocation {
            slug,
            model_id: request.model_id.clone(),
            prompt: render_prompt(test_case, variant)?,
        };
        // Bound the harness session by the run's maximum runtime so it can never
        // continue unbounded. The cap comes from the test case manifest, possibly
        // overridden on the request. On timeout the session future is dropped
        // (cancelling the in-flight exec) and the same `Err` arm below tears the
        // container down, just as it does for any other harness failure.
        let max_runtime = request.effective_max_runtime(test_case);
        let invoke = harness.invoke(&self.runtime, &handle, &invocation, events);
        match with_runtime_cap(invoke, max_runtime, slug).await {
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
        let test_case = self.resolve(request)?;
        self.run_resolved(request, &test_case, events).await
    }

    /// Drive a run end to end against an already-resolved [`TestCaseVersion`],
    /// skipping the catalog lookup [`Self::run`] performs.
    ///
    /// This is the entry point a backend-driven runner uses: it resolves the
    /// version through [`crate::BackendClient`] (materializing the served
    /// definition to disk via [`crate::materialize_version`]) and supplies the
    /// result here, rather than reading a local `test-cases/` checkout. The
    /// orchestrator's `renderer` should be a
    /// [`crate::PrerenderedReferenceRenderer`] over the backend's screenshots in
    /// that case, so this method reuses them instead of re-rendering mockup HTML
    /// the runner never receives.
    pub async fn run_resolved(
        &self,
        request: &RunRequest,
        test_case: &TestCaseVersion,
        events: &mut dyn EventSink,
    ) -> Result<RunRecord> {
        let started_at = OffsetDateTime::now_utc();
        let timer = Instant::now();

        // Select the variant up front so its specs are what gets seeded and its
        // slug is what the run record attributes the run to.
        let variant = test_case.variant(&request.variant)?.clone();
        let specs = test_case.seeded_specs(&variant);
        // Render the selected variant's reference mockups once: the screenshots
        // are both seeded as visual targets and reused as validation baselines
        // below. A variant may add references of its own on top of the common set.
        let references = self.render_references(test_case, &variant)?;
        // A run is only meaningful if every declared reference rendered: those
        // screenshots are the visual targets the harness builds against and the
        // baselines validation scores against. Rendering degrades view-by-view
        // (a failure is logged and skipped, not raised), so detect a short render
        // here and refuse to start rather than seed an incomplete target set and
        // burn a harness session on it.
        let expected = test_case.references_for(&variant);
        if references.len() < expected.len() {
            let rendered: std::collections::HashSet<&str> =
                references.iter().map(|r| r.view.as_str()).collect();
            let missing = expected
                .iter()
                .map(|view| view.view.clone())
                .filter(|view| !rendered.contains(view.as_str()))
                .collect();
            return Err(Error::ReferenceRenderIncomplete {
                slug: test_case.slug.clone(),
                version: test_case.version.clone(),
                missing,
            });
        }
        let seeded = self.seed(test_case, &variant, &specs, &references)?;
        let (handle, outcome, environment) = self
            .execute(test_case, &variant, &seeded, request, events)
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
        let validation = self.validate(test_case, &artifacts, &references)?;
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
            tooling: RunTooling::current(),
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
        // Persist the harness's raw output and its translation beside the record
        // so a run's event classification can be inspected and re-checked.
        write_run_streams(
            &self.output_dir.join(&record.id),
            &outcome.raw_output,
            &outcome.translated_events,
        )?;
        Ok(record)
    }
}

/// Write a run's raw harness output and its translated events as two JSONL files
/// in the run directory: `raw.jsonl` carries one stream-tagged line per entry in
/// arrival order, and `events.jsonl` carries one normalized event per line.
///
/// Together they make a run's translation auditable: replaying `raw.jsonl`
/// through an [`EventParser`] reproduces `events.jsonl`, so the parsing logic can
/// be checked against real harness output captured from an actual run.
fn write_run_streams(
    run_dir: &std::path::Path,
    raw: &[RawOutputLine],
    events: &[HarnessEvent],
) -> Result<()> {
    write_jsonl(&run_dir.join("raw.jsonl"), raw)?;
    write_jsonl(&run_dir.join("events.jsonl"), events)?;
    Ok(())
}

/// Serialize each item as its own JSON line and write them to `path`.
fn write_jsonl<T: serde::Serialize>(path: &std::path::Path, items: &[T]) -> Result<()> {
    let mut contents = String::new();
    for item in items {
        contents.push_str(&serde_json::to_string(item)?);
        contents.push('\n');
    }
    std::fs::write(path, contents)?;
    Ok(())
}

/// Drive a harness session future under a wall-clock cap.
///
/// Returns the session's own result if it finishes within `seconds`. Otherwise
/// the future is dropped — cancelling the in-flight container exec — and an
/// [`Error::RunTimedOut`] for `slug` is returned so the caller can tear the
/// container down. This is what keeps a run from continuing unbounded; the cap
/// is always positive, so a session is always bounded.
async fn with_runtime_cap<F>(session: F, seconds: u64, slug: HarnessSlug) -> Result<HarnessOutcome>
where
    F: Future<Output = Result<HarnessOutcome>>,
{
    match tokio::time::timeout(Duration::from_secs(seconds), session).await {
        Ok(result) => result,
        Err(_elapsed) => Err(Error::RunTimedOut {
            slug: slug.as_str().to_string(),
            seconds,
        }),
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
