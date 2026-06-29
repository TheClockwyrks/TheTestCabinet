//! Backend client: resolve test-case versions and container definitions from the
//! v0.2.0 backend, and publish finished runs to it.
//!
//! See `design/v0.2.0-contracts.md` §4. Runners (CLI, worker, Tauri) resolve
//! definitions through this trait instead of assuming a local `test-cases/`
//! checkout. The existing [`crate::TestCaseCatalog`] (filesystem) stays for local
//! dev; this trait is the remote source of record.
//!
//! The backend renders each case's reference mockups to screenshots at ingest, so
//! runners receive **rendered screenshots** (`references`) rather than mockup
//! HTML. Spec/asset bodies are fetched per-file (`artifact`), and the prompt
//! template is served inline by [`BackendClient::resolve_version`]. A resolved
//! [`TestCaseVersion`] therefore carries store-relative keys in its path fields
//! (it has no host checkout); see [`materialize_version`] for turning a remote
//! resolution into the on-disk inputs the seeder, prompt renderer, and validator
//! consume unchanged.

use std::path::{Path, PathBuf};

use serde::Deserialize;
use tracing::instrument;

use crate::error::{Error, Result};
use crate::event::HarnessEvent;
use crate::job_api::{ActiveJobOut, JobStatusOut, LaunchAck, LaunchBody, Notification};
use crate::match_play::{ARENA_OPPONENT_IDS, ControllerRef, TournamentRecord};
use crate::preview::AssetPreview;
use crate::publish_job_api::{PublishProgress, PublishResult};
use crate::reference::RenderedReference;
use crate::review::Writeup;
use crate::run_record::{RunLinks, RunRecord};
use crate::test_case::{
    AssetKind, BuildCommands, CanvasSpec, Check, CheckAction, ContractSpec, Domain, MatchSpec,
    MediaKind, OutputSpec, PerformanceCase, ProofFile, ReferenceKind, ReferenceView, ReplaySpec,
    ReviewItem, SandboxSpec, SheetSpec, SimulationSpec, SpecFile, TestCase, TestCaseVersion,
    TestType, ToolSpec, Variant, WorkspaceFile,
};

/// A reference view resolved to its backend-served media bytes. The runner seeds
/// these as visual targets and (for image references) uses them as validation
/// baselines; it never receives a rendered reference's mockup HTML (rendering
/// happens on backend ingest). A static reference's bytes are the image/video
/// served as-is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedReference {
    /// The view slug this media corresponds to.
    pub view: String,
    /// Whether the media is an image or a video.
    pub kind: MediaKind,
    /// The file extension the media is served under (for example `png` or `mp4`).
    pub extension: String,
    /// The raw media bytes (a rendered screenshot, or a static reference as-is).
    pub bytes: Vec<u8>,
}

/// One seeded artifact (a spec source or an asset file) fetched by key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedArtifact {
    /// The store-relative `source` key (matches `SpecFile.source` / asset entry).
    pub source: PathBuf,
    /// The raw file bytes.
    pub bytes: Vec<u8>,
}

/// The backend's acknowledgement of *enqueuing* a publish for a run.
///
/// Publishing is asynchronous: `POST /runs/{id}/publish` no longer flips the run
/// public synchronously — it gates the run, enqueues a per-publish job, and returns
/// this ack. The gh/wrangler release runs in a `tcab-publisher` Job and is observed
/// over the live stream at [`live_url`](Self::live_url) (subscribe with
/// [`BackendClient::watch_publish_job`]), which ends with a terminal
/// [`PublishResult`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublishAck {
    /// The enqueued publish job's id — the handle [`BackendClient::watch_publish_job`]
    /// takes to observe the release.
    pub publish_job_id: String,
    /// The relative URL of the live NDJSON stream to observe the publish on
    /// (`/publish-jobs/{id}/live`), as the backend reported it.
    pub live_url: String,
}

/// A run on the backend's read side, as served by `GET /runs` and
/// `GET /runs/{id}`: the full record (with its links resolved), its reviews, and
/// the resolved links. This is what a reporter or gallery consumes.
#[derive(Debug, Clone)]
pub struct PublishedRun {
    /// The full run record. Its [`RunLinks`] are the resolved links the backend
    /// holds (the separate [`links`](Self::links) field, merged onto the blob).
    pub record: RunRecord,
    /// The run's reviews, oldest first. Empty while the run is pending review.
    /// The run's overall rating is the worst across them and its score the
    /// average.
    pub reviews: Vec<PublishedReview>,
    /// Whether the run is published (in the public snapshot).
    pub published: bool,
    /// The resolved source-repo and playable-build links the backend recorded.
    pub links: RunLinks,
}

/// A review as the backend serves it on the read side: the reviewing account's
/// public identity, the per-domain ratings, the prose body, and the reviewer's
/// verdicts on the case's checklist items.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublishedReview {
    /// The reviewing account's id.
    pub reviewer_id: String,
    /// The reviewing account's display name.
    pub reviewer: String,
    /// The reviewing account's login handle.
    pub username: String,
    /// The reviewer's rating for each of the case's scoring domains. This
    /// review's overall rating is the worst across them.
    pub ratings: Vec<crate::review::DomainRating>,
    /// The review prose.
    pub writeup: String,
    /// The reviewer's verdicts on the case's declared checklist items.
    pub checklist: Vec<crate::review::ReviewVerdict>,
    /// RFC 3339 of when the review was submitted.
    pub reviewed_at: String,
}

/// One page of published runs from `GET /runs`, newest first.
#[derive(Debug, Clone)]
pub struct RunPage {
    /// The runs on this page, newest first.
    pub runs: Vec<PublishedRun>,
    /// The `before` cursor to pass for the following page, or `None` when this is
    /// the last page.
    pub next_before: Option<String>,
}

/// One item from a job's live stream (`GET /jobs/{id}/live`, NDJSON): a
/// normalized harness event, or a live asset-generation preview frame. The
/// backend tags a preview line `type: "asset_preview"` so the two are told apart
/// (a [`HarnessEvent`]'s `type` is always one of the closed set of event kinds).
#[derive(Debug, Clone, PartialEq)]
pub enum LiveItem {
    /// A normalized harness event.
    Event(HarnessEvent),
    /// A live asset-generation preview frame (never persisted).
    Preview(AssetPreview),
}

/// One item from a publish job's live stream (`GET /publish-jobs/{id}/live`,
/// NDJSON): a non-terminal progress line, or the terminal release outcome. The
/// backend tags each line with a `type` discriminator (`progress` or `result`) so
/// the two are told apart; the stream closes after the [`Result`](Self::Result).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PublishLiveItem {
    /// A human-readable progress line streamed while the release runs.
    Progress(PublishProgress),
    /// The terminal release outcome (links on success, reason on failure); the
    /// stream ends with this.
    Result(PublishResult),
}

/// What runners use to resolve definitions from, and publish runs to, the
/// backend.
#[async_trait::async_trait]
pub trait BackendClient: Send + Sync {
    /// The full catalog: cases and their versions. (`GET /test-cases`)
    async fn catalog(&self) -> Result<Vec<TestCase>>;

    /// Versions available for one case. (`GET /test-cases/{slug}/versions`)
    async fn versions(&self, slug: &str) -> Result<Vec<String>>;

    /// Resolve an exact, immutable test-case version manifest.
    /// (`GET /test-cases/{slug}/versions/{version}`)
    ///
    /// Returns a [`TestCaseVersion`] whose path fields are store-relative keys
    /// (not host paths). Fetch spec/asset bytes via [`Self::artifact`] and
    /// reference screenshots via [`Self::references`]; or use
    /// [`materialize_version`] to write all of them to disk and obtain a
    /// host-path [`TestCaseVersion`] the seeder and validator consume unchanged.
    async fn resolve_version(&self, slug: &str, version: &str) -> Result<TestCaseVersion>;

    /// Fetch one seeded artifact (spec source or asset) by its `source` key.
    /// (`GET …/artifacts/{path}`)
    async fn artifact(&self, slug: &str, version: &str, source: &Path) -> Result<ResolvedArtifact>;

    /// Fetch the backend-rendered reference screenshots for a variant: the common
    /// references plus that variant's own.
    /// (`GET …/references/{scope}/{view}.png`)
    async fn references(
        &self,
        slug: &str,
        version: &str,
        variant: &str,
    ) -> Result<Vec<ResolvedReference>>;

    /// The prompt template source for a version (also returned inline by
    /// [`Self::resolve_version`]; this is the explicit fetch).
    async fn prompt_template(&self, slug: &str, version: &str) -> Result<String>;

    /// Submit a review for a pushed run. (`POST /runs/{id}/reviews`) The review is
    /// attributed to the account behind the client's bearer token; a run may carry
    /// many reviews, one per account, and re-submitting from the same account
    /// updates it. Requires a bearer token.
    async fn submit_review(&self, run_id: &str, review: &Writeup) -> Result<()>;

    /// Enqueue a publish for a run. (`POST /runs/{id}/publish`) Publishing is
    /// asynchronous: the backend gates the run (refused unless it has at least one
    /// review and is not an infrastructure failure), enqueues a per-publish job, and
    /// returns the [`PublishAck`] carrying the publish-job id and the live URL. The
    /// gh/wrangler release runs in a `tcab-publisher` Job; observe it (and learn its
    /// terminal outcome) by subscribing with [`Self::watch_publish_job`]. Requires a
    /// bearer token.
    async fn publish_run(&self, run_id: &str) -> Result<PublishAck>;

    /// Watch a publish job's live progress. (`GET /publish-jobs/{id}/live`, NDJSON)
    /// Each line is one [`PublishLiveItem`] — a progress line or the terminal result
    /// — passed to `on_item` as it arrives. Returns once the stream closes, which the
    /// backend does after delivering the terminal [`PublishLiveItem::Result`]; a
    /// connection to an already-finished publish returns after the replayed backlog
    /// (which ends in that result). The terminal outcome (links on success, reason on
    /// failure) is the last item delivered.
    ///
    /// `on_item` is a `&mut dyn FnMut` (not an `impl Stream`) so the trait stays
    /// object-safe — it is consumed through `dyn BackendClient`, mirroring
    /// [`Self::watch_job`]. A malformed line is surfaced as a failure
    /// [`PublishResult`] rather than tearing down the watch.
    ///
    /// Defaults to an error so a backend without publish support (or a test stub) is
    /// explicit about not streaming; the HTTP client overrides it.
    async fn watch_publish_job(
        &self,
        publish_job_id: &str,
        _on_item: &mut (dyn FnMut(PublishLiveItem) + Send),
    ) -> Result<()> {
        Err(Error::Publish(format!(
            "this backend client cannot stream the live progress of publish job \
             `{publish_job_id}`"
        )))
    }

    /// Upload one proof-of-implementation media file for a published run, served
    /// back as the reviewer's submitted-evidence pane. `file` is `<proof-id>.<ext>`.
    /// (`POST /runs/{id}/proof/{file}`) Idempotent: identical bytes overwrite.
    ///
    /// Defaults to a no-op so a backend without proof support (or a test stub)
    /// stays valid; the HTTP client overrides it.
    async fn publish_run_proof(&self, _run_id: &str, _file: &str, _bytes: Vec<u8>) -> Result<()> {
        Ok(())
    }

    /// Upload one asset-generation media file for a published run, served back to
    /// the gallery's result view. `file` is `regenerated.png`, `preview.png`,
    /// `target.png`, or `actions.json`. (`POST /runs/{id}/asset/{file}`)
    /// Idempotent: identical bytes overwrite.
    ///
    /// Defaults to a no-op so a backend without asset support (or a test stub)
    /// stays valid; the HTTP client overrides it.
    async fn publish_run_asset(&self, _run_id: &str, _file: &str, _bytes: Vec<u8>) -> Result<()> {
        Ok(())
    }

    /// Upload an adversarial run's controller wasm module for a pushed run, served
    /// back so the arena can resolve and pit a pushed implementation from any host.
    /// (`POST /runs/{id}/controller.wasm`) Idempotent: identical bytes overwrite.
    ///
    /// Defaults to a no-op so a backend without controller support (or a test stub)
    /// stays valid; the HTTP client overrides it.
    async fn publish_run_controller(&self, _run_id: &str, _bytes: Vec<u8>) -> Result<()> {
        Ok(())
    }

    /// Fetch a pushed adversarial run's controller wasm module.
    /// (`GET /runs/{id}/controller.wasm`) Used by the arena to resolve a
    /// [`ControllerKind::PushedRun`](crate::match_play::ControllerKind::PushedRun).
    ///
    /// Defaults to an error so a backend without controller support (or a test
    /// stub) is explicit about not serving one; the HTTP client overrides it.
    async fn controller_artifact(&self, run_id: &str) -> Result<Vec<u8>> {
        Err(Error::Publish(format!(
            "this backend client cannot serve the controller for run `{run_id}`"
        )))
    }

    /// List the pushed adversarial controllers for a case: every stored run that
    /// produced an adversarial result and uploaded a controller, as a
    /// [`ControllerKind::PushedRun`](crate::match_play::ControllerKind::PushedRun)
    /// ref. (`GET /adversarial/controllers?testCase=<slug>`) The arena merges these
    /// with the host's local runs so a pushed implementation is always selectable.
    ///
    /// Defaults to an empty list so a backend without arena support (or a test
    /// stub) stays valid; the HTTP client overrides it.
    async fn list_adversarial_controllers(&self, _slug: &str) -> Result<Vec<ControllerRef>> {
        Ok(Vec::new())
    }

    /// Publish an adversarial tournament's record (standings + per-match
    /// summaries). (`POST /tournaments`) Idempotent on `record.id`. The per-match
    /// replays are uploaded separately via [`Self::publish_tournament_match`].
    ///
    /// Defaults to a no-op so a backend without tournament support (or a test stub)
    /// stays valid; the HTTP client overrides it.
    async fn publish_tournament(&self, _record: &TournamentRecord) -> Result<()> {
        Ok(())
    }

    /// Upload one tournament match's replay JSON, served back for browser playback.
    /// (`POST /tournaments/{id}/matches/{matchId}/replay.json`) Idempotent:
    /// identical bytes overwrite.
    ///
    /// Defaults to a no-op so a backend without tournament support (or a test stub)
    /// stays valid; the HTTP client overrides it.
    async fn publish_tournament_match(
        &self,
        _tournament_id: &str,
        _match_id: &str,
        _bytes: Vec<u8>,
    ) -> Result<()> {
        Ok(())
    }

    /// List published runs, newest first, paginated. (`GET /runs?before=&limit=`)
    ///
    /// `before` is the cursor from a previous page's
    /// [`RunPage::next_before`] (`None` for the first page); `limit` caps the page
    /// size (the backend clamps it to its own bounds). This is the read side a
    /// reporter or gallery consumes.
    async fn list_runs(&self, before: Option<&str>, limit: Option<usize>) -> Result<RunPage>;

    /// Read one published run by id. (`GET /runs/{id}`)
    async fn read_run(&self, id: &str) -> Result<PublishedRun>;

    /// Enqueue a run on the backend's job queue. (`POST /jobs`, bearer auth)
    ///
    /// `body` is the canonical [`LaunchBody`] (serialized camelCase to match the
    /// backend); `token` is the launching account's bearer token, which the
    /// backend gates the enqueue on (a missing/invalid token is rejected `401`).
    /// Returns the enqueued job's id — the handle the watch/status methods take.
    ///
    /// Defaults to an error so a backend without queue support (or a test stub) is
    /// explicit about not enqueuing; the HTTP client overrides it.
    async fn launch_run(&self, _body: &LaunchBody, _token: &str) -> Result<String> {
        Err(Error::Publish(
            "this backend client cannot enqueue runs".to_string(),
        ))
    }

    /// One job's current status. (`GET /jobs/{id}`) Carries the lifecycle state
    /// and, once it succeeded, the produced run record's id (read the record back
    /// via [`Self::read_run`]); else the terminal failure reason.
    ///
    /// Defaults to an error so a backend without queue support (or a test stub) is
    /// explicit about not serving job status; the HTTP client overrides it.
    async fn job_status(&self, job_id: &str) -> Result<JobStatusOut> {
        Err(Error::Publish(format!(
            "this backend client cannot report the status of job `{job_id}`"
        )))
    }

    /// The runs still in flight (queued, dispatched, or running), each described
    /// by the identity captured at enqueue. (`GET /jobs/active`)
    ///
    /// Defaults to an empty list so a backend without queue support (or a test
    /// stub) stays valid; the HTTP client overrides it.
    async fn list_active_jobs(&self) -> Result<Vec<ActiveJobOut>> {
        Ok(Vec::new())
    }

    /// Watch a job's live progress. (`GET /jobs/{id}/live`, NDJSON) Each line is
    /// one [`LiveItem`] — a harness event or an asset-preview frame — passed to
    /// `on_item` as it arrives. Returns once the stream closes, which the backend
    /// does when the run reaches a terminal state; read the terminal outcome (and
    /// on success the produced record's id) back via [`Self::job_status`]. A
    /// connection to an already-finished job returns after the replayed backlog.
    ///
    /// `on_item` is a `&mut dyn FnMut` (not an `impl Stream`) so the trait stays
    /// object-safe — it is consumed through `dyn BackendClient`. The CLI prints
    /// each item; a malformed line is surfaced as an `unknown` event rather than
    /// tearing down the watch (mirroring the web console's transport).
    ///
    /// Defaults to an error so a backend without queue support (or a test stub) is
    /// explicit about not streaming; the HTTP client overrides it.
    async fn watch_job(
        &self,
        job_id: &str,
        _on_item: &mut (dyn FnMut(LiveItem) + Send),
    ) -> Result<()> {
        Err(Error::Publish(format!(
            "this backend client cannot stream the live progress of job `{job_id}`"
        )))
    }

    /// Subscribe to the worker-wide run-completion feed. (`GET /notifications`,
    /// SSE) Each event's `data:` payload is one [`Notification`], passed to
    /// `on_notification` as it arrives. Live-only (no backlog); returns when the
    /// connection ends. A malformed payload is dropped rather than ending the
    /// subscription (mirroring the web console's transport).
    ///
    /// `on_notification` is a `&mut dyn FnMut` so the trait stays object-safe.
    ///
    /// Defaults to an error so a backend without queue support (or a test stub) is
    /// explicit about not serving notifications; the HTTP client overrides it.
    async fn subscribe_notifications(
        &self,
        _on_notification: &mut (dyn FnMut(Notification) + Send),
    ) -> Result<()> {
        Err(Error::Publish(
            "this backend client cannot serve notifications".to_string(),
        ))
    }
}

/// Materialize a backend-resolved version onto disk so the existing seeder,
/// prompt renderer, and validator — all of which read host paths — work
/// unchanged against a remote definition.
///
/// Writes the prompt template, every spec source, every starter workspace file,
/// every asset, and the backend-rendered reference screenshots under
/// `store_dir`, then returns a
/// [`TestCaseVersion`] whose path fields point inside `store_dir`, together with
/// the [`RenderedReference`]s for `variant` (the common references plus that
/// variant's own). Pair the returned references with a
/// [`PrerenderedReferenceRenderer`] so [`crate::RunEngine::run`] reuses them
/// rather than re-rendering from mockup HTML the runner never receives.
pub async fn materialize_version(
    client: &dyn BackendClient,
    slug: &str,
    version: &str,
    variant: &str,
    store_dir: &Path,
) -> Result<(TestCaseVersion, Vec<RenderedReference>)> {
    let mut resolved = client.resolve_version(slug, version).await?;
    let root = store_dir.to_path_buf();
    std::fs::create_dir_all(&root)?;

    // The prompt template is served inline; write it to disk so `render_prompt`
    // (which reads `prompt_path`) keeps working without a special case.
    let prompt_path = root.join("prompt.hbs");
    let template = client.prompt_template(slug, version).await?;
    write_at(&prompt_path, template.as_bytes())?;

    // Fetch and write every spec source (common + each variant's own) and asset
    // by its store-relative key, then rewrite the version's path fields to point
    // at the materialized copies.
    let mut sources: std::collections::BTreeSet<PathBuf> = std::collections::BTreeSet::new();
    for spec in resolved.common_specs.iter().chain(
        resolved
            .variants
            .iter()
            .flat_map(|variant| variant.specs.iter()),
    ) {
        sources.insert(spec.source_path.clone());
    }
    let mut assets: std::collections::BTreeSet<PathBuf> = std::collections::BTreeSet::new();
    for asset in &resolved.asset_paths {
        assets.insert(asset.clone());
    }
    // Starter workspace files (common + each variant's override) are fetched by
    // their store-relative key the same way, then rewritten to host paths below.
    let mut workspace: std::collections::BTreeSet<PathBuf> = std::collections::BTreeSet::new();
    for file in resolved.common_workspace.iter().chain(
        resolved
            .variants
            .iter()
            .filter_map(|variant| variant.workspace.as_ref())
            .flatten(),
    ) {
        workspace.insert(file.source_path.clone());
    }
    for key in sources.iter().chain(assets.iter()).chain(workspace.iter()) {
        let artifact = client.artifact(slug, version, key).await?;
        write_at(&root.join(key), &artifact.bytes)?;
    }

    // Reference screenshots: the backend renders them at ingest. Write each PNG
    // under `references/<scope>/<view>.png` and point the version's reference
    // views at those files so seeding and validation use them as host paths.
    let common: std::collections::HashSet<&str> = resolved
        .common_references
        .iter()
        .map(|r| r.view.as_str())
        .collect();
    let common: std::collections::HashSet<String> = common.iter().map(|s| s.to_string()).collect();
    let media = client.references(slug, version, variant).await?;
    let mut rendered = Vec::with_capacity(media.len());
    for item in &media {
        let scope = if common.contains(&item.view) {
            "_common".to_string()
        } else {
            variant.to_string()
        };
        let media_path = root
            .join("references")
            .join(&scope)
            .join(format!("{}.{}", item.view, item.extension));
        write_at(&media_path, &item.bytes)?;
        rendered.push(RenderedReference {
            view: item.view.clone(),
            kind: item.kind,
            media_path,
        });
    }

    // Adversarial opponent controllers: the case commits its baselines and hidden
    // references as `references/<id>.wasm`, but those are *not* manifest reference
    // views, so the screenshot loop above never fetches them. The
    // [`AdversarialValidator`](crate::AdversarialValidator) (and the arena's
    // disk-resolved paths) load them straight from `references/<id>.wasm` under the
    // version root, so materialize them here for an adversarial case — otherwise a
    // backend-driven run validates against a hole and forfeits with "the case ships
    // no opponent". The ids are the full arena set (model-facing baselines plus the
    // hidden references like `fuel-probe`); they live on disk only, never seeded
    // into the run container, exactly as a local checkout already has them.
    if resolved.test_type == TestType::Adversarial {
        for id in ARENA_OPPONENT_IDS {
            let key = PathBuf::from("references").join(format!("{id}.wasm"));
            let artifact = client.artifact(slug, version, &key).await?;
            write_at(&root.join(&key), &artifact.bytes)?;
        }
    }

    // Performance `[[case]]` files: the held-out scored set — each case's `input`
    // scenario and its `expected` oracle state — lives in the version folder but is
    // neither a spec, an asset, nor a reference view, so the loops above never fetch
    // it. The [`PerformanceValidator`](crate::PerformanceValidator) reads both from
    // `test_case.root` per case, so a backend-driven run needs them materialized
    // exactly as a local checkout already ships them.
    for case in &resolved.cases {
        for key in [&case.input, &case.expected] {
            let artifact = client.artifact(slug, version, key).await?;
            write_at(&root.join(key), &artifact.bytes)?;
        }
    }

    // Rewrite path fields from store-relative keys to materialized host paths.
    resolved.root = root.clone();
    resolved.prompt_path = prompt_path;
    for spec in &mut resolved.common_specs {
        spec.source_path = root.join(&spec.source_path);
    }
    resolved.asset_paths = resolved.asset_paths.iter().map(|a| root.join(a)).collect();
    for case in &mut resolved.cases {
        case.input = root.join(&case.input);
        case.expected = root.join(&case.expected);
    }
    for file in &mut resolved.common_workspace {
        file.source_path = root.join(&file.source_path);
    }
    for variant in &mut resolved.variants {
        for spec in &mut variant.specs {
            spec.source_path = root.join(&spec.source_path);
        }
        if let Some(files) = &mut variant.workspace {
            for file in files {
                file.source_path = root.join(&file.source_path);
            }
        }
        // Point each reference view at its materialized media (scope = variant);
        // a rendered reference is a `.png`, a static reference keeps its extension.
        for reference in &mut variant.references {
            let file = format!("{}.{}", reference.view, reference.extension());
            reference.source_path = root.join("references").join(&variant.slug).join(file);
        }
    }
    for reference in &mut resolved.common_references {
        let file = format!("{}.{}", reference.view, reference.extension());
        reference.source_path = root.join("references").join("_common").join(file);
    }

    Ok((resolved, rendered))
}

/// A [`crate::ReferenceRenderer`] that returns references already rendered by the
/// backend, rather than rendering mockup HTML the runner never receives.
///
/// Pair it with [`materialize_version`]'s returned references so
/// [`crate::RunEngine::run`] — which calls `render_references` — reuses the
/// backend's screenshots as both the seeded visual targets and the validation
/// baselines.
#[derive(Debug, Clone, Default)]
pub struct PrerenderedReferenceRenderer {
    /// The references the backend rendered, by view slug.
    rendered: Vec<RenderedReference>,
}

impl PrerenderedReferenceRenderer {
    /// Build a renderer over the references materialized for the selected
    /// variant.
    pub fn new(rendered: Vec<RenderedReference>) -> Self {
        Self { rendered }
    }
}

impl crate::reference::ReferenceRenderer for PrerenderedReferenceRenderer {
    fn render_references(
        &self,
        test_case: &TestCaseVersion,
        variant: &Variant,
    ) -> Result<Vec<RenderedReference>> {
        // Return only the views this variant declares, matching the on-disk set
        // the backend rendered for it; a view the backend did not render is
        // simply absent, which `RunEngine::run` then reports as incomplete.
        let wanted: std::collections::HashSet<String> = test_case
            .references_for(variant)
            .into_iter()
            .map(|view| view.view)
            .collect();
        Ok(self
            .rendered
            .iter()
            .filter(|reference| wanted.contains(&reference.view))
            .cloned()
            .collect())
    }
}

// --- HTTP implementation ----------------------------------------------------

/// A [`BackendClient`] that talks to the backend's HTTP API over `reqwest`.
///
/// The base URL is the backend's address (for example `http://127.0.0.1:8787`).
/// The mutating endpoints (push, review, publish, media upload) require a bearer
/// token, attached on every request when one is set via [`Self::with_token`];
/// reads work without one. The private network is still the outer boundary — the
/// token authenticates *which account* is acting, not merely that the caller can
/// reach the backend.
#[derive(Debug, Clone)]
pub struct HttpBackendClient {
    /// The backend base URL, without a trailing slash.
    base_url: String,
    /// The bearer token attached to every request, or `None` for read-only use.
    token: Option<String>,
    /// The shared HTTP client.
    http: reqwest::Client,
}

impl HttpBackendClient {
    /// Construct a client targeting the backend at `base_url`, with no token (for
    /// read-only use). Use [`Self::with_token`] to authenticate mutating calls.
    pub fn new(base_url: impl Into<String>) -> Self {
        let base = base_url.into();
        Self {
            base_url: base.trim_end_matches('/').to_string(),
            token: None,
            http: reqwest::Client::new(),
        }
    }

    /// Attach (or clear) the bearer token this client authenticates mutating
    /// requests with. `None` leaves it read-only.
    pub fn with_token(mut self, token: Option<String>) -> Self {
        self.token = token.filter(|t| !t.is_empty());
        self
    }

    /// The backend base URL this client targets.
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// Join a path onto the base URL.
    fn url(&self, path: &str) -> String {
        format!("{}/{}", self.base_url, path.trim_start_matches('/'))
    }

    /// The outbound headers for a request: the current trace context (a no-op
    /// when no propagator is installed) plus the bearer token when one is set.
    fn headers(&self) -> http::HeaderMap {
        let mut headers = http::HeaderMap::new();
        test_cabinet_telemetry::propagation::inject_current_context(&mut headers);
        if let Some(token) = &self.token
            && let Ok(value) = http::HeaderValue::from_str(&format!("Bearer {token}"))
        {
            headers.insert(http::header::AUTHORIZATION, value);
        }
        headers
    }

    /// GET `path` and deserialize a JSON body, mapping transport and status
    /// failures into [`Error::Publish`]-free [`Error`] variants.
    ///
    /// The span carries only the method and request `path` (never the base URL,
    /// which is environment config, nor any header): there is no app-level auth,
    /// so no credential is ever attached to these requests.
    #[instrument(skip(self), fields(otel.kind = "client", http.request.method = "GET", url.path = %path), err)]
    async fn get_json<T: for<'de> Deserialize<'de>>(&self, path: &str) -> Result<T> {
        let url = self.url(path);
        let response = self.get(&url).await.map_err(|err| backend_err(&url, err))?;
        let response = error_for_status(&url, response).await?;
        response
            .json::<T>()
            .await
            .map_err(|err| backend_err(&url, err))
    }

    /// GET `path` and return the raw response bytes.
    #[instrument(skip(self), fields(otel.kind = "client", http.request.method = "GET", url.path = %path), err)]
    async fn get_bytes(&self, path: &str) -> Result<Vec<u8>> {
        let url = self.url(path);
        let response = self.get(&url).await.map_err(|err| backend_err(&url, err))?;
        let response = error_for_status(&url, response).await?;
        Ok(response
            .bytes()
            .await
            .map_err(|err| backend_err(&url, err))?
            .to_vec())
    }

    /// Issue a GET to `url` with the standard headers (trace context, and the
    /// bearer token when set). The trace injection is a no-op unless a binary
    /// installed the global propagator, so this is safe in fmt-only mode.
    async fn get(&self, url: &str) -> reqwest::Result<reqwest::Response> {
        self.http.get(url).headers(self.headers()).send().await
    }
}

#[async_trait::async_trait]
impl BackendClient for HttpBackendClient {
    async fn catalog(&self) -> Result<Vec<TestCase>> {
        let body: CatalogBody = self.get_json("/test-cases").await?;
        Ok(body
            .test_cases
            .into_iter()
            .map(|case| TestCase {
                slug: case.slug,
                versions: case.versions,
            })
            .collect())
    }

    async fn versions(&self, slug: &str) -> Result<Vec<String>> {
        let body: VersionsBody = self
            .get_json(&format!("/test-cases/{}/versions", encode(slug)))
            .await?;
        Ok(body.versions)
    }

    async fn resolve_version(&self, slug: &str, version: &str) -> Result<TestCaseVersion> {
        let body: VersionBody = self
            .get_json(&format!(
                "/test-cases/{}/versions/{}",
                encode(slug),
                encode(version)
            ))
            .await?;
        Ok(body.into_version())
    }

    async fn artifact(&self, slug: &str, version: &str, source: &Path) -> Result<ResolvedArtifact> {
        let key = forward_slash(source);
        let bytes = self
            .get_bytes(&format!(
                "/test-cases/{}/versions/{}/artifacts/{}",
                encode(slug),
                encode(version),
                encode_path(&key),
            ))
            .await?;
        Ok(ResolvedArtifact {
            source: source.to_path_buf(),
            bytes,
        })
    }

    async fn references(
        &self,
        slug: &str,
        version: &str,
        variant: &str,
    ) -> Result<Vec<ResolvedReference>> {
        // The resolved version tells us which views exist, under which scope
        // (`_common` or the variant's slug), and each one's media kind/extension;
        // fetch the served media for each.
        let resolved = self.resolve_version(slug, version).await?;
        let variant_def = resolved.variant(variant)?;
        let mut out = Vec::new();
        for reference in &resolved.common_references {
            out.push(
                self.fetch_reference(slug, version, "_common", reference)
                    .await?,
            );
        }
        for reference in &variant_def.references {
            out.push(
                self.fetch_reference(slug, version, variant, reference)
                    .await?,
            );
        }
        Ok(out)
    }

    async fn prompt_template(&self, slug: &str, version: &str) -> Result<String> {
        // Served inline by `resolve_version`; this is the explicit fetch.
        let body: VersionBody = self
            .get_json(&format!(
                "/test-cases/{}/versions/{}",
                encode(slug),
                encode(version)
            ))
            .await?;
        Ok(body.prompt_template)
    }

    #[instrument(
        skip(self, review),
        fields(otel.kind = "client", http.request.method = "POST", run.id = %run_id),
        err,
    )]
    async fn submit_review(&self, run_id: &str, review: &Writeup) -> Result<()> {
        let url = self.url(&format!("/runs/{}/reviews", encode(run_id)));
        let body = ReviewBody {
            ratings: &review.ratings,
            writeup: &review.body,
            checklist: &review.checklist,
        };
        let response = self
            .http
            .post(&url)
            .headers(self.headers())
            .json(&body)
            .send()
            .await
            .map_err(|err| backend_err(&url, err))?;
        error_for_status(&url, response).await?;
        Ok(())
    }

    #[instrument(
        skip(self),
        fields(otel.kind = "client", http.request.method = "POST", run.id = %run_id),
        err,
    )]
    async fn publish_run(&self, run_id: &str) -> Result<PublishAck> {
        let url = self.url(&format!("/runs/{}/publish", encode(run_id)));
        let response = self
            .http
            .post(&url)
            .headers(self.headers())
            .send()
            .await
            .map_err(|err| backend_err(&url, err))?;
        // `202 Accepted` with the enqueued publish job's id + live URL; the gate
        // failures (no review, infra failure) surface as the backend's error
        // envelope through `error_for_status`.
        let response = error_for_status(&url, response).await?;
        let ack: PublishAckBody = response
            .json()
            .await
            .map_err(|err| backend_err(&url, err))?;
        Ok(PublishAck {
            publish_job_id: ack.publish_job_id,
            live_url: ack.live_url,
        })
    }

    #[instrument(
        skip(self, on_item),
        fields(otel.kind = "client", http.request.method = "GET", publish_job.id = %publish_job_id),
        err,
    )]
    async fn watch_publish_job(
        &self,
        publish_job_id: &str,
        on_item: &mut (dyn FnMut(PublishLiveItem) + Send),
    ) -> Result<()> {
        let url = self.url(&format!("/publish-jobs/{}/live", encode(publish_job_id)));
        let response = self
            .http
            .get(&url)
            .headers(self.headers())
            .header(http::header::ACCEPT, "application/x-ndjson")
            .send()
            .await
            .map_err(|err| backend_err(&url, err))?;
        let mut response = error_for_status(&url, response).await?;
        // NDJSON: accumulate bytes and emit one item per `\n`-terminated line,
        // mirroring `watch_job`. The `stream` feature isn't enabled workspace-wide,
        // so pull chunks directly (`Response::chunk`) rather than a `bytes_stream`.
        let mut buffer = String::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|err| backend_err(&url, err))?
        {
            buffer.push_str(&String::from_utf8_lossy(&chunk));
            while let Some(newline) = buffer.find('\n') {
                let line: String = buffer.drain(..=newline).collect();
                emit_publish_line(line.trim(), on_item);
            }
        }
        // A final line the stream closed without a trailing newline on.
        emit_publish_line(buffer.trim(), on_item);
        Ok(())
    }

    #[instrument(
        skip(self, bytes),
        fields(otel.kind = "client", http.request.method = "POST", run.id = %run_id, proof.file = %file),
        err,
    )]
    async fn publish_run_proof(&self, run_id: &str, file: &str, bytes: Vec<u8>) -> Result<()> {
        let url = self.url(&format!("/runs/{}/proof/{}", encode(run_id), encode(file)));
        let content_type = content_type_for_file(file);
        let headers = self.headers();
        let response = self
            .http
            .post(&url)
            .headers(headers)
            .header(http::header::CONTENT_TYPE, content_type)
            .body(bytes)
            .send()
            .await
            .map_err(|err| backend_err(&url, err))?;
        error_for_status(&url, response).await?;
        Ok(())
    }

    #[instrument(
        skip(self, bytes),
        fields(otel.kind = "client", http.request.method = "POST", run.id = %run_id, asset.file = %file),
        err,
    )]
    async fn publish_run_asset(&self, run_id: &str, file: &str, bytes: Vec<u8>) -> Result<()> {
        let url = self.url(&format!("/runs/{}/asset/{}", encode(run_id), encode(file)));
        let content_type = content_type_for_file(file);
        let headers = self.headers();
        let response = self
            .http
            .post(&url)
            .headers(headers)
            .header(http::header::CONTENT_TYPE, content_type)
            .body(bytes)
            .send()
            .await
            .map_err(|err| backend_err(&url, err))?;
        error_for_status(&url, response).await?;
        Ok(())
    }

    #[instrument(
        skip(self, bytes),
        fields(otel.kind = "client", http.request.method = "POST", run.id = %run_id),
        err,
    )]
    async fn publish_run_controller(&self, run_id: &str, bytes: Vec<u8>) -> Result<()> {
        let url = self.url(&format!("/runs/{}/controller.wasm", encode(run_id)));
        let headers = self.headers();
        let response = self
            .http
            .post(&url)
            .headers(headers)
            .header(http::header::CONTENT_TYPE, "application/wasm")
            .body(bytes)
            .send()
            .await
            .map_err(|err| backend_err(&url, err))?;
        error_for_status(&url, response).await?;
        Ok(())
    }

    async fn controller_artifact(&self, run_id: &str) -> Result<Vec<u8>> {
        self.get_bytes(&format!("/runs/{}/controller.wasm", encode(run_id)))
            .await
    }

    async fn list_adversarial_controllers(&self, slug: &str) -> Result<Vec<ControllerRef>> {
        let body: ControllersBody = self
            .get_json(&format!(
                "/adversarial/controllers?testCase={}",
                encode(slug)
            ))
            .await?;
        Ok(body.controllers)
    }

    #[instrument(
        skip(self, record),
        fields(otel.kind = "client", http.request.method = "POST", tournament.id = %record.id),
        err,
    )]
    async fn publish_tournament(&self, record: &TournamentRecord) -> Result<()> {
        let url = self.url("/tournaments");
        let headers = self.headers();
        let response = self
            .http
            .post(&url)
            .headers(headers)
            .json(record)
            .send()
            .await
            .map_err(|err| backend_err(&url, err))?;
        error_for_status(&url, response).await?;
        Ok(())
    }

    #[instrument(
        skip(self, bytes),
        fields(otel.kind = "client", http.request.method = "POST", tournament.id = %tournament_id, match.id = %match_id),
        err,
    )]
    async fn publish_tournament_match(
        &self,
        tournament_id: &str,
        match_id: &str,
        bytes: Vec<u8>,
    ) -> Result<()> {
        let url = self.url(&format!(
            "/tournaments/{}/matches/{}/replay.json",
            encode(tournament_id),
            encode(match_id)
        ));
        let headers = self.headers();
        let response = self
            .http
            .post(&url)
            .headers(headers)
            .header(http::header::CONTENT_TYPE, "application/json")
            .body(bytes)
            .send()
            .await
            .map_err(|err| backend_err(&url, err))?;
        error_for_status(&url, response).await?;
        Ok(())
    }

    async fn list_runs(&self, before: Option<&str>, limit: Option<usize>) -> Result<RunPage> {
        let mut path = String::from("/runs");
        let mut query = Vec::new();
        if let Some(before) = before {
            query.push(format!("before={}", encode(before)));
        }
        if let Some(limit) = limit {
            query.push(format!("limit={limit}"));
        }
        if !query.is_empty() {
            path.push('?');
            path.push_str(&query.join("&"));
        }
        let body: RunPageBody = self.get_json(&path).await?;
        Ok(RunPage {
            runs: body.runs.into_iter().map(stored_run_from).collect(),
            next_before: body.next_before,
        })
    }

    async fn read_run(&self, id: &str) -> Result<PublishedRun> {
        let body: StoredRunBody = self.get_json(&format!("/runs/{}", encode(id))).await?;
        Ok(stored_run_from(body))
    }

    #[instrument(
        skip(self, body, token),
        fields(
            otel.kind = "client",
            http.request.method = "POST",
            url.path = "/jobs",
            case.slug = %body.test_case,
            case.version = %body.version,
            variant = %body.variant,
        ),
        err,
    )]
    async fn launch_run(&self, body: &LaunchBody, token: &str) -> Result<String> {
        let url = self.url("/jobs");
        // The enqueue is gated on the launching account, so the account's token
        // rides along as `Authorization: Bearer` regardless of the client's own
        // configured token (a watch-only client carries none).
        let mut headers = self.headers();
        if let Ok(value) = http::HeaderValue::from_str(&format!("Bearer {token}")) {
            headers.insert(http::header::AUTHORIZATION, value);
        }
        let response = self
            .http
            .post(&url)
            .headers(headers)
            .json(body)
            .send()
            .await
            .map_err(|err| backend_err(&url, err))?;
        let response = error_for_status(&url, response).await?;
        let ack: LaunchAck = response
            .json()
            .await
            .map_err(|err| backend_err(&url, err))?;
        Ok(ack.job_id)
    }

    async fn job_status(&self, job_id: &str) -> Result<JobStatusOut> {
        self.get_json(&format!("/jobs/{}", encode(job_id))).await
    }

    async fn list_active_jobs(&self) -> Result<Vec<ActiveJobOut>> {
        self.get_json("/jobs/active").await
    }

    #[instrument(
        skip(self, on_item),
        fields(otel.kind = "client", http.request.method = "GET", job.id = %job_id),
        err,
    )]
    async fn watch_job(
        &self,
        job_id: &str,
        on_item: &mut (dyn FnMut(LiveItem) + Send),
    ) -> Result<()> {
        let url = self.url(&format!("/jobs/{}/live", encode(job_id)));
        let response = self
            .http
            .get(&url)
            .headers(self.headers())
            .header(http::header::ACCEPT, "application/x-ndjson")
            .send()
            .await
            .map_err(|err| backend_err(&url, err))?;
        let mut response = error_for_status(&url, response).await?;
        // NDJSON: accumulate bytes and emit one item per `\n`-terminated line. The
        // `stream` feature isn't enabled workspace-wide, so pull chunks directly
        // (`Response::chunk`) rather than a `bytes_stream`.
        let mut buffer = String::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|err| backend_err(&url, err))?
        {
            buffer.push_str(&String::from_utf8_lossy(&chunk));
            while let Some(newline) = buffer.find('\n') {
                let line: String = buffer.drain(..=newline).collect();
                emit_live_line(line.trim(), on_item);
            }
        }
        // A final line the stream closed without a trailing newline on.
        emit_live_line(buffer.trim(), on_item);
        Ok(())
    }

    #[instrument(
        skip(self, on_notification),
        fields(otel.kind = "client", http.request.method = "GET", url.path = "/notifications"),
        err,
    )]
    async fn subscribe_notifications(
        &self,
        on_notification: &mut (dyn FnMut(Notification) + Send),
    ) -> Result<()> {
        let url = self.url("/notifications");
        let response = self
            .http
            .get(&url)
            .headers(self.headers())
            .header(http::header::ACCEPT, "text/event-stream")
            .send()
            .await
            .map_err(|err| backend_err(&url, err))?;
        let mut response = error_for_status(&url, response).await?;
        // SSE: events are separated by a blank line; each carries one or more
        // `data:` lines whose concatenation is the JSON payload. Accumulate bytes,
        // split complete events on the blank-line boundary, and decode each one.
        // Normalize CRLF so the boundary search and field parsing are line-ending
        // agnostic.
        let mut buffer = String::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|err| backend_err(&url, err))?
        {
            buffer.push_str(&String::from_utf8_lossy(&chunk).replace("\r\n", "\n"));
            while let Some(boundary) = buffer.find("\n\n") {
                let event: String = buffer.drain(..boundary + 2).collect();
                if let Some(notification) = parse_sse_notification(&event) {
                    on_notification(notification);
                }
            }
        }
        Ok(())
    }
}

/// Emit one NDJSON live line as a [`LiveItem`]: a line tagged
/// `type: "asset_preview"` is a live drawing frame; every other non-empty line is
/// a normalized harness event. A malformed line is surfaced as an `unknown` event
/// carrying the raw text rather than aborting the watch (the contract's `unknown`
/// kind), mirroring the web console's transport. An empty line is skipped.
fn emit_live_line(line: &str, on_item: &mut (dyn FnMut(LiveItem) + Send)) {
    if line.is_empty() {
        return;
    }
    // Peek the `type` tag to route the line: a preview frame is tagged
    // `asset_preview`; a harness event's `type` is one of the closed set of event
    // kinds (never `asset_preview`).
    let is_preview = serde_json::from_str::<TaggedLine>(line)
        .ok()
        .and_then(|tagged| tagged.r#type)
        .as_deref()
        == Some("asset_preview");
    if is_preview {
        if let Ok(preview) = serde_json::from_str::<AssetPreview>(line) {
            on_item(LiveItem::Preview(preview));
            return;
        }
    } else if let Ok(event) = serde_json::from_str::<HarnessEvent>(line) {
        on_item(LiveItem::Event(event));
        return;
    }
    on_item(LiveItem::Event(unknown_event(line)));
}

/// Emit one publish-stream NDJSON line as a [`PublishLiveItem`]. The backend tags
/// each line with a `type` discriminator: a `progress` line carries a `message`,
/// the terminal `result` line carries the release outcome. An empty line is
/// skipped; a line that is neither (a malformed item) is surfaced as a failure
/// [`PublishResult`] so nothing is silently dropped, mirroring `emit_live_line`'s
/// `unknown` fallback.
fn emit_publish_line(line: &str, on_item: &mut (dyn FnMut(PublishLiveItem) + Send)) {
    if line.is_empty() {
        return;
    }
    let kind = serde_json::from_str::<TaggedLine>(line)
        .ok()
        .and_then(|tagged| tagged.r#type);
    match kind.as_deref() {
        Some("progress") => {
            if let Ok(progress) = serde_json::from_str::<PublishProgress>(line) {
                on_item(PublishLiveItem::Progress(progress));
                return;
            }
        }
        Some("result") => {
            if let Ok(result) = serde_json::from_str::<PublishResult>(line) {
                on_item(PublishLiveItem::Result(result));
                return;
            }
        }
        _ => {}
    }
    on_item(PublishLiveItem::Result(unknown_publish_result(line)));
}

/// The terminal [`PublishResult`] standing in for an unparseable publish-stream
/// line: a failure carrying the raw text as its `detail`, so a malformed item ends
/// the watch with a legible reason rather than being dropped.
fn unknown_publish_result(raw: &str) -> PublishResult {
    PublishResult {
        state: crate::publish_job_api::PublishState::Failed,
        source_repo: None,
        playable_build: None,
        detail: Some(format!("unrecognized publish stream line: {raw}")),
    }
}

/// Decode one SSE event block into a [`Notification`]: concatenate its `data:`
/// field values (SSE allows an event to carry several) and parse the result as
/// JSON. Returns `None` for a comment/keep-alive block or a malformed payload,
/// which the subscription drops rather than tearing down.
fn parse_sse_notification(event: &str) -> Option<Notification> {
    let mut data = String::new();
    for line in event.lines() {
        if let Some(value) = line.strip_prefix("data:") {
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(value.strip_prefix(' ').unwrap_or(value));
        }
    }
    if data.is_empty() {
        return None;
    }
    serde_json::from_str(&data).ok()
}

/// The `type` tag of a live NDJSON line, peeked to route it (a preview frame is
/// tagged `asset_preview`; a harness event's `type` is one of the event kinds).
#[derive(Deserialize)]
struct TaggedLine {
    #[serde(default)]
    r#type: Option<String>,
}

/// A harness event standing in for an unparseable live line: the contract's
/// [`Unknown`](crate::event::EventKind::Unknown) kind, carrying the raw text so
/// nothing is silently dropped. The timestamp is left empty (the line carried no
/// usable one), matching the web console's `unknown`-line fallback.
fn unknown_event(raw: &str) -> HarnessEvent {
    HarnessEvent {
        timestamp: String::new(),
        session_id: None,
        kind: crate::event::EventKind::Unknown {
            raw: serde_json::Value::String(raw.to_string()),
        },
    }
}

impl HttpBackendClient {
    /// Fetch one reference's served media under `scope` (`_common` or a variant
    /// slug), using the reference's resolved kind/extension to address it.
    async fn fetch_reference(
        &self,
        slug: &str,
        version: &str,
        scope: &str,
        reference: &ReferenceView,
    ) -> Result<ResolvedReference> {
        let extension = reference.extension();
        let bytes = self
            .get_bytes(&format!(
                "/test-cases/{}/versions/{}/references/{}/{}.{}",
                encode(slug),
                encode(version),
                encode(scope),
                encode(&reference.view),
                extension,
            ))
            .await?;
        Ok(ResolvedReference {
            view: reference.view.clone(),
            kind: reference.kind.media_kind(),
            extension,
            bytes,
        })
    }
}

// --- Wire shapes (deserialized from the backend, §1.2–§1.4) -----------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogBody {
    test_cases: Vec<CatalogCaseBody>,
}

#[derive(Deserialize)]
struct CatalogCaseBody {
    slug: String,
    versions: Vec<String>,
}

#[derive(Deserialize)]
struct VersionsBody {
    versions: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VersionBody {
    slug: String,
    version: String,
    name: String,
    difficulty: String,
    tags: Vec<String>,
    summary: Option<String>,
    description: Option<String>,
    max_runtime_seconds: u64,
    #[serde(default)]
    test_type: TestType,
    #[serde(default)]
    build: Option<BuildBody>,
    #[serde(default)]
    canvas: Option<CanvasBody>,
    #[serde(default)]
    tool: Option<ToolBody>,
    #[serde(default)]
    output: Option<OutputBody>,
    #[serde(default)]
    contract: Option<ContractBody>,
    #[serde(default)]
    sandbox: Option<SandboxBody>,
    #[serde(default)]
    simulation: Option<SimulationBody>,
    #[serde(default, rename = "match")]
    r#match: Option<MatchBody>,
    #[serde(default)]
    replay: Option<ReplayBody>,
    /// The asset shape (sprite vs sprite sheet). Defaults to
    /// [`AssetKind::Sprite`], matching a store that predates the field.
    #[serde(default)]
    asset_kind: AssetKind,
    /// The sprite-sheet grid and sequences. Deserialized straight into
    /// [`SheetSpec`] — the wire shape matches it field for field — so a
    /// backend-driven sprite-sheet run carries the same layout a local one does.
    #[serde(default)]
    sheet: Option<SheetSpec>,
    prompt_template: String,
    common_specs: Vec<SpecBody>,
    #[serde(default)]
    workspace: Vec<WorkspaceFileBody>,
    #[serde(default)]
    init: Option<String>,
    assets: Vec<AssetBody>,
    variants: Vec<VariantBody>,
    common_references: Vec<ReferenceBody>,
    #[serde(default)]
    common_proofs: Vec<ProofBody>,
    checks: Vec<CheckBody>,
    #[serde(default)]
    common_review_items: Vec<ReviewItemBody>,
    /// The case's scoring domains. Deserialized straight into [`Domain`] — the
    /// wire shape (`id`, `name`, `description`) matches it field for field.
    #[serde(default)]
    domains: Vec<Domain>,
    /// A performance case's held-out scored set. Empty for every other type.
    #[serde(default)]
    cases: Vec<CaseBody>,
}

impl VersionBody {
    /// Build a [`TestCaseVersion`] with store-relative keys in its path fields.
    /// Reference views carry the rendered screenshot path key in `source_path`;
    /// [`materialize_version`] rewrites these to host paths.
    fn into_version(self) -> TestCaseVersion {
        let description_path = self
            .description
            .as_ref()
            .map(|_| PathBuf::from("description.md"));
        TestCaseVersion {
            slug: self.slug,
            version: self.version,
            name: self.name,
            difficulty: self.difficulty,
            tags: self.tags,
            summary: self.summary,
            description_path,
            // A remote resolution has no host checkout; the store key is empty
            // until `materialize_version` roots it at the on-disk store dir.
            root: PathBuf::new(),
            prompt_path: PathBuf::from("prompt.hbs"),
            max_runtime_seconds: self.max_runtime_seconds,
            test_type: self.test_type,
            build: self.build.map(|build| BuildCommands {
                install: build.install,
                build: build.build,
                module: build.module.map(PathBuf::from),
            }),
            canvas: self.canvas.map(|canvas| CanvasSpec {
                width: canvas.width,
                height: canvas.height,
                background: canvas.background,
            }),
            tool: self.tool.map(|tool| ToolSpec {
                binary: tool.binary,
                preview: PathBuf::from(&tool.preview),
            }),
            output: self.output.map(|output| OutputSpec {
                actions: PathBuf::from(&output.actions),
            }),
            contract: self.contract.map(|contract| ContractSpec {
                entry: contract.entry,
                world: contract.world.as_deref().map(PathBuf::from),
                action: contract.action.as_deref().map(PathBuf::from),
                input: contract.input.as_deref().map(PathBuf::from),
                output: contract.output.as_deref().map(PathBuf::from),
            }),
            sandbox: self.sandbox.map(|sandbox| SandboxSpec {
                fuel_per_tick: sandbox.fuel_per_tick,
                fuel_limit: sandbox.fuel_limit,
                max_memory_bytes: sandbox.max_memory_bytes,
            }),
            simulation: self.simulation.map(|simulation| SimulationSpec {
                timestep_ms: simulation.timestep_ms,
                max_ticks: simulation.max_ticks,
            }),
            r#match: self.r#match.map(|m| MatchSpec {
                participants: m.participants,
                structure: m.structure,
                rounds: m.rounds,
            }),
            replay: self.replay.map(|replay| ReplaySpec {
                renderer: PathBuf::from(&replay.renderer),
            }),
            asset_kind: self.asset_kind,
            sheet: self.sheet,
            common_specs: self.common_specs.iter().map(spec_from).collect(),
            common_workspace: self.workspace.iter().map(workspace_from).collect(),
            init: self.init,
            asset_paths: self
                .assets
                .iter()
                .map(|a| PathBuf::from(&a.source))
                .collect(),
            variants: self
                .variants
                .into_iter()
                .map(|variant| Variant {
                    slug: variant.slug,
                    name: variant.name,
                    description: variant.description,
                    specs: variant.specs.iter().map(spec_from).collect(),
                    workspace: variant
                        .workspace
                        .map(|files| files.iter().map(workspace_from).collect()),
                    references: variant.references.iter().map(reference_from).collect(),
                    proofs: variant.proofs.iter().map(proof_from).collect(),
                    review_items: variant
                        .review_items
                        .into_iter()
                        .map(review_item_from)
                        .collect(),
                })
                .collect(),
            common_references: self.common_references.iter().map(reference_from).collect(),
            common_proofs: self.common_proofs.iter().map(proof_from).collect(),
            checks: self
                .checks
                .into_iter()
                .map(|check| Check {
                    view: check.view,
                    name: check.name,
                    reference_view: check.reference_view,
                    actions: check.actions,
                })
                .collect(),
            common_review_items: self
                .common_review_items
                .into_iter()
                .map(review_item_from)
                .collect(),
            domains: self.domains,
            cases: self
                .cases
                .into_iter()
                .map(|case| PerformanceCase {
                    input: PathBuf::from(&case.input),
                    expected: PathBuf::from(&case.expected),
                })
                .collect(),
        }
    }
}

/// Build a [`SpecFile`] from a wire spec, keying `source_path` by the
/// store-relative `source`. The `template` flag is implicit in a `.hbs`
/// extension, which the seeder already keys on, so it is not carried separately.
fn spec_from(spec: &SpecBody) -> SpecFile {
    SpecFile {
        source_path: PathBuf::from(&spec.source),
        dest: PathBuf::from(&spec.dest),
    }
}

/// Build a [`WorkspaceFile`] from a wire workspace file, keying `source_path` by
/// the store-relative `source` (rewritten to a host path by
/// [`materialize_version`]) and preserving the run-relative `dest`.
fn workspace_from(file: &WorkspaceFileBody) -> WorkspaceFile {
    WorkspaceFile {
        source_path: PathBuf::from(&file.source),
        dest: PathBuf::from(&file.dest),
    }
}

/// Build a [`ReviewItem`] from a wire review item. Reviewer checklist items are
/// reporter-side material, so they carry no path to rewrite; the optional
/// reference/proof links are pairings the reviewer UI resolves.
fn review_item_from(item: ReviewItemBody) -> ReviewItem {
    ReviewItem {
        id: item.id,
        title: item.title,
        text: item.text,
        reference: item.reference,
        proof: item.proof,
        sequences: item.sequences,
        frames: item.frames,
        weight: item.weight,
        domain: item.domain,
    }
}

/// Build a [`ReferenceView`] from a wire reference, keying `source_path` by the
/// media URL path (rewritten to a host path by [`materialize_version`]) and
/// carrying its kind so static image/video references are handled as-is.
fn reference_from(reference: &ReferenceBody) -> ReferenceView {
    ReferenceView {
        view: reference.view.clone(),
        kind: reference.kind,
        source_path: PathBuf::from(&reference.media_url),
    }
}

/// Build a [`ProofFile`] from a wire proof declaration. Proofs are produced by the
/// agent, not seeded, so they carry no host path to rewrite.
fn proof_from(proof: &ProofBody) -> ProofFile {
    ProofFile {
        id: proof.id.clone(),
        name: proof.name.clone(),
        kind: proof.kind,
        dest: PathBuf::from(&proof.dest),
    }
}

/// A best-effort content type for an uploaded proof media file, from its
/// extension. Proof media is only ever an image or an `.mp4`.
fn content_type_for_file(file: &str) -> &'static str {
    let ext = Path::new(file)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "mp4" => "video/mp4",
        // The asset-generation action log uploads through this same path.
        "json" => "application/json",
        _ => "application/octet-stream",
    }
}

#[derive(Deserialize)]
struct BuildBody {
    install: String,
    build: String,
    #[serde(default)]
    module: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContractBody {
    entry: String,
    /// Adversarial only; absent on a performance case.
    #[serde(default)]
    world: Option<String>,
    /// Adversarial only; absent on a performance case.
    #[serde(default)]
    action: Option<String>,
    /// Performance only; absent on an adversarial case.
    #[serde(default)]
    input: Option<String>,
    /// Performance only; absent on an adversarial case.
    #[serde(default)]
    output: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SandboxBody {
    /// Adversarial only; absent on a performance case.
    #[serde(default)]
    fuel_per_tick: Option<u64>,
    /// Performance only; absent on an adversarial case.
    #[serde(default)]
    fuel_limit: Option<u64>,
    max_memory_bytes: u64,
}

/// A performance case's held-out `[[case]]` as served by the backend.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CaseBody {
    input: String,
    expected: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SimulationBody {
    timestep_ms: u32,
    max_ticks: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MatchBody {
    participants: u32,
    structure: String,
    rounds: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReplayBody {
    renderer: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CanvasBody {
    width: u32,
    height: u32,
    background: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToolBody {
    binary: String,
    preview: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OutputBody {
    actions: String,
}

#[derive(Deserialize)]
struct SpecBody {
    source: String,
    dest: String,
    #[allow(dead_code)]
    #[serde(default)]
    template: bool,
}

#[derive(Deserialize)]
struct AssetBody {
    source: String,
    #[allow(dead_code)]
    dest: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VariantBody {
    slug: String,
    name: String,
    description: Option<String>,
    specs: Vec<SpecBody>,
    /// The variant's workspace override, when it declares one (it replaces the
    /// common workspace for this variant). Absent when the variant inherits the
    /// common workspace.
    #[serde(default)]
    workspace: Option<Vec<WorkspaceFileBody>>,
    references: Vec<ReferenceBody>,
    #[serde(default)]
    proofs: Vec<ProofBody>,
    #[serde(default)]
    review_items: Vec<ReviewItemBody>,
}

/// A starter workspace file in the §1.2 wire shape: a store-relative `source`
/// key the runner fetches and the run-relative `dest` it seeds to.
#[derive(Deserialize)]
struct WorkspaceFileBody {
    source: String,
    dest: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewItemBody {
    id: String,
    title: String,
    text: String,
    #[serde(default)]
    reference: Option<String>,
    #[serde(default)]
    proof: Option<String>,
    #[serde(default)]
    sequences: Vec<String>,
    #[serde(default)]
    frames: Vec<u32>,
    weight: u32,
    #[serde(default)]
    domain: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReferenceBody {
    view: String,
    /// How the reference is produced (`rendered`, `image`, or `video`).
    kind: ReferenceKind,
    /// The URL path the reference media is served under.
    media_url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProofBody {
    id: String,
    name: String,
    kind: MediaKind,
    dest: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CheckBody {
    view: String,
    name: String,
    reference_view: String,
    actions: Vec<CheckAction>,
}

#[derive(serde::Serialize)]
struct ReviewBody<'a> {
    /// The reviewer's rating for each scoring domain.
    ratings: &'a [crate::review::DomainRating],
    writeup: &'a str,
    /// The reviewer's verdicts on the case's declared checklist items.
    checklist: &'a [crate::review::ReviewVerdict],
}

/// The body of the `202 Accepted` from `POST /runs/{id}/publish`: the enqueued
/// publish job's id and the live URL to observe it on (mirrors the backend's
/// `PublishResponse`).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublishAckBody {
    publish_job_id: String,
    live_url: String,
}

#[derive(Deserialize)]
struct ControllersBody {
    controllers: Vec<ControllerRef>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunPageBody {
    runs: Vec<StoredRunBody>,
    #[serde(default)]
    next_before: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredRunBody {
    record: RunRecord,
    #[serde(default)]
    reviews: Vec<ReviewOutBody>,
    #[serde(default)]
    published: bool,
    #[serde(default)]
    links: LinksOutBody,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewOutBody {
    #[serde(default)]
    reviewer_id: String,
    #[serde(default)]
    reviewer: String,
    #[serde(default)]
    username: String,
    /// The reviewer's rating for each scoring domain. Deserialized straight into
    /// [`crate::review::DomainRating`] — the wire shape matches it.
    #[serde(default)]
    ratings: Vec<crate::review::DomainRating>,
    writeup: String,
    #[serde(default)]
    checklist: Vec<crate::review::ReviewVerdict>,
    #[serde(default)]
    reviewed_at: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct LinksOutBody {
    #[serde(default)]
    source_repo: Option<String>,
    #[serde(default)]
    playable_build: Option<String>,
}

/// Turn a wire run into a [`PublishedRun`], resolving its links. The backend
/// serves the resolved links in a separate `links` object as well as on the
/// record blob; the separate object is authoritative, so it wins, and the merged
/// result is written back onto the record so callers see one consistent set.
fn stored_run_from(body: StoredRunBody) -> PublishedRun {
    let mut record = body.record;
    let links = RunLinks {
        source_repo: body
            .links
            .source_repo
            .or_else(|| record.links.source_repo.clone()),
        playable_build: body
            .links
            .playable_build
            .or_else(|| record.links.playable_build.clone()),
    };
    record.links = links.clone();
    PublishedRun {
        record,
        reviews: body
            .reviews
            .into_iter()
            .map(|review| PublishedReview {
                reviewer_id: review.reviewer_id,
                reviewer: review.reviewer,
                username: review.username,
                ratings: review.ratings,
                writeup: review.writeup,
                checklist: review.checklist,
                reviewed_at: review.reviewed_at,
            })
            .collect(),
        published: body.published,
        links,
    }
}

// --- Helpers ----------------------------------------------------------------

/// Render a path with forward slashes so store keys are stable across hosts.
fn forward_slash(path: &Path) -> String {
    path.components()
        .filter_map(|component| component.as_os_str().to_str())
        .collect::<Vec<_>>()
        .join("/")
}

/// Write `bytes` to `path`, creating parent directories as needed.
fn write_at(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, bytes)?;
    Ok(())
}

/// Percent-encode a single path segment (slug, version, view, scope) for use in
/// a URL, escaping every character that is not URL-path-safe.
fn encode(segment: &str) -> String {
    let mut out = String::with_capacity(segment.len());
    for byte in segment.bytes() {
        if is_unreserved(byte) {
            out.push(byte as char);
        } else {
            out.push('%');
            out.push(
                char::from_digit((byte >> 4) as u32, 16)
                    .unwrap()
                    .to_ascii_uppercase(),
            );
            out.push(
                char::from_digit((byte & 0xf) as u32, 16)
                    .unwrap()
                    .to_ascii_uppercase(),
            );
        }
    }
    out
}

/// Percent-encode a multi-segment path key for a `{path...}` route, preserving
/// the forward slashes that separate segments.
fn encode_path(path: &str) -> String {
    path.split('/').map(encode).collect::<Vec<_>>().join("/")
}

/// Whether a byte is an unreserved URL character that needs no escaping.
fn is_unreserved(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~')
}

/// Map a transport-level failure (connection refused, timeout, decode error)
/// into a crate error tagged with the URL that failed.
fn backend_err(url: &str, err: reqwest::Error) -> Error {
    Error::Publish(format!("backend request to `{url}` failed: {err}"))
}

/// Turn a non-2xx response into an [`Error`], surfacing the backend's error
/// envelope (`{ "error": { "code", "message" } }`) when present.
async fn error_for_status(url: &str, response: reqwest::Response) -> Result<reqwest::Response> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let body = response.text().await.unwrap_or_default();
    let message = serde_json::from_str::<ErrorEnvelope>(&body)
        .ok()
        .map(|envelope| envelope.error.message)
        .unwrap_or_else(|| body.trim().to_string());
    Err(Error::Publish(format!(
        "backend request to `{url}` failed ({status}): {message}"
    )))
}

#[derive(Deserialize)]
struct ErrorEnvelope {
    error: ErrorEnvelopeInner,
}

#[derive(Deserialize)]
struct ErrorEnvelopeInner {
    message: String,
}

#[cfg(test)]
#[path = "backend_client.test.rs"]
mod tests;
