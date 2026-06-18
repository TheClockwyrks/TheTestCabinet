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

use crate::error::{Error, Result};
use crate::reference::RenderedReference;
use crate::review::Writeup;
use crate::run_record::{RunLinks, RunRecord};
use crate::test_case::{
    BuildCommands, Check, CheckAction, ReferenceView, ReviewItem, SpecFile, TestCase,
    TestCaseVersion, Variant,
};

/// A resolved harness container image: a full, pullable image reference the
/// runner pulls by digest from a registry.
///
/// The runner is registry-agnostic: it never composes a registry, org, or tag.
/// It pulls exactly the [`reference`](Self::reference) the backend returns, which
/// is a fully-qualified digest ref such as
/// `ghcr.io/<org>/test-cabinet-claude@sha256:…`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContainerImage {
    /// Harness slug this image provides the CLI for.
    pub harness: String,
    /// The full, pullable image reference (a registry-qualified digest ref). This
    /// is what the runner pulls and records as `RunEnvironment.containerImage`.
    pub reference: String,
}

/// A reference view resolved to its backend-rendered screenshot bytes. The runner
/// seeds these as visual targets and uses them as validation baselines; it never
/// receives the mockup HTML (rendering happens on backend ingest).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedReference {
    /// The view slug this screenshot corresponds to.
    pub view: String,
    /// The rendered PNG bytes.
    pub png_bytes: Vec<u8>,
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

    /// Resolve a harness container image: the full, pullable digest reference the
    /// runner pulls. (`GET /containers/{harness}`)
    async fn resolve_container(&self, harness: &str) -> Result<ContainerImage>;

    /// Submit a published run: record + review + resolved links. (`POST /runs`)
    /// Idempotent on `record.id`.
    async fn publish_run(
        &self,
        record: &RunRecord,
        review: &Writeup,
        links: &RunLinks,
    ) -> Result<PublishAck>;
}

/// Materialize a backend-resolved version onto disk so the existing seeder,
/// prompt renderer, and validator — all of which read host paths — work
/// unchanged against a remote definition.
///
/// Writes the prompt template, every spec source, every asset, and the
/// backend-rendered reference screenshots under `store_dir`, then returns a
/// [`TestCaseVersion`] whose path fields point inside `store_dir`, together with
/// the [`RenderedReference`]s for `variant` (the common references plus that
/// variant's own). Pair the returned references with a
/// [`PrerenderedReferenceRenderer`] so [`crate::Orchestrator::run`] reuses them
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
    for key in sources.iter().chain(assets.iter()) {
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
    let pngs = client.references(slug, version, variant).await?;
    let mut rendered = Vec::with_capacity(pngs.len());
    for png in &pngs {
        let scope = if common.contains(&png.view) {
            "_common".to_string()
        } else {
            variant.to_string()
        };
        let image_path = root
            .join("references")
            .join(&scope)
            .join(format!("{}.png", png.view));
        write_at(&image_path, &png.png_bytes)?;
        rendered.push(RenderedReference {
            view: png.view.clone(),
            image_path,
        });
    }

    // Rewrite path fields from store-relative keys to materialized host paths.
    resolved.root = root.clone();
    resolved.prompt_path = prompt_path;
    for spec in &mut resolved.common_specs {
        spec.source_path = root.join(&spec.source_path);
    }
    resolved.asset_paths = resolved.asset_paths.iter().map(|a| root.join(a)).collect();
    for variant in &mut resolved.variants {
        for spec in &mut variant.specs {
            spec.source_path = root.join(&spec.source_path);
        }
        // Point each reference view at its materialized PNG (scope = variant).
        for reference in &mut variant.references {
            reference.source_path = root
                .join("references")
                .join(&variant.slug)
                .join(format!("{}.png", reference.view));
        }
    }
    for reference in &mut resolved.common_references {
        reference.source_path = root
            .join("references")
            .join("_common")
            .join(format!("{}.png", reference.view));
    }

    Ok((resolved, rendered))
}

/// A [`crate::ReferenceRenderer`] that returns references already rendered by the
/// backend, rather than rendering mockup HTML the runner never receives.
///
/// Pair it with [`materialize_version`]'s returned references so
/// [`crate::Orchestrator::run`] — which calls `render_references` — reuses the
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
        // simply absent, which `Orchestrator::run` then reports as incomplete.
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
    async fn get_json<T: for<'de> Deserialize<'de>>(&self, path: &str) -> Result<T> {
        let url = self.url(path);
        let response = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|err| backend_err(&url, err))?;
        let response = error_for_status(&url, response).await?;
        response
            .json::<T>()
            .await
            .map_err(|err| backend_err(&url, err))
    }

    /// GET `path` and return the raw response bytes.
    async fn get_bytes(&self, path: &str) -> Result<Vec<u8>> {
        let url = self.url(path);
        let response = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|err| backend_err(&url, err))?;
        let response = error_for_status(&url, response).await?;
        Ok(response
            .bytes()
            .await
            .map_err(|err| backend_err(&url, err))?
            .to_vec())
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
        // The resolved version tells us which views exist and under which scope
        // (`_common` or the variant's slug); fetch the PNG for each.
        let resolved = self.resolve_version(slug, version).await?;
        let variant_def = resolved.variant(variant)?;
        let mut out = Vec::new();
        for reference in &resolved.common_references {
            out.push(
                self.fetch_reference(slug, version, "_common", &reference.view)
                    .await?,
            );
        }
        for reference in &variant_def.references {
            out.push(
                self.fetch_reference(slug, version, variant, &reference.view)
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

    async fn resolve_container(&self, harness: &str) -> Result<ContainerImage> {
        let body: ContainerBody = self
            .get_json(&format!("/containers/{}", encode(harness)))
            .await?;
        Ok(ContainerImage {
            harness: body.harness,
            reference: body.reference,
        })
    }

    async fn publish_run(
        &self,
        record: &RunRecord,
        review: &Writeup,
        links: &RunLinks,
    ) -> Result<PublishAck> {
        let url = self.url("/runs");
        let body = PublishBody {
            record,
            review: ReviewBody {
                rating: review.rating.as_str(),
                writeup: &review.body,
                checklist: &review.checklist,
            },
            links: LinksBody {
                source_repo: links.source_repo.clone(),
                playable_build: links.playable_build.clone(),
            },
        };
        let response = self
            .http
            .post(&url)
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
}

impl HttpBackendClient {
    /// Fetch one rendered reference screenshot under `scope` (`_common` or a
    /// variant slug).
    async fn fetch_reference(
        &self,
        slug: &str,
        version: &str,
        scope: &str,
        view: &str,
    ) -> Result<ResolvedReference> {
        let bytes = self
            .get_bytes(&format!(
                "/test-cases/{}/versions/{}/references/{}/{}.png",
                encode(slug),
                encode(version),
                encode(scope),
                encode(view),
            ))
            .await?;
        Ok(ResolvedReference {
            view: view.to_string(),
            png_bytes: bytes,
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
    build: BuildBody,
    prompt_template: String,
    common_specs: Vec<SpecBody>,
    assets: Vec<AssetBody>,
    variants: Vec<VariantBody>,
    common_references: Vec<ReferenceBody>,
    checks: Vec<CheckBody>,
    #[serde(default)]
    common_review_items: Vec<ReviewItemBody>,
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
            build: BuildCommands {
                install: self.build.install,
                build: self.build.build,
            },
            common_specs: self.common_specs.iter().map(spec_from).collect(),
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
                    references: variant.references.iter().map(reference_from).collect(),
                    review_items: variant
                        .review_items
                        .into_iter()
                        .map(review_item_from)
                        .collect(),
                })
                .collect(),
            common_references: self.common_references.iter().map(reference_from).collect(),
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

/// Build a [`ReferenceView`] from a wire reference, keying `source_path` by the
/// rendered screenshot URL path (rewritten to a host path by
/// [`materialize_version`]).
/// Build a [`ReviewItem`] from a wire review item. Reviewer checklist items are
/// reporter-side material, so they carry no path to rewrite.
fn review_item_from(item: ReviewItemBody) -> ReviewItem {
    ReviewItem {
        id: item.id,
        text: item.text,
    }
}

fn reference_from(reference: &ReferenceBody) -> ReferenceView {
    ReferenceView {
        view: reference.view.clone(),
        source_path: PathBuf::from(&reference.screenshot_url),
    }
}

#[derive(Deserialize)]
struct BuildBody {
    install: String,
    build: String,
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
    references: Vec<ReferenceBody>,
    #[serde(default)]
    review_items: Vec<ReviewItemBody>,
}

#[derive(Deserialize)]
struct ReviewItemBody {
    id: String,
    text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReferenceBody {
    view: String,
    screenshot_url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CheckBody {
    view: String,
    name: String,
    reference_view: String,
    actions: Vec<CheckAction>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContainerBody {
    harness: String,
    reference: String,
}

#[derive(serde::Serialize)]
struct PublishBody<'a> {
    record: &'a RunRecord,
    review: ReviewBody<'a>,
    links: LinksBody,
}

#[derive(serde::Serialize)]
struct ReviewBody<'a> {
    rating: &'a str,
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
