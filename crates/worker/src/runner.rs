//! Driving a submitted run through the core, backend-driven.
//!
//! This is the worker's entire run translation: it assembles the same
//! [`RunEngine`] a local `tcab run` does — only always sourced from the
//! backend (a worker has no local `test-cases/` checkout) — and calls
//! [`RunEngine::run_resolved`], relaying the live events to the submitting
//! job. It re-implements **none** of a run's behavior; the record it produces is
//! the one core writes, identical to a local run's.
//!
//! The mirror is `crates/cli/src/commands/run.rs`. The differences are that the
//! worker has no terminal to print to (events go to the job's stream instead) and
//! is always backend-resolved.

use std::path::{Path, PathBuf};

use test_cabinet_core::{
    ArtifactCollector, CliArtifactCollector, CliContainerRuntime, ContainerRuntime,
    DefaultHarnessRegistry, DispatchValidator, FsRepoSeeder, HttpBackendClient, NoopPublisher,
    OpenRouterPrices, OrchestratorCatalog, PrerenderedReferenceRenderer, RenderedReference,
    RunEngine, RunRecord, RunRequest, TestCaseCatalog, TestCaseVersion, materialize_version,
    write_failed_record,
};
use time::OffsetDateTime;

use std::sync::Arc;

use crate::config::WorkerRuntime;
use crate::jobs::{Job, JobEventSink, JobPreviewSink};
use crate::kubernetes::{
    KubernetesArtifactCollector, KubernetesConfig, KubernetesContainerRuntime,
};
use crate::notify::{WorkerNotification, WorkerNotifier};

/// Everything the worker needs to drive a run, derived once from the config and
/// shared (cheaply cloned) into each background run task.
#[derive(Debug, Clone)]
pub struct RunContext {
    /// The backend base URL definitions are resolved from and runs publish to.
    pub backend_url: String,
    /// Directory each run's record + implementation is written under.
    pub out_dir: PathBuf,
    /// Staging directory for a run's mountable inputs.
    pub work_dir: PathBuf,
    /// How each run's container is started (CLI runtime or Kubernetes run pods).
    pub runtime: WorkerRuntime,
    /// Run-pod settings used when [`runtime`](Self::runtime) is
    /// [`WorkerRuntime::Kubernetes`].
    pub kubernetes: KubernetesConfig,
}

/// Drive a single run to completion, recording its outcome on `job`.
///
/// Resolves the requested version from the backend, materializes it to disk,
/// assembles the orchestrator, and runs it — emitting the harness's live events
/// onto the job as they arrive. On success the produced [`RunRecord`] is recorded
/// on the job; on any failure the job is marked failed with the reason. Either
/// way a worker-wide completion notification is published to `notifier` so the
/// console can alert without watching the live stream. This function never
/// returns an error: a run's outcome (including a hard failure to even start) is
/// the job's terminal state, so the background task that calls it has nothing
/// left to handle.
pub async fn drive_run(ctx: RunContext, request: RunRequest, job: Job, notifier: WorkerNotifier) {
    let started_at = OffsetDateTime::now_utc();
    match run_inner(&ctx, &request, &job).await {
        Ok(record) => {
            let notification = WorkerNotification::completed(job.id(), job.summary(), &record.id);
            job.finish_succeeded(record);
            notifier.notify(notification);
        }
        Err(failure) => {
            // The job's failed state lives only in memory and is lost when the
            // worker restarts, so a failed run would otherwise vanish from the
            // listing entirely. Persist it as a `failed` run record (keyed by the
            // job id, so the live monitor and the detail page resolve to the same
            // id) with the captured event backlog, so the consoles can list it and
            // show why it stopped. A failure to persist is logged, not fatal — the
            // in-memory failed state and notification still fire.
            if let Err(err) = write_failed_record(
                &ctx.out_dir,
                job.id(),
                &request,
                failure.test_case.as_ref(),
                started_at,
                &failure.detail,
                &job.events_snapshot(),
            ) {
                tracing::warn!(
                    job_id = job.id(),
                    error = %err,
                    "could not persist failed run record",
                );
            }
            let notification = WorkerNotification::failed(job.id(), job.summary(), &failure.detail);
            job.finish_failed(failure.detail);
            notifier.notify(notification);
        }
    }
}

/// Why a run failed, with the resolved version when the failure happened after the
/// definition was materialized. The version lets the persisted failure record
/// carry the run's real test type and version; a failure before resolution (the
/// scratch directories cannot be created, or the backend will not serve the
/// definition) has none and falls back to what the request carried.
struct RunFailure {
    detail: String,
    test_case: Option<TestCaseVersion>,
}

impl RunFailure {
    /// A failure before the version was resolved.
    fn setup(detail: String) -> Self {
        Self {
            detail,
            test_case: None,
        }
    }
}

/// The fallible body of [`drive_run`]: assemble the orchestrator and run it.
/// Errors are returned as a [`RunFailure`] carrying a human-readable reason for
/// the job's failed state and, once known, the resolved version.
async fn run_inner(
    ctx: &RunContext,
    request: &RunRequest,
    job: &Job,
) -> Result<RunRecord, RunFailure> {
    let work_dir = &ctx.work_dir;
    let seed_dir = work_dir.join("seeds").join(job.id());
    let artifact_dir = work_dir.join("artifacts").join(job.id());
    let screenshot_dir = work_dir.join("screenshots").join(job.id());
    let store_dir = work_dir.join("definitions").join(job.id());
    for dir in [
        &ctx.out_dir,
        &seed_dir,
        &artifact_dir,
        &screenshot_dir,
        &store_dir,
    ] {
        std::fs::create_dir_all(dir)
            .map_err(|err| RunFailure::setup(format!("creating {}: {err}", dir.display())))?;
    }

    // The worker is always backend-driven: resolve the served definition, write
    // it to the per-job store, and reuse the backend's pre-rendered references as
    // the seeded visual targets and validation baselines.
    let version_str = request.test_case_version.clone().unwrap_or_default();
    let client = HttpBackendClient::new(ctx.backend_url.clone());
    let version_store = store_dir.join(&request.test_case_slug).join(&version_str);
    let (test_case, references) = materialize_version(
        &client,
        &request.test_case_slug,
        &version_str,
        &request.variant,
        &version_store,
    )
    .await
    .map_err(|err| {
        RunFailure::setup(format!(
            "resolving {}@{} [{}] from the backend: {err}",
            request.test_case_slug, version_str, request.variant
        ))
    })?;

    // From here the version is resolved, so any failure — including building the
    // container runtime — carries it through for the persisted failure record's
    // subject (its real test type and version). Select the runtime: a host
    // Docker/Podman for local/single-box use, or run pods via the Kubernetes API
    // for a cluster deployment. Only the runtime and its artifact collector differ;
    // everything else the engine wires is identical, so each arm hands its pair to
    // the same generic `drive_engine`.
    let with_test_case = |detail: String| RunFailure {
        detail,
        test_case: Some(test_case.clone()),
    };
    match ctx.runtime {
        WorkerRuntime::Cli => {
            let runtime = CliContainerRuntime::detect()
                .map_err(|err| with_test_case(format!("locating a container runtime: {err}")))?;
            let collector = CliArtifactCollector::new(runtime.clone(), artifact_dir);
            drive_engine(
                ctx,
                request,
                &test_case,
                references,
                seed_dir,
                screenshot_dir,
                runtime,
                collector,
                job,
            )
            .await
        }
        WorkerRuntime::Kubernetes => {
            let runtime = KubernetesContainerRuntime::connect(ctx.kubernetes.clone())
                .await
                .map_err(|err| {
                    with_test_case(format!("connecting to the Kubernetes API: {err}"))
                })?;
            let collector = KubernetesArtifactCollector::new(runtime.clone(), artifact_dir);
            drive_engine(
                ctx,
                request,
                &test_case,
                references,
                seed_dir,
                screenshot_dir,
                runtime,
                collector,
                job,
            )
            .await
        }
    }
    .map_err(|err| with_test_case(format!("run failed: {err}")))
}

/// Assemble the [`RunEngine`] around the selected container `runtime` and
/// `collector` and drive the resolved run to completion, relaying live events and
/// preview frames onto `job`. Everything except the runtime/collector pair is the
/// same regardless of where containers run, so both runtime arms share this.
#[allow(clippy::too_many_arguments)]
async fn drive_engine<R, C>(
    ctx: &RunContext,
    request: &RunRequest,
    test_case: &TestCaseVersion,
    references: Vec<RenderedReference>,
    seed_dir: PathBuf,
    screenshot_dir: PathBuf,
    runtime: R,
    collector: C,
    job: &Job,
) -> Result<RunRecord, test_cabinet_core::Error>
where
    R: ContainerRuntime,
    C: ArtifactCollector,
{
    // The base image resolves from the environment inside the orchestrator (a
    // registry reference, no backend involved); the request carries no explicit
    // per-run override.
    let orchestrator = RunEngine {
        // `run_resolved` does not consult the catalog (the version is resolved by
        // the caller), but the struct still carries one; a worker has no checkout,
        // so point it at a placeholder that is never read.
        catalog: TestCaseCatalog::new(catalog_placeholder()),
        seeder: FsRepoSeeder::new(seed_dir),
        collector,
        runtime,
        harnesses: Box::new(DefaultHarnessRegistry::new()),
        orchestrators: OrchestratorCatalog::new(),
        renderer: Box::new(PrerenderedReferenceRenderer::new(references)),
        validator: DispatchValidator::new(screenshot_dir),
        // The worker only runs; publishing is a separate, explicit operation
        // reached through the publish endpoint.
        publisher: NoopPublisher,
        prices: OpenRouterPrices::new(),
        output_dir: ctx.out_dir.clone(),
    };

    let mut events = JobEventSink::new(job.clone());
    // An asset-generation run streams its live drawing frames onto the same job, so
    // the console's run monitor can watch the sprite take shape; other run types
    // produce none and the listener simply never fires.
    let preview = Arc::new(JobPreviewSink::new(job.clone()));
    orchestrator
        .run_resolved(request, test_case, &mut events, Some(preview))
        .await
}

/// A non-existent catalog root for the orchestrator's unused `catalog` field. A
/// backend-driven run resolves its version itself and never touches the catalog,
/// so this path is never read; it exists only to satisfy the struct.
fn catalog_placeholder() -> &'static Path {
    Path::new("/nonexistent/tcab-worker-has-no-checkout")
}
