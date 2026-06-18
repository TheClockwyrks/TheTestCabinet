//! Test-case catalog, version resolution, artifacts, and reference handlers
//! (§1.2 of `design/v0.2.0-contracts.md`).

use axum::Json;
use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::Serialize;

use crate::error::ApiError;
use crate::store::StoredManifest;

use super::AppState;

/// `GET /test-cases` — the catalog of ingested cases and their versions.
pub async fn catalog(State(state): State<AppState>) -> Result<Json<CatalogResponse>, ApiError> {
    let cases = state
        .store
        .list_cases()
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
    let versions = state.store.list_versions(&slug).map_err(ApiError::from)?;
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
    Ok(Json(version_response(&manifest)))
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

/// `GET /test-cases/{slug}/versions/{version}/references/{scope}/{view}.png` — a
/// rendered reference screenshot. The route captures `{view}` including the
/// `.png` suffix, which is stripped before lookup.
pub async fn reference(
    State(state): State<AppState>,
    Path((slug, version, scope, view)): Path<(String, String, String, String)>,
) -> Result<Response, ApiError> {
    let view = view.strip_suffix(".png").unwrap_or(&view);
    let bytes = state
        .store
        .read_reference(&slug, &version, &scope, view)
        .map_err(ApiError::from)?;
    Ok((StatusCode::OK, [(header::CONTENT_TYPE, "image/png")], bytes).into_response())
}

/// Map a [`StoredManifest`] to the §1.2 wire response, building reference
/// screenshot URLs from the version's store layout.
fn version_response(manifest: &StoredManifest) -> VersionResponse {
    let reference_url = |scope: &str, view: &str| {
        format!(
            "/test-cases/{}/{}/references/{scope}/{view}.png",
            manifest.slug, manifest.version
        )
    };

    VersionResponse {
        slug: manifest.slug.clone(),
        version: manifest.version.clone(),
        name: manifest.name.clone(),
        difficulty: manifest.difficulty.clone(),
        tags: manifest.tags.clone(),
        summary: manifest.summary.clone(),
        description: manifest.description.clone(),
        max_runtime_seconds: manifest.max_runtime_seconds,
        build: BuildOut {
            install: manifest.build.install.clone(),
            build: manifest.build.build.clone(),
        },
        prompt_template: manifest.prompt_template.clone(),
        common_specs: manifest.common_specs.iter().map(spec_out).collect(),
        assets: manifest
            .assets
            .iter()
            .map(|a| AssetOut {
                source: a.source.clone(),
                dest: a.dest.clone(),
            })
            .collect(),
        variants: manifest
            .variants
            .iter()
            .map(|v| VariantOut {
                slug: v.slug.clone(),
                name: v.name.clone(),
                description: v.description.clone(),
                specs: v.specs.iter().map(spec_out).collect(),
                references: v
                    .references
                    .iter()
                    .map(|r| ReferenceOut {
                        view: r.view.clone(),
                        screenshot_url: reference_url(&v.slug, &r.view),
                    })
                    .collect(),
                review_items: v.review_items.iter().map(review_item_out).collect(),
            })
            .collect(),
        common_references: manifest
            .common_references
            .iter()
            .map(|r| ReferenceOut {
                view: r.view.clone(),
                screenshot_url: reference_url("_common", &r.view),
            })
            .collect(),
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
    }
}

/// Map a stored reviewer checklist item to its wire `{id, text}` shape.
fn review_item_out(item: &crate::store::StoredReviewItem) -> ReviewItemOut {
    ReviewItemOut {
        id: item.id.clone(),
        title: item.title.clone(),
        text: item.text.clone(),
    }
}

/// Map a stored spec to the wire `{source, dest, template}` shape.
fn spec_out(spec: &crate::store::StoredSpec) -> SpecOut {
    SpecOut {
        source: spec.source.clone(),
        dest: spec.dest.clone(),
        template: spec.template,
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
pub struct CatalogResponse {
    test_cases: Vec<CatalogCase>,
}

#[derive(Serialize)]
struct CatalogCase {
    slug: String,
    versions: Vec<String>,
}

#[derive(Serialize)]
pub struct VersionsResponse {
    slug: String,
    versions: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionResponse {
    slug: String,
    version: String,
    name: String,
    difficulty: String,
    tags: Vec<String>,
    summary: Option<String>,
    description: Option<String>,
    max_runtime_seconds: u64,
    build: BuildOut,
    prompt_template: String,
    common_specs: Vec<SpecOut>,
    assets: Vec<AssetOut>,
    variants: Vec<VariantOut>,
    common_references: Vec<ReferenceOut>,
    checks: Vec<CheckOut>,
    common_review_items: Vec<ReviewItemOut>,
}

#[derive(Serialize)]
struct BuildOut {
    install: String,
    build: String,
}

#[derive(Serialize)]
struct SpecOut {
    source: String,
    dest: String,
    template: bool,
}

#[derive(Serialize)]
struct AssetOut {
    source: String,
    dest: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VariantOut {
    slug: String,
    name: String,
    description: Option<String>,
    specs: Vec<SpecOut>,
    references: Vec<ReferenceOut>,
    review_items: Vec<ReviewItemOut>,
}

#[derive(Serialize)]
struct ReviewItemOut {
    id: String,
    title: String,
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReferenceOut {
    view: String,
    screenshot_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CheckOut {
    view: String,
    name: String,
    reference_view: String,
    actions: Vec<test_cabinet_core::test_case::CheckAction>,
}
