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
use crate::reference::RenderedReference;
use crate::review::Writeup;
use crate::run_record::{RunLinks, RunRecord};
use crate::test_case::{
    AssetKind, BuildCommands, CanvasSpec, Check, CheckAction, ContractSpec, Domain, MatchSpec,
    MediaKind, OutputSpec, ProofFile, ReferenceKind, ReferenceView, ReplaySpec, ReviewItem,
    SandboxSpec, SheetSpec, SimulationSpec, SpecFile, TestCase, TestCaseVersion, TestType,
    ToolSpec, Variant, WorkspaceFile,
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

/// The backend's acknowledgement of a published run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublishAck {
    /// The run id the backend stored the publish under (`record.id`).
    pub id: String,
    /// Whether this publish was newly recorded (`true`) or an idempotent
    /// re-publish of an already-stored run (`false`).
    pub newly_published: bool,
}

/// A run on the backend's read side, as served by `GET /runs` and
/// `GET /runs/{id}`: the full record (with its links resolved), the review it
/// was published with, and the resolved links. This is what a reporter or
/// gallery consumes — the publish-time counterpart is [`BackendClient::publish_run`].
#[derive(Debug, Clone)]
pub struct PublishedRun {
    /// The full run record. Its [`RunLinks`] are the resolved links the backend
    /// holds (the separate [`links`](Self::links) field, merged onto the blob).
    pub record: RunRecord,
    /// The review the run was published with.
    pub review: PublishedReview,
    /// The resolved source-repo and playable-build links the backend recorded.
    pub links: RunLinks,
}

/// A review as the backend serves it on the read side: the per-domain ratings,
/// the prose body, and the reviewer's verdicts on the case's checklist items.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublishedReview {
    /// The reviewer's rating for each of the case's scoring domains. The run's
    /// overall rating is the worst across them.
    pub ratings: Vec<crate::review::DomainRating>,
    /// The review prose.
    pub writeup: String,
    /// The reviewer's verdicts on the case's declared checklist items.
    pub checklist: Vec<crate::review::ReviewVerdict>,
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

    /// Submit a published run: record + review + resolved links + recorded event
    /// stream. (`POST /runs`) Idempotent on `record.id`. `events` is the run's
    /// normalized event log; pass an empty slice when none is available.
    async fn publish_run(
        &self,
        record: &RunRecord,
        review: &Writeup,
        links: &RunLinks,
        events: &[HarnessEvent],
    ) -> Result<PublishAck>;

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

    /// List published runs, newest first, paginated. (`GET /runs?before=&limit=`)
    ///
    /// `before` is the cursor from a previous page's
    /// [`RunPage::next_before`] (`None` for the first page); `limit` caps the page
    /// size (the backend clamps it to its own bounds). This is the read side a
    /// reporter or gallery consumes.
    async fn list_runs(&self, before: Option<&str>, limit: Option<usize>) -> Result<RunPage>;

    /// Read one published run by id. (`GET /runs/{id}`)
    async fn read_run(&self, id: &str) -> Result<PublishedRun>;
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

    // Rewrite path fields from store-relative keys to materialized host paths.
    resolved.root = root.clone();
    resolved.prompt_path = prompt_path;
    for spec in &mut resolved.common_specs {
        spec.source_path = root.join(&spec.source_path);
    }
    resolved.asset_paths = resolved.asset_paths.iter().map(|a| root.join(a)).collect();
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
/// There is no app-level auth — the private network / Tailscale is the access
/// control — so no credentials are attached.
#[derive(Debug, Clone)]
pub struct HttpBackendClient {
    /// The backend base URL, without a trailing slash.
    base_url: String,
    /// The shared HTTP client.
    http: reqwest::Client,
}

impl HttpBackendClient {
    /// Construct a client targeting the backend at `base_url`.
    pub fn new(base_url: impl Into<String>) -> Self {
        let base = base_url.into();
        Self {
            base_url: base.trim_end_matches('/').to_string(),
            http: reqwest::Client::new(),
        }
    }

    /// The backend base URL this client targets.
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// Join a path onto the base URL.
    fn url(&self, path: &str) -> String {
        format!("{}/{}", self.base_url, path.trim_start_matches('/'))
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

    /// Issue a GET to `url` with the current trace context injected into the
    /// outbound headers, so the backend can continue this trace. The injection is
    /// a no-op unless a binary installed the global propagator (the propagation
    /// helper degrades silently otherwise), so this is safe in fmt-only mode.
    async fn get(&self, url: &str) -> reqwest::Result<reqwest::Response> {
        let mut headers = http::HeaderMap::new();
        test_cabinet_telemetry::propagation::inject_current_context(&mut headers);
        self.http.get(url).headers(headers).send().await
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
        skip(self, record, review, links, events),
        fields(
            otel.kind = "client",
            http.request.method = "POST",
            url.path = "/runs",
            run.id = %record.id,
        ),
        err,
    )]
    async fn publish_run(
        &self,
        record: &RunRecord,
        review: &Writeup,
        links: &RunLinks,
        events: &[HarnessEvent],
    ) -> Result<PublishAck> {
        let url = self.url("/runs");
        let body = PublishBody {
            record,
            review: ReviewBody {
                ratings: &review.ratings,
                writeup: &review.body,
                checklist: &review.checklist,
            },
            links: LinksBody {
                source_repo: links.source_repo.clone(),
                playable_build: links.playable_build.clone(),
            },
            events,
        };
        // Inject the current trace context so the backend continues this trace.
        // A no-op when no propagator is installed (fmt-only mode).
        let mut headers = http::HeaderMap::new();
        test_cabinet_telemetry::propagation::inject_current_context(&mut headers);
        let response = self
            .http
            .post(&url)
            .headers(headers)
            .json(&body)
            .send()
            .await
            .map_err(|err| backend_err(&url, err))?;
        let response = error_for_status(&url, response).await?;
        let ack: PublishAckBody = response
            .json()
            .await
            .map_err(|err| backend_err(&url, err))?;
        Ok(PublishAck {
            id: ack.id,
            newly_published: ack.newly_published,
        })
    }

    #[instrument(
        skip(self, bytes),
        fields(otel.kind = "client", http.request.method = "POST", run.id = %run_id, proof.file = %file),
        err,
    )]
    async fn publish_run_proof(&self, run_id: &str, file: &str, bytes: Vec<u8>) -> Result<()> {
        let url = self.url(&format!("/runs/{}/proof/{}", encode(run_id), encode(file)));
        let content_type = content_type_for_file(file);
        let mut headers = http::HeaderMap::new();
        test_cabinet_telemetry::propagation::inject_current_context(&mut headers);
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
        let mut headers = http::HeaderMap::new();
        test_cabinet_telemetry::propagation::inject_current_context(&mut headers);
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
                world: PathBuf::from(&contract.world),
                action: PathBuf::from(&contract.action),
            }),
            sandbox: self.sandbox.map(|sandbox| SandboxSpec {
                fuel_per_tick: sandbox.fuel_per_tick,
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
    world: String,
    action: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SandboxBody {
    fuel_per_tick: u64,
    max_memory_bytes: u64,
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
struct PublishBody<'a> {
    record: &'a RunRecord,
    review: ReviewBody<'a>,
    links: LinksBody,
    /// The run's normalized event stream. Always sent (an empty array when the
    /// run has none); the backend stores it for the published Events tab.
    events: &'a [HarnessEvent],
}

#[derive(serde::Serialize)]
struct ReviewBody<'a> {
    /// The reviewer's rating for each scoring domain.
    ratings: &'a [crate::review::DomainRating],
    writeup: &'a str,
    /// The reviewer's verdicts on the case's declared checklist items.
    checklist: &'a [crate::review::ReviewVerdict],
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LinksBody {
    source_repo: Option<String>,
    playable_build: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublishAckBody {
    id: String,
    newly_published: bool,
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
    review: ReviewOutBody,
    #[serde(default)]
    links: LinksOutBody,
}

#[derive(Deserialize)]
struct ReviewOutBody {
    /// The reviewer's rating for each scoring domain. Deserialized straight into
    /// [`crate::review::DomainRating`] — the wire shape matches it.
    #[serde(default)]
    ratings: Vec<crate::review::DomainRating>,
    writeup: String,
    #[serde(default)]
    checklist: Vec<crate::review::ReviewVerdict>,
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
        review: PublishedReview {
            ratings: body.review.ratings,
            writeup: body.review.writeup,
            checklist: body.review.checklist,
        },
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
