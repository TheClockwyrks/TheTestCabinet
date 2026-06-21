//! The Tauri commands the webview drives the core through.
//!
//! Each command is a thin adapter: it resolves host configuration from the
//! environment (see [`crate::config`]), calls into [`test_cabinet_core`], and
//! maps the result to a serializable DTO. Errors surface to the frontend as
//! strings so the UI can show them verbatim. The orchestration itself lives in
//! the core; the shell owns no run logic of its own.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use test_cabinet_core::{
    AccountsClient, ArtifactCollection, AuthnResponse, BackendClient, BackendPublisher,
    BrowserRenderer, CliArtifactCollector, CliContainerRuntime, DefaultHarnessRegistry,
    DispatchValidator, Domain, DomainRating, FsRepoSeeder, HarnessEvent, HarnessSlug,
    HttpBackendClient, LoginRequest, Model, ModelCatalog, NoopPublisher, OpenRouterPrices,
    OrchestratorCatalog, OrchestratorSelection, PrerenderedReferenceRenderer, PublishConfig,
    PublishedRun, Publisher, PushRequest, RawOutputLine, ReferenceRenderer, RegisterRequest,
    ReviewItem, ReviewVerdict, RunEngine, RunRecord, RunRequest, SystemCommandRunner, TestCase,
    TestCaseCatalog, TestCaseVersion, TestType, Writeup, find_build_output, implementation_dir,
    materialize_version, missing_ratings, missing_verdicts, parse_writeup, read_event_log,
    render_prompt,
};

use crate::config;
use crate::events::{
    NOTIFY_CHANNEL, RunNotification, WebviewEventSink, WebviewPreviewSink, done_channel,
};
use crate::playable::build_base_url;

/// A command result whose error is a plain string the webview can render.
type CmdResult<T> = Result<T, String>;

/// Map any error into the string form the frontend shows.
fn err<E: std::fmt::Display>(context: &str, e: E) -> String {
    format!("{context}: {e}")
}

// ---------------------------------------------------------------------------
// Catalogs: harnesses, models, test cases.
// ---------------------------------------------------------------------------

/// The curated model catalog: each model the benchmark evaluates against, read
/// from `models/<slug>.toml`. Used to populate the run-configuration model
/// picker (with the model ids that identify each in run records).
#[tauri::command]
#[tracing::instrument]
pub fn list_models() -> CmdResult<Vec<Model>> {
    ModelCatalog::new(config::models_root())
        .list()
        .map_err(|e| err("listing models", e))
}

/// The test-case catalog: every case and its available versions. Resolved from
/// the backend when one is configured (`TCAB_BACKEND_URL`), otherwise from the
/// local `test-cases/` checkout for offline development.
#[tauri::command]
#[tracing::instrument]
pub async fn list_test_cases() -> CmdResult<Vec<TestCase>> {
    match config::backend_url() {
        Some(url) => HttpBackendClient::new(url)
            .catalog()
            .await
            .map_err(|e| err("listing test cases from the backend", e)),
        None => TestCaseCatalog::new(config::catalog_root())
            .list()
            .map_err(|e| err("listing test cases from the local checkout", e)),
    }
}

/// The versions available for one test case, newest-listed-last, from the same
/// source as [`list_test_cases`].
#[tauri::command]
#[tracing::instrument(fields(%slug))]
pub async fn list_versions(slug: String) -> CmdResult<Vec<String>> {
    match config::backend_url() {
        Some(url) => HttpBackendClient::new(url)
            .versions(&slug)
            .await
            .map_err(|e| err("listing versions from the backend", e)),
        None => TestCaseCatalog::new(config::catalog_root())
            .versions(&slug)
            .map_err(|e| err("listing versions from the local checkout", e)),
    }
}

// ---------------------------------------------------------------------------
// Version resolution & reading the specs.
// ---------------------------------------------------------------------------

/// A reference for a variant: the view it depicts, whether its media is an image
/// or video, and the URL the webview loads it from (the backend's reference
/// endpoint).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceShot {
    pub view: String,
    pub kind: test_cabinet_core::MediaKind,
    pub url: String,
}

/// A variant of a resolved version, flattened for the configuration picker and
/// the test-case detail tabs.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VariantInfo {
    pub slug: String,
    pub name: String,
    pub description: Option<String>,
    /// The variant's prompt, rendered as a real run receives it.
    pub prompt: String,
    /// Rendered reference screenshots (common first, then the variant's own),
    /// resolved to backend URLs. Empty for a locally-resolved checkout, which has
    /// no rendered baselines without a backend to serve them.
    pub references: Vec<ReferenceShot>,
    /// The reviewer checklist items for this variant (common first, then the
    /// variant's own), carrying their point weights so the gallery can score runs.
    pub review_items: Vec<ReviewItem>,
}

/// A resolved test-case version's site-facing framing, enough to configure a run
/// and to read the specification it was built from.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionInfo {
    pub slug: String,
    pub version: String,
    pub name: String,
    pub difficulty: String,
    pub tags: Vec<String>,
    pub summary: Option<String>,
    /// The case's test type. The webview offers the run-launch orchestrator
    /// selector only for `end-to-end`; other types always run `one-shot`.
    pub test_type: TestType,
    pub variants: Vec<VariantInfo>,
    /// The case's scoring domains (case-level). A reviewer rates each
    /// independently; a run's overall rating is the worst across them.
    pub domains: Vec<Domain>,
    /// The sprite-sheet frame grid and named sequences, present only for a
    /// sprite-sheet case; `None` otherwise. Lets the webview's live monitor show
    /// one stable slot per declared frame as the model draws.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sheet: Option<test_cabinet_core::SheetSpec>,
    pub max_runtime_seconds: u64,
}

impl VersionInfo {
    /// Build the framing the webview consumes. `reference_base` is the backend
    /// URL whose reference endpoint serves the rendered baselines (the backend
    /// the version was resolved from); it is `None` for a local checkout, which
    /// has no rendered baselines, so those variants carry no references. The
    /// prompt is rendered for every variant regardless, the same way a run
    /// receives it.
    fn from_version(v: &TestCaseVersion, reference_base: Option<&str>) -> CmdResult<Self> {
        let variants = v
            .variants
            .iter()
            .map(|variant| {
                let prompt = render_prompt(v, variant)
                    .map_err(|e| err("rendering the variant prompt", e))?;
                Ok(VariantInfo {
                    slug: variant.slug.clone(),
                    name: variant.name.clone(),
                    description: variant.description.clone(),
                    prompt,
                    references: reference_base
                        .map(|base| variant_reference_shots(base, v, variant))
                        .unwrap_or_default(),
                    review_items: v.review_items_for(variant),
                })
            })
            .collect::<CmdResult<Vec<_>>>()?;
        Ok(Self {
            slug: v.slug.clone(),
            version: v.version.clone(),
            name: v.name.clone(),
            difficulty: v.difficulty.clone(),
            tags: v.tags.clone(),
            summary: v.summary.clone(),
            test_type: v.test_type,
            variants,
            domains: v.domains.clone(),
            sheet: v.sheet.clone(),
            max_runtime_seconds: v.max_runtime_seconds,
        })
    }
}

/// The reference screenshots for a variant, resolved to backend URLs: the common
/// references (served under the `_common` scope) followed by the variant's own
/// (served under the variant slug), matching the backend's reference layout.
fn variant_reference_shots(
    base: &str,
    v: &TestCaseVersion,
    variant: &test_cabinet_core::Variant,
) -> Vec<ReferenceShot> {
    let base = base.trim_end_matches('/');
    let shot = |scope: &str, r: &test_cabinet_core::ReferenceView| ReferenceShot {
        view: r.view.clone(),
        kind: r.kind.media_kind(),
        url: format!(
            "{base}/test-cases/{}/versions/{}/references/{scope}/{}.{}",
            v.slug,
            v.version,
            r.view,
            r.extension()
        ),
    };
    v.common_references
        .iter()
        .map(|r| shot("_common", r))
        .chain(variant.references.iter().map(|r| shot(&variant.slug, r)))
        .collect()
}

/// Resolve an exact test-case version to its configuration framing (its name,
/// difficulty, tags, its variants for the variant picker, and each variant's
/// rendered prompt and reference baselines for the detail tabs).
#[tauri::command]
#[tracing::instrument(fields(%slug, %version))]
pub async fn resolve_version(slug: String, version: String) -> CmdResult<VersionInfo> {
    let resolved = resolve_version_inner(&slug, &version).await?;
    VersionInfo::from_version(&resolved, config::backend_url().as_deref())
}

/// Resolve a version from the backend (materializing its served definition to
/// disk so spec bodies are readable) or the local checkout. The local checkout
/// already holds the spec files on disk; the backend path writes them under the
/// per-run staging store.
pub(crate) async fn resolve_version_inner(slug: &str, version: &str) -> CmdResult<TestCaseVersion> {
    match config::backend_url() {
        Some(url) => {
            let client = HttpBackendClient::new(url);
            let store = config::staging_dir()
                .join("definitions")
                .join(slug)
                .join(version);
            // Materialize against the first variant; spec bodies (common + every
            // variant's own) are written regardless of the variant argument, which
            // only selects which references are fetched. Reading specs needs the
            // sources, which are all materialized here.
            let first_variant = client
                .resolve_version(slug, version)
                .await
                .map_err(|e| err("resolving version from the backend", e))?
                .variants
                .first()
                .map(|v| v.slug.clone())
                .unwrap_or_else(|| "base".to_string());
            let (resolved, _refs) =
                materialize_version(&client, slug, version, &first_variant, &store)
                    .await
                    .map_err(|e| err("materializing version from the backend", e))?;
            Ok(resolved)
        }
        None => TestCaseCatalog::new(config::catalog_root())
            .resolve(slug, version)
            .map_err(|e| err("resolving version from the local checkout", e)),
    }
}

/// One spec file as the webview reads it: its in-workspace destination path and
/// its text body.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecDocument {
    /// The path the spec is seeded to in a run's workspace (a stable label).
    pub dest: String,
    /// The spec's text contents.
    pub body: String,
}

/// The full specification a run is built from, for a given variant: the case's
/// site-facing description (when present) plus every seeded spec's body.
///
/// This is the "read the specs" capability — what a reviewer judges a produced
/// implementation against.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Specification {
    pub slug: String,
    pub version: String,
    pub variant: String,
    /// The resolved `description.md` body, when the case declares one.
    pub description: Option<String>,
    /// Every spec seeded for this variant (common + variant-specific), in order.
    pub specs: Vec<SpecDocument>,
}

/// Read the specification a run would be built from for the chosen variant.
///
/// Resolves the version (materializing from the backend when configured), reads
/// the optional site-facing description, and reads each seeded spec's body from
/// its source on disk.
#[tauri::command]
#[tracing::instrument(fields(%slug, %version, %variant))]
pub async fn read_specs(
    slug: String,
    version: String,
    variant: String,
) -> CmdResult<Specification> {
    let resolved = resolve_version_inner(&slug, &version).await?;
    let variant_ref = resolved
        .variant(&variant)
        .map_err(|e| err("selecting variant", e))?;

    let description = match &resolved.description_path {
        Some(path) => Some(
            std::fs::read_to_string(path)
                .map_err(|e| err(&format!("reading description {}", path.display()), e))?,
        ),
        None => None,
    };

    let mut specs = Vec::new();
    for spec in resolved.seeded_specs(variant_ref) {
        let body = std::fs::read_to_string(&spec.source_path)
            .map_err(|e| err(&format!("reading spec {}", spec.source_path.display()), e))?;
        specs.push(SpecDocument {
            dest: spec.dest.to_string_lossy().into_owned(),
            body,
        });
    }

    Ok(Specification {
        slug: resolved.slug.clone(),
        version: resolved.version.clone(),
        variant: variant_ref.slug.clone(),
        description,
        specs,
    })
}

// ---------------------------------------------------------------------------
// Launching a run with a live event stream (async job model).
// ---------------------------------------------------------------------------

/// One run currently executing in-process, as `list_active_runs` reports it.
/// Mirrors the worker's `/runs/active` entry and the console's `InProgressRun`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveRun {
    /// The live stream/job id the run was launched under.
    pub run_id: String,
    pub test_case_slug: String,
    pub variant: String,
    pub harness_slug: String,
    pub model_id: String,
    /// Always `running`; a finished run is removed from the registry.
    pub state: &'static str,
}

/// The desktop shell's registry of in-flight runs.
///
/// The HTTP worker tracks running jobs in its job registry; the embedded core has
/// none, so the shell records each launched run here and removes it when the run
/// finishes. `list_active_runs` reads this so the console's in-progress list
/// survives a reload (the session-only client state is rebuilt from it), matching
/// the web path's `GET /runs/active`.
#[derive(Debug, Default)]
pub struct ActiveRuns(Mutex<HashMap<String, ActiveRun>>);

impl ActiveRuns {
    /// Record a run as in-flight under its job id.
    fn insert(&self, run: ActiveRun) {
        self.0
            .lock()
            .expect("active-runs mutex poisoned")
            .insert(run.run_id.clone(), run);
    }

    /// Drop a run once it has reached a terminal state.
    fn remove(&self, run_id: &str) {
        self.0
            .lock()
            .expect("active-runs mutex poisoned")
            .remove(run_id);
    }

    /// Snapshot the currently in-flight runs.
    fn list(&self) -> Vec<ActiveRun> {
        self.0
            .lock()
            .expect("active-runs mutex poisoned")
            .values()
            .cloned()
            .collect()
    }
}

/// List the runs the shell is currently executing, for the console's in-progress
/// list. The desktop equivalent of the worker's `GET /runs/active`.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn list_active_runs(active: State<'_, ActiveRuns>) -> Vec<ActiveRun> {
    active.list()
}

/// The configuration the webview submits to launch a run.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchConfig {
    pub test_case: String,
    pub version: String,
    pub variant: String,
    /// The harness slug (one of [`HarnessSlug`]'s wire tokens).
    pub harness: String,
    pub model_id: String,
    /// The built-in orchestrator slug that conducts the harness sessions. The
    /// webview offers this only for the end-to-end test type; other types always
    /// submit `one-shot`. A local run resolves built-in orchestrators only (no
    /// `--orchestrator-dir` directory). Defaults to `one-shot` when omitted.
    #[serde(default = "default_orchestrator")]
    pub orchestrator: String,
    /// Optional override for the run's maximum runtime, in seconds.
    pub max_runtime_override: Option<u64>,
}

/// The default orchestrator slug for a launch that omits one (a single session).
fn default_orchestrator() -> String {
    OrchestratorSelection::default().slug
}

/// The terminal outcome of a launched run, delivered on the run's `done` channel.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum RunOutcome {
    /// The run finished and produced a record.
    Completed { record: Box<RunRecord> },
    /// The run failed before producing a record; `message` explains why.
    Failed { message: String },
}

/// Parse a harness slug from its wire token.
fn parse_harness(slug: &str) -> CmdResult<HarnessSlug> {
    HarnessSlug::ALL
        .into_iter()
        .find(|h| h.as_str() == slug)
        .ok_or_else(|| format!("unknown harness slug `{slug}`"))
}

/// Launch a run for the configured test case, variant, harness, and model.
///
/// Returns immediately with a `runId` (the live-stream/job id). The run proceeds
/// on a background task: each normalized harness event is emitted to the webview
/// on `run://<runId>/event`, and the terminal [`RunOutcome`] (the record or an
/// error) is emitted on `run://<runId>/done`. This is the async job model — the
/// command does not block for the (up-to-an-hour) run.
#[tauri::command]
#[tracing::instrument(skip_all, fields(
    test_case = %config.test_case,
    version = %config.version,
    variant = %config.variant,
    harness = %config.harness,
    model_id = %config.model_id,
    orchestrator = %config.orchestrator,
))]
pub async fn launch_run(app: AppHandle, config: LaunchConfig) -> CmdResult<String> {
    let harness = parse_harness(&config.harness)?;
    // The live-stream id is generated up front so the UI can subscribe before the
    // run produces its own record id; the final record carries its own id.
    let job_id = uuid::Uuid::new_v4().to_string();

    // Resolve the version + renderer before spawning so a configuration error is
    // reported synchronously (the command returns an error) rather than only over
    // the event channel.
    let request = RunRequest {
        test_case_slug: config.test_case.clone(),
        test_case_version: Some(config.version.clone()),
        variant: config.variant.clone(),
        harness,
        model_id: config.model_id.clone(),
        // The webview selects a built-in orchestrator by slug (no local directory);
        // it surfaces the selector only for end-to-end and otherwise submits the
        // default `one-shot`. Core re-validates that a non-default orchestrator is
        // only used for the end-to-end test type.
        orchestrator: OrchestratorSelection::builtin(config.orchestrator.clone()),
        max_runtime_override: config.max_runtime_override,
        // Filled in from the backend below when one is configured; a local run
        // falls back to the harness's locally-built image.
        container_image: None,
    };

    let runtime =
        CliContainerRuntime::detect().map_err(|e| err("locating a container runtime", e))?;

    let work_dir = config::staging_dir();
    let seed_dir = work_dir.join("seeds");
    let artifact_dir = work_dir.join("artifacts");
    let screenshot_dir = work_dir.join("screenshots");
    let store_dir = work_dir.join("definitions");
    let output_dir = config::output_dir();
    for dir in [&output_dir, &seed_dir, &artifact_dir, &screenshot_dir] {
        std::fs::create_dir_all(dir)
            .map_err(|e| err(&format!("creating directory {}", dir.display()), e))?;
    }

    let (test_case, renderer): (TestCaseVersion, Box<dyn ReferenceRenderer>) =
        match config::backend_url() {
            Some(url) => {
                let client = HttpBackendClient::new(url);
                let store = store_dir.join(&config.test_case).join(&config.version);
                let (version, references) = materialize_version(
                    &client,
                    &config.test_case,
                    &config.version,
                    &config.variant,
                    &store,
                )
                .await
                .map_err(|e| err("resolving the run's definition from the backend", e))?;
                // The base image resolves from the environment in the
                // orchestrator (a registry reference, no backend involved); no
                // explicit per-run override is set.
                (
                    version,
                    Box::new(PrerenderedReferenceRenderer::new(references)),
                )
            }
            None => {
                let catalog = TestCaseCatalog::new(config::catalog_root());
                let version = catalog
                    .resolve(&config.test_case, &config.version)
                    .map_err(|e| {
                        err("resolving the run's definition from the local checkout", e)
                    })?;
                (version, Box::new(BrowserRenderer::new()))
            }
        };

    let orchestrator = RunEngine {
        catalog: TestCaseCatalog::new(config::catalog_root()),
        seeder: FsRepoSeeder::new(seed_dir),
        collector: CliArtifactCollector::new(runtime.clone(), artifact_dir),
        runtime,
        harnesses: Box::new(DefaultHarnessRegistry::new()),
        orchestrators: OrchestratorCatalog::new(),
        renderer,
        validator: DispatchValidator::new(screenshot_dir),
        publisher: NoopPublisher,
        prices: OpenRouterPrices::new(),
        output_dir,
    };

    // Record the run as in-flight so `list_active_runs` can rebuild the console's
    // in-progress list after a reload; the background task drops it on completion.
    let active = ActiveRun {
        run_id: job_id.clone(),
        test_case_slug: config.test_case.clone(),
        variant: config.variant.clone(),
        harness_slug: config.harness.clone(),
        model_id: config.model_id.clone(),
        state: "running",
    };
    app.state::<ActiveRuns>().insert(active.clone());

    let done = done_channel(&job_id);
    let mut sink = WebviewEventSink::new(app.clone(), job_id.clone());
    // An asset-generation run streams its live drawing frames to the webview on the
    // run's preview channel; other run types produce none and the listener never
    // fires.
    let preview = Arc::new(WebviewPreviewSink::new(app.clone(), &job_id));
    let outcome_app = app.clone();
    // Drive the run on a background task so the command returns the job id at once
    // and the UI streams events live rather than waiting out the whole run.
    tokio::spawn(async move {
        use tauri::Emitter;
        let outcome = match orchestrator
            .run_resolved(&request, &test_case, &mut sink, Some(preview))
            .await
        {
            Ok(record) => RunOutcome::Completed {
                record: Box::new(record),
            },
            Err(e) => RunOutcome::Failed {
                message: e.to_string(),
            },
        };

        // Build the worker-wide completion notification from the outcome before
        // the record is moved onto the done channel.
        let notification = match &outcome {
            RunOutcome::Completed { record } => RunNotification {
                kind: "run-completed",
                job_id: active.run_id.clone(),
                test_case_slug: active.test_case_slug.clone(),
                variant: active.variant.clone(),
                harness_slug: active.harness_slug.clone(),
                model_id: active.model_id.clone(),
                outcome: "completed",
                record_id: Some(record.id.clone()),
                message: None,
            },
            RunOutcome::Failed { message } => RunNotification {
                kind: "run-completed",
                job_id: active.run_id.clone(),
                test_case_slug: active.test_case_slug.clone(),
                variant: active.variant.clone(),
                harness_slug: active.harness_slug.clone(),
                model_id: active.model_id.clone(),
                outcome: "failed",
                record_id: None,
                message: Some(message.clone()),
            },
        };

        // The run is no longer in flight; drop it from the registry before
        // announcing, so a reload racing the notification still sees it gone.
        outcome_app.state::<ActiveRuns>().remove(&active.run_id);
        let _ = outcome_app.emit(NOTIFY_CHANNEL, notification);
        let _ = outcome_app.emit(&done, outcome);
    });

    Ok(job_id)
}

// ---------------------------------------------------------------------------
// Reporter: listing finished runs, reading a record, writing a review.
// ---------------------------------------------------------------------------

/// A finished run on disk, as the reporter lists it: its record plus whether a
/// review (`writeup.md`) has been authored beside it yet.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredRun {
    pub id: String,
    pub record: Box<RunRecord>,
    /// The authored review, when one exists beside the record.
    pub review: Option<ReviewDocument>,
}

/// A review as the webview reads/writes it: the per-domain ratings, the prose
/// body, and the reviewer's verdicts on the case's declared checklist items.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewDocument {
    /// The reviewer's rating for each scoring domain. The run's overall rating is
    /// the worst across them.
    #[serde(default)]
    pub ratings: Vec<DomainRating>,
    pub writeup: String,
    /// The reviewer's verdicts on the declared checklist items. Empty for a case
    /// that declares none.
    #[serde(default)]
    pub checklist: Vec<ReviewVerdict>,
}

/// List the finished runs written under the output directory, each with its
/// record and any review authored beside it. Newest first by start time.
#[tauri::command]
#[tracing::instrument]
pub fn list_runs() -> CmdResult<Vec<StoredRun>> {
    let dir = config::output_dir();
    let mut runs = Vec::new();
    let entries = match std::fs::read_dir(&dir) {
        Ok(entries) => entries,
        // No runs directory yet is an empty list, not an error.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(err(&format!("reading runs directory {}", dir.display()), e)),
    };
    for entry in entries {
        let entry = entry.map_err(|e| err("reading a run directory entry", e))?;
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let record_path = entry.path().join("run-record.json");
        if !record_path.is_file() {
            continue;
        }
        let mut record = load_record(&record_path)?;
        attach_playable_build(&mut record, &entry.path());
        let review = read_review_beside(&record_path);
        runs.push(StoredRun {
            id: record.id.clone(),
            record: Box::new(record),
            review,
        });
    }
    // Newest first by start time (RFC 3339 sorts lexically).
    runs.sort_by(|a, b| b.record.started_at.cmp(&a.record.started_at));
    Ok(runs)
}

/// Read one finished run by its id.
#[tauri::command]
#[tracing::instrument(fields(%id))]
pub fn read_run(id: String) -> CmdResult<StoredRun> {
    let run_dir = config::output_dir().join(&id);
    let record_path = run_dir.join("run-record.json");
    let mut record = load_record(&record_path)?;
    attach_playable_build(&mut record, &run_dir);
    let review = read_review_beside(&record_path);
    Ok(StoredRun {
        id: record.id.clone(),
        record: Box::new(record),
        review,
    })
}

/// A finished run's recorded event streams, read from disk for the Events tab:
/// the normalized event stream the live feed renders, and the raw harness output
/// it was mapped from (which the runner hosts expose behind a toggle).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunEventStreams {
    /// The normalized event stream (`events.jsonl`).
    pub events: Vec<HarnessEvent>,
    /// The raw harness output lines (`raw.jsonl`).
    pub raw: Vec<RawOutputLine>,
}

/// Read a finished run's recorded event streams from its output directory: the
/// normalized events (`events.jsonl`) and the raw harness output (`raw.jsonl`).
/// Best-effort per stream — a missing file yields an empty list — so a run that
/// recorded only one (or neither) still resolves rather than erroring.
#[tauri::command]
#[tracing::instrument(fields(%id))]
pub fn read_run_events(id: String) -> CmdResult<RunEventStreams> {
    let run_dir = config::output_dir().join(&id);
    Ok(RunEventStreams {
        events: read_event_log(&run_dir),
        raw: read_raw_output(&run_dir),
    })
}

/// Read a run's raw harness output (`raw.jsonl`), one [`RawOutputLine`] per line.
/// Best-effort: an absent file or an unparsable line yields what did parse.
fn read_raw_output(run_dir: &Path) -> Vec<RawOutputLine> {
    let Ok(text) = std::fs::read_to_string(run_dir.join("raw.jsonl")) else {
        return Vec::new();
    };
    text.lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| serde_json::from_str::<RawOutputLine>(line).ok())
        .collect()
}

/// Point an unpublished run's `playableBuild` link at the desktop's
/// build-serving scheme when its static build is on disk, so a reviewer can play
/// it before publishing. A run that produced no build is left with a null link;
/// one that already carries links (an oddity for a produced run) is untouched.
fn attach_playable_build(record: &mut RunRecord, run_dir: &Path) {
    if record.links.playable_build.is_some() {
        return;
    }
    if find_build_output(&run_dir.join("implementation")).is_some() {
        record.links.playable_build = Some(build_base_url(&record.id));
    }
}

// ---------------------------------------------------------------------------
// Published gallery: reading runs the backend serves (the read side).
// ---------------------------------------------------------------------------

/// One page of published runs from the backend, in the shape the webview's
/// `BackendClient` consumes: the runs newest-first plus the cursor for the next
/// page (`null` when there are no more).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishedRunPage {
    pub runs: Vec<StoredRun>,
    pub next_cursor: Option<String>,
}

/// List published runs from the configured backend (`GET /runs`), newest first.
///
/// This is the desktop's proxy for the backend read side: the local catalog and
/// this app's produced runs are served by the embedded core, but the *published*
/// gallery lives on the backend, so it is fetched over HTTP here. Requires
/// `TCAB_BACKEND_URL`; without it the published gallery is simply empty.
#[tauri::command]
#[tracing::instrument(fields(?before, ?limit))]
pub async fn list_published_runs(
    before: Option<String>,
    limit: Option<usize>,
) -> CmdResult<PublishedRunPage> {
    let url = config::backend_url().ok_or_else(|| {
        "listing published runs needs a backend, but TCAB_BACKEND_URL is not set".to_string()
    })?;
    let page = HttpBackendClient::new(url)
        .list_runs(before.as_deref(), limit)
        .await
        .map_err(|e| err("listing published runs from the backend", e))?;
    Ok(PublishedRunPage {
        runs: page.runs.into_iter().map(published_to_stored).collect(),
        next_cursor: page.next_before,
    })
}

/// Read one published run by id from the configured backend (`GET /runs/{id}`).
#[tauri::command]
#[tracing::instrument(fields(%id))]
pub async fn read_published_run(id: String) -> CmdResult<StoredRun> {
    let url = config::backend_url().ok_or_else(|| {
        "reading a published run needs a backend, but TCAB_BACKEND_URL is not set".to_string()
    })?;
    let run = HttpBackendClient::new(url)
        .read_run(&id)
        .await
        .map_err(|e| err("reading a published run from the backend", e))?;
    Ok(published_to_stored(run))
}

/// Map a backend [`PublishedRun`] into the webview's [`StoredRun`] shape. A
/// published run carries at least one review; the desktop's run list shows the
/// first (the web console shows the full set with the aggregate).
fn published_to_stored(run: PublishedRun) -> StoredRun {
    StoredRun {
        id: run.record.id.clone(),
        record: Box::new(run.record),
        review: run.reviews.into_iter().next().map(|review| ReviewDocument {
            ratings: review.ratings,
            writeup: review.writeup,
            checklist: review.checklist,
        }),
    }
}

/// The reviewer checklist items a run must be judged against, as the webview
/// reads them: a variant's declared items (common + variant-specific). These are
/// definitional catalog data, keyed by the case identity the run record carries —
/// the desktop core serves them through its backend facade, mirroring the HTTP
/// backend's resolved-version endpoint.
#[tauri::command]
#[tracing::instrument(fields(%slug, %version, %variant))]
pub async fn read_review_items(
    slug: String,
    version: String,
    variant: String,
) -> CmdResult<Vec<ReviewItem>> {
    let resolved = resolve_version_inner(&slug, &version).await?;
    let variant_ref = resolved
        .variant(&variant)
        .map_err(|e| err("selecting variant", e))?;
    Ok(resolved.review_items_for(variant_ref))
}

/// Write (or overwrite) the review for a finished run: validate the rating, gate
/// on a complete checklist, then write the canonical `writeup.md` beside the
/// record. Required before the run can be published.
///
/// The checklist gate enforces the case's contract: every reviewer checklist item
/// the run's variant declares must carry a verdict, so a reviewer cannot skip a
/// requirement the case author marked as something to check. The rating itself
/// stays entirely the reviewer's call.
#[tauri::command]
#[tracing::instrument(skip_all, fields(%id))]
pub async fn save_review(
    id: String,
    ratings: Vec<DomainRating>,
    writeup: String,
    checklist: Vec<ReviewVerdict>,
) -> CmdResult<()> {
    let body = writeup.trim();
    if body.is_empty() {
        return Err("the writeup body must not be empty".to_string());
    }
    let review = Writeup {
        ratings,
        body: body.to_string(),
        checklist,
    };
    let run_dir = config::output_dir().join(&id);
    let record_path = run_dir.join("run-record.json");
    if !record_path.is_file() {
        return Err(format!("no run `{id}` found to review"));
    }

    // Gate: every declared checklist item must have a verdict, and every scoring
    // domain must be rated, before the review is saved. This guarantees a reviewer
    // addresses each major item the case author called out and scores every mode.
    let record = load_record(&record_path)?;
    let (items, domains) = review_model_for_record(&record).await?;
    let missing = missing_verdicts(&items, &review);
    if !missing.is_empty() {
        return Err(format!(
            "the review is missing a verdict for {} checklist item(s): {}",
            missing.len(),
            missing.join(", ")
        ));
    }
    let unrated = missing_ratings(&domains, &review);
    if !unrated.is_empty() {
        return Err(format!(
            "the review is missing a rating for {} domain(s): {}",
            unrated.len(),
            unrated.join(", ")
        ));
    }

    std::fs::write(run_dir.join("writeup.md"), review.to_file_string())
        .map_err(|e| err("writing the review", e))
}

// ---------------------------------------------------------------------------
// Pushing a run (the release step, no review).
// ---------------------------------------------------------------------------

/// The result of pushing, surfaced to the UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushResult {
    pub source_repo: String,
    pub playable_build: Option<String>,
    pub newly_pushed: bool,
}

/// Push a finished run **without** a review (the release step): release its
/// source to a public GitHub repo and deploy its build to Cloudflare Pages, then
/// store the record on the backend privately so the build can be reviewed. The
/// run stays private until it is published. Pushing requires **no** review — it
/// is what makes a run reviewable — and is idempotent on the record id.
///
/// This is the desktop equivalent of `tcab push`: the same machine can push a run
/// and only later (or never) review and publish it. The solo [`publish_run`] path
/// remains available for when one person does all three at once.
///
/// Requires `TCAB_BACKEND_URL` and a bearer `token` (from [`login`]/[`register`]).
#[tauri::command]
#[tracing::instrument(skip(token), fields(%id))]
pub async fn push_run(id: String, token: String) -> CmdResult<PushResult> {
    let backend = config::backend_url().ok_or_else(|| {
        "pushing submits the run to the backend, but TCAB_BACKEND_URL is not set".to_string()
    })?;
    if token.trim().is_empty() {
        return Err("you must be logged in to push (no bearer token)".to_string());
    }

    let run_dir = config::output_dir().join(&id);
    let record_path = run_dir.join("run-record.json");
    let record = load_record(&record_path)?;

    let impl_dir = implementation_dir(&record_path);
    let build_dir = find_build_output(&impl_dir);
    let artifacts = ArtifactCollection {
        repo_path: impl_dir,
    };

    let publisher = BackendPublisher::new(
        PublishConfig::from_env(),
        SystemCommandRunner,
        HttpBackendClient::new(backend).with_token(Some(token)),
    );
    let events = read_event_log(&run_dir);
    let request = PushRequest {
        record: &record,
        artifacts: &artifacts,
        build_dir: build_dir.as_deref(),
        events: &events,
    };
    let outcome = publisher
        .push(&request)
        .await
        .map_err(|e| err("pushing the run", e))?;

    Ok(PushResult {
        source_repo: outcome.source_repo,
        playable_build: outcome.playable_build,
        newly_pushed: outcome.newly_pushed,
    })
}

// ---------------------------------------------------------------------------
// Publishing a reviewed run.
// ---------------------------------------------------------------------------

/// The result of publishing, surfaced to the UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishResult {
    pub source_repo: String,
    pub playable_build: Option<String>,
    pub newly_published: bool,
}

/// Publish a reviewed run end to end (the solo path): release its source to a
/// public GitHub repo and deploy its build to Cloudflare Pages, store the record
/// on the backend, submit the locally-authored review (attributed to the
/// logged-in account behind `token`), and publish it.
///
/// Requires `TCAB_BACKEND_URL`, a bearer `token` (from [`login`]/[`register`]),
/// and a `writeup.md` beside the record (authored via [`save_review`]).
#[tauri::command]
#[tracing::instrument(skip(token), fields(%id))]
pub async fn publish_run(id: String, token: String) -> CmdResult<PublishResult> {
    let backend = config::backend_url().ok_or_else(|| {
        "publishing submits the run to the backend, but TCAB_BACKEND_URL is not set".to_string()
    })?;
    if token.trim().is_empty() {
        return Err("you must be logged in to publish (no bearer token)".to_string());
    }

    let run_dir = config::output_dir().join(&id);
    let record_path = run_dir.join("run-record.json");
    let record = load_record(&record_path)?;

    let stored = read_review_beside(&record_path)
        .ok_or_else(|| format!("run `{id}` has no review; write one before publishing"))?;
    let writeup = Writeup {
        ratings: stored.ratings,
        body: stored.writeup,
        checklist: stored.checklist,
    };

    // Re-gate at publish: the checklist must be complete and every domain rated
    // even if the stored `writeup.md` was hand-edited after the in-app save gate.
    // A run is not releasable until every declared item has a verdict.
    let (items, domains) = review_model_for_record(&record).await?;
    let missing = missing_verdicts(&items, &writeup);
    if !missing.is_empty() {
        return Err(format!(
            "run `{id}` cannot be published: its review is missing a verdict for {} checklist \
             item(s): {}",
            missing.len(),
            missing.join(", ")
        ));
    }
    let unrated = missing_ratings(&domains, &writeup);
    if !unrated.is_empty() {
        return Err(format!(
            "run `{id}` cannot be published: its review is missing a rating for {} domain(s): {}",
            unrated.len(),
            unrated.join(", ")
        ));
    }

    let impl_dir = implementation_dir(&record_path);
    let build_dir = find_build_output(&impl_dir);
    let artifacts = ArtifactCollection {
        repo_path: impl_dir,
    };

    let publisher = BackendPublisher::new(
        PublishConfig::from_env(),
        SystemCommandRunner,
        HttpBackendClient::new(backend).with_token(Some(token)),
    );
    let events = read_event_log(&run_dir);
    // push (release + store, no review), then submit the review (attributed to
    // the account), then publish (the gate refuses a run with no reviews).
    let request = PushRequest {
        record: &record,
        artifacts: &artifacts,
        build_dir: build_dir.as_deref(),
        events: &events,
    };
    let outcome = publisher
        .push(&request)
        .await
        .map_err(|e| err("pushing the run", e))?;
    publisher
        .backend()
        .submit_review(&record.id, &writeup)
        .await
        .map_err(|e| err("submitting the review", e))?;
    let ack = publisher
        .backend()
        .publish_run(&record.id)
        .await
        .map_err(|e| err("publishing the run", e))?;

    Ok(PublishResult {
        source_repo: outcome.source_repo,
        playable_build: outcome.playable_build,
        newly_published: ack.newly_published,
    })
}

/// Register a new account on the auth service and return the minted token + the
/// account. The webview stores the token and passes it to [`publish_run`].
#[tauri::command]
#[tracing::instrument(skip(password), fields(%username))]
pub async fn register(
    username: String,
    password: String,
    display_name: String,
) -> CmdResult<AuthnResponse> {
    AccountsClient::new(config::auth_url())
        .register(&RegisterRequest {
            username,
            password,
            display_name,
        })
        .await
        .map_err(|e| err("registering an account", e))
}

/// Log in to an existing account and return the minted token + the account.
#[tauri::command]
#[tracing::instrument(skip(password), fields(%username))]
pub async fn login(username: String, password: String) -> CmdResult<AuthnResponse> {
    AccountsClient::new(config::auth_url())
        .login(&LoginRequest { username, password })
        .await
        .map_err(|e| err("logging in", e))
}

// ---------------------------------------------------------------------------
// Shared helpers.
// ---------------------------------------------------------------------------

fn load_record(path: &Path) -> CmdResult<RunRecord> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| err(&format!("reading run record {}", path.display()), e))?;
    serde_json::from_str(&text)
        .map_err(|e| err(&format!("parsing run record {}", path.display()), e))
}

/// Read and parse the `writeup.md` beside a run record, if present and valid.
/// A missing or malformed review yields `None` (the reporter shows it as
/// unreviewed), so listing never fails on one bad file.
fn read_review_beside(record_path: &Path) -> Option<ReviewDocument> {
    let path = record_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("writeup.md");
    let text = std::fs::read_to_string(&path).ok()?;
    let parsed = parse_writeup(&text).ok()?;
    Some(ReviewDocument {
        ratings: parsed.ratings,
        writeup: parsed.body,
        checklist: parsed.checklist,
    })
}

/// Resolve the review model a run must be judged against: the reviewer checklist
/// items the run's selected variant declares (common + variant-specific) and the
/// case's scoring domains. Resolves the run's exact version (from the backend when
/// configured, else the local checkout) so the reporter shows the same items and
/// domains the case authored.
async fn review_model_for_record(record: &RunRecord) -> CmdResult<(Vec<ReviewItem>, Vec<Domain>)> {
    let resolved = resolve_version_inner(
        &record.subject.test_case_slug,
        &record.subject.test_case_version,
    )
    .await?;
    let variant = resolved
        .variant(&record.subject.variant)
        .map_err(|e| err("selecting variant", e))?;
    Ok((resolved.review_items_for(variant), resolved.domains.clone()))
}
