//! Driving the one run this driver executes, backend-streamed.
//!
//! This is the worker's `runner.rs` (`drive_run → run_inner → drive_engine`) with
//! the in-memory job removed: the same [`RunEngine`] a local `tcab run` or the
//! worker assembles, always backend-resolved (the driver has no local
//! `test-cases/` checkout), only here the live events and preview frames flow
//! through the backend-streaming [`sink`](crate::sink) rather than onto a job. It
//! re-implements **none** of a run's behavior; the record it produces is the one
//! core writes, identical to a local run's.
//!
//! The outcome is *not* recorded locally (the pod is ephemeral): [`drive`] returns
//! it so [`crate::main`] can stream the terminal status — carrying the produced or
//! failed record — back to the backend.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use test_cabinet_core::{
    ArtifactCollector, CliArtifactCollector, CliContainerRuntime, ContainerRuntime, CredBytesSource,
    DefaultHarnessRegistry, DispatchValidator, FsRepoSeeder, HttpBackendClient, NoopPublisher,
    OpenRouterPrices, OrchestratorCatalog, PrerenderedReferenceRenderer, RenderedReference,
    RunEngine, RunRecord, RunRequest, TestCaseCatalog, TestCaseVersion, materialize_version,
};
use tokio::sync::mpsc::UnboundedSender;

use crate::config::{Config, DriverRuntime};
use crate::creds::mounted_creds;
use crate::kubernetes::{
    KubernetesArtifactCollector, KubernetesContainerRuntime,
};
use crate::sink::{BackendEventSink, BackendPreviewSink, Outbound};

/// Why a run failed, with the resolved version when the failure happened after the
/// definition was materialized. Mirrors the worker's `RunFailure`: the version
/// lets the persisted failure record carry the run's real test type and version; a
/// failure before resolution (the scratch directories cannot be created, or the
/// backend will not serve the definition) has none and falls back to what the
/// request carried.
pub struct RunFailure {
    /// A specific, human-readable reason for the failure — the diagnostic detail
    /// the backend records, distinguishing "couldn't pull the image" from
    /// "harness unavailable" and the like.
    pub detail: String,
    /// The resolved version, present once the definition materialized.
    pub test_case: Option<TestCaseVersion>,
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

/// Drive the one run this driver executes, returning the produced [`RunRecord`] or
/// a [`RunFailure`] carrying a specific reason and the resolved version (when
/// known). Live events and preview frames are pushed onto `outbound` for the relay
/// to stream to the backend.
///
/// This is the fallible counterpart of the worker's `run_inner`: it creates the
/// ephemeral scratch dirs, materializes the served definition, selects the
/// container runtime, and runs the engine. Unlike the worker it records nothing on
/// failure — the caller streams the outcome to the backend instead.
pub async fn drive(
    config: &Config,
    request: &RunRequest,
    outbound: &UnboundedSender<Outbound>,
) -> Result<RunRecord, RunFailure> {
    // When the run requests an explicit auth mode, lock it for the engine by
    // setting `TCAB_AUTH_MODE` before resolution — the driver does not select the
    // mode itself, it only hands core the request's preference. Default (no
    // `auth_mode`) leaves the engine's API-key-preferring selection unchanged. A
    // driver pod runs exactly one run, so mutating its own process env here is
    // safe (there is no concurrent run to race).
    if let Some(mode) = config.launch.auth_mode.as_deref().filter(|m| !m.is_empty()) {
        // SAFETY: single-run process, set before any auth resolution; no other
        // thread reads `TCAB_AUTH_MODE` concurrently.
        unsafe { std::env::set_var("TCAB_AUTH_MODE", mode) };
    }

    // Make subscription auth available from the mounted Secret, when configured.
    // This is the cluster analogue of a signed-in host home: the bytes come from
    // the operator-provided Secret the dispatcher mounted, never from `~`. Core
    // still decides whether subscription is the selected mode.
    let creds: Option<Box<dyn CredBytesSource + Send + Sync>> =
        config.subscription_dir.as_deref().map(|dir| {
            Box::new(mounted_creds(dir, request.harness)) as Box<dyn CredBytesSource + Send + Sync>
        });

    let work_dir = &config.work_dir;
    // One run per driver, so the job id namespaces this pod's scratch (harmless,
    // and keeps the layout identical to the worker's per-job dirs).
    let job_id = &config.job_id;
    let out_dir = work_dir.join("out");
    let seed_dir = work_dir.join("seeds").join(job_id);
    let artifact_dir = work_dir.join("artifacts").join(job_id);
    let screenshot_dir = work_dir.join("screenshots").join(job_id);
    let store_dir = work_dir.join("definitions").join(job_id);
    for dir in [
        &out_dir,
        &seed_dir,
        &artifact_dir,
        &screenshot_dir,
        &store_dir,
    ] {
        std::fs::create_dir_all(dir)
            .map_err(|err| RunFailure::setup(format!("creating {}: {err}", dir.display())))?;
    }

    // Always backend-driven: resolve the served definition, write it to the
    // per-job store, and reuse the backend's pre-rendered references as the seeded
    // visual targets and validation baselines.
    let version_str = request.test_case_version.clone().unwrap_or_default();
    let client = HttpBackendClient::new(config.backend_url.clone());
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
    // container runtime — carries it through for the failure record's subject (its
    // real test type and version). Select the runtime: a host Docker/Podman for
    // local/single-box use, or a sandbox pod via the Kubernetes API for a cluster
    // deployment. Only the runtime and its artifact collector differ; everything
    // else the engine wires is identical, so each arm hands its pair to the same
    // generic `drive_engine`.
    let with_test_case = |detail: String| RunFailure {
        detail,
        test_case: Some(test_case.clone()),
    };
    match config.runtime {
        DriverRuntime::Cli => {
            let runtime = CliContainerRuntime::detect()
                .map_err(|err| with_test_case(format!("locating a container runtime: {err}")))?;
            let collector = CliArtifactCollector::new(runtime.clone(), artifact_dir);
            drive_engine(
                &out_dir,
                request,
                &test_case,
                references,
                seed_dir,
                screenshot_dir,
                runtime,
                collector,
                creds,
                outbound,
            )
            .await
        }
        DriverRuntime::Kubernetes => {
            let runtime = KubernetesContainerRuntime::connect(config.kubernetes.clone())
                .await
                .map_err(|err| {
                    with_test_case(format!("connecting to the Kubernetes API: {err}"))
                })?;
            let collector = KubernetesArtifactCollector::new(runtime.clone(), artifact_dir);
            drive_engine(
                &out_dir,
                request,
                &test_case,
                references,
                seed_dir,
                screenshot_dir,
                runtime,
                collector,
                creds,
                outbound,
            )
            .await
        }
    }
    .map_err(|err| with_test_case(format!("run failed: {err}")))
}

/// Assemble the [`RunEngine`] around the selected container `runtime` and
/// `collector` and drive the resolved run to completion, streaming live events and
/// preview frames through the backend-streaming sinks. Everything except the
/// runtime/collector pair is the same regardless of where containers run, so both
/// runtime arms share this — exactly as the worker's `drive_engine` does.
#[allow(clippy::too_many_arguments)]
async fn drive_engine<R, C>(
    out_dir: &Path,
    request: &RunRequest,
    test_case: &TestCaseVersion,
    references: Vec<RenderedReference>,
    seed_dir: PathBuf,
    screenshot_dir: PathBuf,
    runtime: R,
    collector: C,
    creds: Option<Box<dyn CredBytesSource + Send + Sync>>,
    outbound: &UnboundedSender<Outbound>,
) -> Result<RunRecord, test_cabinet_core::Error>
where
    R: ContainerRuntime,
    C: ArtifactCollector,
{
    // The base image resolves from the environment inside the orchestrator (a
    // registry reference, no backend involved); the request carries no explicit
    // per-run override.
    let engine = RunEngine {
        // `run_resolved` does not consult the catalog (the version is resolved by
        // the caller), but the struct still carries one; the driver has no
        // checkout, so point it at a placeholder that is never read.
        catalog: TestCaseCatalog::new(catalog_placeholder()),
        seeder: FsRepoSeeder::new(seed_dir),
        collector,
        runtime,
        harnesses: Box::new(DefaultHarnessRegistry::new()),
        orchestrators: OrchestratorCatalog::new(),
        renderer: Box::new(PrerenderedReferenceRenderer::new(references)),
        validator: DispatchValidator::new(screenshot_dir),
        // The driver only runs; publishing is a separate, explicit backend
        // operation reached through the publish endpoint.
        publisher: NoopPublisher,
        prices: OpenRouterPrices::new(),
        output_dir: out_dir.to_path_buf(),
        // The cluster path has no host credential files; a subscription run reads
        // its credentials from the mounted Secret instead (`None` when no
        // subscription Secret is configured — the run stays API-key-only).
        creds,
    };

    let mut events = BackendEventSink::new(outbound.clone());
    // An asset-generation run streams its live drawing frames through the same
    // relay, so the console's run monitor can watch the sprite take shape; other
    // run types produce none and the listener simply never fires.
    let preview = Arc::new(BackendPreviewSink::new(outbound.clone()));
    engine
        .run_resolved(request, test_case, &mut events, Some(preview))
        .await
}

/// A non-existent catalog root for the engine's unused `catalog` field. A
/// backend-driven run resolves its version itself and never touches the catalog,
/// so this path is never read; it exists only to satisfy the struct.
fn catalog_placeholder() -> &'static Path {
    Path::new("/nonexistent/tcab-driver-has-no-checkout")
}
