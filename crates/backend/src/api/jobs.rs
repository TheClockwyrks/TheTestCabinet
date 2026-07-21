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
//! the worker-wide completion feed (`GET /notifications`).
//!
//! The durable job lifecycle is the `job` table; the live event/preview fan-out
//! is the in-memory [`crate::relay`]. A produced run's record lands in the `run`
//! table via [`crate::db::Db::push`] on success, the same store a locally-driven
//! `tcab` run pushes to.

use std::convert::Infallible;

use axum::Json;
use axum::body::Body;
use axum::extract::{Path, State};
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
// The job-API wire shapes shared with the dispatcher, driver, and the queue's
// Rust clients live in `core` (so neither must depend on this crate) — both the
// request shapes the driver/dispatcher speak and the server **output** shapes a
// client deserializes. Re-export them so this module — and `api.rs`'s public
// re-export, which the `contract-codegen` generator names — keep referring to
// them as `jobs::{LaunchBody, …}`.
pub use test_cabinet_core::{
    ActiveJobOut, ClaimedJob, DriverState, JobState, JobStatusOut, LaunchAck, LaunchBatchAck,
    LaunchBatchBody, LaunchBatchItem, LaunchBody, StatusUpdate,
};
use test_cabinet_entities::job;

use crate::auth::{AuthUser, ServiceAuth, bearer_token, token_matches};
use crate::error::ApiError;
use crate::relay::{JobSummary, Notification, StreamItem};

use super::AppState;

/// `POST /jobs` — enqueue a run. Requires a bearer token (the launching account);
/// validates the request, mints a job id and per-job driver token, stores it in
/// the `queued` state, and returns the job id. The run itself is driven later by
/// a driver pod the dispatcher creates; observe it via the endpoints below.
#[tracing::instrument(
    name = "jobs.launch",
    skip(state, _user, body),
    fields(case.slug = %body.test_case, case.version = %body.version, variant = %body.variant),
    err(Debug),
)]
pub async fn launch(
    State(state): State<AppState>,
    _user: AuthUser,
    Json(body): Json<LaunchBody>,
) -> Result<Response, ApiError> {
    let now = now_rfc3339()?;
    let new = build_new_job(&body, &now).map_err(ApiError::bad_request)?;
    let id = new.id.clone();

    state.db.enqueue_job(new).await.map_err(ApiError::from)?;

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

/// `POST /jobs/batch` — enqueue many runs in one request. Requires a bearer token
/// (the launching account), the same gate as `POST /jobs`. Each requested run is
/// validated and minted independently, so a single malformed request is reported as
/// its own error without aborting the rest; the accepted runs are then inserted in
/// one batch. The response carries one result per requested run, aligned by index,
/// each with the enqueued job id or the reason it was rejected.
///
/// This is the batch analogue of [`launch`]: a console fanning out a set of runs
/// (the coverage matrix's still-missing runs, the new-run form's combinations)
/// sends one request and one insert instead of one per run.
#[tracing::instrument(name = "jobs.launch_batch", skip(state, _user, body), fields(runs = body.runs.len()), err(Debug))]
pub async fn launch_batch(
    State(state): State<AppState>,
    _user: AuthUser,
    Json(body): Json<LaunchBatchBody>,
) -> Result<Response, ApiError> {
    if body.runs.len() > MAX_BATCH_RUNS {
        return Err(ApiError::bad_request(format!(
            "a batch may enqueue at most {MAX_BATCH_RUNS} runs (got {})",
            body.runs.len()
        )));
    }

    let now = now_rfc3339()?;
    // Validate and mint each requested run up front. A rejected run records its
    // error at its index and is dropped from the insert set; an accepted run
    // records its (already minted) job id and is queued for the batch insert. The
    // `items` vector stays index-aligned with `body.runs`.
    let mut items: Vec<LaunchBatchItem> = Vec::with_capacity(body.runs.len());
    let mut to_insert: Vec<crate::db::NewJob> = Vec::with_capacity(body.runs.len());
    for run in &body.runs {
        match build_new_job(run, &now) {
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

    state
        .db
        .enqueue_jobs(to_insert)
        .await
        .map_err(ApiError::from)?;

    Ok((StatusCode::ACCEPTED, Json(LaunchBatchAck { jobs: items })).into_response())
}

/// Validate a launch request and build the `queued` job to enqueue for it: mint the
/// job id and per-job driver token and serialize the request verbatim. Returns the
/// human-readable reason on a validation failure. Shared by the single
/// ([`launch`]) and batch ([`launch_batch`]) enqueue paths so both validate and
/// record a run identically.
fn build_new_job(body: &LaunchBody, now: &str) -> Result<crate::db::NewJob, String> {
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
        harness_slug: body.harness.as_str().to_string(),
        model_id: body.model.clone(),
        job_token: Uuid::new_v4().to_string(),
        // A console launch is the initial attempt; the backend re-enqueues any
        // automatic retries with an incremented `attempt`.
        attempt: 0,
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
/// bearer token (the launching account, the same gate as `POST /jobs`).
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
    // teardown proceeds asynchronously. Deliberately not a `finish_and_notify`: a
    // canceled run raises no completion alert.
    state.relay.live(&id).finish();
    Ok(Json(job_status_out(&canceled)))
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
    let Some(job) = state
        .db
        .claim_next_job(&now)
        .await
        .map_err(ApiError::from)?
    else {
        return Ok(StatusCode::NO_CONTENT.into_response());
    };
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
            Ok(StatusCode::NO_CONTENT)
        }
        DriverState::Running => {
            state
                .db
                .set_job_state(&id, "running", &now, None, None)
                .await
                .map_err(ApiError::from)?;
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
/// Two guards keep the chain finite: `already_terminal` skips a duplicate/late
/// terminal report (the decision is made only the first time a job goes terminal),
/// and the strictly-monotonic `attempt` bounded by the request's `retryCount` means
/// the chain always terminates.
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
            harness_slug: job.harness_slug.clone(),
            model_id: job.model_id.clone(),
            job_token,
            attempt,
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
    let receiver = state.relay.notifier().subscribe();
    let stream = stream::unfold(receiver, |mut receiver| async move {
        loop {
            match receiver.recv().await {
                Ok(notification) => {
                    let event = Event::default()
                        .json_data(&notification)
                        .unwrap_or_else(|_| Event::default());
                    return Some((Ok(event), receiver));
                }
                Err(RecvError::Lagged(_)) => continue,
                Err(RecvError::Closed) => return None,
            }
        }
    });
    Sse::new(stream).keep_alive(KeepAlive::default())
}

// --- Helpers ----------------------------------------------------------------

/// Mark a job's live stream finished and publish its completion notification.
fn finish_and_notify(state: &AppState, notification: Notification) {
    state.relay.live(&notification.job_id).finish();
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

// The server output shapes `LaunchAck`, `JobState`, `ActiveJobOut`, and
// `JobStatusOut` are shared with the queue's Rust clients, so they live in
// `core::job_api` and are re-exported at the top of this module.

#[cfg(test)]
#[path = "jobs.test.rs"]
mod tests;
