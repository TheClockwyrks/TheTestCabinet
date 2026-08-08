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
use serde::Serialize;
use test_cabinet_core::test_case::{
    AudioSpec, ErratumSeverity, MaterialSpec, ParticleSpec, UiSpec,
};
use test_cabinet_core::{
    AssetKind, ModelSpec, SheetSpec, SpecKind, TestType, VoxelSpec, shippable_package_description,
};

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
    // The asset-generation counterpart: which frames of each variant's reference the
    // public snapshot bucket holds. Stored out-of-band too — discovered by listing the
    // bucket at ingest, never resolved from the manifest — so it is read from the
    // database alongside the build URLs. A variant with no published reference
    // resolves to `None`.
    let reference_sheets = state
        .db
        .reference_sheets_for_version(&slug, &version)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(version_response(
        &manifest,
        &reference_builds,
        &reference_sheets,
    )?))
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

/// `GET /test-cases/{slug}/versions/{version}/specs/{variant}` — the variant's
/// full seeded spec set with every body rendered for that variant, in seed
/// order (the common specs first, then the variant's own).
///
/// This is the spec analogue of the rendered variant prompt on [`resolve_version`]:
/// a `template` spec's `{{#if (eq variant.slug …)}}` branches are resolved here, on
/// the backend, so the console's Inputs tab shows handlebars-free text — the same
/// file the harness receives — rather than the raw template the per-key
/// [`artifact`] route serves. A plain spec is returned verbatim. A render error is
/// exceptional (the same template renders at run time), so it surfaces as an
/// internal error rather than silently dropping the spec.
pub async fn variant_specs(
    State(state): State<AppState>,
    Path((slug, version, variant)): Path<(String, String, String)>,
) -> Result<Json<SpecsResponse>, ApiError> {
    let manifest = state
        .store
        .read_manifest(&slug, &version)
        .map_err(ApiError::from)?;
    // Mirror `resolve_version`: an experimental version the deployment has not
    // opted into is treated as if it does not exist.
    if manifest.experimental && !state.config.allow_experimental {
        return Err(ApiError::not_found(format!(
            "test-case version `{slug}@{version}` is not ingested"
        )));
    }
    let selected = manifest
        .variants
        .iter()
        .find(|v| v.slug == variant)
        .ok_or_else(|| {
            ApiError::not_found(format!(
                "variant `{variant}` of `{slug}@{version}` not found"
            ))
        })?;
    // The variant's own volume overrides the case's, matching how the prompt and a
    // run's seed resolve `{{voxel}}` for this variant.
    let voxel = selected.voxel.as_ref().or(manifest.voxel.as_ref());
    // Seed order: the common specs first, then the variant's own — the order a run
    // is seeded and the prompt lists them.
    let specs = manifest
        .common_specs
        .iter()
        .chain(selected.specs.iter())
        .map(|spec| {
            let body = state.store.read_rendered_spec(
                &slug,
                &version,
                spec,
                &selected.slug,
                &selected.name,
                selected.description.as_deref(),
                voxel,
            )?;
            Ok(SpecDocumentOut {
                dest: spec.dest.clone(),
                body,
                kind: spec.kind,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;
    Ok(Json(SpecsResponse {
        slug: manifest.slug.clone(),
        version: manifest.version.clone(),
        variant: selected.slug.clone(),
        description: manifest.description.clone(),
        specs,
    }))
}

/// `GET /test-cases/{slug}/versions/{version}/validation-files` — the store-relative
/// keys of every file under the version's reporter-side automated-validation script
/// directory (`validation/`), as a JSON string array. A backend-driven run fetches this
/// whole set into its definition store so a debug script's shared `import`s (for example
/// `validation/_helpers.mjs`) resolve when the validator runs it; the named scripts alone
/// are not enough. Reporter-side — these are never seeded into the model's run container.
pub async fn validation_files(
    State(state): State<AppState>,
    Path((slug, version)): Path<(String, String)>,
) -> Result<Json<Vec<String>>, ApiError> {
    let keys = state
        .store
        .list_validation_files(&slug, &version)
        .map_err(ApiError::from)?;
    Ok(Json(keys))
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

/// `GET /test-cases/{slug}/versions/{version}/validation-baseline/{variant}/{file}`
/// — a case variant's committed **baseline** validation media (`{file}` is the flat
/// `<item>__<output>.<ext>`). This is the invariant counterpart to a run's *actual*
/// validation media (served run-scoped by the artifact service): synthesized once at
/// `tcab publish-reference` time from the reference implementation and committed under
/// the version folder, so the reviewer UI resolves it case-scoped (by
/// slug/version/variant/item/output), not from any run tree. The content type follows
/// the extension.
pub async fn validation_baseline(
    State(state): State<AppState>,
    Path((slug, version, variant, file)): Path<(String, String, String, String)>,
) -> Result<Response, ApiError> {
    let bytes = state
        .store
        .read_validation_baseline(&slug, &version, &variant, &file)
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

/// `GET /runs/{id}/validation/{file}` — a published run's synthesized *actual*
/// validation media (`{file}` is the flat `<item>__<output>.<ext>`), mirrored into the
/// backend store by the driver so it reaches the public snapshot (the run-scoped
/// counterpart to the case-scoped [`validation_baseline`]). The content type follows
/// the extension.
pub async fn run_validation(
    State(state): State<AppState>,
    Path((id, file)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    let bytes = state
        .store
        .read_run_validation(&id, &file)
        .map_err(ApiError::from)?;
    Ok(bytes_response(&file, bytes))
}

/// `POST /runs/{id}/validation/{file}` — store a published run's synthesized *actual*
/// validation media, uploaded by the publisher alongside the run record.
pub async fn put_run_validation(
    State(state): State<AppState>,
    Path((id, file)): Path<(String, String)>,
    body: axum::body::Bytes,
) -> Result<Response, ApiError> {
    state
        .store
        .write_run_validation(&id, &file, &body)
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
    reference_sheets: &std::collections::HashMap<String, Vec<u32>>,
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
                reference_sheet: reference_sheets
                    .get(&v.slug)
                    .map(|frames| ReferenceSheetOut {
                        frames: frames.clone(),
                    }),
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
        cases: manifest
            .cases
            .iter()
            .map(|c| CaseOut {
                input: c.input.clone(),
                expected: c.expected.clone(),
                fuel_ceiling: c.fuel_ceiling,
                kind: c.kind,
            })
            .collect(),
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
        instrumentation: manifest.instrumentation.as_ref().map(|instrumentation| {
            InstrumentationOut {
                handle: instrumentation.handle.clone(),
                tick_hz: instrumentation.tick_hz,
            }
        }),
        errata: manifest.errata.iter().map(erratum_out).collect(),
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
        manifest.max_runtime_seconds,
        // The variant's own volume overrides the case's for its prompt, so the
        // gallery renders each size variant's brief at its actual dimensions.
        variant.voxel.as_ref().or(manifest.voxel.as_ref()),
        // The gallery preview shows the standing prompt, with no prior game-jam
        // entries in play, so it never carries the distinctness section.
        0,
    )
    .map_err(|err| ApiError::internal(err.to_string()))
}

/// Map a stored reviewer checklist item to its wire shape, carrying the optional
/// reference/proof pairings the reviewer UI resolves and, for an auto-validated item,
/// its reporter-side validation driver (debug script key + declared outputs) so the
/// driver's validator can locate and run it against the build's debug API.
fn review_item_out(item: &crate::store::StoredReviewItem) -> ReviewItemOut {
    ReviewItemOut {
        id: item.id.clone(),
        title: item.title.clone(),
        text: item.text.clone(),
        reference: item.reference.clone(),
        proof: item.proof.clone(),
        weight: item.weight,
        graded: item.graded,
        domain: item.domain.clone(),
        sub_items: item
            .sub_items
            .iter()
            .map(|sub| SubReviewItemOut {
                id: sub.id.clone(),
                title: sub.title.clone(),
                description: sub.description.clone(),
                weight: sub.weight,
                reference: sub.reference.clone(),
                proof: sub.proof.clone(),
                validation: sub.validation.as_ref().map(review_validation_out),
            })
            .collect(),
        validation: item.validation.as_ref().map(review_validation_out),
    }
}

/// Map a stored automated-validation driver to its wire shape. Shared by the item-level
/// and per-sub-item drivers.
fn review_validation_out(validation: &crate::store::StoredReviewValidation) -> ReviewValidationOut {
    ReviewValidationOut {
        script: validation.script.clone(),
        outputs: validation
            .outputs
            .iter()
            .map(|output| ReviewOutputOut {
                id: output.id.clone(),
                name: output.name.clone(),
                kind: output.kind,
            })
            .collect(),
    }
}

/// Map a stored known-issue erratum to its wire shape.
fn erratum_out(erratum: &crate::store::StoredErratum) -> ErratumOut {
    ErratumOut {
        id: erratum.id.clone(),
        title: erratum.title.clone(),
        date: erratum.date.clone(),
        severity: erratum.severity,
        affects_scoring: erratum.affects_scoring,
        exclude_from_score: erratum.exclude_from_score,
        body: erratum.body.clone(),
        resolved_in: erratum.resolved_in.clone(),
        variant: erratum.variant.clone(),
        review: erratum.review.clone(),
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
    /// A performance case's held-out scored set — each case's `input` scenario and
    /// `expected` oracle state, by store-relative key. Empty (and omitted) for
    /// every other type. The runner fetches these like assets and the performance
    /// validator scores the engine against them; they are never seeded into a run.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    cases: Vec<CaseOut>,
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
    /// The case's `[instrumentation]` debug-API handle, when it mandates one for
    /// automated validation. Reporter-side (never seeded into a run): served so the
    /// driver's validator knows which `window` handle to drive. Absent for a case with
    /// no auto-validated items.
    #[serde(skip_serializing_if = "Option::is_none")]
    instrumentation: Option<InstrumentationOut>,
    /// Known-issue errata recorded for this version after it shipped. Site-facing:
    /// shown on the case's Errata tab and, where relevant, to reviewers scoring a
    /// run of the version. Empty when the version has none.
    errata: Vec<ErratumOut>,
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

/// A variant's seeded spec set with every body rendered for that variant, the
/// response of [`variant_specs`]. Unlike [`SpecOut`] (a descriptor pointing at the
/// raw artifact key) this carries the finished, handlebars-free `body` the reader
/// shows.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct SpecsResponse {
    slug: String,
    version: String,
    variant: String,
    /// The version's site-facing description (never seeded), carried so the Inputs
    /// tab has the same context the resolved version does. `null` when none.
    description: Option<String>,
    specs: Vec<SpecDocumentOut>,
}

/// One seeded spec with its body already rendered for the selected variant.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
struct SpecDocumentOut {
    /// The run-workspace-relative path the spec seeds to (its `dest`).
    dest: String,
    /// The spec's body, rendered for this variant — a template spec's conditionals
    /// resolved, a plain spec verbatim.
    body: String,
    /// The seeded file's role (`spec`/`script`), for the Inputs-tab tag.
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

/// One held-out scored case of a performance case: the store-relative keys of the
/// `input` scenario fed to the engine and the `expected` oracle state its output
/// is checked against. Mirrors core's wire `CaseBody`, so a resolved version
/// round-trips its scored set through to the runner's [`materialize_version`].
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
struct CaseOut {
    input: String,
    expected: String,
    /// The case's resolved run ceiling (`fuel_limit * fuel_runway`), carried so the
    /// driver grades against the same ceiling the manifest declared.
    fuel_ceiling: u64,
    /// Which phase the case belongs to — a correctness pre-flight `smoke` test or a
    /// scored `stress` case — carried so the driver runs the smoke gate before the
    /// stress cases. Defaults to `stress` for versions ingested before smoke tests.
    #[serde(default)]
    kind: test_cabinet_core::validation::PerformanceCaseKind,
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
    /// This variant's published **reference sheet** — the asset-generation analogue of
    /// [`Self::reference_build`]. An asset case's reference is a `draw.sh` script, not
    /// a site, so what is recorded is which of its rendered frames were published to
    /// the public snapshot bucket. `None` when the variant declares no
    /// `reference_implementation`, or has one that has not been published yet.
    ///
    /// Written out-of-band by `tcab publish-reference` (which uploads the frames) and
    /// read from the `case_reference_sheet` table, which the backend reconciles by
    /// listing the bucket at ingest — never resolved from the manifest and never
    /// seeded into a run. Only the indices travel: each frame's URL is derivable from
    /// the case triple and its index (see `test_cabinet_core::asset_reference`), so
    /// the client builds them against the `snapshotUrl` from `GET /config`.
    reference_sheet: Option<ReferenceSheetOut>,
}

/// One variant's published reference frames.
///
/// A struct rather than a bare `Vec<u32>` because the frame indices are not the whole
/// story a reference sheet will want to tell — a sheet may later carry, say, the
/// canvas size or a published-at stamp — and a named object can grow those fields
/// without a breaking change to the wire shape.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
struct ReferenceSheetOut {
    /// The published frame indices, ascending. A single sprite (a case with no
    /// `[sheet]`) publishes exactly one frame, index `0`.
    frames: Vec<u32>,
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
    /// Whether the item is graded on the five-level scale (a game-jam category)
    /// rather than pass/fail. False for every other test type. The reviewer UI keys
    /// its editor control (emoji grade scale vs. pass/fail) off this flag.
    #[serde(default)]
    graded: bool,
    domain: Option<String>,
    /// Name-only sub-items the reviewer grades this item by, each an
    /// independently scored pass/fail point. Empty for an item graded as a whole.
    sub_items: Vec<SubReviewItemOut>,
    /// The item's automated-validation driver, when it opts into auto-validation:
    /// the reporter-side debug script (by its version-folder-relative key) and its
    /// declared media outputs. Served so the driver's validator can fetch, materialize,
    /// and run it against the build's debug API. Absent for a human-judged item.
    #[serde(skip_serializing_if = "Option::is_none")]
    validation: Option<ReviewValidationOut>,
}

/// The `[instrumentation]` handle in the §1.2 wire shape.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
struct InstrumentationOut {
    /// The `window` property name the debug API is installed on (no `window.` prefix).
    handle: String,
    /// The case's fixed simulation rate in whole ticks per second, when it declares
    /// one — what lets the validation runtime relate exact stepping to real time.
    /// Omitted for a real-time-clocked case.
    #[serde(skip_serializing_if = "Option::is_none")]
    tick_hz: Option<u32>,
}

/// A review item's automated-validation driver in the §1.2 wire shape: the
/// version-folder-relative debug `script` key the driver fetches (like an asset) and
/// its declared media `outputs`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
struct ReviewValidationOut {
    script: String,
    outputs: Vec<ReviewOutputOut>,
}

/// One media output of a [`ReviewValidationOut`] script in the §1.2 wire shape.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
struct ReviewOutputOut {
    id: String,
    name: String,
    kind: test_cabinet_core::MediaKind,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
struct SubReviewItemOut {
    id: String,
    title: String,
    /// Optional prose for this point (categories grammar); absent for a legacy
    /// name-only sub-item.
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    /// How many points this point is worth. A category's weight is the sum of its
    /// items' weights.
    weight: u32,
    /// Optional expected reference paired with this point.
    #[serde(skip_serializing_if = "Option::is_none")]
    reference: Option<String>,
    /// Optional submitted proof paired with this point.
    #[serde(skip_serializing_if = "Option::is_none")]
    proof: Option<String>,
    /// The sub-item's automated-validation driver, when it opts into auto-validation.
    /// Same shape as [`ReviewItemOut::validation`] but keyed to this sub-item's verdict.
    /// Absent for a human-judged sub-item.
    #[serde(skip_serializing_if = "Option::is_none")]
    validation: Option<ReviewValidationOut>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
struct DomainOut {
    id: String,
    name: String,
    description: String,
}

/// A known-issue erratum in the §1.2 wire shape (see
/// [`test_cabinet_core::test_case::Erratum`]).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
struct ErratumOut {
    id: String,
    title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    date: Option<String>,
    severity: ErratumSeverity,
    affects_scoring: bool,
    /// Whether the linked review point is excluded from scoring for the version.
    exclude_from_score: bool,
    body: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    resolved_in: Option<String>,
    /// The variant slug the erratum is scoped to, or absent for all variants.
    #[serde(skip_serializing_if = "Option::is_none")]
    variant: Option<String>,
    /// The review verdict id the erratum concerns, or absent when untied to a point.
    #[serde(skip_serializing_if = "Option::is_none")]
    review: Option<String>,
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
