//! Quick-match endpoints: pit two chosen controllers head-to-head and list the
//! controllers available to pit. A quick match is **transient** — it produces a
//! replay for immediate playback and persists nothing.

use axum::Json;
use axum::extract::{Query, State};
use serde::{Deserialize, Serialize};

use foray_core::replay::Replay;
use test_cabinet_core::match_play::{ControllerRef, MatchSummary, run_quick_match};
use test_cabinet_core::{BackendClient, HttpBackendClient};

use crate::api::AppState;
use crate::arena::{list_controllers, resolve_controller, with_pushed_controllers};
use crate::error::ApiError;

/// `POST /matches` — run one head-to-head match between two controllers and
/// return its replay (for immediate browser playback) plus the summary. Transient:
/// nothing is persisted.
pub async fn run(
    State(state): State<AppState>,
    Json(body): Json<MatchBody>,
) -> Result<Json<MatchResponse>, ApiError> {
    let client = HttpBackendClient::new(state.config.backend_url.clone());
    let test_case = client
        .resolve_version(&body.test_case, &body.version)
        .await
        .map_err(|err| {
            ApiError::bad_request(format!(
                "resolving {}@{}: {err}",
                body.test_case, body.version
            ))
        })?;

    let out_dir = &state.config.out_dir;
    let red = resolve_controller(
        &client,
        out_dir,
        &body.test_case,
        &body.version,
        &test_case,
        &body.red,
    )
    .await
    .map_err(ApiError::bad_request)?;
    let blue = resolve_controller(
        &client,
        out_dir,
        &body.test_case,
        &body.version,
        &test_case,
        &body.blue,
    )
    .await
    .map_err(ApiError::bad_request)?;

    // A match is CPU-bound wasm execution; run it off the async runtime.
    let outcome = tokio::task::spawn_blocking(move || run_quick_match(&test_case, &red, &blue))
        .await
        .map_err(|err| ApiError::internal(format!("match task panicked: {err}")))?
        .map_err(|err| ApiError::internal(format!("running the match: {err}")))?;

    Ok(Json(MatchResponse {
        replay: outcome.replay,
        summary: outcome.summary,
    }))
}

/// `GET /matches/controllers?testCase=` — the controllers available to pit for a
/// case: the committed arena opponents (model-facing baselines plus the hidden
/// references), this worker's produced adversarial runs, and the case's **pushed**
/// adversarial controllers resolved from the backend (so a pushed implementation is
/// always selectable, even from a host that did not produce it).
pub async fn controllers(
    State(state): State<AppState>,
    Query(params): Query<ControllersParams>,
) -> Json<ControllersResponse> {
    let local = list_controllers(&state.config.out_dir, &params.test_case);
    let client = HttpBackendClient::new(state.config.backend_url.clone());
    let controllers = with_pushed_controllers(&client, &params.test_case, local).await;
    Json(ControllersResponse { controllers })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchBody {
    pub test_case: String,
    pub version: String,
    pub red: ControllerRef,
    pub blue: ControllerRef,
}

#[derive(Debug, Serialize)]
pub struct MatchResponse {
    /// The browser-playable replay, or `null` when a controller failed to load.
    replay: Option<Replay>,
    summary: MatchSummary,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControllersParams {
    pub test_case: String,
}

#[derive(Debug, Serialize)]
pub struct ControllersResponse {
    controllers: Vec<ControllerRef>,
}
