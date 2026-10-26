//! Publishing and reading adversarial tournaments, and serving per-match replays.
//!
//! A tournament is a verbatim record in the database, and each of its match replays
//! is kept on the artifact service's private container, written and read back through
//! [`ArtifactsClient`] (the backend overview's "Durable state"). Tournaments are
//! **live-only**: they are not folded into the public-site snapshot, and they carry
//! no review gate.

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use test_cabinet_contracts::match_play::TournamentRecord;

use crate::artifacts::{ArtifactsClient, ArtifactsError};
use crate::auth::ServiceCaller;
use crate::db::StoredTournament;
use crate::error::ApiError;

use super::AppState;

/// The default and maximum page size for `GET /tournaments`.
const DEFAULT_LIMIT: usize = 50;
const MAX_LIMIT: usize = 200;

/// `POST /tournaments` — publish a tournament record. Idempotent on `record.id`
/// (201 newly published, 200 re-publish). The per-match replays are uploaded
/// separately to `POST /tournaments/{id}/matches/{matchId}/replay.json`.
#[tracing::instrument(
    name = "tournaments.publish",
    skip(state, record),
    fields(tournament.id = %record.id, case.slug = %record.test_case_slug),
    err(Debug),
)]
pub async fn publish(
    State(state): State<AppState>,
    _caller: ServiceCaller,
    Json(record): Json<TournamentRecord>,
) -> Result<Response, ApiError> {
    let published_at = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|e| ApiError::internal(format!("formatting published_at: {e}")))?;

    let outcome = state
        .db
        .publish_tournament(&record, &published_at)
        .await
        .map_err(ApiError::from)?;

    let body = PublishResponse {
        id: record.id.clone(),
        newly_published: outcome.newly_published,
    };
    let status = if outcome.newly_published {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Ok((status, Json(body)).into_response())
}

/// `GET /tournaments?limit=&before=` — list tournaments, newest first, paginated.
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
        tournaments: tournaments.iter().map(tournament_out).collect(),
        next_before,
    }))
}

/// `GET /tournaments/{id}` — one tournament.
pub async fn get(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<TournamentOut>, ApiError> {
    let tournament = state
        .db
        .get_tournament(&id)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found(format!("tournament `{id}` not found")))?;
    Ok(Json(tournament_out(&tournament)))
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
/// replay, uploaded by the arena alongside the tournament record, through the
/// artifact service. The service answers only once the replay is stored, so a
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

/// Map a stored tournament to its wire shape (`record` + `publishedAt`).
fn tournament_out(tournament: &StoredTournament) -> TournamentOut {
    TournamentOut {
        record: tournament.record.clone(),
        published_at: tournament.published_at.clone(),
    }
}

// --- Wire shapes ------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PublishResponse {
    id: String,
    newly_published: bool,
}

#[derive(Deserialize)]
pub struct ListParams {
    limit: Option<usize>,
    before: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListResponse {
    tournaments: Vec<TournamentOut>,
    next_before: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TournamentOut {
    record: TournamentRecord,
    published_at: String,
}
