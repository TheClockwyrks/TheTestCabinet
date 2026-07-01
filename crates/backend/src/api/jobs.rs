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
use test_cabinet_core::run_record::RunRecord;
// The job-API wire shapes shared with the dispatcher, driver, and the queue's
// Rust clients live in `core` (so neither must depend on this crate) — both the
// request shapes the driver/dispatcher speak and the server **output** shapes a
// client deserializes. Re-export them so this module — and `api.rs`'s public
// re-export, which the `contract-codegen` generator names — keep referring to
// them as `jobs::{LaunchBody, …}`.
pub use test_cabinet_core::{
    ActiveJobOut, ClaimedJob, DriverState, JobState, JobStatusOut, LaunchAck, LaunchBody,
    StatusUpdate,
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
    if body.test_case.trim().is_empty() {
        return Err(ApiError::bad_request("`testCase` must not be empty"));
    }
    if body.version.trim().is_empty() {
        return Err(ApiError::bad_request("`version` must not be empty"));
    }
    if body.variant.trim().is_empty() {
        return Err(ApiError::bad_request("`variant` must not be empty"));
    }
    if body.model.trim().is_empty() {
        return Err(ApiError::bad_request("`model` must not be empty"));
    }

    let id = Uuid::new_v4().to_string();
    let job_token = Uuid::new_v4().to_string();
    let now = now_rfc3339()?;
    let request_json = serde_json::to_string(&body)
        .map_err(|e| ApiError::internal(format!("serializing launch request: {e}")))?;

    state
        .db
        .enqueue_job(crate::db::NewJob {
            id: id.clone(),
            request_json,
            test_case_slug: body.test_case.clone(),
            variant: body.variant.clone(),
            harness_slug: body.harness.as_str().to_string(),
            model_id: body.model.clone(),
            job_token,
            created_at: now,
        })
        .await
        .map_err(ApiError::from)?;

    let ack = LaunchAck {
        job_id: id.clone(),
        status_url: format!("/jobs/{id}"),
        live_url: format!("/jobs/{id}/live"),
    };
    Ok((StatusCode::ACCEPTED, Json(ack)).into_response())
}

/// `GET /jobs/active` — the runs still in flight (queued, dispatched, or
/// running), each described by the identity captured at enqueue. The console
/// seeds its in-progress list from this so a run it is watching survives a reload.
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
/// A job still in a non-terminal state (`queued`, `dispatched`, or `running`) is
/// atomically moved to the terminal `canceled` state and its live stream is closed,
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

    let now = now_rfc3339()?;

    match update.state {
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
            Ok(StatusCode::NO_CONTENT)
        }
    }
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
    let links = record.links.clone();
    state
        .db
        .push(record, &links, events_json.as_deref())
        .await
        .map_err(ApiError::from)?;
    Ok(record.id.clone())
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
