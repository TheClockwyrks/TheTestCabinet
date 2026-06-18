//! Container image resolution handlers (§1.3 of `design/v0.2.0-contracts.md`).
//!
//! Harness images are distributed via a registry and pulled by digest. The
//! backend tracks the latest pullable image **reference** per harness: the image
//! build/push step posts it (`POST /containers`), and runners resolve it
//! (`GET /containers/{harness}`) and pull it. There is no build context served.

use axum::Json;
use axum::extract::{Path, State};
use serde::{Deserialize, Serialize};

use crate::error::ApiError;
use crate::store::StoredContainer;

use super::AppState;

/// `GET /containers` — the tracked harness image references.
pub async fn list(State(state): State<AppState>) -> Result<Json<ContainersResponse>, ApiError> {
    let containers = state
        .store
        .list_containers()
        .map_err(ApiError::from)?
        .into_iter()
        .map(ContainerOut::from)
        .collect();
    Ok(Json(ContainersResponse { containers }))
}

/// `GET /containers/{harness}` — resolve a harness to its pullable image
/// reference (the digest ref the runner pulls).
pub async fn resolve(
    State(state): State<AppState>,
    Path(harness): Path<String>,
) -> Result<Json<ContainerOut>, ApiError> {
    let stored = state
        .store
        .read_container(&harness)
        .map_err(ApiError::from)?
        .ok_or_else(|| {
            ApiError::not_found(format!("container `{harness}` has no image reference"))
        })?;
    Ok(Json(ContainerOut::from(stored)))
}

/// `POST /containers` — record the latest pullable image reference for a harness
/// (posted by the image build/push step). Overwrites any previous reference for
/// that harness. Network-auth only, like every other endpoint.
pub async fn post(
    State(state): State<AppState>,
    Json(body): Json<ContainerIn>,
) -> Result<Json<ContainerOut>, ApiError> {
    if body.harness.trim().is_empty() {
        return Err(ApiError::bad_request("`harness` must not be empty"));
    }
    if body.reference.trim().is_empty() {
        return Err(ApiError::bad_request("`reference` must not be empty"));
    }
    let stored = StoredContainer {
        harness: body.harness,
        reference: body.reference,
    };
    state
        .store
        .write_container(&stored)
        .map_err(ApiError::from)?;
    Ok(Json(ContainerOut::from(stored)))
}

// --- Wire shapes (§1.3) -----------------------------------------------------

#[derive(Serialize)]
pub struct ContainersResponse {
    containers: Vec<ContainerOut>,
}

/// A harness and its pullable image reference (`{ harness, reference }`).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerOut {
    harness: String,
    reference: String,
}

impl From<StoredContainer> for ContainerOut {
    fn from(stored: StoredContainer) -> Self {
        Self {
            harness: stored.harness,
            reference: stored.reference,
        }
    }
}

/// The `POST /containers` request body (`{ harness, reference }`).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerIn {
    harness: String,
    reference: String,
}

#[cfg(test)]
#[path = "containers.test.rs"]
mod tests;
