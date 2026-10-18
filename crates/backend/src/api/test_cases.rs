//! Test-case catalog, version resolution, artifacts, and reference handlers
//! (§1.2 of `design/v0.2.0-contracts.md`).

#[cfg(test)]
#[path = "test_cases.test.rs"]
mod tests;

use axum::Json;
use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use test_cabinet_core::content_labels::{self, ContentLabels};
use test_cabinet_core::engine::{EngineSelection, ResolvedEngine};
use test_cabinet_core::shippable_package_description;

use crate::error::ApiError;
use crate::store::StoredManifest;
use crate::suite_store::StoredSuite;

use super::AppState;

use test_cabinet_contracts::backend_api::test_cases::{
    AssetOut, BuildOut, CanvasOut, CaseOut, CheckOut, DomainOut, EngineOut, ErratumOut,
    InstrumentationOut, OutputOut, PackageOut, ProofOut, ReferenceOut, ReferenceSheetOut,
    ReviewItemOut, ReviewOutputOut, ReviewValidationOut, ShowcaseOut, SpecDocumentOut, SpecOut,
    SubReviewItemOut, ToolOut, ToolchainOut, VariantOut, WorkspaceOut,
};
pub use test_cabinet_contracts::backend_api::test_cases::{
    CatalogCase, CatalogResponse, CatalogShowcaseOut, ShowcaseMediaOut, SpecsResponse,
    VersionResponse, VersionsResponse,
};

/// `GET /test-cases` — the catalog of ingested cases and their versions, each
/// carrying the display metadata a *listing* needs.
///
/// The metadata (name, type, difficulty, tags, summary) is deliberately part of
/// this response: a catalog listing shows exactly these fields, and without them
/// a client has to resolve every version of every case just to render a grid of
/// cards — hundreds of round trips for a page that needs one. Anything heavier
/// than a card (the description, variants, prompts, seeded specs, checklist,
/// changelog, errata) stays on [`resolve_version`], fetched only for the case a
/// visitor actually opens.
///
/// The metadata is read from each case's **latest visible version**, which is the
/// one a listing describes. A case whose latest manifest cannot be read is
/// skipped rather than failing the whole catalog — one unreadable sidecar should
/// cost that case's card, not every case's. A store the running build cannot read
/// at all is the other case entirely: it answers `503` naming the repair, because
/// a listing of whichever versions happen to still parse is a wrong answer that
/// looks like a right one (see
/// [`needs_reingest`](crate::store::DefinitionStore::needs_reingest)).
///
/// Experimental versions are omitted unless the deployment has opted in via
/// `TCAB_BACKEND_ALLOW_EXPERIMENTAL` (see [`crate::config::Config::allow_experimental`]),
/// so an experimental case a deployment has not enabled is not offered to the UI.
pub async fn catalog(State(state): State<AppState>) -> Result<Json<CatalogResponse>, ApiError> {
    if state.store.needs_reingest() {
        return Err(ApiError::unavailable(
            "the definition store holds no version in a record format this build can read; \
             re-ingest the catalog",
        ));
    }
    let mut cases = Vec::new();
    for (slug, versions) in state
        .store
        .list_visible_cases(state.config.allow_experimental)
        .map_err(ApiError::from)?
    {
        // `list_visible_cases` orders versions oldest-first, so the latest — the
        // one the card describes — is the last.
        let Some(latest) = versions.last() else {
            continue;
        };
        let manifest = match state.store.read_manifest(&slug, latest) {
            Ok(manifest) => manifest,
            Err(error) => {
                // The store is one this build reads, so a manifest inside it that
                // does not read back is a defect in what ingest wrote, not a state
                // to expect.
                tracing::error!(
                    %slug,
                    version = %latest,
                    %error,
                    "skipping case in catalog listing: its latest manifest could not be read"
                );
                continue;
            }
        };
        cases.push(catalog_case(slug, versions, &manifest));
    }
    Ok(Json(CatalogResponse { test_cases: cases }))
}

/// Build one catalog listing entry from a case's visible versions and the
/// manifest of its latest one. Split out from [`catalog`] so the metadata a card
/// renders can be covered without standing up a store.
fn catalog_case(slug: String, versions: Vec<String>, manifest: &StoredManifest) -> CatalogCase {
    // The catalog preview: the latest version's first variant (manifest order)
    // that declares a showcase. `None` when no variant of the latest version has
    // one — the card renders its placeholder stage.
    let showcase = manifest.variants.iter().find_map(|variant| {
        variant
            .showcase
            .as_ref()
            .map(|showcase| CatalogShowcaseOut {
                version: manifest.version.clone(),
                variant: variant.slug.clone(),
                media: showcase.media.iter().map(showcase_media_out).collect(),
            })
    });
    CatalogCase {
        slug,
        versions,
        name: manifest.name.clone(),
        test_type: manifest.test_type,
        asset_kind: manifest.asset_kind,
        difficulty: manifest.difficulty.clone(),
        tags: manifest.tags.clone(),
        summary: manifest.summary.clone(),
        showcase,
        suite: manifest.suite.clone(),
    }
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

/// The [engine](test_cabinet_core::engine) a version's templated text is rendered
/// for: `?engine=<slug>` on [`resolve_version`] and [`variant_specs`].
///
/// A case version's `prompt.hbs` and its `.hbs` specs branch on the selected
/// engine, so the same stored template renders into different text depending on
/// which runtime the build is written against. The engine is therefore a
/// *rendering* input, not part of a version's identity — a version makes no claim
/// about an engine — which is why it rides as a query parameter here while the
/// `validation-baseline` route carries it as a path segment (there it names a
/// distinct stored directory).
///
/// A surface showing a **run** passes the engine that run recorded, so it reads
/// the text that run's harness actually received. A surface showing a **case**
/// passes nothing and gets the engineless form: a case is not a run, and nothing
/// has selected an engine yet.
#[derive(Debug, Default, Deserialize)]
pub struct EngineQuery {
    /// The engine slug to render for, or absent for the engineless form. An
    /// unknown slug is a client error rather than a silent fallback.
    #[serde(default)]
    pub engine: Option<String>,
}

impl EngineQuery {
    /// Resolve the requested slug against the built-in engine catalogue.
    ///
    /// `None` (the parameter was omitted) renders engineless. An explicit
    /// [`NONE_SLUG`](test_cabinet_core::engine::NONE_SLUG) resolves to the built-in
    /// engineless engine, which renders identically — a run that named `none` and a
    /// surface that named nothing see the same text.
    fn resolve(&self) -> Result<Option<ResolvedEngine>, ApiError> {
        let Some(slug) = self.engine.as_deref() else {
            return Ok(None);
        };
        test_cabinet_core::engine::built_in_catalog()
            .resolve(&EngineSelection::new(slug))
            .map(Some)
            .map_err(|err| ApiError::bad_request(err.to_string()))
    }
}

/// `GET /test-cases/{slug}/versions/{version}` — the full resolved manifest a
/// runner needs, with store-relative keys and references resolved to rendered
/// screenshot URLs.
///
/// `?engine=<slug>` (see [`EngineQuery`]) selects which engine each variant's
/// `prompt` is rendered for; omitting it renders the engineless form.
pub async fn resolve_version(
    State(state): State<AppState>,
    Path((slug, version)): Path<(String, String)>,
    Query(query): Query<EngineQuery>,
) -> Result<Json<VersionResponse>, ApiError> {
    let engine = query.resolve()?;
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
    let mut reference_builds = state
        .db
        .reference_builds_for_version(&slug, &version)
        .await
        .map_err(ApiError::from)?;
    // A suite-defined version's builds are uploaded against its suite version
    // instead, so they are read from the store beside the suite record.
    fold_suite_reference_builds(&state.store, &manifest, &mut reference_builds)?;
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
    // A suite-defined version's prompt renders against the specifications its suite
    // version declares, exactly as a run of it does.
    let suite = state
        .store
        .read_suite_of(&manifest)
        .map_err(ApiError::from)?;
    Ok(Json(version_response(
        &manifest,
        suite.as_ref(),
        &reference_builds,
        &reference_sheets,
        engine.as_ref(),
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
///
/// `?engine=<slug>` (see [`EngineQuery`]) selects which engine the bodies are
/// rendered for; omitting it renders the engineless form.
pub async fn variant_specs(
    State(state): State<AppState>,
    Path((slug, version, variant)): Path<(String, String, String)>,
    Query(query): Query<EngineQuery>,
) -> Result<Json<SpecsResponse>, ApiError> {
    let engine = query.resolve()?;
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
                engine.as_ref(),
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

/// `GET /test-cases/{slug}/versions/{version}/suite-files` — the store-relative keys
/// of every file of the suite version a suite-defined version was lowered from: its
/// `version.toml` and `suite.toml`, its specification folders, its definition files, its `validators/`
/// project and its debug API declaration, as a sorted JSON string array. A
/// backend-driven run fetches the whole set into its definition store, rebuilds the
/// version folder there, and reads the suite model back out of it to render the
/// prompt and to record one outcome per requirement. Reporter-side and seed-side
/// both: the validator project is never seeded, while the specifications are seeded
/// as the rendered documents keyed under `specs/`. The array is empty for an
/// authored version, which was lowered from no suite.
pub async fn suite_files(
    State(state): State<AppState>,
    Path((slug, version)): Path<(String, String)>,
) -> Result<Json<Vec<String>>, ApiError> {
    let keys = state
        .store
        .list_suite_files(&slug, &version)
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

/// `GET /test-cases/{slug}/versions/{version}/validation-baseline/{engine}/{variant}/{file}`
/// — one reference build's committed **baseline** validation media (`{file}` is the
/// flat `<item>__<output>.<ext>`). This is the invariant counterpart to a run's
/// *actual* validation media (served run-scoped by the artifact service): synthesized
/// once at `tcab capture-baselines` time from the reference implementation and
/// committed under the version folder, so the reviewer UI resolves it case-scoped (by
/// slug/version/engine/variant/item/output), not from any run tree. The content type
/// follows the extension.
///
/// The engine is part of the address because a variant has one reference
/// implementation per engine: the run being reviewed selected an engine, and the
/// expected-behavior media it is compared against has to have come from the same one.
pub async fn validation_baseline(
    State(state): State<AppState>,
    Path((slug, version, engine, variant, file)): Path<(String, String, String, String, String)>,
) -> Result<Response, ApiError> {
    let bytes = state
        .store
        .read_validation_baseline(&slug, &version, &engine, &variant, &file)
        .map_err(ApiError::from)?;
    Ok(bytes_response(&file, bytes))
}

/// `GET /test-cases/{slug}/versions/{version}/showcase/{variant}/{file}` — one
/// media file of a variant's authored **showcase** (`{file}` is the plain file
/// name the carousel declares — a `.png` still, a `.webm` clip, or a `.json.gz`
/// replay recording). The case-side counterpart of [`run_showcase`], served
/// case-scoped because the showcase is authored material committed with the
/// version, not run output. The content type follows the extension. The store
/// resolves only a file the variant's stored showcase actually lists — and never
/// `showcase.toml`, which is authoring input.
pub async fn case_showcase(
    State(state): State<AppState>,
    Path((slug, version, variant, file)): Path<(String, String, String, String)>,
) -> Result<Response, ApiError> {
    let bytes = state
        .store
        .read_case_showcase(&slug, &version, &variant, &file)
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

/// `GET /runs/{id}/showcase/{file}` — one of a published run's
/// [showcase](test_cabinet_core::RunShowcase) files (`{file}` is the plain file
/// name in the produced tree's `showcase/` — a carousel media file, or an image
/// the description references), mirrored into the backend store by the driver so
/// it reaches the public snapshot. The content type follows the extension; a
/// `.json.gz` replay serves as JSON travelling gzip-framed, so a browser inflates
/// it before the player sees it.
pub async fn run_showcase(
    State(state): State<AppState>,
    Path((id, file)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    let bytes = state
        .store
        .read_run_showcase(&id, &file)
        .map_err(ApiError::from)?;
    Ok(bytes_response(&file, bytes))
}

/// `POST /runs/{id}/showcase/{file}` — store one of a published run's showcase
/// files, uploaded by the publisher alongside the run record.
pub async fn put_run_showcase(
    State(state): State<AppState>,
    Path((id, file)): Path<(String, String)>,
    body: axum::body::Bytes,
) -> Result<Response, ApiError> {
    state
        .store
        .write_run_showcase(&id, &file, &body)
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

/// `GET /runs/{id}/replay` — a gg run's stored
/// [session record](test_cabinet_core::gg_session_record), the capture of its non-deterministic
/// inputs, served as JSON so a replay driver can re-run the session.
///
/// The stored bytes are gzipped, so this is served through [`run_artifact_response`]: a browser
/// gets them moved verbatim, and a gzip-unaware client (the CLI, the replay driver — anything on
/// the workspace `reqwest`) gets them decoded here.
pub async fn run_replay(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let bytes = state.store.read_run_replay(&id).map_err(ApiError::from)?;
    run_artifact_response(&headers, crate::store::REPLAY_ARTIFACT, bytes)
}

/// `POST /runs/{id}/replay` — store a gg run's session record, mirrored in by the driver from the
/// collected run tree. The raw request body is the bytes.
///
/// **Store-only**, by the run-tree artifact convention: the driver uploads *before* the terminal
/// status post that creates the run row, so there is nothing here to patch, and the store keeps the
/// body opaque: it is never parsed.
pub async fn put_run_replay(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: axum::body::Bytes,
) -> Result<Response, ApiError> {
    state
        .store
        .write_run_replay(&id, &body)
        .map_err(ApiError::from)?;
    Ok((StatusCode::NO_CONTENT, ()).into_response())
}

/// `GET /runs/{id}/code-analysis` — a run's stored
/// [code-analysis](test_cabinet_core::code_analysis) document: the unbounded tier of the
/// static read of the code its model wrote, with every file, symbol, import edge, cycle and
/// clone group.
///
/// Served through [`run_artifact_response`] exactly as the session record is: a browser (the
/// per-run Code tab) gets the stored gzip moved verbatim, and a gzip-unaware client on the
/// workspace `reqwest` gets it decoded here.
///
/// Offered for every harness's runs. The gg-only constraint binds on the *aggregate* query
/// surface, not on a per-run document that costs nothing harness-specific to produce.
pub async fn run_code_analysis(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let bytes = state
        .store
        .read_run_code_analysis(&id)
        .map_err(ApiError::from)?;
    run_artifact_response(&headers, crate::store::CODE_ANALYSIS_ARTIFACT, bytes)
}

/// `POST /runs/{id}/code-analysis` — store a run's code-analysis document, mirrored in by
/// the driver from the collected run tree. The raw request body is the bytes.
///
/// **Store-only**, by the run-tree artifact convention: the driver uploads *before* the
/// terminal status post that creates the run row, so there is nothing here to patch. The
/// lifted `run.code_analyzer_version` column is set from the record on the ordinary insert,
/// which is why this handler never touches the database and why a document arriving for a
/// run that does not exist yet is not an error.
pub async fn put_run_code_analysis(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: axum::body::Bytes,
) -> Result<Response, ApiError> {
    state
        .store
        .write_run_code_analysis(&id, &body)
        .map_err(ApiError::from)?;
    Ok((StatusCode::NO_CONTENT, ()).into_response())
}

/// Fold the reference builds uploaded for the suite version a suite-defined version
/// was lowered from onto each of its variants, keyed by engine with the
/// backend-relative URL each is played at. Only the engines the version supports
/// are folded, and an authored version is left as it is.
fn fold_suite_reference_builds(
    store: &crate::store::DefinitionStore,
    manifest: &StoredManifest,
    reference_builds: &mut std::collections::HashMap<
        String,
        std::collections::BTreeMap<String, String>,
    >,
) -> Result<(), ApiError> {
    let Some(coordinate) = &manifest.suite else {
        return Ok(());
    };
    let builds = super::suite_reference_builds::reference_builds_among(
        store,
        &coordinate.suite,
        &coordinate.suite_version,
        manifest.engines.iter().map(|engine| engine.slug.as_str()),
    )?;
    if builds.is_empty() {
        return Ok(());
    }
    for variant in &manifest.variants {
        reference_builds
            .entry(variant.slug.clone())
            .or_default()
            .extend(builds.clone());
    }
    Ok(())
}

/// Map a [`StoredManifest`] to the §1.2 wire response, building reference
/// screenshot URLs from the version's store layout and rendering each variant's
/// prompt the way a run on `engine` receives it. `suite` is the record of the suite
/// version a suite-defined manifest was lowered from, which its prompt renders
/// against; `None` for an authored one.
fn version_response(
    manifest: &StoredManifest,
    suite: Option<&StoredSuite>,
    reference_builds: &std::collections::HashMap<
        String,
        std::collections::BTreeMap<String, String>,
    >,
    reference_sheets: &std::collections::HashMap<String, Vec<u32>>,
    engine: Option<&ResolvedEngine>,
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
                prompt: render_variant_prompt(manifest, v, suite, engine)?,
                specs: v.specs.iter().map(spec_out).collect(),
                workspace: v.workspace.as_ref().map(workspaces_out),
                references: v
                    .references
                    .iter()
                    .map(|r| reference_out(&v.slug, r))
                    .collect(),
                proofs: v.proofs.iter().map(proof_out).collect(),
                review_items: v.review_items.iter().map(review_item_out).collect(),
                domains: v.domains.iter().map(domain_out).collect(),
                voxel: v.voxel.clone(),
                reference_builds: reference_builds.get(&v.slug).cloned().unwrap_or_default(),
                reference_sheet: reference_sheets
                    .get(&v.slug)
                    .map(|frames| ReferenceSheetOut {
                        frames: frames.clone(),
                    }),
                showcase: v.showcase.as_ref().map(showcase_out),
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
        engine_format: manifest.engine_format,
        engines: manifest
            .engines
            .iter()
            .map(|engine| EngineOut {
                slug: engine.slug.clone(),
                min_version: engine.min_version.as_ref().map(|v| v.to_string()),
                max_version: engine.max_version.as_ref().map(|v| v.to_string()),
            })
            .collect(),
        build: manifest.build.as_ref().map(|build| BuildOut {
            install: build.install.clone(),
            build: build.build.clone(),
            module: build.module.clone(),
        }),
        toolchain: manifest.toolchain.as_ref().map(|toolchain| ToolchainOut {
            typecheck: toolchain.typecheck.clone(),
            lint: toolchain.lint.clone(),
            format: toolchain.format.clone(),
            test: toolchain.test.clone(),
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
        asset_dimension: manifest.asset_dimension,
        sheet: manifest.sheet.clone(),
        voxel: manifest.voxel.clone(),
        model: manifest.model.clone(),
        ui: manifest.ui.clone(),
        material: manifest.material.clone(),
        particle: manifest.particle.clone(),
        audio: manifest.audio.clone(),
        audio_packs: manifest.audio_packs.clone(),
        prompt_template: manifest.prompt_template.clone(),
        common_specs: manifest.common_specs.iter().map(spec_out).collect(),
        packages: manifest
            .packages
            .iter()
            .map(|name| package_out(name))
            .collect(),
        workspace: workspaces_out(&manifest.workspace),
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
        suite: manifest.suite.clone(),
    })
}

/// Render a variant's prompt the way a real run on `engine` receives it (see
/// [`crate::prompt::render_stored_prompt`]): an authored version against its
/// variant and seeded specs, a suite-defined one against the specifications its
/// definition covers in `suite`. A template error is exceptional (the same template
/// renders at run time), so surface it as an internal error rather than silently
/// dropping the prompt.
fn render_variant_prompt(
    manifest: &StoredManifest,
    variant: &crate::store::StoredVariant,
    suite: Option<&StoredSuite>,
    engine: Option<&ResolvedEngine>,
) -> Result<String, ApiError> {
    crate::prompt::render_stored_prompt(manifest, variant, suite, engine)
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
                failure_cap: sub.failure_cap,
                domains: sub.domains.clone(),
            })
            .collect(),
        validation: item.validation.as_ref().map(review_validation_out),
        failure_cap: item.failure_cap,
        domains: item.domains.clone(),
    }
}

/// Map a stored automated-validation driver to its wire shape. Shared by the item-level
/// and per-sub-item drivers.
fn review_validation_out(validation: &crate::store::StoredReviewValidation) -> ReviewValidationOut {
    ReviewValidationOut {
        script: validation.script.clone(),
        per_engine: validation.per_engine,
        engines: validation.engines.clone(),
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

/// Map a variant's stored showcase to its wire shape.
fn showcase_out(showcase: &crate::store::StoredShowcase) -> ShowcaseOut {
    ShowcaseOut {
        description: showcase.description.clone(),
        media: showcase.media.iter().map(showcase_media_out).collect(),
    }
}

/// Map one stored showcase media entry to its wire shape. The store-relative
/// `key` deliberately stays behind: a client addresses the bytes by the showcase
/// route (`/test-cases/{slug}/versions/{version}/showcase/{variant}/{file}`),
/// never by artifact key.
fn showcase_media_out(media: &crate::store::StoredShowcaseMedia) -> ShowcaseMediaOut {
    ShowcaseMediaOut {
        file: media.file.clone(),
        name: media.name.clone(),
        kind: media.kind,
    }
}

/// Map a stored workspace file to the wire `{source, dest}` shape.
fn workspace_out(file: &crate::store::StoredWorkspaceFile) -> WorkspaceOut {
    WorkspaceOut {
        source: file.source.clone(),
        dest: file.dest.clone(),
    }
}

/// Map a stored starter project to the wire shape: one file list per
/// [engine](test_cabinet_core::engine) slug.
fn workspaces_out(
    workspace: &crate::store::StoredWorkspace,
) -> std::collections::BTreeMap<String, Vec<WorkspaceOut>> {
    workspace
        .0
        .iter()
        .map(|(engine, files)| (engine.clone(), files.iter().map(workspace_out).collect()))
        .collect()
}

/// Build a raw-bytes response for a stored file, labelled from its name.
///
/// A name carries both answers a response has to give: what the resource is, and how
/// the body is framed. `<name>.json.gz` is a JSON document travelling gzip-framed and
/// is labelled as such, so a browser inflates it before any script sees it; every
/// other name describes bytes that are already the resource (see
/// [`labels_for`]).
pub(super) fn bytes_response(path: &str, bytes: Vec<u8>) -> Response {
    labelled_response(labels_for(path), bytes)
}

/// Build a raw-bytes response under labels the caller already knows.
///
/// [`run_artifact_response`] is the one route whose framing is not implied by the
/// name it serves under: it stores the document gzipped under a `.json` name and
/// decides per request whether to hand that framing on, so it states the labels
/// rather than deriving them.
fn labelled_response(labels: ContentLabels, bytes: Vec<u8>) -> Response {
    let len = bytes.len();
    let mut response = (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, labels.content_type.to_string()),
            (header::CONTENT_LENGTH, len.to_string()),
        ],
        Body::from(bytes),
    )
        .into_response();
    if let Some(encoding) = labels.content_encoding {
        response.headers_mut().insert(
            header::CONTENT_ENCODING,
            header::HeaderValue::from_static(encoding),
        );
    }
    response
}

/// Serve one of a run's [run-tree artifacts](crate::store::DefinitionStore::run_artifact_path)
/// — the whole-run analysis documents (`replay`, and code analysis to follow) — content
/// negotiating on the **request's** `Accept-Encoding`.
///
/// Negotiating on the request rather than keying on what happens to be stored is the whole
/// point of the convention. The workspace HTTP client (`reqwest`, built without its `gzip`
/// feature so the workspace stays free of a second TLS/compression stack) neither advertises
/// the encoding nor decodes it, while every browser advertises it unconditionally. Serving
/// the stored bytes verbatim would break the CLI and the replay driver; decompressing
/// unconditionally would throw away the ~10× the console's fetch gets for free.
///
/// Records captured before the convention are stored as plain JSON, so the stored bytes are
/// sniffed rather than assumed. Nothing here ever compresses on demand: compression happens
/// once, where the artifact is written, and this route only ever *removes* it.
fn run_artifact_response(
    headers: &HeaderMap,
    name: &str,
    stored: Vec<u8>,
) -> Result<Response, ApiError> {
    let mut response = if !is_gzip(&stored) {
        labelled_response(ContentLabels::plain(JSON_CONTENT_TYPE), stored)
    } else if accepts_gzip(headers) {
        labelled_response(ContentLabels::gzipped(JSON_CONTENT_TYPE), stored)
    } else {
        let mut plain = Vec::new();
        std::io::Read::read_to_end(
            &mut flate2::read::GzDecoder::new(std::io::Cursor::new(&stored)),
            &mut plain,
        )
        .map_err(|e| {
            ApiError::internal(format!(
                "decoding stored `{name}` artifact for a client that does not accept gzip: {e}"
            ))
        })?;
        labelled_response(ContentLabels::plain(JSON_CONTENT_TYPE), plain)
    };
    // The body genuinely varies by request header, so say so — a shared cache in front
    // of the backend must not hand a browser's gzipped copy to the gzip-unaware CLI.
    response.headers_mut().insert(
        header::VARY,
        header::HeaderValue::from_static("accept-encoding"),
    );
    Ok(response)
}

/// Whether the bytes are a gzip member, by its two-byte magic (RFC 1952 §2.3.1).
///
/// Both a gzip stream and the JSON it frames are self-describing enough that this
/// cannot be ambiguous: a JSON document never begins `0x1f 0x8b`.
fn is_gzip(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0x1f, 0x8b])
}

/// Whether the request advertised gzip in `Accept-Encoding`.
///
/// Deliberately narrow: this decides between handing over bytes already in hand and
/// decompressing them, so it accepts `gzip` (or the `*` wildcard) and honours an explicit
/// `q=0`, which is how a client *refuses* an encoding — RFC 9110 §12.5.3. Anything it does
/// not understand means "not advertised", which is always the safe answer: the caller gets
/// plain JSON.
fn accepts_gzip(headers: &HeaderMap) -> bool {
    let Some(value) = headers
        .get(header::ACCEPT_ENCODING)
        .and_then(|v| v.to_str().ok())
    else {
        return false;
    };
    value.split(',').any(|entry| {
        let mut parts = entry.split(';');
        let coding = parts.next().unwrap_or_default().trim();
        if !coding.eq_ignore_ascii_case("gzip") && coding != "*" {
            return false;
        }
        // `;q=0` (and `q=0.0`, `q=0.000`) is a refusal; any other quality is acceptance.
        !parts.any(|param| {
            let param = param.trim();
            let Some(q) = param
                .strip_prefix("q=")
                .or_else(|| param.strip_prefix("Q="))
            else {
                return false;
            };
            q.trim().parse::<f32>().is_ok_and(|q| q <= 0.0)
        })
    })
}

/// The content type and body framing for a stored file, from its name.
fn labels_for(path: &str) -> ContentLabels {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    match ext.to_ascii_lowercase().as_str() {
        "md" | "txt" => ContentLabels::plain("text/plain; charset=utf-8"),
        "hbs" => ContentLabels::plain("text/plain; charset=utf-8"),
        "html" => ContentLabels::plain("text/html; charset=utf-8"),
        "json" => ContentLabels::plain(JSON_CONTENT_TYPE),
        // A gzipped document served as it is stored — a validator's draw-command
        // recording (`<name>.json.gz`), which is JSON travelling gzip-framed and is
        // labelled that way, so the browser inflates it before the player sees it.
        "gz" => content_labels::for_gz(path),
        "png" => ContentLabels::plain("image/png"),
        "jpg" | "jpeg" => ContentLabels::plain("image/jpeg"),
        "webp" => ContentLabels::plain("image/webp"),
        "gif" => ContentLabels::plain("image/gif"),
        "mp4" => ContentLabels::plain("video/mp4"),
        "webm" => ContentLabels::plain("video/webm"),
        "svg" => ContentLabels::plain("image/svg+xml"),
        "css" => ContentLabels::plain("text/css"),
        "js" | "mjs" => ContentLabels::plain("text/javascript"),
        "wasm" => ContentLabels::plain("application/wasm"),
        _ => ContentLabels::plain("application/octet-stream"),
    }
}

/// The content type every JSON response this module serves carries.
const JSON_CONTENT_TYPE: &str = "application/json";
