//! The run lifecycle endpoints: review, publish, and reads.
//!
//! A produced run is stored privately when it finishes (the driver reports it via
//! `POST /jobs/{id}/status`) — its build playable for reviewers but absent from the
//! public snapshot. Any account may then **review** it (one review per account). An
//! explicit **publish** flips it public, and is refused unless it has at least one
//! review. Review and publish each require a valid bearer token (see
//! [`crate::auth::AuthUser`]); reads stay open on the private network.

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

use test_cabinet_core::match_play::{ControllerKind, ControllerRef};
use test_cabinet_core::review::{DomainRating, ReviewVerdict};
use test_cabinet_core::run_record::RunRecord;

use crate::auth::AuthUser;
use crate::db::{
    Reviewer, SortDir, StoredReview, StoredRun, SummaryFilter, SummarySort, SummaryState,
};
use crate::error::ApiError;
use crate::snapshot::{RunSummary, run_summary_score};
use crate::store::{DefinitionStore, StoredManifest};

use super::AppState;

use std::collections::HashMap;

/// The default and maximum page size for `GET /runs`.
const DEFAULT_LIMIT: usize = 50;
const MAX_LIMIT: usize = 200;

/// `POST /runs/{id}/reviews` — submit a review for a run, attributed to the
/// token's account. The review gate (at least one domain rated, a non-empty
/// writeup) applies here. An account reviews a run at most once: re-submitting
/// updates that review. Requires a bearer token. `404` for an unknown run.
#[tracing::instrument(
    name = "runs.add_review",
    skip(state, user, request),
    fields(run.id = %id, reviewer = %user.0.username),
    err(Debug),
)]
pub async fn add_review(
    State(state): State<AppState>,
    Path(id): Path<String>,
    user: AuthUser,
    Json(request): Json<ReviewRequest>,
) -> Result<Json<ReviewResponse>, ApiError> {
    if request.ratings.is_empty() {
        return Err(ApiError::unprocessable(
            "review.ratings must rate at least one domain",
        ));
    }
    if request.writeup.trim().is_empty() {
        return Err(ApiError::unprocessable("review.writeup must be non-empty"));
    }

    let reviewed_at = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|e| ApiError::internal(format!("formatting reviewedAt: {e}")))?;
    let review = StoredReview {
        reviewer: Reviewer {
            user_id: user.0.id,
            username: user.0.username,
            display_name: user.0.display_name,
        },
        ratings: request.ratings,
        writeup: request.writeup.trim().to_string(),
        checklist: request.checklist,
        reviewed_at,
    };

    let published = state
        .db
        .add_review(&id, &review)
        .await
        .map_err(ApiError::from)?;

    // A review on an already-published run changes its public aggregate, so a
    // refresh is queued; on a pending run it is not yet public.
    if published {
        state.publisher.queue_refresh();
    }

    Ok(Json(ReviewResponse { id, published }))
}

/// `POST /runs/{id}/publish` — **enqueue** a publish for a run. The publish is now
/// asynchronous: the gh/wrangler release runs in a per-publish `tcab-publisher`
/// Job, so this only **gates** the run (refused with 422 unless it is publishable —
/// not an infrastructure failure, and a completed run with ≥1 review) and enqueues
/// a publish job. It no longer flips `published` synchronously — that happens when
/// the publisher reports a terminal success (see [`crate::api::publish_jobs`]).
/// Requires a bearer token. `404` for an unknown run. Returns `202 Accepted` with
/// the publish-job id and the live URL to observe it on.
#[tracing::instrument(
    name = "runs.publish",
    skip(state, _user),
    fields(run.id = %id, reviewer = %_user.0.username),
    err(Debug),
)]
pub async fn publish(
    State(state): State<AppState>,
    Path(id): Path<String>,
    _user: AuthUser,
) -> Result<Response, ApiError> {
    // Gate at enqueue so the user is rejected immediately (rather than after a
    // publish Job spins up and fails). This is the same gate the legacy
    // `Db::publish` flip enforces.
    state
        .db
        .ensure_publishable(&id)
        .await
        .map_err(ApiError::from)?;

    let publish_job_id = Uuid::new_v4().to_string();
    let job_token = Uuid::new_v4().to_string();
    let created_at = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|e| ApiError::internal(format!("formatting created_at: {e}")))?;

    state
        .db
        .enqueue_publish_job(crate::db::NewPublishJob {
            id: publish_job_id.clone(),
            run_id: id.clone(),
            job_token,
            created_at,
        })
        .await
        .map_err(ApiError::from)?;

    let body = PublishResponse {
        publish_job_id: publish_job_id.clone(),
        live_url: format!("/publish-jobs/{publish_job_id}/live"),
    };
    Ok((StatusCode::ACCEPTED, Json(body)).into_response())
}

/// `DELETE /runs/{id}` — permanently delete a run. Refused with `422` when the
/// run is **published** (a public run is in the snapshot and gallery and can
/// never be deleted). Requires a bearer token. `404` for an unknown run. Removes
/// the run record, its reviews, its links, and its stored media.
#[tracing::instrument(
    name = "runs.delete",
    skip(state, _user),
    fields(run.id = %id, reviewer = %_user.0.username),
    err(Debug),
)]
pub async fn delete(
    State(state): State<AppState>,
    Path(id): Path<String>,
    _user: AuthUser,
) -> Result<Response, ApiError> {
    // The system of record is the run row: deleting it (and its cascaded reviews
    // and links) makes the run vanish from every listing. This also enforces the
    // published guard, so it runs first.
    state.db.delete_run(&id).await.map_err(ApiError::from)?;

    // Then clear the run's stored media tree so deletion leaves nothing behind.
    // The authoritative record is already gone, so a media-cleanup fault must not
    // fail the request — log it and leave the (now-unreferenced) bytes for a later
    // sweep rather than resurrecting a half-deleted run.
    if let Err(err) = state.store.delete_run_media(&id) {
        tracing::warn!("deleted run {id} but failed to remove its media: {err}");
    }

    // A run's playable build and recorded logs live in the separate artifact
    // service; ask it to prune the tree too. Best-effort (see
    // [`crate::artifacts`]): a failure is logged, never surfaced — the record is
    // already gone, so the run has vanished from every listing regardless.
    crate::artifacts::delete_run_tree(
        &state.http,
        state.config.artifacts_url.as_deref(),
        state.config.service_token.as_deref(),
        &id,
    )
    .await;

    // Only an unpublished run can be deleted, so the run was not in the public
    // snapshot — no refresh is queued.
    Ok((StatusCode::OK, Json(DeleteResponse { id, deleted: true })).into_response())
}

/// `GET /runs?limit=&before=&state=` — list runs, newest first, paginated.
///
/// `state` defaults to `published` (the public read side: only published runs,
/// ordered by publish time). `state=review` returns **completed** runs — pending
/// and published — ordered by finish time, for the reviewer worklist.
/// `state=failures` returns the **publishable failure** runs (catastrophic and
/// timed-out, pending and published) for the publish-failures affordance.
/// `state=unpublished` returns **every** pushed-but-unpublished run whatever its
/// state (completed, every failure tier, including the never-publishable
/// infrastructure failures), ordered by finish time — the console's "produced"
/// worklist, disjoint from the default published listing.
///
/// `fields=summary` returns bounded [`RunSummary`] cards (the lightweight shape
/// the console's run log and list pages consume) instead of full
/// [`StoredRunOut`] records; the cursor (`before`/`limit`) and `state` selector
/// behave identically for both projections. Any other `fields` value (or none)
/// keeps the default full records.
pub async fn list(
    State(state): State<AppState>,
    Query(params): Query<ListParams>,
) -> Result<Response, ApiError> {
    let limit = params.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);

    // The numbered-pager path: a summary projection with an explicit `offset` uses
    // the OFFSET + total-COUNT listing (with filter/free-text/sort), distinct from
    // the `before`-cursor path below. Only the summary projection carries it.
    if params.fields.as_deref() == Some("summary")
        && let Some(offset) = params.offset
    {
        let filter = SummaryFilter {
            state: summary_state(params.state.as_deref()),
            test_case: params.test_case.clone(),
            model: params.model.clone(),
            harness: params.harness.clone(),
            q: params.q.clone(),
        };
        let sort = parse_sort(params.sort.as_deref());
        let dir = parse_dir(params.dir.as_deref());
        let (runs, total) = state
            .db
            .list_summaries(&filter, sort, dir, limit, offset)
            .await
            .map_err(ApiError::from)?;
        return Ok(Json(SummaryListResponse {
            runs: summary_cards(&state.store, &runs),
            next_before: None,
            total: Some(total),
        })
        .into_response());
    }

    let (runs, next_before) = match params.state.as_deref() {
        Some("review") | Some("all") => state
            .db
            .list_for_review(limit, params.before.as_deref())
            .await
            .map_err(ApiError::from)?,
        Some("failures") => state
            .db
            .list_publishable_failures(limit, params.before.as_deref())
            .await
            .map_err(ApiError::from)?,
        Some("unpublished") => state
            .db
            .list_unpublished(limit, params.before.as_deref())
            .await
            .map_err(ApiError::from)?,
        _ => state
            .db
            .list_published(limit, params.before.as_deref())
            .await
            .map_err(ApiError::from)?,
    };
    if params.fields.as_deref() == Some("summary") {
        Ok(Json(SummaryListResponse {
            runs: summary_cards(&state.store, &runs),
            next_before,
            total: None,
        })
        .into_response())
    } else {
        Ok(Json(ListResponse {
            runs: runs.iter().map(stored_run_out).collect(),
            next_before,
        })
        .into_response())
    }
}

/// Build the summary cards for a page of runs, enriching each with its aggregate
/// reviewer `score` — the one field [`RunSummary::from_stored`] leaves `None`
/// because the checklist weights live only in the case catalog, not the run.
///
/// Each run's manifest is resolved from the definition store and its reviews
/// scored against that case's declared weights (see [`run_summary_score`]). The
/// resolved manifest is cached per `(slug, version)` so a case is read once per
/// page rather than once per run; a run whose case isn't ingested keeps
/// `score = None`.
fn summary_cards(store: &DefinitionStore, runs: &[StoredRun]) -> Vec<RunSummary> {
    let mut manifests: HashMap<(String, String), Option<StoredManifest>> = HashMap::new();
    runs.iter()
        .map(|run| {
            let mut card = RunSummary::from_stored(run);
            let subject = &run.record.subject;
            let key = (
                subject.test_case_slug.clone(),
                subject.test_case_version.clone(),
            );
            let manifest = manifests.entry(key).or_insert_with(|| {
                store
                    .read_manifest(&subject.test_case_slug, &subject.test_case_version)
                    .ok()
            });
            if let Some(manifest) = manifest {
                card.score = run_summary_score(manifest, &subject.variant, &run.reviews);
            }
            card
        })
        .collect()
}

/// `GET /adversarial/controllers?testCase=<slug>` — the pushed adversarial
/// controllers for a case: every stored run (pending or published) that produced
/// an adversarial result and uploaded a controller wasm. The arena resolves these
/// as [`ControllerKind::PushedRun`] (fetching the wasm from
/// `GET /runs/{id}/controller.wasm`), so a reviewer can pit a pushed
/// implementation from any host. A read; no auth on the private network.
pub async fn adversarial_controllers(
    State(state): State<AppState>,
    Query(params): Query<ControllersParams>,
) -> Result<Json<ControllersResponse>, ApiError> {
    let runs = state
        .db
        .list_for_case(&params.test_case)
        .await
        .map_err(ApiError::from)?;
    let controllers = runs
        .into_iter()
        .filter(|run| run.record.validation.adversarial.is_some())
        // Only runs whose controller wasm actually landed can be pitted.
        .filter(|run| state.store.has_run_controller(&run.record.id))
        .map(|run| ControllerRef {
            id: run.record.id.clone(),
            kind: ControllerKind::PushedRun,
            label: Some(run.record.subject.model_id.clone()),
        })
        .collect();
    Ok(Json(ControllersResponse { controllers }))
}

/// `GET /runs/{id}` — one stored run (published or pending) with its reviews.
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

/// Map a stored run to the read-side wire shape: `record` (links populated), the
/// reviews array, the resolved links, and the published flag.
fn stored_run_out(run: &StoredRun) -> StoredRunOut {
    StoredRunOut {
        record: run.record.clone(),
        reviews: run.reviews.iter().map(review_out).collect(),
        links: LinksOut {
            source_repo: run.links.source_repo.clone(),
            playable_build: run.links.playable_build.clone(),
        },
        published: run.published,
    }
}

/// Map a stored review to its read-side wire shape, exposing the reviewer's
/// public identity.
fn review_out(review: &StoredReview) -> ReviewOut {
    ReviewOut {
        reviewer_id: review.reviewer.user_id.clone(),
        reviewer: review.reviewer.display_name.clone(),
        username: review.reviewer.username.clone(),
        ratings: review.ratings.clone(),
        writeup: review.writeup.clone(),
        checklist: review.checklist.clone(),
        reviewed_at: review.reviewed_at.clone(),
    }
}

// --- Wire shapes ------------------------------------------------------------

#[derive(Deserialize)]
pub struct ReviewRequest {
    #[serde(default)]
    ratings: Vec<DomainRating>,
    writeup: String,
    #[serde(default)]
    checklist: Vec<ReviewVerdict>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewResponse {
    id: String,
    /// Whether the run is published (and so this review changed something public).
    published: bool,
}

/// The body of `POST /runs/{id}/publish`: the enqueued publish job's id and the
/// live URL to observe it on. Publishing is now asynchronous — the console
/// subscribes to `live_url` (an NDJSON stream ending in the terminal result) rather
/// than receiving a synchronous `newlyPublished`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PublishResponse {
    publish_job_id: String,
    live_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeleteResponse {
    id: String,
    deleted: bool,
}

#[derive(Deserialize)]
pub struct ListParams {
    limit: Option<usize>,
    before: Option<String>,
    /// `published` (default) for the public listing, or `review`/`all` for the
    /// reviewer worklist (pending + published).
    state: Option<String>,
    /// `summary` returns bounded [`RunSummary`] cards instead of full
    /// [`StoredRunOut`] records; any other value (or none) keeps the full records.
    fields: Option<String>,
    /// The 0-based row offset for the numbered-pager path. Present only on the
    /// summary projection; when set, the offset + total-count listing (with the
    /// filter/free-text/sort params below) is used instead of the `before` cursor.
    /// The struct has no `rename_all`, so each field binds by its Rust name; only
    /// `test_case` needs a `rename` to reach the camelCase wire name `testCase`.
    offset: Option<usize>,
    /// Filter to one test-case slug (summary + offset path only). Wire: `testCase`.
    #[serde(rename = "testCase")]
    test_case: Option<String>,
    /// Filter to one model id (summary + offset path only).
    model: Option<String>,
    /// Filter to one harness slug (summary + offset path only).
    harness: Option<String>,
    /// Case-insensitive free-text query across the lifted identity columns (summary
    /// + offset path only).
    q: Option<String>,
    /// The sort column: `date` (default), `runtime`, `tokens`, `cost`, `rating`,
    /// `testType`, `testCase`, `harness`, `model`, `variant`.
    sort: Option<String>,
    /// The sort direction: `desc` (default) or `asc`.
    dir: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListResponse {
    runs: Vec<StoredRunOut>,
    next_before: Option<String>,
}

/// The lightweight `fields=summary` projection of [`ListResponse`]: bounded run
/// cards plus the same cursor. Not a contract-codegen type — a plain axum
/// response reusing the [`RunSummary`] contract shape (already registered via the
/// snapshot's `runs.json` index).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryListResponse {
    runs: Vec<RunSummary>,
    next_before: Option<String>,
    /// The total number of matching rows, ignoring the page window — present only
    /// on the numbered-pager (offset) path, to size the console's pager. Absent on
    /// the `before`-cursor path (which drains rather than jumps), so that wire shape
    /// is unchanged.
    #[serde(skip_serializing_if = "Option::is_none")]
    total: Option<usize>,
}

/// Map the `state` query param to the summary listing's lifecycle slice, mirroring
/// the cursor path's `state` handling (`review`/`all` → the reviewer worklist).
fn summary_state(state: Option<&str>) -> SummaryState {
    match state {
        Some("review") | Some("all") => SummaryState::Review,
        Some("failures") => SummaryState::Failures,
        Some("unpublished") => SummaryState::Unpublished,
        _ => SummaryState::Published,
    }
}

/// Map the `sort` query param to a [`SummarySort`], defaulting to `Date`.
fn parse_sort(sort: Option<&str>) -> SummarySort {
    match sort {
        Some("runtime") => SummarySort::Runtime,
        Some("tokens") => SummarySort::Tokens,
        Some("cost") => SummarySort::Cost,
        Some("rating") => SummarySort::Rating,
        Some("testType") => SummarySort::TestType,
        Some("testCase") => SummarySort::TestCase,
        Some("harness") => SummarySort::Harness,
        Some("model") => SummarySort::Model,
        Some("variant") => SummarySort::Variant,
        _ => SummarySort::Date,
    }
}

/// Map the `dir` query param to a [`SortDir`], defaulting to `Desc`.
fn parse_dir(dir: Option<&str>) -> SortDir {
    match dir {
        Some("asc") => SortDir::Asc,
        _ => SortDir::Desc,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControllersParams {
    /// The test case slug whose pushed controllers to list.
    test_case: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControllersResponse {
    controllers: Vec<ControllerRef>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredRunOut {
    record: RunRecord,
    /// The run's reviews, oldest first. Empty while the run is pending review.
    reviews: Vec<ReviewOut>,
    links: LinksOut,
    /// Whether the run is published (in the public snapshot).
    published: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReviewOut {
    reviewer_id: String,
    reviewer: String,
    username: String,
    ratings: Vec<DomainRating>,
    writeup: String,
    checklist: Vec<ReviewVerdict>,
    reviewed_at: String,
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
