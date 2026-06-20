//! Publishing and reading runs, and the forced snapshot refresh (§1.4 of
//! `design/v0.2.0-contracts.md`).

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use test_cabinet_core::event::HarnessEvent;
use test_cabinet_core::review::{DomainRating, ReviewVerdict};
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
#[tracing::instrument(
    name = "runs.publish",
    skip(state, request),
    fields(
        run.id = %request.record.id,
        case.slug = %request.record.subject.test_case_slug,
        case.version = %request.record.subject.test_case_version,
    ),
    err(Debug),
)]
pub async fn publish(
    State(state): State<AppState>,
    Json(request): Json<PublishRequest>,
) -> Result<Response, ApiError> {
    // §1.4 validation gate (422 on failure): at least one domain must be rated
    // (the rating tiers are validated by deserialization) and the writeup must be
    // non-empty — publishing refuses a run without a review.
    if request.review.ratings.is_empty() {
        return Err(ApiError::unprocessable(
            "review.ratings must rate at least one domain — publishing refuses a run without a review",
        ));
    }
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
        ratings: request.review.ratings,
        writeup: request.review.writeup.trim().to_string(),
        checklist: request.review.checklist,
    };
    let links = RunLinks {
        source_repo: request.links.source_repo,
        playable_build: request.links.playable_build,
    };
    let published_at = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|e| ApiError::internal(format!("formatting published_at: {e}")))?;

    // Persist the run's recorded event stream verbatim as a JSON array (omitted
    // when empty), so the published Events tab can replay it. Raw harness output
    // is never published.
    let events_json = if request.events.is_empty() {
        None
    } else {
        Some(
            serde_json::to_string(&request.events)
                .map_err(|e| ApiError::internal(format!("serializing events: {e}")))?,
        )
    };

    let outcome = state
        .db
        .publish(
            &request.record,
            &review,
            &links,
            &published_at,
            events_json.as_deref(),
        )
        .await
        .map_err(ApiError::from)?;

    // Coalesced: the dirty flag was set in the publish transaction; this only
    // wakes the debounce loop, which folds a burst into one regen/upload/rebuild.
    state.publisher.queue_refresh();

    // Domain metric: one accepted publish, split by first-publish vs re-publish.
    crate::metrics::record_run_published(outcome.newly_published);

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
        .await
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
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found(format!("run `{id}` not found")))?;
    Ok(Json(stored_run_out(&run)))
}

/// `GET /runs/{id}/events` — the published run's recorded normalized event
/// stream, as a JSON array (an empty array when the run recorded none). Raw
/// harness output is never published, so it is not served here. `404` for an
/// unknown run.
pub async fn events(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    let run = state
        .db
        .get_run(&id)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found(format!("run `{id}` not found")))?;
    // Stored verbatim as a JSON array; pass it through unparsed, defaulting to an
    // empty array when the run carries no events.
    let body = run.events_json.unwrap_or_else(|| "[]".to_string());
    Ok((
        [
            (header::CONTENT_TYPE, "application/json"),
            (header::CACHE_CONTROL, "public, max-age=300"),
        ],
        body,
    )
        .into_response())
}

/// `POST /snapshot/refresh` — force an immediate regen + upload + hook fire.
#[tracing::instrument(name = "snapshot.refresh", skip(state), err(Debug))]
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
            ratings: run.review.ratings.clone(),
            writeup: run.review.writeup.clone(),
            checklist: run.review.checklist.clone(),
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
    /// The run's recorded normalized event stream (empty when the run recorded
    /// none); stored verbatim and re-emitted to the snapshot.
    events: Vec<HarnessEvent>,
}

#[derive(Deserialize)]
struct ReviewIn {
    #[serde(default)]
    ratings: Vec<DomainRating>,
    writeup: String,
    #[serde(default)]
    checklist: Vec<ReviewVerdict>,
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
    ratings: Vec<DomainRating>,
    writeup: String,
    checklist: Vec<ReviewVerdict>,
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
