//! Driving a submitted run through the core, backend-driven.
//!
//! This is the worker's entire run translation: it assembles the same
//! [`Orchestrator`] a local `tcab run` does — only always sourced from the
//! backend (a worker has no local `test-cases/` checkout) — and calls
//! [`Orchestrator::run_resolved`], relaying the live events to the submitting
//! job. It re-implements **none** of a run's behavior; the record it produces is
//! the one core writes, identical to a local run's.
//!
//! The mirror is `crates/cli/src/commands/run.rs`. The differences are that the
//! worker has no terminal to print to (events go to the job's stream instead) and
//! is always backend-resolved.

use std::path::{Path, PathBuf};

use test_cabinet_core::{
    BackendClient, BuildValidator, CliArtifactCollector, CliContainerRuntime,
    DefaultHarnessRegistry, FsRepoSeeder, HttpBackendClient, NoopPublisher, OpenRouterPrices,
    Orchestrator, PrerenderedReferenceRenderer, RunRecord, RunRequest, TestCaseCatalog,
    materialize_version,
};

use crate::jobs::{Job, JobEventSink};

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
}

/// Drive a single run to completion, recording its outcome on `job`.
///
/// Resolves the requested version from the backend, materializes it to disk,
/// assembles the orchestrator, and runs it — emitting the harness's live events
/// onto the job as they arrive. On success the produced [`RunRecord`] is recorded
/// on the job; on any failure the job is marked failed with the reason. This
/// function never returns an error: a run's outcome (including a hard failure to
/// even start) is the job's terminal state, so the background task that calls it
/// has nothing left to handle.
pub async fn drive_run(ctx: RunContext, request: RunRequest, job: Job) {
    match run_inner(&ctx, &request, &job).await {
        Ok(record) => job.finish_succeeded(record),
        Err(detail) => job.finish_failed(detail),
    }
}

/// The fallible body of [`drive_run`]: assemble the orchestrator and run it.
/// Errors are returned as a human-readable reason for the job's failed state.
async fn run_inner(ctx: &RunContext, request: &RunRequest, job: &Job) -> Result<RunRecord, String> {
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
        std::fs::create_dir_all(dir).map_err(|err| format!("creating {}: {err}", dir.display()))?;
    }

    let runtime = CliContainerRuntime::detect()
        .map_err(|err| format!("locating a container runtime: {err}"))?;

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
        format!(
            "resolving {}@{} [{}] from the backend: {err}",
            request.test_case_slug, version_str, request.variant
        )
    })?;

    // Resolve the harness image to the backend's pullable digest reference; the
    // runner pulls it by digest rather than building it. The request is cloned so
    // the resolved image rides along into `run_resolved`.
    let image = client
        .resolve_container(request.harness.as_str())
        .await
        .map_err(|err| {
            format!(
                "resolving the `{}` container image from the backend: {err}",
                request.harness.as_str()
            )
        })?;
    let mut request = request.clone();
    request.container_image = Some(image.reference);

    let orchestrator = Orchestrator {
        // `run_resolved` does not consult the catalog (the version is resolved
        // above), but the struct still carries one; a worker has no checkout, so
        // point it at a placeholder that is never read.
        catalog: TestCaseCatalog::new(catalog_placeholder()),
        seeder: FsRepoSeeder::new(seed_dir),
        collector: CliArtifactCollector::new(runtime.clone(), artifact_dir),
        runtime,
        harnesses: Box::new(DefaultHarnessRegistry::new()),
        renderer: Box::new(PrerenderedReferenceRenderer::new(references)),
        validator: BuildValidator::new(screenshot_dir),
        // The worker only runs; publishing is a separate, explicit operation
        // reached through the publish endpoint.
        publisher: NoopPublisher,
        prices: OpenRouterPrices::new(),
        output_dir: ctx.out_dir.clone(),
    };

    let mut events = JobEventSink::new(job.clone());
    orchestrator
        .run_resolved(&request, &test_case, &mut events)
        .await
        .map_err(|err| format!("run failed: {err}"))
}

/// A non-existent catalog root for the orchestrator's unused `catalog` field. A
/// backend-driven run resolves its version itself and never touches the catalog,
/// so this path is never read; it exists only to satisfy the struct.
fn catalog_placeholder() -> &'static Path {
    Path::new("/nonexistent/tcab-worker-has-no-checkout")
}
