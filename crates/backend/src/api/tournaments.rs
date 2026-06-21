//! Publishing and reading adversarial tournaments, and serving per-match replays.
//!
//! Tournaments mirror runs (a verbatim record in SQLite plus on-disk assets) but
//! are **live-only**: they are served straight from the store and are not folded
//! into the public-site snapshot, and they carry no review gate.

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use test_cabinet_core::match_play::TournamentRecord;

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

/// `GET /tournaments/{id}/matches/{matchId}/replay.json` — one match's replay,
/// served immutable (replays never change once published).
pub async fn match_replay(
    State(state): State<AppState>,
    Path((id, match_id)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    let bytes = state
        .store
        .read_tournament_match(&id, &match_id)
        .map_err(ApiError::from)?;
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
/// replay, uploaded by the publisher alongside the tournament record.
pub async fn put_match_replay(
    State(state): State<AppState>,
    Path((id, match_id)): Path<(String, String)>,
    body: axum::body::Bytes,
) -> Result<Response, ApiError> {
    state
        .store
        .write_tournament_match(&id, &match_id, &body)
        .map_err(ApiError::from)?;
    Ok((StatusCode::NO_CONTENT, ()).into_response())
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
