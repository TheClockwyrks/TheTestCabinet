//! The run-queue endpoints: enqueue, claim, ingest progress, advance state, and
//! the live stream.
//!
//! A run is no longer driven by a worker the console talks to directly; the
//! console **enqueues** a run here (`POST /jobs`), the **dispatcher** claims it
//! (`POST /jobs/next`, service-token), and a per-run **driver** pod streams the
//! run's events, preview frames, and terminal status back
//! (`POST /jobs/{id}/events|preview|status`, per-job token). The console observes
//! it entirely through the backend: the live NDJSON stream (`GET /jobs/{id}/live`),
//! the status (`GET /jobs/{id}`), the active-run list (`GET /jobs/active`), and
//! the worker-wide console stream (`GET /notifications`) — completion alerts and
//! run-lifecycle events multiplexed under per-client topics, which is how a console
//! keeps its in-flight list current without re-reading the active list on a timer.
//!
//! The durable job lifecycle is the `job` table; the live event/preview fan-out
//! is the in-memory [`crate::relay`]. A produced run's record lands in the `run`
//! table via [`crate::db::Db::push`] on success, the same store a locally-driven
//! `tcab` run pushes to.

use std::collections::{HashMap, HashSet};
use std::convert::Infallible;

use axum::Json;
use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use bytes::Bytes;
use futures_util::stream::{self, Stream, StreamExt};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use tokio::sync::broadcast::error::RecvError;
use uuid::Uuid;

use test_cabinet_core::event::HarnessEvent;
use test_cabinet_core::preview::AssetPreview;
use test_cabinet_core::run_record::{RunRecord, RunState};
use test_cabinet_core::test_case::TestType;
// The job-API wire shapes shared with the dispatcher, driver, and the queue's
// Rust clients live in `core` (so neither must depend on this crate) — both the
// request shapes the driver/dispatcher speak and the server **output** shapes a
// client deserializes. Re-export them so this module — and `api.rs`'s public
// re-export, which the `contract-codegen` generator names — keep referring to
// them as `jobs::{LaunchBody, …}`.
pub use test_cabinet_core::{
    ActiveJobOut, ClaimedJob, DriverState, JobState, JobStatusOut, LaunchAck, LaunchBatchAck,
    LaunchBatchBody, LaunchBatchItem, LaunchBody, StatusUpdate, StreamTopicsBody,
};
use test_cabinet_entities::job;

use crate::auth::{AuthUser, ServiceAuth, bearer_token, token_matches};
use crate::db::{CANCELABLE_ACTIVE_STATES, CANCELABLE_WAITING_STATES, JobCancelFilter, JobOrigin};
use crate::error::ApiError;
use crate::relay::{JobSummary, Notification, RunEvent, StreamItem, StreamMessage};

use super::AppState;

/// `POST /jobs` — enqueue a run. Requires a bearer token; validates the request,
/// mints a job id and per-job driver token, stores it in the `queued` state, and
/// returns the job id. The run itself is driven later by a driver pod the dispatcher
/// creates; observe it via the endpoints below.
///
/// The run is **attributed** to the token's account (`job.user_id`) and, when the
/// request carries an [`origin`](LaunchQuery::origin), to the coverage plan or ladder
/// that asked for it (`job.origin`). A launch by hand from the console's run form
/// sends no origin and so is never swept up by a plan's or ladder's scoped halt.
/// Attribution is bookkeeping only: coverage counting stays global, so a run counts
/// toward its cell's target whoever launched it and whatever launched it.
#[tracing::instrument(
    name = "jobs.launch",
    skip(state, user, body, query),
    fields(
        case.slug = %body.test_case,
        case.version = %body.version,
        variant = %body.variant,
        origin = query.origin.as_deref().unwrap_or("manual"),
    ),
    err(Debug),
)]
pub async fn launch(
    State(state): State<AppState>,
    user: AuthUser,
    Query(query): Query<LaunchQuery>,
    Json(body): Json<LaunchBody>,
) -> Result<Response, ApiError> {
    let attribution = attribution(&user, &query)?;
    let now = now_rfc3339()?;
    let new = build_new_job(&body, resolve_test_type(&state, &body), &now, &attribution)
        .map_err(ApiError::bad_request)?;
    let id = new.id.clone();
    let summary = new_job_summary(&new);

    state.db.enqueue_job(new).await.map_err(ApiError::from)?;

    // Announce the run *after* it is durably queued, so a console that reacts by
    // re-reading the active list cannot beat the row into existence.
    state
        .relay
        .notifier()
        .publish_run(RunEvent::enqueued(&id, summary));

    let ack = LaunchAck {
        job_id: id.clone(),
        status_url: format!("/jobs/{id}"),
        live_url: format!("/jobs/{id}/live"),
    };
    Ok((StatusCode::ACCEPTED, Json(ack)).into_response())
}

/// The most runs a single `POST /jobs/batch` may enqueue. A guard against an
/// unbounded fan-out in one request; comfortably above a full coverage plan's
/// worth of missing runs.
const MAX_BATCH_RUNS: usize = 20_000;

/// `POST /jobs/batch` — enqueue many runs in one request. Requires a bearer token,
/// the same gate as `POST /jobs`. Each requested run is
/// validated and minted independently, so a single malformed request is reported as
/// its own error without aborting the rest; the accepted runs are then inserted in
/// one batch. The response carries one result per requested run, aligned by index,
/// each with the enqueued job id or the reason it was rejected.
///
/// This is the batch analogue of [`launch`]: a console fanning out a set of runs
/// (the coverage matrix's still-missing runs, the new-run form's combinations)
/// sends one request and one insert instead of one per run.
///
/// Every run in the batch takes the **same** attribution — the token's account, and
/// the one [`origin`](LaunchQuery::origin) the query carries — because a batch is one
/// decision by one plan, ladder, or person. A caller wanting runs attributed to two
/// different origins sends two batches.
///
/// **The request's order is the queue's order.** The accepted runs take a contiguous
/// block of queue positions in the order they were listed, and the dispatcher claims
/// in that order — so a console that emits a case's repeats together (both of ours
/// do) has all of that case's runs start, and so finish, before the next case's. A
/// caller that wants a different execution order sends the runs in that order.
#[tracing::instrument(
    name = "jobs.launch_batch",
    skip(state, user, body, query),
    fields(runs = body.runs.len(), origin = query.origin.as_deref().unwrap_or("manual")),
    err(Debug),
)]
pub async fn launch_batch(
    State(state): State<AppState>,
    user: AuthUser,
    Query(query): Query<LaunchQuery>,
    Json(body): Json<LaunchBatchBody>,
) -> Result<Response, ApiError> {
    if body.runs.len() > MAX_BATCH_RUNS {
        return Err(ApiError::bad_request(format!(
            "a batch may enqueue at most {MAX_BATCH_RUNS} runs (got {})",
            body.runs.len()
        )));
    }

    let attribution = attribution(&user, &query)?;
    let now = now_rfc3339()?;
    // Validate and mint each requested run up front. A rejected run records its
    // error at its index and is dropped from the insert set; an accepted run
    // records its (already minted) job id and is queued for the batch insert. The
    // `items` vector stays index-aligned with `body.runs`.
    let mut items: Vec<LaunchBatchItem> = Vec::with_capacity(body.runs.len());
    let mut to_insert: Vec<crate::db::NewJob> = Vec::with_capacity(body.runs.len());
    // A batch usually fans one case out over many models/harnesses, so resolve each
    // (case, version)'s type once instead of re-reading the same manifest per run.
    let mut types: HashMap<(String, String), TestType> = HashMap::new();
    for run in &body.runs {
        let test_type = *types
            .entry((run.test_case.clone(), run.version.clone()))
            .or_insert_with(|| resolve_test_type(&state, run));
        match build_new_job(run, test_type, &now, &attribution) {
            Ok(new) => {
                items.push(LaunchBatchItem {
                    job_id: Some(new.id.clone()),
                    error: None,
                });
                to_insert.push(new);
            }
            Err(reason) => items.push(LaunchBatchItem {
                job_id: None,
                error: Some(reason),
            }),
        }
    }

    // The identities to announce, captured before the insert consumes the jobs.
    let enqueued: Vec<(String, JobSummary)> = to_insert
        .iter()
        .map(|new| (new.id.clone(), new_job_summary(new)))
        .collect();

    state
        .db
        .enqueue_jobs(to_insert)
        .await
        .map_err(ApiError::from)?;

    // One event per accepted run, in queue order — the same order the dispatcher will
    // claim them in, so a console appends them exactly as the active list would report
    // them. A batch is not collapsed into a single "some runs were queued" signal: the
    // console's list is per-run, and a fan-out of a hundred runs is precisely when it
    // most needs to show them individually rather than send everyone to re-read.
    for (id, summary) in enqueued {
        state
            .relay
            .notifier()
            .publish_run(RunEvent::enqueued(&id, summary));
    }

    Ok((StatusCode::ACCEPTED, Json(LaunchBatchAck { jobs: items })).into_response())
}

/// The test type of the case version a launch request targets, read from the
/// ingested manifest.
///
/// It is lifted onto the job row so the queue can serialize the run types that must
/// not overlap (a game jam per model — see [`crate::db::Db::claim_next_job`]). A
/// version that is not ingested resolves to the default type rather than rejecting
/// the launch: whether the case resolves at all is the driver's call, and it fails
/// the run with a far better diagnostic than an enqueue-time guess would.
fn resolve_test_type(state: &AppState, body: &LaunchBody) -> TestType {
    state
        .store
        .read_manifest(&body.test_case, &body.version)
        .map(|manifest| manifest.test_type)
        .unwrap_or_default()
}

/// Who and what a job is attributed to, resolved once per request and stamped on
/// every job that request enqueues.
///
/// Both halves are optional because both are optional on the row: attribution was
/// added after the queue existed, so every job enqueued before it carries neither, and
/// a retry copies whatever its original had rather than inventing one. A run with no
/// attribution is a perfectly good run — it is simply invisible to the scoped halts,
/// which is the correct answer for a run nobody can attribute.
#[derive(Debug, Clone, Default)]
struct JobAttribution {
    /// The account that asked for the run. `None` only on a retry of a job enqueued
    /// before attribution existed.
    user_id: Option<String>,
    /// The coverage plan or ladder that asked for the run, or `None` for a launch by
    /// hand. This is what a scoped `halt` cancels by.
    origin: Option<JobOrigin>,
}

/// Resolve the attribution for a launch request: the token's account, plus the
/// plan/ladder named by the query's `origin`.
///
/// An `origin` that is present but unparseable is a **400** rather than a silently
/// dropped label. The whole point of the column is that a later `halt` can find these
/// jobs again, so a run enqueued under a typo'd origin is one no halt will ever reach
/// — a fault that surfaces much later and in a confusing shape ("this plan will not
/// stop"), far from the request that caused it.
fn attribution(user: &AuthUser, query: &LaunchQuery) -> Result<JobAttribution, ApiError> {
    let origin = match query.origin.as_deref() {
        None => None,
        Some(token) => Some(JobOrigin::parse(token).ok_or_else(|| {
            ApiError::bad_request(format!(
                "`origin` must be `plan:<id>` or `ladder:<id>` (got `{token}`)"
            ))
        })?),
    };
    Ok(JobAttribution {
        user_id: Some(user.0.id.clone()),
        origin,
    })
}

/// Validate a launch request and build the `queued` job to enqueue for it: mint the
/// job id and per-job driver token and serialize the request verbatim. `test_type`
/// is the resolved type of the case it targets (see [`resolve_test_type`]), and
/// `attribution` is who and what asked for the run (see [`attribution`]). Returns
/// the human-readable reason on a validation failure. Shared by the single
/// ([`launch`]) and batch ([`launch_batch`]) enqueue paths so both validate and
/// record a run identically.
fn build_new_job(
    body: &LaunchBody,
    test_type: TestType,
    now: &str,
    attribution: &JobAttribution,
) -> Result<crate::db::NewJob, String> {
    if body.test_case.trim().is_empty() {
        return Err("`testCase` must not be empty".to_string());
    }
    if body.version.trim().is_empty() {
        return Err("`version` must not be empty".to_string());
    }
    if body.variant.trim().is_empty() {
        return Err("`variant` must not be empty".to_string());
    }
    if body.model.trim().is_empty() {
        return Err("`model` must not be empty".to_string());
    }
    let request_json =
        serde_json::to_string(body).map_err(|e| format!("serializing launch request: {e}"))?;
    Ok(crate::db::NewJob {
        id: Uuid::new_v4().to_string(),
        request_json,
        test_case_slug: body.test_case.clone(),
        test_case_version: body.version.clone(),
        variant: body.variant.clone(),
        test_type: test_type.as_str().to_string(),
        harness_slug: body.harness.as_str().to_string(),
        model_id: body.model.clone(),
        job_token: Uuid::new_v4().to_string(),
        // A console launch is the initial attempt; the backend re-enqueues any
        // automatic retries with an incremented `attempt`.
        attempt: 0,
        user_id: attribution.user_id.clone(),
        origin: attribution.origin.clone(),
        created_at: now.to_string(),
    })
}

/// `GET /jobs/active` — the runs still in flight (queued, pending, dispatched,
/// starting, or running), each described by the identity captured at enqueue. The
/// console seeds its in-progress list from this so a run it is watching survives a
/// reload — including runs held back (`pending`) or still spinning up (`starting`).
pub async fn active(State(state): State<AppState>) -> Result<Json<Vec<ActiveJobOut>>, ApiError> {
    let jobs = state.db.active_jobs().await.map_err(ApiError::from)?;
    Ok(Json(
        jobs.iter()
            .map(|job| ActiveJobOut {
                run_id: job.id.clone(),
                summary: job_summary(job),
                state: JobState::from_db(&job.state),
            })
            .collect(),
    ))
}

/// `GET /jobs/{id}` — one job's current status: its state and, once it succeeded,
/// the produced run record's id (else the terminal failure reason). `404` for an
/// unknown job.
pub async fn status(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<JobStatusOut>, ApiError> {
    let job = state
        .db
        .get_job(&id)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found(format!("no job `{id}`")))?;
    Ok(Json(job_status_out(&job)))
}

/// `POST /jobs/{id}/cancel` — request cancellation of an in-flight run. Requires a
/// bearer token, the same gate as `POST /jobs`. Any signed-in account may cancel any
/// run: the queue is a shared workbench, and a stuck run costs everyone. The job
/// records who *launched* it (`job.user_id`), not who stopped it.
///
/// A job still in a non-terminal state (`queued`, `pending`, `dispatched`,
/// `starting`, or `running`) is atomically moved to the terminal `canceled` state
/// and its live stream is closed,
/// so every watching console's monitor reflects the end at once. The
/// [driver](crate) polls its own job's state while it runs, so it observes the
/// cancellation, drops the in-flight harness exec, tears its sandbox down, and
/// exits — the same both on the local cluster and in production, since both drive a
/// run through a driver pod. No completion notification is fired: a canceled run is
/// an operator action, not a failure to alert on.
///
/// Canceling an already-`canceled` job is an idempotent no-op (`200`); a job that
/// already ran to `succeeded`/`failed` cannot be canceled (`409`); an unknown job
/// is `404`.
#[tracing::instrument(name = "jobs.cancel", skip(state, _user), fields(job.id = %id), err(Debug))]
pub async fn cancel(
    State(state): State<AppState>,
    _user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<JobStatusOut>, ApiError> {
    let job = state
        .db
        .get_job(&id)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found(format!("no job `{id}`")))?;
    let current = JobState::from_db(&job.state);
    if current.is_terminal() {
        // Already-canceled is an idempotent success; a run that finished on its own
        // is a conflict — it produced a result the cancel would misrepresent.
        if current == JobState::Canceled {
            return Ok(Json(job_status_out(&job)));
        }
        return Err(ApiError::conflict(format!(
            "job `{id}` already finished and cannot be canceled"
        )));
    }

    let now = now_rfc3339()?;
    let detail = "canceled by operator";
    let Some(canceled) = state
        .db
        .cancel_job(&id, &now, detail)
        .await
        .map_err(ApiError::from)?
    else {
        // The job reached a terminal state between the read above and the atomic
        // transition (it finished as we were canceling it). Report its now-current
        // status rather than force a cancel over a completed run.
        let job = state
            .db
            .get_job(&id)
            .await
            .map_err(ApiError::from)?
            .ok_or_else(|| ApiError::not_found(format!("no job `{id}`")))?;
        return Ok(Json(job_status_out(&job)));
    };

    // Close the live stream so every watcher's monitor ends now; the driver's own
    // teardown proceeds asynchronously. Deliberately `finish_run` rather than
    // `finish_and_notify`: a canceled run raises no completion *alert*, but it has
    // still left the in-flight set, and a console showing it must drop the row.
    finish_run(
        &state,
        RunEvent::finished(
            &id,
            job_summary(&canceled),
            JobState::Canceled,
            None,
            Some(detail),
        ),
    );
    Ok(Json(job_status_out(&canceled)))
}

/// `POST /jobs/cancel-waiting` — cancel every run that has not started yet
/// (`queued` or `pending`), whoever launched it and whatever launched it. Requires a
/// bearer token, the same gate as the other job mutations.
///
/// This is the Runs page's **"Clear pending"** control, and the one of the three that
/// needs no confirmation: a waiting job has no driver and has spent nothing, so
/// cancelling it discards no work. It is deliberately **global** rather than scoped to
/// the caller or to a plan — "empty the queue" is the whole point, and a queue with
/// somebody else's runs still in it is not empty. The scoped equivalent is a coverage
/// plan's or ladder's `halt`, which sweeps only its own jobs.
///
/// `pending` is included alongside `queued` because both are simply waiting: a
/// `pending` job is one the queue is holding back behind a harness parallelism cap or
/// a same-model game jam, not one that is part-way through anything.
#[tracing::instrument(name = "jobs.cancel_waiting", skip(state, _user), err(Debug))]
pub async fn cancel_waiting(
    State(state): State<AppState>,
    _user: AuthUser,
) -> Result<Json<BulkCancelOut>, ApiError> {
    let canceled = sweep_cancel(
        &state,
        &global_filter(&CANCELABLE_WAITING_STATES),
        "canceled by an operator clearing the waiting queue",
    )
    .await?;
    Ok(Json(BulkCancelOut {
        canceled,
        included_waiting: true,
        included_active: false,
    }))
}

/// `POST /jobs/cancel-active` — cancel every run that is already executing
/// (`dispatched`, `starting`, or `running`), whoever launched it. Requires a bearer
/// token, the same gate as the other job mutations.
///
/// This is the Runs page's **"Kill active"** control. Unlike [`cancel_waiting`] it
/// throws work away: each of these runs has a driver Job that is being created,
/// starting up, or burning tokens right now, so the console must confirm before
/// calling it and must never offer it as the default action. It leaves the waiting
/// queue alone, so the dispatcher starts claiming from it again immediately — pair it
/// with [`cancel_waiting`], or use [`cancel_all`], to actually stop everything.
#[tracing::instrument(name = "jobs.cancel_active", skip(state, _user), err(Debug))]
pub async fn cancel_active(
    State(state): State<AppState>,
    _user: AuthUser,
) -> Result<Json<BulkCancelOut>, ApiError> {
    let canceled = sweep_cancel(
        &state,
        &global_filter(&CANCELABLE_ACTIVE_STATES),
        "canceled by an operator killing the active runs",
    )
    .await?;
    Ok(Json(BulkCancelOut {
        canceled,
        included_waiting: false,
        included_active: true,
    }))
}

/// `POST /jobs/cancel-all` — cancel every in-flight run, waiting or executing.
/// Requires a bearer token, the same gate as the other job mutations.
///
/// This is the Runs page's **"Stop all"** control: [`cancel_waiting`] and
/// [`cancel_active`] in one atomic sweep, so nothing that was waiting can be claimed
/// and started in the gap between two separate calls. It is the most destructive of
/// the three and must be confirmed.
#[tracing::instrument(name = "jobs.cancel_all", skip(state, _user), err(Debug))]
pub async fn cancel_all(
    State(state): State<AppState>,
    _user: AuthUser,
) -> Result<Json<BulkCancelOut>, ApiError> {
    let mut states: Vec<&str> = CANCELABLE_WAITING_STATES.to_vec();
    states.extend_from_slice(&CANCELABLE_ACTIVE_STATES);
    let canceled = sweep_cancel(
        &state,
        &global_filter(&states),
        "canceled by an operator stopping every run",
    )
    .await?;
    Ok(Json(BulkCancelOut {
        canceled,
        included_waiting: true,
        included_active: true,
    }))
}

/// The filter the three **global** sweeps use: the given states, unnarrowed.
///
/// Both narrowing fields are `None` on purpose. Narrowing by account would silently
/// skip every job enqueued before attribution existed (they carry no `user_id`), and
/// narrowing by origin is what a plan's or ladder's own `halt` does instead — these
/// controls deliberately reach every run on the worker.
fn global_filter<'a>(states: &'a [&'a str]) -> JobCancelFilter<'a> {
    JobCancelFilter {
        states,
        origin: None,
        user_id: None,
    }
}

/// The shared body of the three global cancel controls: move every in-flight job in
/// `states` to the terminal `canceled` state with `detail` as its reason, close the
/// live stream of each run that left the queue as a result, and report how many moved.
///
/// The transition is [`crate::db::Db::cancel_jobs`] — one atomic `UPDATE` applying
/// exactly the same rule as the single-run [`cancel`]: only a job still in an
/// in-flight state moves, so a run that reached a terminal state a moment ago is left
/// alone and a driver's already-final report can never be overwritten. Nothing here
/// writes a new state transition.
///
/// Closing the live streams needs the *ids* the sweep touched, which a set-based
/// `UPDATE` does not report, so the in-flight set is read either side of it and the
/// difference is what ended. That errs in the safe direction on both sides: a job
/// still in flight afterwards keeps its stream open (a `queued` run that was claimed
/// and started mid-sweep is genuinely still going, and closing its monitor would lie
/// to the reviewer watching it), while a job that finished on its own instead of being
/// cancelled has already had its stream finished, and finishing it again is a no-op.
///
/// No completion notification is fired, for the same reason a single cancel fires
/// none: an operator stopping runs is an operator action, not a failure to alert on.
pub(super) async fn sweep_cancel(
    state: &AppState,
    filter: &JobCancelFilter<'_>,
    detail: &str,
) -> Result<u32, ApiError> {
    // Keep the rows, not just their ids: a run that ends here must be announced with
    // the same identity the console listed it under, and after the sweep it is no
    // longer in the active set to read it back from.
    let before: Vec<job::Model> = state
        .db
        .active_jobs()
        .await
        .map_err(ApiError::from)?
        .into_iter()
        .filter(|job| filter.states.contains(&job.state.as_str()))
        .collect();

    let canceled = state
        .db
        .cancel_jobs(filter, &now_rfc3339()?, detail)
        .await
        .map_err(ApiError::from)?;

    let still_in_flight: HashSet<String> = state
        .db
        .active_jobs()
        .await
        .map_err(ApiError::from)?
        .into_iter()
        .map(|job| job.id)
        .collect();
    for job in before
        .iter()
        .filter(|job| !still_in_flight.contains(&job.id))
    {
        finish_run(
            state,
            RunEvent::finished(
                &job.id,
                job_summary(job),
                JobState::Canceled,
                None,
                Some(detail),
            ),
        );
    }

    tracing::info!(canceled, detail, "swept the run queue");
    // The count is reported as a `u32` on the wire; the queue is capped far below
    // that (`MAX_BATCH_RUNS` per request), so the clamp is unreachable in practice
    // and exists only so the conversion cannot wrap.
    Ok(canceled.min(u64::from(u32::MAX)) as u32)
}

/// `GET /jobs/{id}/live` — the live harness-event + asset-preview stream as
/// NDJSON. A subscriber is first replayed the backlog (and the latest preview per
/// frame), then receives new items as the driver produces them; the stream closes
/// when the run reaches a terminal state. A connection to an already-finished job
/// closes after the backlog. `404` for an unknown job.
pub async fn live(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    let job = state
        .db
        .get_job(&id)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found(format!("no job `{id}`")))?;
    // If the job is already terminal but its in-memory buffer was lost (e.g. a
    // backend restart), close the stream after the (possibly empty) backlog
    // instead of waiting forever for a `Done` that will never come; the console
    // then falls back to the persisted run record.
    let db_terminal = JobState::from_db(&job.state).is_terminal();
    let live = state.relay.live(&id);
    let body = Body::from_stream(event_stream(live, db_terminal));
    Ok((
        [
            (header::CONTENT_TYPE, "application/x-ndjson"),
            // Disable proxy buffering so items are delivered as they arrive.
            (header::CACHE_CONTROL, "no-cache"),
        ],
        body,
    )
        .into_response())
}

/// `POST /jobs/next` — the dispatcher claims the oldest queued job. Requires the
/// service token. Returns `200` with the claimed job (id, driver token, and the
/// launch request to run) or `204 No Content` when the queue is empty.
pub async fn claim(
    State(state): State<AppState>,
    _service: ServiceAuth,
) -> Result<Response, ApiError> {
    let now = now_rfc3339()?;
    let outcome = state.db.claim_next(&now).await.map_err(ApiError::from)?;

    // Announce the display states this pass reconciled, whether or not it claimed
    // anything. A pass that claims nothing still moves runs between `queued` and
    // `pending` as capacity frees up, and those are exactly the transitions an
    // operator watching a held-back queue is waiting to see.
    for job in &outcome.reconciled {
        state.relay.notifier().publish_run(RunEvent::state_changed(
            &job.id,
            job_summary(job),
            JobState::from_db(&job.state),
        ));
    }

    let Some(job) = outcome.claimed else {
        return Ok(StatusCode::NO_CONTENT.into_response());
    };

    state.relay.notifier().publish_run(RunEvent::state_changed(
        &job.id,
        job_summary(&job),
        JobState::Dispatched,
    ));

    let request: LaunchBody = serde_json::from_str(&job.request_json)
        .map_err(|e| ApiError::internal(format!("decoding stored launch request: {e}")))?;
    Ok(Json(ClaimedJob {
        job_id: job.id,
        job_token: job.job_token,
        request,
    })
    .into_response())
}

/// `POST /jobs/{id}/events` — the driver streams a batch of harness events.
/// Authenticated by the per-job token. The events join the live stream and are
/// retained as the backlog persisted with the run on completion.
pub async fn ingest_events(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(events): Json<Vec<HarnessEvent>>,
) -> Result<StatusCode, ApiError> {
    authorize_job(&state, &id, &headers).await?;
    state.relay.live(&id).push_events(events);
    Ok(StatusCode::NO_CONTENT)
}

/// `POST /jobs/{id}/preview` — the driver streams one live asset-preview frame.
/// Authenticated by the per-job token. Previews are relayed but never persisted.
pub async fn ingest_preview(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(preview): Json<AssetPreview>,
) -> Result<StatusCode, ApiError> {
    authorize_job(&state, &id, &headers).await?;
    state.relay.live(&id).push_preview(preview);
    Ok(StatusCode::NO_CONTENT)
}

/// `POST /jobs/{id}/status` — the driver advances the job's state. Authenticated
/// by the per-job token.
///
/// `starting` records that the driver pod is up and running the pre-run setup;
/// `running` records that execution began. `succeeded` carries the produced
/// [`RunRecord`] — persisted to the `run` store **regardless of outcome**
/// (completed, unevaluable, or a model failure that produced a record), using the
/// events the relay accumulated as its recorded stream, so nothing the ephemeral
/// driver produced is lost. `failed` records a terminal infrastructure/setup
/// failure with a specific diagnostic reason; the failure record it produced (if
/// any) is retained too. A terminal update closes the live stream and fires a
/// completion notification.
///
/// Whether a retained non-completed record is *publishable* is deliberately not
/// decided here — the publish path enforces the interim "completed only" guard,
/// and turning failures into first-class publishable results is a separate design
/// pass (see the project notes).
#[tracing::instrument(name = "jobs.status", skip(state, headers, update), fields(job.id = %id), err(Debug))]
pub async fn update_status(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(update): Json<StatusUpdate>,
) -> Result<StatusCode, ApiError> {
    let job = authorize_job(&state, &id, &headers).await?;

    // A canceled job is terminal. Ignore any status the in-flight driver posts
    // before it notices the cancellation, so a late `running`/`succeeded`/`failed`
    // report cannot resurrect or overwrite the canceled run (nor persist a record
    // for it). The driver's poll ends it shortly after; this is the belt-and-braces
    // guard on the backend side.
    if JobState::from_db(&job.state) == JobState::Canceled {
        return Ok(StatusCode::NO_CONTENT);
    }

    // Whether this job had *already* reached a terminal state before this update.
    // The auto-retry decision below keys off it: a retry is considered only the
    // first time a job crosses into a terminal state, so a duplicate or late
    // terminal report from a still-winding-down driver cannot fire a second retry.
    let already_terminal = JobState::from_db(&job.state).is_terminal();

    let now = now_rfc3339()?;

    match update.state {
        DriverState::Starting => {
            state
                .db
                .set_job_state(&id, "starting", &now, None, None)
                .await
                .map_err(ApiError::from)?;
            state.relay.notifier().publish_run(RunEvent::state_changed(
                &id,
                job_summary(&job),
                JobState::Starting,
            ));
            Ok(StatusCode::NO_CONTENT)
        }
        DriverState::Running => {
            state
                .db
                .set_job_state(&id, "running", &now, None, None)
                .await
                .map_err(ApiError::from)?;
            state.relay.notifier().publish_run(RunEvent::state_changed(
                &id,
                job_summary(&job),
                JobState::Running,
            ));
            Ok(StatusCode::NO_CONTENT)
        }
        DriverState::Failed => {
            // An infrastructure/setup failure needs a *specific* reason a "run
            // failed" placeholder would hide — "couldn't pull container image",
            // "harness unavailable", etc. The driver supplies it; retain whatever
            // record it managed to produce so the timeline is inspectable.
            let detail = update.detail.as_deref().unwrap_or("run failed");
            let record_id = persist_produced(&state, &id, update.record.as_ref()).await?;
            state
                .db
                .set_job_state(&id, "failed", &now, Some(detail), record_id.as_deref())
                .await
                .map_err(ApiError::from)?;
            finish_and_notify(
                &state,
                RunEvent::finished(
                    &id,
                    job_summary(&job),
                    JobState::Failed,
                    record_id.as_deref(),
                    Some(detail),
                ),
                Notification::failed(&id, job_summary(&job), detail, record_id.as_deref()),
            );
            // A `failed` report carries the driver's classified terminal state on the
            // failure record it built (`Infrastructure` — our infra broke — or
            // `TimedOut` — the model never converged). When no record could be built
            // at all, the failure was severe enough that it is our infrastructure.
            let terminal_state =
                terminal_run_state(update.record.as_ref(), RunState::Infrastructure);
            maybe_enqueue_retry(&state, &job, terminal_state, already_terminal).await?;
            Ok(StatusCode::NO_CONTENT)
        }
        DriverState::Succeeded => {
            // The driver must hand back the record it produced. It is retained
            // whatever its outcome (completed/unevaluable/failed) — the publish
            // gate, not storage, decides what is publishable.
            let record = update.record.as_ref().ok_or_else(|| {
                ApiError::unprocessable("a succeeded status must carry the run record")
            })?;
            let record_id = persist_record(&state, &id, record).await?;
            state
                .db
                .set_job_state(&id, "succeeded", &now, None, Some(&record_id))
                .await
                .map_err(ApiError::from)?;
            finish_and_notify(
                &state,
                RunEvent::finished(
                    &id,
                    job_summary(&job),
                    JobState::Succeeded,
                    Some(&record_id),
                    None,
                ),
                Notification::completed(&id, job_summary(&job), &record_id),
            );
            // A clean harness exit is `Completed` (evaluable) or `Catastrophic`
            // (the model claimed done but the build won't load) — the record carries
            // which.
            let terminal_state = terminal_run_state(Some(record), RunState::Completed);
            maybe_enqueue_retry(&state, &job, terminal_state, already_terminal).await?;
            Ok(StatusCode::NO_CONTENT)
        }
    }
}

/// The default `retryCount` when a launch request omits it: one retry after a
/// failure, so the total attempts allowed is `1 + retry_count` = 2.
const DEFAULT_RETRY_COUNT: u32 = 1;

/// The largest `retryCount` honored, clamping an absurd request so a run cannot
/// re-enqueue itself an unbounded number of times.
const MAX_RETRY_COUNT: u32 = 10;

/// Read the terminal [`RunState`] a driver reported: the produced/partial record's
/// own `status.state` when it built one, else `fallback` (the state that best
/// describes a report that carried no record — `Infrastructure` for a `failed`
/// report, `Completed` for a `succeeded` one, though a succeeded report always
/// carries its record).
fn terminal_run_state(record: Option<&RunRecord>, fallback: RunState) -> RunState {
    record.map(|record| record.status.state).unwrap_or(fallback)
}

/// The `retryCount` a job's stored launch request asks for, defaulting to
/// [`DEFAULT_RETRY_COUNT`] when absent (or the request cannot be parsed) and clamped
/// to [`MAX_RETRY_COUNT`].
fn retry_count_of(request_json: &str) -> u32 {
    serde_json::from_str::<LaunchBody>(request_json)
        .ok()
        .and_then(|body| body.retry_count)
        .unwrap_or(DEFAULT_RETRY_COUNT)
        .min(MAX_RETRY_COUNT)
}

/// Whether the coverage plan or ladder that launched `job` is currently paused — a
/// ladder's paused flag is what the console calls **disabled**.
///
/// A paused plan or ladder has been told to stop producing work, and re-enqueueing a
/// failed run of it is producing work: it is a fresh `queued` job, minted minutes after
/// the reviewer halted the queue and watched it empty. That is the shape of the bug
/// this guards — runs "coming back" after being stopped, with nothing in the console
/// that asked for them. Whatever was already in flight still runs to completion, which
/// is the promise a pause makes; only the *next* attempt is withheld.
///
/// Answers false, so the retry proceeds, whenever the question cannot be settled: an
/// unattributed job (launched by hand — no plan ever spoke for it), one with no
/// launching account to scope the lookup to, or an origin whose plan or ladder has since
/// been deleted. Deleting a plan deliberately leaves its runs alone, and a run nobody
/// can attribute is still a perfectly good run that a transient failure should not end.
async fn origin_is_paused(state: &AppState, job: &job::Model) -> Result<bool, ApiError> {
    let Some(origin) = job.origin.as_deref().and_then(JobOrigin::parse) else {
        return Ok(false);
    };
    let Some(user_id) = job.user_id.as_deref() else {
        return Ok(false);
    };
    let paused = match origin {
        JobOrigin::Plan(id) => state
            .db
            .coverage_plan_schedule(user_id, &id)
            .await
            .map_err(ApiError::from)?
            .map(|schedule| schedule.paused),
        JobOrigin::Ladder(id) => state
            .db
            .ladder_schedule(user_id, &id)
            .await
            .map_err(ApiError::from)?
            .map(|schedule| schedule.paused),
    };
    Ok(paused.unwrap_or(false))
}

/// Whether a terminal run in `state` should be automatically retried.
/// [`RunState::Infrastructure`] (our infra broke) and [`RunState::Catastrophic`]
/// (the harness ran clean but the build won't load) retry, as does
/// [`RunState::HarnessError`] (the harness exited non-zero) — a subscription
/// auth-token refresh surfaces there and can self-heal on a bounded retry; a model
/// that genuinely crashes the harness burns its retries and then settles as a
/// recordable harness error. [`RunState::Hung`] retries for the same reason: a
/// harness that stalled on one provider request usually gets further on a fresh
/// attempt, and a retry costs far less than the slot the hang would otherwise
/// have held. A [`RunState::TimedOut`] or [`RunState::Completed`]
/// outcome is the model's, not a fault to retry (and a user cancel never reaches
/// the terminal transition here). The chain is bounded by the request's
/// `retryCount`, so a persistently failing run always terminates.
fn is_retryable(state: RunState) -> bool {
    matches!(
        state,
        RunState::Infrastructure | RunState::Catastrophic | RunState::HarnessError | RunState::Hung
    )
}

/// Auto-retry a run that just reached a terminal failure: if the outcome is
/// [retryable](is_retryable) and the job still has attempts left, re-enqueue a fresh
/// attempt of the same launch request.
///
/// The retry is a brand-new `queued` job — a fresh id and per-job token (minted like
/// [`launch`]), the original `request_json` cloned verbatim (so it carries the same
/// `retryCount`), and `attempt = job.attempt + 1`. The dispatcher re-claims it
/// unchanged, so no dispatcher change is needed.
///
/// It also inherits the **original** job's attribution rather than taking none: the
/// retry is still that account's run, and still the plan's or ladder's, so it stays in
/// that plan's coverage buffer and is still reached by that plan's halt. A retry with
/// no origin would be a job the plan launched and can no longer stop.
///
/// Two guards keep the chain finite: `already_terminal` skips a duplicate/late
/// terminal report (the decision is made only the first time a job goes terminal),
/// and the strictly-monotonic `attempt` bounded by the request's `retryCount` means
/// the chain always terminates. A third, [`origin_is_paused`], stops the chain
/// outright when the plan or ladder that launched the run has been paused since: a
/// halted queue that refills itself minutes later is indistinguishable from a queue
/// that was never halted.
async fn maybe_enqueue_retry(
    state: &AppState,
    job: &job::Model,
    terminal_state: RunState,
    already_terminal: bool,
) -> Result<(), ApiError> {
    if already_terminal || !is_retryable(terminal_state) {
        return Ok(());
    }
    let retry_count = retry_count_of(&job.request_json);
    let attempt = job.attempt + 1;
    // `attempt` is 1-based over the retries: attempt 1 is the first retry, so the
    // chain stops once it would exceed `retryCount` retries.
    if attempt as u32 > retry_count {
        return Ok(());
    }
    if origin_is_paused(state, job).await? {
        tracing::info!(
            parent_job = %job.id,
            origin = job.origin.as_deref().unwrap_or(""),
            terminal_state = ?terminal_state,
            "skipped the automatic retry of a failed run: the plan or ladder that \
             launched it is paused"
        );
        return Ok(());
    }

    let retry_id = Uuid::new_v4().to_string();
    let job_token = Uuid::new_v4().to_string();
    let now = now_rfc3339()?;
    state
        .db
        .enqueue_job(crate::db::NewJob {
            id: retry_id.clone(),
            request_json: job.request_json.clone(),
            test_case_slug: job.test_case_slug.clone(),
            test_case_version: job.test_case_version.clone(),
            variant: job.variant.clone(),
            test_type: job.test_type.clone(),
            harness_slug: job.harness_slug.clone(),
            model_id: job.model_id.clone(),
            job_token,
            attempt,
            user_id: job.user_id.clone(),
            origin: job.origin.as_deref().and_then(JobOrigin::parse),
            created_at: now,
        })
        .await
        .map_err(ApiError::from)?;
    tracing::info!(
        parent_job = %job.id,
        retry_job = %retry_id,
        attempt,
        retry_count,
        terminal_state = ?terminal_state,
        "re-enqueued an automatic retry of a failed run"
    );
    Ok(())
}

/// Persist a produced run record to the `run` store, using the events the relay
/// accumulated as its recorded stream (so the driver never re-sends them).
/// Returns the record's id. Retains the record regardless of its outcome.
async fn persist_record(
    state: &AppState,
    job_id: &str,
    record: &RunRecord,
) -> Result<String, ApiError> {
    let events = state.relay.live(job_id).events_snapshot();
    let events_json = if events.is_empty() {
        None
    } else {
        Some(
            serde_json::to_string(&events)
                .map_err(|e| ApiError::internal(format!("serializing relayed events: {e}")))?,
        )
    };

    // Store the model id with any trailing OpenRouter `:free`-style variant tag
    // stripped, so a free-tagged run groups under its base model rather than
    // splitting off a phantom entry. The run's cost is already computed against
    // the base price by the driver, so only the identity needs normalizing here.
    let mut record = record.clone();
    normalize_record_model_id(&mut record);

    let links = record.links.clone();
    state
        .db
        .push(&record, &links, events_json.as_deref())
        .await
        .map_err(ApiError::from)?;

    // Record the model's current price on completion, off the request path: a
    // detached best-effort task so an OpenRouter fetch never delays or fails the
    // driver's status report.
    let db = std::sync::Arc::clone(&state.db);
    let prices = state.prices.clone();
    let model_id = record.subject.model_id.clone();
    let harness = record.subject.harness_slug;
    tokio::spawn(async move {
        crate::bootstrap::observe_completion(&db, &prices, &model_id, harness).await;
    });

    Ok(record.id.clone())
}

/// Strip a trailing OpenRouter variant tag (for example `:free`) from a run's
/// model id when the harness routes through OpenRouter, so the stored identity
/// matches the base model. A no-op for provider-native harnesses and untagged ids.
fn normalize_record_model_id(record: &mut RunRecord) {
    let harness = record.subject.harness_slug;
    if harness.routes_through_openrouter()
        && let Some((base, _tag)) = record.subject.model_id.rsplit_once(':')
    {
        record.subject.model_id = base.to_string();
    }
}

/// Persist the record the driver produced if it managed to produce one, returning
/// its id (`None` when an infrastructure failure produced no record at all).
async fn persist_produced(
    state: &AppState,
    job_id: &str,
    record: Option<&RunRecord>,
) -> Result<Option<String>, ApiError> {
    match record {
        Some(record) => Ok(Some(persist_record(state, job_id, record).await?)),
        None => Ok(None),
    }
}

/// `POST /jobs/{id}/verify-token` — confirm a presented per-job token matches the
/// one minted for job `{id}`. The internal call the **artifact service** makes to
/// authenticate an upload: the driver presents its job token to the artifact
/// service, which forwards it here (the backend is the token authority) before
/// accepting the run's artifact tree.
///
/// No other auth gates this endpoint — the presented token *is* the secret (job
/// tokens are random UUIDs minted at enqueue), so a caller that does not already
/// hold it learns nothing. `200 No Content` when it matches, `401` when it does
/// not (or the token field is absent), `404` for an unknown job. Constant-time
/// comparison via [`token_matches`] keeps the check from leaking the token through
/// timing, exactly as the driver-streaming endpoints' [`authorize_job`] does.
pub async fn verify_token(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<VerifyTokenBody>,
) -> Result<StatusCode, ApiError> {
    let job = state
        .db
        .get_job(&id)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found(format!("no job `{id}`")))?;
    if body.token.is_empty() || !token_matches(&body.token, &job.job_token) {
        return Err(ApiError::unauthorized("invalid job token"));
    }
    Ok(StatusCode::NO_CONTENT)
}

/// `GET /notifications` — stream worker-wide run-completion notifications as SSE.
/// Each event's `data` is one [`Notification`] as JSON. Live-only (no backlog); a
/// keep-alive holds idle connections open between runs.
pub async fn notifications(
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let handle = state.relay.notifier().open_stream();

    // The hello frame, sent before anything else: it hands the client the id it
    // needs to change its own topics. A client cannot subscribe to run events until
    // it has this, which is why it is the first thing on the wire rather than
    // something the client has to ask for.
    let hello = Event::default()
        .event(STREAM_EVENT_HELLO)
        .json_data(StreamOpened {
            stream_id: handle.id.clone(),
        })
        .unwrap_or_else(|_| Event::default());

    let tail = stream::unfold(handle, |mut handle| async move {
        loop {
            // Bounded, so an idle stream still emits something a client can see.
            // `Sse::keep_alive` already writes SSE *comments*, but the browser's
            // `EventSource` consumes those internally and surfaces nothing to the
            // page — they keep proxies from timing the connection out and are
            // useless as a liveness signal. This heartbeat is a real named event,
            // so a client can arm a watchdog on it and notice a stream that has
            // gone quiet because it is dead rather than because nothing happened.
            let received = tokio::time::timeout(STREAM_HEARTBEAT, handle.receiver.recv()).await;
            let Ok(received) = received else {
                let event = Event::default().event(STREAM_EVENT_HEARTBEAT);
                return Some((Ok(event), handle));
            };
            match received {
                Ok(message) => {
                    // The topic filter is applied per message, at delivery time, so a
                    // `PUT /notifications/{id}/topics` that lands mid-stream takes
                    // effect on the very next message.
                    if !handle.wants(&message) {
                        continue;
                    }
                    let event = match &message {
                        StreamMessage::Notification(notification) => Event::default()
                            .event(STREAM_EVENT_NOTIFICATION)
                            .json_data(notification.as_ref()),
                        StreamMessage::Run(run) => Event::default()
                            .event(STREAM_EVENT_RUN)
                            .json_data(run.as_ref()),
                    }
                    .unwrap_or_else(|_| Event::default());
                    return Some((Ok(event), handle));
                }
                // This client fell behind far enough that the channel dropped
                // messages for it. Tell it so, rather than skipping on in silence:
                // the stream is live-only, so a dropped message is gone, and a
                // console that does not know it missed one would show a stale
                // in-flight list indefinitely with a perfectly healthy connection.
                // Its recovery is to re-read the authoritative lists.
                Err(RecvError::Lagged(dropped)) => {
                    let event = Event::default()
                        .event(STREAM_EVENT_RESYNC)
                        .json_data(StreamResync { dropped })
                        .unwrap_or_else(|_| Event::default());
                    return Some((Ok(event), handle));
                }
                Err(RecvError::Closed) => return None,
            }
        }
    });

    let stream = stream::once(async move { Ok(hello) }).chain(tail);
    Sse::new(stream).keep_alive(KeepAlive::default())
}

/// `PUT /notifications/{stream}/topics` — change which topics an already-connected
/// stream delivers.
///
/// This is the control channel SSE itself does not have. The console opens one
/// stream when it connects to the backend and keeps it open for the session; when it
/// navigates onto a page that shows in-flight runs it turns the `runs` topic on, and
/// when it leaves it turns it back off. The alternative — a second stream opened and
/// closed per page — would drop the alerts riding the first one every time, and cost
/// a reconnect on every navigation.
///
/// An omitted field leaves that topic unchanged. `404` when no such stream is
/// connected, which tells a client its `EventSource` has reconnected under a new id
/// (or the backend restarted) and it must re-apply its topics to the new stream.
pub async fn set_stream_topics(
    State(state): State<AppState>,
    Path(stream_id): Path<String>,
    Json(body): Json<StreamTopicsBody>,
) -> Result<StatusCode, ApiError> {
    if state
        .relay
        .notifier()
        .set_topics(&stream_id, body.notifications, body.runs)
    {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::not_found(format!(
            "no connected stream `{stream_id}`"
        )))
    }
}

// --- Helpers ----------------------------------------------------------------

/// Mark a run's live stream finished and announce that it left the in-flight set.
///
/// Every terminal transition goes through here, including the ones that raise no
/// alert (a cancellation). That is the distinction the two functions draw: *ending* a
/// run is list maintenance and always published, while *alerting* on it is a separate
/// judgment [`finish_and_notify`] adds on top.
fn finish_run(state: &AppState, event: RunEvent) {
    state.relay.live(&event.run_id).finish();
    state.relay.notifier().publish_run(event);
}

/// Finish a run (as [`finish_run`]) and additionally raise its completion alert.
///
/// The run event is published before the notification so a console applying both
/// removes the run from its in-flight list before it toasts the completion — the
/// order a person expects, and the reason the two topics share one channel.
fn finish_and_notify(state: &AppState, event: RunEvent, notification: Notification) {
    finish_run(state, event);
    state.relay.notifier().notify(notification);
}

/// Load a job and verify the request carries its per-job token. `404` for an
/// unknown job, `401` for a missing or wrong token.
async fn authorize_job(
    state: &AppState,
    id: &str,
    headers: &HeaderMap,
) -> Result<job::Model, ApiError> {
    let job = state
        .db
        .get_job(id)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found(format!("no job `{id}`")))?;
    let token = bearer_token(headers).ok_or_else(|| ApiError::unauthorized("missing job token"))?;
    if !token_matches(&token, &job.job_token) {
        return Err(ApiError::unauthorized("invalid job token"));
    }
    Ok(job)
}

/// Build the `GET /jobs/{id}` status shape from a stored job row.
fn job_status_out(job: &job::Model) -> JobStatusOut {
    JobStatusOut {
        id: job.id.clone(),
        state: JobState::from_db(&job.state),
        record_id: job.record_id.clone(),
        detail: job.detail.clone(),
    }
}

/// The run's display identity, lifted from a job about to be inserted.
///
/// The same fields as [`job_summary`], read off the insert shape instead of the
/// stored row, so an enqueue can announce the run without reading back what it just
/// wrote.
fn new_job_summary(new: &crate::db::NewJob) -> JobSummary {
    JobSummary {
        test_case_slug: new.test_case_slug.clone(),
        test_case_version: new.test_case_version.clone(),
        variant: new.variant.clone(),
        harness_slug: new.harness_slug.clone(),
        model_id: new.model_id.clone(),
    }
}

/// The run's display identity, lifted from the stored job columns.
fn job_summary(job: &job::Model) -> JobSummary {
    JobSummary {
        test_case_slug: job.test_case_slug.clone(),
        test_case_version: job.test_case_version.clone(),
        variant: job.variant.clone(),
        harness_slug: job.harness_slug.clone(),
        model_id: job.model_id.clone(),
    }
}

/// The current UTC time as an RFC 3339 string, or a `500` if formatting fails.
fn now_rfc3339() -> Result<String, ApiError> {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|e| ApiError::internal(format!("formatting timestamp: {e}")))
}

/// How often the live NDJSON stream emits a heartbeat newline while idle, so a
/// client whose streaming `fetch()` aborts on idle reads keeps the connection
/// alive through event-free gaps. Matches axum's default SSE keep-alive period
/// and stays well under WKWebView/NSURLSession's ~60s request idle timeout.
const LIVE_HEARTBEAT: std::time::Duration = std::time::Duration::from_secs(15);

/// Build the NDJSON byte stream for a job: the replayed backlog and latest
/// previews, then the live tail, each item one `\n`-terminated JSON line, ending
/// when the run does. `force_terminated` closes the stream after the backlog when
/// the job is already terminal but its live buffer is gone.
fn event_stream(
    live: crate::relay::LiveJob,
    force_terminated: bool,
) -> impl Stream<Item = Result<Bytes, Infallible>> {
    let sub = live.subscribe();
    let terminated = sub.terminated || force_terminated;
    let backlog = stream::iter(sub.backlog.into_iter().map(|event| Ok(encode_line(&event))));
    let previews = stream::iter(
        sub.previews
            .into_iter()
            .map(|preview| Ok(encode_preview_line(&preview))),
    );
    // A periodic newline heartbeat keeps bytes flowing while the run is idle
    // between events — most notably the long gap after "Preparing the test case
    // workspace" while the driver clones the case and pulls the run-container
    // image. A streaming `fetch()` reader that aborts on idle reads (WKWebView /
    // NSURLSession, which backs the Tauri desktop app, times an idle request out
    // after ~60s and surfaces it as `TypeError: Load failed`) would otherwise
    // tear the live monitor down mid-run; Chromium has no such idle timeout,
    // which is why the web console never saw it. A bare `\n` is a no-op to the
    // NDJSON client, which skips empty lines. Mirrors the keep-alive the
    // `/notifications` SSE stream already applies. `interval_at` starts one period
    // out so a freshly subscribed client isn't sent a redundant immediate tick.
    let heartbeat =
        tokio::time::interval_at(tokio::time::Instant::now() + LIVE_HEARTBEAT, LIVE_HEARTBEAT);
    let live_tail = stream::unfold(
        (terminated, sub.receiver, heartbeat),
        |(done, mut receiver, mut heartbeat)| async move {
            if done {
                return None;
            }
            loop {
                tokio::select! {
                    _ = heartbeat.tick() => {
                        return Some((Ok(Bytes::from_static(b"\n")), (false, receiver, heartbeat)));
                    }
                    received = receiver.recv() => match received {
                        Ok(StreamItem::Event(event)) => {
                            return Some((Ok(encode_line(&event)), (false, receiver, heartbeat)));
                        }
                        Ok(StreamItem::Preview(preview)) => {
                            return Some((Ok(encode_preview_line(&preview)), (false, receiver, heartbeat)));
                        }
                        Ok(StreamItem::Done) => return None,
                        Err(RecvError::Closed) => return None,
                        Err(RecvError::Lagged(_)) => continue,
                    },
                }
            }
        },
    );
    backlog.chain(previews).chain(live_tail)
}

/// Encode one event as a `\n`-terminated NDJSON line. A `HarnessEvent`'s fields
/// are plain JSON-safe scalars, so a defensive empty line stands in for the
/// impossible serialization error rather than aborting the stream.
fn encode_line(event: &HarnessEvent) -> Bytes {
    match serde_json::to_string(event) {
        Ok(mut line) => {
            line.push('\n');
            Bytes::from(line)
        }
        Err(_) => Bytes::from_static(b"\n"),
    }
}

/// Encode one live preview frame as a `\n`-terminated NDJSON line, tagged
/// `type: "asset_preview"` so a subscriber tells it apart from a `HarnessEvent`
/// (whose `type` is always one of the closed set of event kinds).
fn encode_preview_line(preview: &AssetPreview) -> Bytes {
    let mut value = serde_json::to_value(preview).unwrap_or_else(|_| serde_json::json!({}));
    if let Some(object) = value.as_object_mut() {
        object.insert("type".to_string(), serde_json::Value::from("asset_preview"));
    }
    match serde_json::to_string(&value) {
        Ok(mut line) => {
            line.push('\n');
            Bytes::from(line)
        }
        Err(_) => Bytes::from_static(b"\n"),
    }
}

// --- Wire shapes ------------------------------------------------------------

/// The query string of `POST /jobs` and `POST /jobs/batch`: what asked for these runs.
///
/// Attribution rides in the query rather than in [`LaunchBody`] deliberately. The
/// launch body is stored **verbatim** as the job's `request_json` and handed straight
/// back to the driver when the dispatcher claims the job — it is the description of
/// *what to run*, and a driver has no business knowing which plan wanted it. An origin
/// is queue bookkeeping: one `job` column, read only by a scoped halt. Keeping it out
/// of the body also keeps [`LaunchBody`] — which lives in `core`, shared with the
/// driver and the dispatcher — from growing a field only the backend ever reads.
///
/// Deserialize-only, and not a codegen contract type: a query string is not a JSON
/// body, so there is nothing for the TypeScript bindings to describe.
#[derive(Debug, Default, serde::Deserialize)]
pub struct LaunchQuery {
    /// The `plan:<id>` / `ladder:<id>` token naming the coverage plan or ladder that
    /// is topping itself up. Absent for a launch by hand from the console's run form,
    /// which is what leaves `job.origin` null and so keeps that run out of every
    /// scoped halt. An unrecognized token is rejected rather than ignored — see
    /// [`attribution`].
    #[serde(default)]
    pub origin: Option<String>,
}

/// The response to one of the three global cancel controls: how many runs the sweep
/// stopped, and how far into the queue it reached.
///
/// The **count is the point**. A sweep that reported only success would leave the
/// operator unable to tell "the queue was already empty" from "nothing matched", and
/// those call for opposite next moves. The two scope flags let the console phrase what
/// it just did ("stopped 12 runs, including 3 already executing") from the response
/// alone, rather than from which button it happens to have called.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct BulkCancelOut {
    /// How many jobs moved to the terminal `canceled` state.
    pub canceled: u32,
    /// Whether the sweep reached runs that had not started yet (`queued`, `pending`)
    /// — the ones that had cost nothing.
    pub included_waiting: bool,
    /// Whether the sweep reached runs that were already executing (`dispatched`,
    /// `starting`, `running`) — the ones whose work was discarded.
    pub included_active: bool,
}

/// The body of `POST /jobs/{id}/verify-token`: the per-job token to check against
/// the one minted for the job. Sent by the artifact service to authenticate an
/// upload. Deserialize-only — no client in this workspace constructs it for the
/// wire (the artifact service builds the equivalent JSON itself), so it is not a
/// codegen contract type.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyTokenBody {
    /// The per-job bearer token the driver presented to the artifact service.
    pub token: String,
}

/// The SSE `event:` name of the console stream's hello frame, carrying the stream id.
pub const STREAM_EVENT_HELLO: &str = "stream";
/// The SSE `event:` name carrying a [`Notification`] (the `notifications` topic).
pub const STREAM_EVENT_NOTIFICATION: &str = "notification";
/// The SSE `event:` name carrying a [`RunEvent`] (the `runs` topic).
pub const STREAM_EVENT_RUN: &str = "run";
/// The SSE `event:` name telling a client it fell behind and must re-read the
/// authoritative lists.
pub const STREAM_EVENT_RESYNC: &str = "resync";
/// The SSE `event:` name of the periodic liveness frame. Payloadless — its arrival
/// is the whole message.
pub const STREAM_EVENT_HEARTBEAT: &str = "heartbeat";

/// How long the console stream may stay silent before it emits a heartbeat.
///
/// This is what makes a wedged stream detectable *by the client*. A client arms a
/// watchdog on any frame and tears the connection down when one is overdue, so the
/// interval sets how fast a dead stream is noticed — and, with the client's
/// tolerance factor, how long a run's row can be stale in the worst case. Matches
/// the per-job stream's heartbeat and axum's default keep-alive period, and stays
/// well under the 60s idle timeouts proxies and WKWebView impose.
const STREAM_HEARTBEAT: std::time::Duration = std::time::Duration::from_secs(15);

/// The console stream's first frame: the id this client quotes back to
/// `PUT /notifications/{stream}/topics`.
///
/// The id is minted per **connection**, not per client, and deliberately so. An
/// `EventSource` reconnects on its own after a drop, and the reconnected stream is a
/// new subscriber with default topics — so the client must be told the new id and
/// re-apply what it wanted. Handing out a client-chosen or long-lived id would hide
/// that transition and leave a console silently subscribed to nothing.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct StreamOpened {
    /// The connected stream's id.
    pub stream_id: String,
}

/// The console stream's "you fell behind" frame: this client was lagged and the
/// named number of messages were dropped for it.
///
/// It carries the count only as a diagnostic — a client's response is the same
/// whatever the number: re-read the active list (and, if it is showing them, the
/// produced runs). The frame exists because the stream keeps no backlog, so there is
/// nothing to replay and silence would be indistinguishable from an idle queue.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct StreamResync {
    /// How many messages were dropped for this client.
    pub dropped: u64,
}

// The server output shapes `LaunchAck`, `JobState`, `ActiveJobOut`, and
// `JobStatusOut` are shared with the queue's Rust clients, so they live in
// `core::job_api` and are re-exported at the top of this module. So are the console
// stream's `Notification`, `RunEvent`, and `StreamTopicsBody`.

#[cfg(test)]
#[path = "jobs.test.rs"]
mod tests;
