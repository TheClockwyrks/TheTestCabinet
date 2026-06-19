//! The ingest trigger handler (§1.1's `POST /ingest`).

use axum::Json;
use axum::extract::State;
use serde::{Deserialize, Serialize};

use crate::error::ApiError;
use crate::ingest::{IngestRequest, Ingestor};

use super::AppState;

/// `POST /ingest` — scan the configured checkout, copying any new/changed
/// test-case versions into the store and rendering reference screenshots.
/// Synchronous; returns what changed. Container images are distributed via a
/// registry and posted separately (`POST /containers`); ingest does not touch
/// them.
///
/// The scan touches the filesystem and renders references (CPU/process-bound), so
/// it runs on a blocking thread to keep the async runtime responsive.
#[tracing::instrument(name = "ingest", skip(state, body), err(Debug))]
pub async fn ingest(
    State(state): State<AppState>,
    body: Option<Json<IngestBody>>,
) -> Result<Json<IngestResponse>, ApiError> {
    let body = body.map(|Json(b)| b).unwrap_or_default();
    let request = IngestRequest {
        test_cases: body.test_cases,
        force: body.force,
    };

    let checkout = state.config.checkout.clone();
    let store = state.store.clone();
    let report =
        tokio::task::spawn_blocking(move || Ingestor::new(&checkout, &store).scan(&request))
            .await
            .map_err(|e| ApiError::internal(format!("ingest task panicked: {e}")))?
            .map_err(ApiError::from)?;

    Ok(Json(IngestResponse {
        test_case_versions: report
            .test_case_versions
            .into_iter()
            .map(|v| VersionOut {
                slug: v.slug,
                version: v.version,
                ingested: v.ingested,
                rendered_references: v.rendered_references,
            })
            .collect(),
    }))
}

// --- Wire shapes (§1.1) -----------------------------------------------------

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct IngestBody {
    #[serde(default)]
    test_cases: Option<Vec<String>>,
    #[serde(default)]
    force: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestResponse {
    test_case_versions: Vec<VersionOut>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VersionOut {
    slug: String,
    version: String,
    ingested: bool,
    rendered_references: usize,
}
