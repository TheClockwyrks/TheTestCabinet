//! Recording and reading adversarial tournaments, and serving per-match replays.
//!
//! The arena records a tournament from the moment it accepts it: the field and its
//! pairings, each match as it completes, and the state it moves through (the API's
//! "Tournaments"). Each match replay is kept on the artifact service's private
//! container, written and read back through [`ArtifactsClient`] (the backend
//! overview's "Durable state"). Tournaments are **live-only**: they are not folded
//! into the public-site snapshot, and they carry no review gate.

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use test_cabinet_contracts::match_play::{
    MatchSummary, PendingTournament, RecordedTournament, TournamentTransition,
};

use crate::artifacts::{ArtifactsClient, ArtifactsError};
use crate::auth::ServiceCaller;
use crate::db::PendingRecorded;
use crate::error::ApiError;

use super::AppState;

/// The default and maximum page size for `GET /tournaments`.
const DEFAULT_LIMIT: usize = 50;
const MAX_LIMIT: usize = 200;

/// Now, as RFC 3339.
fn now() -> Result<String, ApiError> {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|e| ApiError::internal(format!("formatting the time: {e}")))
}

/// `PUT /tournaments/{id}` — record a pending tournament in state `queued`: `201`
/// newly recorded, `200` for a repeat with identical content, `409` for a
/// different tournament under a recorded id.
#[tracing::instrument(
    name = "tournaments.record_pending",
    skip(state, pending),
    fields(tournament.id = %id, case.slug = %pending.test_case_slug),
    err(Debug),
)]
pub async fn record_pending(
    State(state): State<AppState>,
    _caller: ServiceCaller,
    Path(id): Path<String>,
    Json(pending): Json<PendingTournament>,
) -> Result<Response, ApiError> {
    if pending.id != id {
        return Err(ApiError::bad_request(format!(
            "the body records tournament `{}`, not `{id}`",
            pending.id
        )));
    }
    let recorded = state
        .db
        .record_pending_tournament(&pending, &now()?)
        .await
        .map_err(ApiError::from)?;
    let status = match recorded {
        PendingRecorded::Recorded => StatusCode::CREATED,
        PendingRecorded::Unchanged => StatusCode::OK,
    };
    Ok(status.into_response())
}

/// `PUT /tournaments/{id}/matches/{matchId}` — record one pairing's result.
#[tracing::instrument(
    name = "tournaments.record_match",
    skip(state, summary),
    fields(tournament.id = %id, match.id = %match_id),
    err(Debug),
)]
pub async fn record_match(
    State(state): State<AppState>,
    _caller: ServiceCaller,
    Path((id, match_id)): Path<(String, String)>,
    Json(summary): Json<MatchSummary>,
) -> Result<StatusCode, ApiError> {
    state
        .db
        .record_tournament_match(&id, &match_id, &summary)
        .await
        .map_err(ApiError::from)?;
    Ok(StatusCode::NO_CONTENT)
}

/// `POST /tournaments/{id}/state` — move a tournament to `running`, `succeeded`
/// with its standings, or `failed` with its reason.
#[tracing::instrument(
    name = "tournaments.transition",
    skip(state, transition),
    fields(tournament.id = %id, tournament.state = %transition.state().as_str()),
    err(Debug),
)]
pub async fn transition(
    State(state): State<AppState>,
    _caller: ServiceCaller,
    Path(id): Path<String>,
    Json(transition): Json<TournamentTransition>,
) -> Result<StatusCode, ApiError> {
    state
        .db
        .transition_tournament(&id, &transition, &now()?)
        .await
        .map_err(ApiError::from)?;
    Ok(StatusCode::NO_CONTENT)
}

/// `GET /tournaments?limit=&before=` — the succeeded tournaments, newest first,
/// paginated.
pub async fn list(
    State(state): State<AppState>,
    Query(params): Query<ListParams>,
) -> Result<Json<ListResponse>, ApiError> {
    let limit = params.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let (tournaments, next_before) = state
        .db
        .list_tournaments(limit, params.before.as_deref())
        .await
        .map_err(ApiError::from)?;
    Ok(Json(ListResponse {
        tournaments,
        next_before,
    }))
}

/// `GET /tournaments/unfinished` — every `queued` and `running` tournament,
/// oldest first, for the arena to resume.
pub async fn unfinished(
    State(state): State<AppState>,
    _caller: ServiceCaller,
) -> Result<Json<UnfinishedResponse>, ApiError> {
    let tournaments = state
        .db
        .unfinished_tournaments()
        .await
        .map_err(ApiError::from)?;
    Ok(Json(UnfinishedResponse { tournaments }))
}

/// `GET /tournaments/{id}` — one recorded tournament, in any state.
pub async fn get(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<RecordedTournament>, ApiError> {
    let tournament = state
        .db
        .get_tournament(&id)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found(format!("tournament `{id}` not found")))?;
    Ok(Json(tournament))
}

/// `GET /tournaments/{id}/matches/{matchId}/replay.json` — one match's replay, read
/// from the artifact service and served immutable (replays never change once
/// published). `404` when the service holds none for the match.
pub async fn match_replay(
    State(state): State<AppState>,
    Path((id, match_id)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    let bytes = artifacts(&state)?
        .match_replay(&id, &match_id)
        .await
        .map_err(replay_error)?
        .ok_or_else(|| {
            ApiError::not_found(format!(
                "replay for match `{match_id}` of tournament `{id}` not stored"
            ))
        })?;
    Ok((
        [
            (header::CONTENT_TYPE, "application/json"),
            (header::CACHE_CONTROL, "public, max-age=31536000, immutable"),
        ],
        bytes,
    )
        .into_response())
}

/// `POST /tournaments/{id}/matches/{matchId}/replay.json` — store one match's
/// replay, uploaded by the arena before it records the match's summary, through
/// the artifact service. The service answers only once the replay is stored, so a
/// `204` means it is durable.
pub async fn put_match_replay(
    State(state): State<AppState>,
    _caller: ServiceCaller,
    Path((id, match_id)): Path<(String, String)>,
    body: axum::body::Bytes,
) -> Result<Response, ApiError> {
    artifacts(&state)?
        .put_match_replay(&id, &match_id, body.to_vec())
        .await
        .map_err(replay_error)?;
    Ok((StatusCode::NO_CONTENT, ()).into_response())
}

/// The artifact-service client the replay routes go through, or `503` when the
/// deployment configures no artifact service (`TCAB_ARTIFACTS_URL`) or no service
/// token to present to it: the replays have nowhere else to live.
fn artifacts(state: &AppState) -> Result<ArtifactsClient, ApiError> {
    ArtifactsClient::from_config(
        state.http.clone(),
        state.config.artifacts_internal_url.as_deref(),
        state.config.service_token.as_deref(),
    )
    .ok_or_else(|| {
        ApiError::unavailable(
            "tournament match replays are kept on the artifact service, and none is \
             configured (TCAB_ARTIFACTS_URL and TCAB_BACKEND_SERVICE_TOKEN)",
        )
    })
}

/// A failed replay call, as the route answers it: an id that cannot name one path
/// segment is the caller's mistake (`400`), and the service refusing or not
/// answering is a gateway failure (`502`).
fn replay_error(err: ArtifactsError) -> ApiError {
    match err {
        ArtifactsError::BadSegment(_) => {
            ApiError::bad_request(format!("invalid tournament id or match id: {err}"))
        }
        ArtifactsError::Refused(_) | ArtifactsError::Transport(_) => ApiError::new(
            StatusCode::BAD_GATEWAY,
            "artifacts_unavailable",
            format!("storing or reading the match replay failed: {err}"),
        ),
    }
}

// --- Wire shapes ------------------------------------------------------------

#[derive(Deserialize)]
pub struct ListParams {
    limit: Option<usize>,
    before: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListResponse {
    tournaments: Vec<RecordedTournament>,
    next_before: Option<String>,
}

#[derive(Serialize)]
pub struct UnfinishedResponse {
    tournaments: Vec<RecordedTournament>,
}
