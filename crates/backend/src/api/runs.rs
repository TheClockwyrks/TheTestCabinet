//! Publishing and reading runs, and the forced snapshot refresh (§1.4 of
//! `design/v0.2.0-contracts.md`).

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use test_cabinet_core::review::Rating;
use test_cabinet_core::run_record::{RunLinks, RunRecord};

use crate::db::{StoredReview, StoredRun};
use crate::error::ApiError;

use super::AppState;

/// The default and maximum page size for `GET /runs`.
const DEFAULT_LIMIT: usize = 50;
const MAX_LIMIT: usize = 200;

/// `POST /runs` — submit a published run (record + review + links). Validates
/// the review gate, ingests into SQLite, then queues a coalesced snapshot
/// refresh. Idempotent on `record.id` (201 newly published, 200 re-publish).
pub async fn publish(
    State(state): State<AppState>,
    Json(request): Json<PublishRequest>,
) -> Result<Response, ApiError> {
    // §1.4 validation gate (422 on failure): the rating must be a valid tier and
    // the writeup must be non-empty — publishing refuses a run without a review.
    let rating = Rating::parse(&request.review.rating).ok_or_else(|| {
        ApiError::unprocessable(format!(
            "review.rating must be one of flawless, great, scuffed, broken (got `{}`)",
            request.review.rating
        ))
    })?;
    if request.review.writeup.trim().is_empty() {
        return Err(ApiError::unprocessable(
            "review.writeup must be non-empty — publishing refuses a run without a review",
        ));
    }

    // The subject should resolve to an ingested version, but this is a warning,
    // not a hard fail, so a historical case can still be re-published.
    let subject = &request.record.subject;
    if !state
        .store
        .has_version(&subject.test_case_slug, &subject.test_case_version)
    {
        tracing::warn!(
            "publishing run {} against uningested case {}@{}",
            request.record.id,
            subject.test_case_slug,
            subject.test_case_version
        );
    }

    let review = StoredReview {
        rating,
        writeup: request.review.writeup.trim().to_string(),
    };
    let links = RunLinks {
        source_repo: request.links.source_repo,
        playable_build: request.links.playable_build,
    };
    let published_at = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|e| ApiError::internal(format!("formatting published_at: {e}")))?;

    let outcome = state
        .db
        .publish(&request.record, &review, &links, &published_at)
        .map_err(ApiError::from)?;

    // Coalesced: the dirty flag was set in the publish transaction; this only
    // wakes the debounce loop, which folds a burst into one regen/upload/rebuild.
    state.publisher.queue_refresh();

    let body = PublishResponse {
        id: request.record.id.clone(),
        newly_published: outcome.newly_published,
        snapshot_refresh: "queued",
    };
    let status = if outcome.newly_published {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Ok((status, Json(body)).into_response())
}

/// `GET /runs?limit=&before=` — list stored runs, newest first, paginated.
pub async fn list(
    State(state): State<AppState>,
    Query(params): Query<ListParams>,
) -> Result<Json<ListResponse>, ApiError> {
    let limit = params.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let (runs, next_before) = state
        .db
        .list_runs(limit, params.before.as_deref())
        .map_err(ApiError::from)?;
    Ok(Json(ListResponse {
        runs: runs.iter().map(stored_run_out).collect(),
        next_before,
    }))
}

/// `GET /runs/{id}` — one stored run.
pub async fn get(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<StoredRunOut>, ApiError> {
    let run = state
        .db
        .get_run(&id)
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found(format!("run `{id}` not found")))?;
    Ok(Json(stored_run_out(&run)))
}

/// `POST /snapshot/refresh` — force an immediate regen + upload + hook fire.
pub async fn refresh(State(state): State<AppState>) -> Result<Json<RefreshResponse>, ApiError> {
    let outcome = state
        .publisher
        .refresh_now()
        .await
        .map_err(ApiError::from)?;
    Ok(Json(RefreshResponse {
        refreshed: true,
        run_count: outcome.run_count,
        deploy_hook_fired: outcome.deploy_hook_fired,
    }))
}

/// Map a stored run to the §1.4 wire shape (`record` with links populated,
/// `review`, `links`).
fn stored_run_out(run: &StoredRun) -> StoredRunOut {
    StoredRunOut {
        record: run.record.clone(),
        review: ReviewOut {
            rating: run.review.rating.as_str(),
            writeup: run.review.writeup.clone(),
        },
        links: LinksOut {
            source_repo: run.links.source_repo.clone(),
            playable_build: run.links.playable_build.clone(),
        },
    }
}

// --- Wire shapes (§1.4) -----------------------------------------------------

#[derive(Deserialize)]
pub struct PublishRequest {
    record: RunRecord,
    review: ReviewIn,
    #[serde(default)]
    links: LinksIn,
}

#[derive(Deserialize)]
struct ReviewIn {
    rating: String,
    writeup: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct LinksIn {
    #[serde(default)]
    source_repo: Option<String>,
    #[serde(default)]
    playable_build: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PublishResponse {
    id: String,
    newly_published: bool,
    snapshot_refresh: &'static str,
}

#[derive(Deserialize)]
pub struct ListParams {
    limit: Option<usize>,
    before: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListResponse {
    runs: Vec<StoredRunOut>,
    next_before: Option<String>,
}

#[derive(Serialize)]
pub struct StoredRunOut {
    record: RunRecord,
    review: ReviewOut,
    links: LinksOut,
}

#[derive(Serialize)]
struct ReviewOut {
    rating: &'static str,
    writeup: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LinksOut {
    source_repo: Option<String>,
    playable_build: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshResponse {
    refreshed: bool,
    run_count: usize,
    deploy_hook_fired: bool,
}
