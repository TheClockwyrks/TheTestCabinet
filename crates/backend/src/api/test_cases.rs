//! Test-case catalog, version resolution, artifacts, and reference handlers
//! (§1.2 of `design/v0.2.0-contracts.md`).

#[cfg(test)]
#[path = "test_cases.test.rs"]
mod tests;

use axum::Json;
use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use test_cabinet_core::test_case::{AudioSpec, MaterialSpec, ParticleSpec, UiSpec};
use test_cabinet_core::{
    AssetKind, ModelSpec, SheetSpec, SpecKind, TestType, VoxelSpec, shippable_package_description,
};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::auth::AuthUser;
use crate::error::ApiError;
use crate::store::{
    StoredContract, StoredManifest, StoredMatch, StoredReplay, StoredSandbox, StoredSimulation,
};

use super::AppState;

/// `GET /test-cases` — the catalog of ingested cases and their versions.
///
/// Experimental versions are omitted unless the deployment has opted in via
/// `TCAB_BACKEND_ALLOW_EXPERIMENTAL` (see [`crate::config::Config::allow_experimental`]),
/// so an experimental case a deployment has not enabled is not offered to the UI.
pub async fn catalog(State(state): State<AppState>) -> Result<Json<CatalogResponse>, ApiError> {
    let cases = state
        .store
        .list_visible_cases(state.config.allow_experimental)
        .map_err(ApiError::from)?
        .into_iter()
        .map(|(slug, versions)| CatalogCase { slug, versions })
        .collect();
    Ok(Json(CatalogResponse { test_cases: cases }))
}

/// `GET /test-cases/{slug}/versions` — versions for one case.
pub async fn versions(
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<VersionsResponse>, ApiError> {
    // Hide experimental versions unless the deployment opted in; a case whose only
    // versions are experimental then reports none and 404s, exactly as if it were
    // never ingested.
    let versions = state
        .store
        .list_visible_versions(&slug, state.config.allow_experimental)
        .map_err(ApiError::from)?;
    if versions.is_empty() {
        return Err(ApiError::not_found(format!("test case `{slug}` not found")));
    }
    Ok(Json(VersionsResponse { slug, versions }))
}

/// `GET /test-cases/{slug}/versions/{version}` — the full resolved manifest a
/// runner needs, with store-relative keys and references resolved to rendered
/// screenshot URLs.
pub async fn resolve_version(
    State(state): State<AppState>,
    Path((slug, version)): Path<(String, String)>,
) -> Result<Json<VersionResponse>, ApiError> {
    let manifest = state
        .store
        .read_manifest(&slug, &version)
        .map_err(ApiError::from)?;
    // An experimental version is treated as if it does not exist unless the
    // deployment opted in, so it cannot be resolved (and therefore cannot be run)
    // even by a client that guessed its slug and version.
    if manifest.experimental && !state.config.allow_experimental {
        return Err(ApiError::not_found(format!(
            "test-case version `{slug}@{version}` is not ingested"
        )));
    }
    // The reference-implementation URLs (variant → served build) are stored
    // out-of-band — written by `tcab publish-reference`, never at ingest — so they
    // live in the database, not the resolved manifest. Fold them onto each variant
    // so the console's "Reference" tab can embed the correct build. A variant with
    // no deployed reference simply resolves to `None`.
    let reference_builds = state
        .db
        .reference_builds_for_version(&slug, &version)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(version_response(&manifest, &reference_builds)?))
}

/// `PUT /test-cases/{slug}/versions/{version}/reference-builds/{variant}` — record
/// the deployed URL of a variant's authored reference implementation. Requires a
/// bearer token (the same guard the ingest/publish write paths use), because it
/// mutates the served catalog.
///
/// This is the out-of-band write half of the reference-implementation feature: the
/// `tcab publish-reference` CLI builds and deploys the variant's static site
/// (Cloudflare Pages), reads the served URL back, and PUTs it here. The backend
/// never builds or deploys anything — it only remembers the URL and surfaces it on
/// the version response and the public snapshot. The upsert is idempotent on
/// `(slug, version, variant)`, so a re-deploy replaces the URL in place.
#[tracing::instrument(
    name = "test_cases.put_reference_build",
    skip(state, _user, body),
    fields(slug = %slug, version = %version, variant = %variant),
    err(Debug),
)]
pub async fn put_reference_build(
    State(state): State<AppState>,
    Path((slug, version, variant)): Path<(String, String, String)>,
    _user: AuthUser,
    Json(body): Json<ReferenceBuildBody>,
) -> Result<StatusCode, ApiError> {
    let url = body.url.trim();
    if url.is_empty() {
        return Err(ApiError::unprocessable(
            "referenceBuild.url must be non-empty",
        ));
    }
    let now = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|e| ApiError::internal(format!("formatting timestamp: {e}")))?;
    state
        .db
        .upsert_reference_build(&slug, &version, &variant, url, &now)
        .await
        .map_err(ApiError::from)?;
    // The public snapshot folds each variant's reference-build URL onto its case
    // metadata, so a newly-recorded (or re-deployed) URL must be re-exported.
    state.publisher.queue_refresh();
    Ok(StatusCode::OK)
}

/// `GET /test-cases/{slug}/versions/{version}/artifacts/{path...}` — one seeded
/// spec/asset file by its store-relative `source` key, raw bytes.
pub async fn artifact(
    State(state): State<AppState>,
    Path((slug, version, path)): Path<(String, String, String)>,
) -> Result<Response, ApiError> {
    let bytes = state
        .store
        .read_artifact(&slug, &version, &path)
        .map_err(ApiError::from)?;
    Ok(bytes_response(&path, bytes))
}

/// `GET /test-cases/{slug}/versions/{version}/references/{scope}/{file}` — a
/// reference's served media (`{file}` is `<view>.<ext>`: a rendered `.png`, or a
/// static image/video served as-is). The content type follows the extension.
pub async fn reference(
    State(state): State<AppState>,
    Path((slug, version, scope, file)): Path<(String, String, String, String)>,
) -> Result<Response, ApiError> {
    let bytes = state
        .store
        .read_reference(&slug, &version, &scope, &file)
        .map_err(ApiError::from)?;
    Ok(bytes_response(&file, bytes))
}

/// `GET /runs/{id}/proof/{file}` — a published run's proof media (`{file}` is
/// `<proof-id>.<ext>`). The content type follows the extension.
pub async fn run_proof(
    State(state): State<AppState>,
    Path((id, file)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    let bytes = state
        .store
        .read_run_proof(&id, &file)
        .map_err(ApiError::from)?;
    Ok(bytes_response(&file, bytes))
}

/// `POST /runs/{id}/proof/{file}` — store a published run's proof media, uploaded
/// by the publisher alongside the run record. The raw request body is the bytes.
pub async fn put_run_proof(
    State(state): State<AppState>,
    Path((id, file)): Path<(String, String)>,
    body: axum::body::Bytes,
) -> Result<Response, ApiError> {
    state
        .store
        .write_run_proof(&id, &file, &body)
        .map_err(ApiError::from)?;
    Ok((StatusCode::NO_CONTENT, ()).into_response())
}

/// `GET /runs/{id}/asset/{file}` — a published asset-generation run's media
/// (`{file}` is `regenerated.png`, `preview.png`, `target.png`, or
/// `actions.json`). The content type follows the extension.
pub async fn run_asset(
    State(state): State<AppState>,
    Path((id, file)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    let bytes = state
        .store
        .read_run_asset(&id, &file)
        .map_err(ApiError::from)?;
    Ok(bytes_response(&file, bytes))
}

/// `POST /runs/{id}/asset/{file}` — store a published asset-generation run's
/// media, uploaded by the publisher alongside the run record.
pub async fn put_run_asset(
    State(state): State<AppState>,
    Path((id, file)): Path<(String, String)>,
    body: axum::body::Bytes,
) -> Result<Response, ApiError> {
    state
        .store
        .write_run_asset(&id, &file, &body)
        .map_err(ApiError::from)?;
    Ok((StatusCode::NO_CONTENT, ()).into_response())
}

/// `GET /runs/{id}/controller.wasm` — an adversarial run's pushed controller wasm,
/// served so the arena can resolve and pit a pushed implementation from any host.
pub async fn run_controller(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    let bytes = state
        .store
        .read_run_controller(&id)
        .map_err(ApiError::from)?;
    Ok(bytes_response("controller.wasm", bytes))
}

/// `POST /runs/{id}/controller.wasm` — store an adversarial run's controller wasm,
/// uploaded by the publisher at push alongside the run record.
pub async fn put_run_controller(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: axum::body::Bytes,
) -> Result<Response, ApiError> {
    state
        .store
        .write_run_controller(&id, &body)
        .map_err(ApiError::from)?;
    Ok((StatusCode::NO_CONTENT, ()).into_response())
}

/// Map a [`StoredManifest`] to the §1.2 wire response, building reference
/// screenshot URLs from the version's store layout and rendering each variant's
/// prompt the way a real run receives it.
fn version_response(
    manifest: &StoredManifest,
    reference_builds: &std::collections::HashMap<String, String>,
) -> Result<VersionResponse, ApiError> {
    let reference_out = |scope: &str, r: &crate::store::StoredReference| ReferenceOut {
        view: r.view.clone(),
        kind: r.kind,
        media_url: format!(
            "/test-cases/{}/versions/{}/references/{scope}/{}.{}",
            manifest.slug, manifest.version, r.view, r.extension
        ),
    };

    let variants = manifest
        .variants
        .iter()
        .map(|v| {
            Ok(VariantOut {
                slug: v.slug.clone(),
                name: v.name.clone(),
                description: v.description.clone(),
                prompt: render_variant_prompt(manifest, v)?,
                specs: v.specs.iter().map(spec_out).collect(),
                workspace: v
                    .workspace
                    .as_ref()
                    .map(|files| files.iter().map(workspace_out).collect()),
                references: v
                    .references
                    .iter()
                    .map(|r| reference_out(&v.slug, r))
                    .collect(),
                proofs: v.proofs.iter().map(proof_out).collect(),
                review_items: v.review_items.iter().map(review_item_out).collect(),
                domains: v.domains.iter().map(domain_out).collect(),
                voxel: v.voxel.clone(),
                reference_build: reference_builds.get(&v.slug).cloned(),
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    Ok(VersionResponse {
        slug: manifest.slug.clone(),
        version: manifest.version.clone(),
        name: manifest.name.clone(),
        difficulty: manifest.difficulty.clone(),
        tags: manifest.tags.clone(),
        summary: manifest.summary.clone(),
        description: manifest.description.clone(),
        changelog: manifest.changelog.clone(),
        max_runtime_seconds: manifest.max_runtime_seconds,
        test_type: manifest.test_type,
        build: manifest.build.as_ref().map(|build| BuildOut {
            install: build.install.clone(),
            build: build.build.clone(),
            module: build.module.clone(),
        }),
        canvas: manifest.canvas.as_ref().map(|canvas| CanvasOut {
            width: canvas.width,
            height: canvas.height,
            background: canvas.background.clone(),
        }),
        tool: manifest.tool.as_ref().map(|tool| ToolOut {
            binary: tool.binary.clone(),
            preview: tool.preview.clone(),
        }),
        output: manifest.output.as_ref().map(|output| OutputOut {
            actions: output.actions.clone(),
        }),
        contract: manifest.contract.clone(),
        sandbox: manifest.sandbox,
        simulation: manifest.simulation,
        r#match: manifest.r#match.clone(),
        replay: manifest.replay.clone(),
        asset_kind: manifest.asset_kind,
        sheet: manifest.sheet.clone(),
        voxel: manifest.voxel.clone(),
        model: manifest.model.clone(),
        ui: manifest.ui.clone(),
        material: manifest.material.clone(),
        particle: manifest.particle.clone(),
        audio: manifest.audio.clone(),
        prompt_template: manifest.prompt_template.clone(),
        common_specs: manifest.common_specs.iter().map(spec_out).collect(),
        packages: manifest
            .packages
            .iter()
            .map(|name| package_out(name))
            .collect(),
        workspace: manifest.workspace.iter().map(workspace_out).collect(),
        init: manifest.init.clone(),
        assets: manifest
            .assets
            .iter()
            .map(|a| AssetOut {
                source: a.source.clone(),
                dest: a.dest.clone(),
            })
            .collect(),
        variants,
        common_references: manifest
            .common_references
            .iter()
            .map(|r| reference_out("_common", r))
            .collect(),
        common_proofs: manifest.common_proofs.iter().map(proof_out).collect(),
        checks: manifest
            .checks
            .iter()
            .map(|c| CheckOut {
                view: c.view.clone(),
                name: c.name.clone(),
                reference_view: c.reference_view.clone(),
                actions: c.actions.clone(),
            })
            .collect(),
        common_review_items: manifest
            .common_review_items
            .iter()
            .map(review_item_out)
            .collect(),
        domains: manifest.domains.iter().map(domain_out).collect(),
    })
}

/// Render a variant's prompt the way a real run receives it: the version's
/// `prompt.hbs` template rendered against the variant and its seeded specs (the
/// common specs followed by the variant's own, matching seed order). The
/// in-container workspace path is the engine's fixed default, so this preview is
/// identical to the run-time instruction. A template error is exceptional (the
/// same template renders at run time), so surface it as an internal error rather
/// than silently dropping the prompt.
fn render_variant_prompt(
    manifest: &StoredManifest,
    variant: &crate::store::StoredVariant,
) -> Result<String, ApiError> {
    let spec_dests: Vec<String> = manifest
        .common_specs
        .iter()
        .chain(variant.specs.iter())
        .map(|spec| spec.dest.clone())
        .collect();
    test_cabinet_core::render_prompt_from_template(
        &manifest.slug,
        &manifest.version,
        &manifest.prompt_template,
        &variant.slug,
        &variant.name,
        variant.description.as_deref(),
        &spec_dests,
        manifest.test_type,
        // The variant's own volume overrides the case's for its prompt, so the
        // gallery renders each size variant's brief at its actual dimensions.
        variant.voxel.as_ref().or(manifest.voxel.as_ref()),
    )
    .map_err(|err| ApiError::internal(err.to_string()))
}

/// Map a stored reviewer checklist item to its wire shape, carrying the optional
/// reference/proof pairings the reviewer UI resolves.
fn review_item_out(item: &crate::store::StoredReviewItem) -> ReviewItemOut {
    ReviewItemOut {
        id: item.id.clone(),
        title: item.title.clone(),
        text: item.text.clone(),
        reference: item.reference.clone(),
        proof: item.proof.clone(),
        weight: item.weight,
        domain: item.domain.clone(),
        sub_items: item
            .sub_items
            .iter()
            .map(|sub| SubReviewItemOut {
                id: sub.id.clone(),
                title: sub.title.clone(),
            })
            .collect(),
    }
}

/// Map a stored scoring domain to its wire shape.
fn domain_out(domain: &crate::store::StoredDomain) -> DomainOut {
    DomainOut {
        id: domain.id.clone(),
        name: domain.name.clone(),
        description: domain.description.clone(),
    }
}

/// Map a stored proof declaration to its wire shape.
fn proof_out(proof: &crate::store::StoredProof) -> ProofOut {
    ProofOut {
        id: proof.id.clone(),
        name: proof.name.clone(),
        kind: proof.kind,
        dest: proof.dest.clone(),
    }
}

/// Map a stored spec to the wire `{source, dest, template}` shape.
fn spec_out(spec: &crate::store::StoredSpec) -> SpecOut {
    SpecOut {
        source: spec.source.clone(),
        dest: spec.dest.clone(),
        template: spec.template,
        kind: spec.kind,
    }
}

/// Map a case's declared package name to the wire `{name, description}` shape,
/// looking the UI-only description up from core's shippable registry. A name with
/// no registry entry (a store ingested against a newer core) falls back to an
/// empty description rather than dropping the package.
fn package_out(name: &str) -> PackageOut {
    PackageOut {
        name: name.to_string(),
        description: shippable_package_description(name)
            .unwrap_or_default()
            .to_string(),
    }
}

/// Map a stored workspace file to the wire `{source, dest}` shape.
fn workspace_out(file: &crate::store::StoredWorkspaceFile) -> WorkspaceOut {
    WorkspaceOut {
        source: file.source.clone(),
        dest: file.dest.clone(),
    }
}

/// Build a raw-bytes response with a best-effort content type and length.
fn bytes_response(path: &str, bytes: Vec<u8>) -> Response {
    let content_type = content_type_for(path);
    let len = bytes.len();
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, content_type.to_string()),
            (header::CONTENT_LENGTH, len.to_string()),
        ],
        Body::from(bytes),
    )
        .into_response()
}

/// A best-effort content type from a path's extension.
fn content_type_for(path: &str) -> &'static str {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    match ext.to_ascii_lowercase().as_str() {
        "md" | "txt" => "text/plain; charset=utf-8",
        "hbs" => "text/plain; charset=utf-8",
        "html" => "text/html; charset=utf-8",
        "json" => "application/json",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "mp4" => "video/mp4",
        "svg" => "image/svg+xml",
        "css" => "text/css",
        "js" | "mjs" => "text/javascript",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

// --- Wire shapes (§1.2) -----------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CatalogResponse {
    pub test_cases: Vec<CatalogCase>,
}

#[derive(Serialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CatalogCase {
    pub slug: String,
    pub versions: Vec<String>,
}

#[derive(Serialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct VersionsResponse {
    pub slug: String,
    pub versions: Vec<String>,
}

/// The resolved, fully-rendered definition of one test-case version: the body of
/// `GET /test-cases/{slug}/{version}`. Everything a reporter needs to present the
/// case — its metadata, the per-test-type contract/sandbox shapes, the rendered
/// prompt and seeded specs, and every variant, reference, proof, check, and
/// reviewer item — resolved as a real run receives them.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct VersionResponse {
    slug: String,
    version: String,
    name: String,
    difficulty: String,
    tags: Vec<String>,
    summary: Option<String>,
    description: Option<String>,
    /// The version's own changelog entry (its `changelog.md` body), inlined.
    /// Always present — a changelog is required on every version. The console
    /// aggregates every version's entry into the case's changelog tab.
    changelog: String,
    max_runtime_seconds: u64,
    test_type: TestType,
    #[serde(skip_serializing_if = "Option::is_none")]
    build: Option<BuildOut>,
    #[serde(skip_serializing_if = "Option::is_none")]
    canvas: Option<CanvasOut>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool: Option<ToolOut>,
    #[serde(skip_serializing_if = "Option::is_none")]
    output: Option<OutputOut>,
    #[serde(skip_serializing_if = "Option::is_none")]
    contract: Option<StoredContract>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sandbox: Option<StoredSandbox>,
    #[serde(skip_serializing_if = "Option::is_none")]
    simulation: Option<StoredSimulation>,
    #[serde(rename = "match", skip_serializing_if = "Option::is_none")]
    r#match: Option<StoredMatch>,
    #[serde(skip_serializing_if = "Option::is_none")]
    replay: Option<StoredReplay>,
    asset_kind: AssetKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    sheet: Option<SheetSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    voxel: Option<VoxelSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<ModelSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ui: Option<UiSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    material: Option<MaterialSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    particle: Option<ParticleSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    audio: Option<AudioSpec>,
    prompt_template: String,
    common_specs: Vec<SpecOut>,
    /// The Test Cabinet runtime packages this case ships into every run, each with
    /// a UI-only description. Shown on the console's Inputs tab; empty for a case
    /// that declares none.
    packages: Vec<PackageOut>,
    workspace: Vec<WorkspaceOut>,
    init: Option<String>,
    assets: Vec<AssetOut>,
    variants: Vec<VariantOut>,
    common_references: Vec<ReferenceOut>,
    common_proofs: Vec<ProofOut>,
    checks: Vec<CheckOut>,
    common_review_items: Vec<ReviewItemOut>,
    domains: Vec<DomainOut>,
}

#[derive(Serialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
struct BuildOut {
    install: String,
    build: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    module: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
struct CanvasOut {
    width: u32,
    height: u32,
    background: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
struct ToolOut {
    binary: String,
    preview: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
struct OutputOut {
    actions: String,
}

#[derive(Serialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
struct SpecOut {
    source: String,
    dest: String,
    template: bool,
    /// The seeded file's role (`spec`/`script`), so the console's Inputs tab can
    /// tag it. Presentation only.
    kind: SpecKind,
}

/// A runtime package a case ships into its runs, exposed for the console's Inputs
/// tab: its npm name and the UI-only description of what it provides (never seeded
/// into a run).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
struct PackageOut {
    name: String,
    description: String,
}

#[derive(Serialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
struct AssetOut {
    source: String,
    dest: String,
}

#[derive(Serialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
struct WorkspaceOut {
    source: String,
    dest: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
struct VariantOut {
    slug: String,
    name: String,
    description: Option<String>,
    /// The variant's prompt, rendered as a real run receives it.
    prompt: String,
    specs: Vec<SpecOut>,
    workspace: Option<Vec<WorkspaceOut>>,
    references: Vec<ReferenceOut>,
    proofs: Vec<ProofOut>,
    review_items: Vec<ReviewItemOut>,
    /// The variant's own scoring domains, on top of the case's common
    /// [`VersionResponse::domains`]. Rated only when this variant is selected.
    domains: Vec<DomainOut>,
    /// The variant's bounding-volume override, when it declares its own `[voxel]`
    /// (the size axis behind a case's half/base/double variants). `None` inherits
    /// the case's common [`VersionResponse::voxel`].
    voxel: Option<VoxelSpec>,
    /// The absolute URL of this variant's authored **reference implementation** — the
    /// correct, deployed static build (the case-variant analogue of a run's
    /// `playableBuild`), served on the console's "Reference" tab. `None` when the
    /// variant declares no `reference_implementation`, or has one but it has not been
    /// deployed yet. Written out-of-band by `tcab publish-reference` and read from the
    /// `case_reference_build` table — never resolved from the manifest and never
    /// seeded into a run.
    reference_build: Option<String>,
}

/// The body of `PUT /test-cases/{slug}/versions/{version}/reference-builds/{variant}`:
/// the deployed URL of a variant's authored reference implementation, recorded by
/// `tcab publish-reference` after it builds and hosts the static site.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ReferenceBuildBody {
    /// The absolute (https) URL the reference build is served at. Cloudflare Pages
    /// truncates long branch subdomains, so the CLI reads the served URL back from
    /// `wrangler` output rather than constructing it, and PUTs the exact value here.
    pub url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
struct ReviewItemOut {
    id: String,
    title: String,
    text: String,
    reference: Option<String>,
    proof: Option<String>,
    weight: u32,
    domain: Option<String>,
    /// Name-only sub-items the reviewer grades this item by, each an
    /// independently scored pass/fail point. Empty for an item graded as a whole.
    sub_items: Vec<SubReviewItemOut>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
struct SubReviewItemOut {
    id: String,
    title: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
struct DomainOut {
    id: String,
    name: String,
    description: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
struct ReferenceOut {
    view: String,
    /// How the reference is produced (`rendered`, `image`, or `video`).
    kind: test_cabinet_core::ReferenceKind,
    /// The URL path the reference media is served under.
    media_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
struct ProofOut {
    id: String,
    name: String,
    kind: test_cabinet_core::MediaKind,
    dest: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
struct CheckOut {
    view: String,
    name: String,
    reference_view: String,
    actions: Vec<test_cabinet_core::test_case::CheckAction>,
}
