//! The Tauri commands the webview drives the core through.
//!
//! Each command is a thin adapter: it resolves host configuration from the
//! environment (see [`crate::config`]), calls into [`test_cabinet_core`], and
//! maps the result to a serializable DTO. Errors surface to the frontend as
//! strings so the UI can show them verbatim. The orchestration itself lives in
//! the core; the shell owns no run logic of its own.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use test_cabinet_core::{
    ArtifactCollection, BackendClient, BackendPublisher, BrowserRenderer, BuildValidator,
    CliArtifactCollector, CliContainerRuntime, DefaultHarnessRegistry, FsRepoSeeder, HarnessSlug,
    HttpBackendClient, Model, ModelCatalog, NoopPublisher, OpenRouterPrices, Orchestrator,
    PrerenderedReferenceRenderer, PublishConfig, PublishRequest, Publisher, Rating,
    ReferenceRenderer, RunRecord, RunRequest, SystemCommandRunner, TestCase, TestCaseCatalog,
    TestCaseVersion, Writeup, implementation_dir, materialize_version, parse_writeup,
};

use crate::config;
use crate::events::{WebviewEventSink, done_channel};

/// A command result whose error is a plain string the webview can render.
type CmdResult<T> = Result<T, String>;

/// Map any error into the string form the frontend shows.
fn err<E: std::fmt::Display>(context: &str, e: E) -> String {
    format!("{context}: {e}")
}

// ---------------------------------------------------------------------------
// Catalogs: harnesses, models, test cases.
// ---------------------------------------------------------------------------

/// A supported agent harness, as surfaced to the UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessInfo {
    pub slug: String,
    pub display_name: String,
}

fn display_name_for(slug: HarnessSlug) -> &'static str {
    match slug {
        HarnessSlug::Claude => "Anthropic Claude Code",
        HarnessSlug::Codex => "OpenAI Codex",
        HarnessSlug::Cline => "Cline",
        HarnessSlug::Antigravity => "Google Antigravity",
        HarnessSlug::Goose => "Goose",
        HarnessSlug::Kilo => "Kilo Code",
        HarnessSlug::Opencode => "OpenCode",
        HarnessSlug::Pi => "Pi",
    }
}

/// The catalog of agent harnesses the application can drive, sourced from the
/// core's canonical [`HarnessSlug::ALL`] so the shell never drifts from it.
#[tauri::command]
pub fn list_harnesses() -> Vec<HarnessInfo> {
    HarnessSlug::ALL
        .into_iter()
        .map(|slug| HarnessInfo {
            slug: slug.as_str().to_string(),
            display_name: display_name_for(slug).to_string(),
        })
        .collect()
}

/// The curated model catalog: each model the benchmark evaluates against, read
/// from `models/<slug>.toml`. Used to populate the run-configuration model
/// picker (with the model ids that identify each in run records).
#[tauri::command]
pub fn list_models() -> CmdResult<Vec<Model>> {
    ModelCatalog::new(config::models_root())
        .list()
        .map_err(|e| err("listing models", e))
}

/// The test-case catalog: every case and its available versions. Resolved from
/// the backend when one is configured (`TCAB_BACKEND_URL`), otherwise from the
/// local `test-cases/` checkout for offline development.
#[tauri::command]
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

/// A variant of a resolved version, flattened for the configuration picker.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VariantInfo {
    pub slug: String,
    pub name: String,
    pub description: Option<String>,
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
    pub variants: Vec<VariantInfo>,
    pub max_runtime_seconds: u64,
}

impl VersionInfo {
    fn from_version(v: &TestCaseVersion) -> Self {
        Self {
            slug: v.slug.clone(),
            version: v.version.clone(),
            name: v.name.clone(),
            difficulty: v.difficulty.clone(),
            tags: v.tags.clone(),
            summary: v.summary.clone(),
            variants: v
                .variants
                .iter()
                .map(|variant| VariantInfo {
                    slug: variant.slug.clone(),
                    name: variant.name.clone(),
                    description: variant.description.clone(),
                })
                .collect(),
            max_runtime_seconds: v.max_runtime_seconds,
        }
    }
}

/// Resolve an exact test-case version to its configuration framing (its name,
/// difficulty, tags, and its variants for the variant picker).
#[tauri::command]
pub async fn resolve_version(slug: String, version: String) -> CmdResult<VersionInfo> {
    let resolved = resolve_version_inner(&slug, &version).await?;
    Ok(VersionInfo::from_version(&resolved))
}

/// Resolve a version from the backend (materializing its served definition to
/// disk so spec bodies are readable) or the local checkout. The local checkout
/// already holds the spec files on disk; the backend path writes them under the
/// per-run staging store.
async fn resolve_version_inner(slug: &str, version: &str) -> CmdResult<TestCaseVersion> {
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
    /// Optional override for the run's maximum runtime, in seconds.
    pub max_runtime_override: Option<u64>,
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
        max_runtime_override: config.max_runtime_override,
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

    let orchestrator = Orchestrator {
        catalog: TestCaseCatalog::new(config::catalog_root()),
        seeder: FsRepoSeeder::new(seed_dir),
        collector: CliArtifactCollector::new(runtime.clone(), artifact_dir),
        runtime,
        harnesses: Box::new(DefaultHarnessRegistry::new()),
        renderer,
        validator: BuildValidator::new(screenshot_dir),
        publisher: NoopPublisher,
        prices: OpenRouterPrices::new(),
        output_dir,
    };

    let done = done_channel(&job_id);
    let mut sink = WebviewEventSink::new(app.clone(), job_id.clone());
    let outcome_app = app.clone();
    // Drive the run on a background task so the command returns the job id at once
    // and the UI streams events live rather than waiting out the whole run.
    tokio::spawn(async move {
        use tauri::Emitter;
        let outcome = match orchestrator
            .run_resolved(&request, &test_case, &mut sink)
            .await
        {
            Ok(record) => RunOutcome::Completed {
                record: Box::new(record),
            },
            Err(e) => RunOutcome::Failed {
                message: e.to_string(),
            },
        };
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

/// A review as the webview reads/writes it: the rating token and the prose body.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewDocument {
    /// One of `flawless | great | scuffed | broken`.
    pub rating: String,
    pub writeup: String,
}

/// List the finished runs written under the output directory, each with its
/// record and any review authored beside it. Newest first by start time.
#[tauri::command]
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
        let record = load_record(&record_path)?;
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
pub fn read_run(id: String) -> CmdResult<StoredRun> {
    let record_path = config::output_dir().join(&id).join("run-record.json");
    let record = load_record(&record_path)?;
    let review = read_review_beside(&record_path);
    Ok(StoredRun {
        id: record.id.clone(),
        record: Box::new(record),
        review,
    })
}

/// Write (or overwrite) the review for a finished run: validate the rating, then
/// write the canonical `writeup.md` beside the record. Required before the run
/// can be published.
#[tauri::command]
pub fn save_review(id: String, rating: String, writeup: String) -> CmdResult<()> {
    let rating = Rating::parse(&rating).ok_or_else(|| {
        format!("rating must be one of flawless, great, scuffed, broken (got `{rating}`)")
    })?;
    let body = writeup.trim();
    if body.is_empty() {
        return Err("the writeup body must not be empty".to_string());
    }
    let review = Writeup {
        rating,
        body: body.to_string(),
    };
    let run_dir = config::output_dir().join(&id);
    if !run_dir.join("run-record.json").is_file() {
        return Err(format!("no run `{id}` found to review"));
    }
    std::fs::write(run_dir.join("writeup.md"), review.to_file_string())
        .map_err(|e| err("writing the review", e))
}

// ---------------------------------------------------------------------------
// Publishing a reviewed run.
// ---------------------------------------------------------------------------

/// Candidate static build output directories a run's implementation may produce.
const BUILD_OUTPUTS: [&str; 3] = ["dist", "build", "out"];

/// The result of publishing, surfaced to the UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishResult {
    pub source_repo: String,
    pub playable_build: Option<String>,
    pub newly_published: bool,
}

/// Publish a reviewed run: release its source to a public GitHub repo, deploy its
/// build to Cloudflare Pages, and submit the record + review + links to the
/// backend (the system of record).
///
/// Requires `TCAB_BACKEND_URL` and a `writeup.md` beside the record (authored via
/// [`save_review`]); both are checked before anything is released.
#[tauri::command]
pub async fn publish_run(id: String) -> CmdResult<PublishResult> {
    let backend = config::backend_url().ok_or_else(|| {
        "publishing submits the run to the backend, but TCAB_BACKEND_URL is not set".to_string()
    })?;

    let run_dir = config::output_dir().join(&id);
    let record_path = run_dir.join("run-record.json");
    let record = load_record(&record_path)?;

    let writeup = read_review_beside(&record_path)
        .ok_or_else(|| format!("run `{id}` has no review; write one before publishing"))?;
    let writeup = Writeup {
        rating: Rating::parse(&writeup.rating)
            .ok_or_else(|| format!("stored review has an invalid rating `{}`", writeup.rating))?,
        body: writeup.writeup,
    };

    let impl_dir = implementation_dir(&record_path);
    let build_dir = find_build_output(&impl_dir);
    let artifacts = ArtifactCollection {
        repo_path: impl_dir,
    };

    let publisher = BackendPublisher::new(
        PublishConfig::default(),
        SystemCommandRunner,
        HttpBackendClient::new(backend),
    );
    let request = PublishRequest {
        record: &record,
        artifacts: &artifacts,
        build_dir: build_dir.as_deref(),
        writeup: &writeup,
    };
    let outcome = publisher
        .publish(&request)
        .await
        .map_err(|e| err("publishing the run", e))?;

    Ok(PublishResult {
        source_repo: outcome.source_repo,
        playable_build: outcome.playable_build,
        newly_published: outcome.newly_published,
    })
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
        rating: parsed.rating.as_str().to_string(),
        writeup: parsed.body,
    })
}

/// Find a deployable static build output beside a run's implementation, if one
/// was produced. Returns the first of `dist`/`build`/`out` that exists.
fn find_build_output(impl_dir: &Path) -> Option<PathBuf> {
    BUILD_OUTPUTS
        .iter()
        .map(|name| impl_dir.join(name))
        .find(|candidate| candidate.is_dir())
}
