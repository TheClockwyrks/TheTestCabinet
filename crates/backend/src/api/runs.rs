//! The run lifecycle endpoints: push, review, publish, and reads.
//!
//! A run is **pushed** (record + links + events, no review) — stored privately,
//! its build playable for reviewers but absent from the public snapshot. Any
//! account may then **review** it (one review per account). An explicit
//! **publish** flips it public, and is refused unless it has at least one review.
//! Push, review, and publish each require a valid bearer token (see
//! [`crate::auth::AuthUser`]); reads stay open on the private network.

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use test_cabinet_core::event::HarnessEvent;
use test_cabinet_core::match_play::{ControllerKind, ControllerRef};
use test_cabinet_core::review::{DomainRating, ReviewVerdict};
use test_cabinet_core::run_record::{RunLinks, RunRecord, RunState};

use crate::auth::AuthUser;
use crate::db::{Reviewer, StoredReview, StoredRun};
use crate::error::ApiError;

use super::AppState;

/// The default and maximum page size for `GET /runs`.
const DEFAULT_LIMIT: usize = 50;
const MAX_LIMIT: usize = 200;

/// `POST /runs` — push a run (record + links + events, **no** review). Stores it
/// privately (unpublished) so a reviewer can play the build; it does not enter
/// the public snapshot until published. Requires a bearer token. Idempotent on
/// `record.id` (201 newly pushed, 200 re-push).
#[tracing::instrument(
    name = "runs.push",
    skip(state, _user, request),
    fields(
        run.id = %request.record.id,
        case.slug = %request.record.subject.test_case_slug,
        case.version = %request.record.subject.test_case_version,
    ),
    err(Debug),
)]
pub async fn push(
    State(state): State<AppState>,
    _user: AuthUser,
    Json(request): Json<PushRequest>,
) -> Result<Response, ApiError> {
    // Only a run that produced a result can enter the backend: a failed run is
    // recorded so the consoles can show why it stopped, but it is never reviewable
    // or publishable. The consoles already refuse to push one; this is the
    // server-side guard so a failed run can never reach the public snapshot even
    // if a client bypasses the UI.
    if request.record.status.state != RunState::Completed {
        return Err(ApiError::unprocessable(
            "a run that did not complete cannot be pushed; only completed runs are reviewable",
        ));
    }

    // The subject should resolve to an ingested version, but this is a warning,
    // not a hard fail, so a historical case can still be pushed.
    let subject = &request.record.subject;
    if !state
        .store
        .has_version(&subject.test_case_slug, &subject.test_case_version)
    {
        tracing::warn!(
            "pushing run {} against uningested case {}@{}",
            request.record.id,
            subject.test_case_slug,
            subject.test_case_version
        );
    }

    let links = RunLinks {
        source_repo: request.links.source_repo,
        playable_build: request.links.playable_build,
    };

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
        .push(&request.record, &links, events_json.as_deref())
        .await
        .map_err(ApiError::from)?;

    let body = PushResponse {
        id: request.record.id.clone(),
        newly_pushed: outcome.newly_pushed,
    };
    let status = if outcome.newly_pushed {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Ok((status, Json(body)).into_response())
}

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

/// `POST /runs/{id}/publish` — publish a run (flip it public). Refused with 422
/// unless the run has at least one review. Requires a bearer token. Idempotent
/// (201 newly published, 200 re-publish). `404` for an unknown run.
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
    let published_at = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|e| ApiError::internal(format!("formatting published_at: {e}")))?;

    let outcome = state
        .db
        .publish(&id, &published_at)
        .await
        .map_err(ApiError::from)?;

    // Coalesced: the dirty flag was set in the publish transaction; this only
    // wakes the debounce loop, which folds a burst into one regen/upload/rebuild.
    state.publisher.queue_refresh();
    crate::metrics::record_run_published(outcome.newly_published);

    let body = PublishResponse {
        id: id.clone(),
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

/// `GET /runs?limit=&before=&state=` — list runs, newest first, paginated.
///
/// `state` defaults to `published` (the public read side: only published runs,
/// ordered by publish time). `state=review` returns **completed** runs — pending
/// and published — ordered by finish time, for the reviewer worklist.
/// `state=failures` returns the **publishable failure** runs (catastrophic and
/// timed-out, pending and published) for the publish-failures affordance.
pub async fn list(
    State(state): State<AppState>,
    Query(params): Query<ListParams>,
) -> Result<Json<ListResponse>, ApiError> {
    let limit = params.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
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
        _ => state
            .db
            .list_published(limit, params.before.as_deref())
            .await
            .map_err(ApiError::from)?,
    };
    Ok(Json(ListResponse {
        runs: runs.iter().map(stored_run_out).collect(),
        next_before,
    }))
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

/// The body of `POST /runs`, the **push** step: a finished run's
/// machine-generated record, its resolved public links, and its optional
/// recorded event stream. A push stores the run *without* a review and does not
/// make it public — the build is released so it can be reviewed, but the run is
/// excluded from the public snapshot until it is published (see
/// `POST /runs/{id}/publish`). Reviews are submitted separately to
/// `POST /runs/{id}/reviews`. Requires a bearer token; idempotent on `record.id`.
#[derive(Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PushRequest {
    /// A full run record. Its `links` MAY be empty here; the `links` below are
    /// authoritative and the backend writes them onto the stored record.
    record: RunRecord,
    #[serde(default)]
    links: LinksIn,
    /// The run's recorded normalized event stream (empty when the run recorded
    /// none); stored verbatim and re-emitted to the snapshot once published.
    #[serde(default)]
    events: Vec<HarnessEvent>,
}

#[derive(Deserialize)]
pub struct ReviewRequest {
    #[serde(default)]
    ratings: Vec<DomainRating>,
    writeup: String,
    #[serde(default)]
    checklist: Vec<ReviewVerdict>,
}

/// The resolved public links for a pushed run — the authoritative copies the
/// backend writes onto the stored record.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct LinksIn {
    /// The public repository holding the run's generated source.
    #[serde(default)]
    source_repo: Option<String>,
    /// The deployment URL the build tool reported, recorded verbatim. A pushed
    /// run's build is playable (so it can be reviewed) even before publish.
    #[serde(default)]
    playable_build: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PushResponse {
    id: String,
    newly_pushed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewResponse {
    id: String,
    /// Whether the run is published (and so this review changed something public).
    published: bool,
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
    /// `published` (default) for the public listing, or `review`/`all` for the
    /// reviewer worklist (pending + published).
    state: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListResponse {
    runs: Vec<StoredRunOut>,
    next_before: Option<String>,
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
