//! Container definition resolution handlers (§1.3 of
//! `design/v0.2.0-contracts.md`).

use axum::Json;
use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::Serialize;

use crate::error::ApiError;
use crate::store::StoredContainer;

use super::AppState;

/// `GET /containers` — the ingested container definitions and their hashes.
pub async fn list(State(state): State<AppState>) -> Result<Json<ContainersResponse>, ApiError> {
    let containers = state
        .store
        .list_containers()
        .map_err(ApiError::from)?
        .into_iter()
        .map(|c| ContainerSummary {
            harness: c.harness,
            content_hash: c.content_hash,
            builds_from: c.builds_from,
        })
        .collect();
    Ok(Json(ContainersResponse { containers }))
}

/// `GET /containers/{harness}` — resolve a harness definition: its file manifest
/// and aggregate content hash (the tag the runner uses).
pub async fn resolve(
    State(state): State<AppState>,
    Path(harness): Path<String>,
) -> Result<Json<ContainerResponse>, ApiError> {
    let stored = state
        .store
        .read_latest_container(&harness)
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found(format!("container `{harness}` not ingested")))?;
    Ok(Json(container_response(&stored)))
}

/// `GET /containers/{harness}/files/{path...}` — one build-context file, raw
/// bytes, traversal-guarded.
pub async fn file(
    State(state): State<AppState>,
    Path((harness, path)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    let bytes = state
        .store
        .read_container_file(&harness, &path)
        .map_err(ApiError::from)?;
    let len = bytes.len();
    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/octet-stream".to_string()),
            (header::CONTENT_LENGTH, len.to_string()),
        ],
        Body::from(bytes),
    )
        .into_response())
}

/// Map stored container metadata to the §1.3 resolution response.
fn container_response(stored: &StoredContainer) -> ContainerResponse {
    ContainerResponse {
        harness: stored.harness.clone(),
        content_hash: stored.content_hash.clone(),
        builds_from: stored.builds_from.clone(),
        files: stored
            .files
            .iter()
            .map(|f| FileOut {
                path: f.path.clone(),
                size: f.size,
                sha256: f.sha256.clone(),
            })
            .collect(),
    }
}

// --- Wire shapes (§1.3) -----------------------------------------------------

#[derive(Serialize)]
pub struct ContainersResponse {
    containers: Vec<ContainerSummary>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ContainerSummary {
    harness: String,
    content_hash: String,
    builds_from: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerResponse {
    harness: String,
    content_hash: String,
    builds_from: Option<String>,
    files: Vec<FileOut>,
}

#[derive(Serialize)]
struct FileOut {
    path: String,
    size: u64,
    sha256: String,
}
