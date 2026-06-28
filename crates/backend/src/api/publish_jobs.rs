//! The publish-queue endpoints: claim, stream progress, report the terminal
//! result, and the live stream.
//!
//! A publish is no longer a synchronous flip the console waits on; the console
//! **enqueues** it (`POST /runs/{id}/publish`, see [`super::runs::publish`]), the
//! **dispatcher** claims the oldest queued publish job (`POST /publish-jobs/next`,
//! service-token), and a per-publish `tcab-publisher` pod runs the gh/wrangler
//! release and streams progress + a terminal result back
//! (`POST /publish-jobs/{id}/events|result`, per-job token). The console observes
//! it entirely through the backend over the live NDJSON stream
//! (`GET /publish-jobs/{id}/live`), which ends with the terminal result.
//!
//! The durable publish lifecycle is the `publish_job` table; the live progress
//! fan-out is the in-memory [`crate::publish_relay`]. On a terminal **success** the
//! backend attaches the produced links to the run, flips it published, and queues a
//! public-snapshot refresh ([`crate::db::Db::complete_publish_job`]); the publisher
//! never calls `POST /runs` (which needs an account token) — it reports via the
//! per-publish-job token instead.

use std::convert::Infallible;

use axum::Json;
use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use bytes::Bytes;
use futures_util::stream::{self, Stream, StreamExt};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use tokio::sync::broadcast::error::RecvError;

// The publish-queue wire shapes the dispatcher and publisher speak live in `core`
// (so neither must depend on this crate); re-export them so this module refers to
// them unqualified, mirroring `jobs`'s re-export of the run-queue shapes.
pub use test_cabinet_core::{
    PublishClaim, PublishJobState, PublishProgress, PublishResult, PublishState,
};
use test_cabinet_entities::publish_job;

use crate::auth::{ServiceAuth, bearer_token, token_matches};
use crate::error::ApiError;
use crate::publish_relay::PublishStreamItem;

use super::AppState;

/// `POST /publish-jobs/next` — the dispatcher claims the oldest queued publish job.
/// Requires the service token. Returns `200` with the claimed job (id, the per-job
/// token the publisher reports with, and the run to release) or `204 No Content`
/// when the queue is empty. Mirrors [`super::jobs::claim`].
pub async fn claim(
    State(state): State<AppState>,
    _service: ServiceAuth,
) -> Result<Response, ApiError> {
    let now = now_rfc3339()?;
    let Some(job) = state
        .db
        .claim_next_publish_job(&now)
        .await
        .map_err(ApiError::from)?
    else {
        return Ok(StatusCode::NO_CONTENT.into_response());
    };
    Ok(Json(PublishClaim {
        job_id: job.id,
        job_token: job.job_token,
        run_id: job.run_id,
    })
    .into_response())
}

/// `GET /publish-jobs/{id}` — one publish job's current status: its lifecycle
/// state and, on success, the produced links (else the terminal failure reason).
/// `404` for an unknown publish job. Secondary to the live stream — a console
/// observes a publish over [`live`], not by polling this — but kept so a client can
/// re-resolve a finished publish after a backend restart dropped its live buffer.
pub async fn status(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<PublishStatusOut>, ApiError> {
    let job = state
        .db
        .get_publish_job(&id)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found(format!("no publish job `{id}`")))?;
    Ok(Json(PublishStatusOut {
        id: job.id,
        run_id: job.run_id,
        state: PublishJobState::from_db(&job.state),
        source_repo: job.source_repo,
        playable_build: job.playable_build,
        detail: job.detail,
    }))
}

/// `GET /publish-jobs/{id}/live` — the live publish-progress stream as NDJSON. A
/// subscriber is first replayed the backlog (progress lines so far, ending in the
/// terminal result if the publish already finished), then receives new items as the
/// publisher produces them; the stream closes when the terminal [`PublishResult`]
/// is delivered. A connection to an already-finished publish closes after the
/// backlog. `404` for an unknown publish job.
///
/// Open to any caller that can reach the backend, exactly like
/// [`super::jobs::live`] — the private-network model gates the backend, and a
/// publish-job id is itself opaque.
pub async fn live(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    let job = state
        .db
        .get_publish_job(&id)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found(format!("no publish job `{id}`")))?;
    // If the publish is already terminal but its in-memory buffer was lost (e.g. a
    // backend restart), synthesize the terminal item from the persisted row so the
    // stream still closes cleanly instead of waiting forever for a result that will
    // never be re-streamed; the console then has the final links/reason.
    let persisted_terminal = PublishJobState::from_db(&job.state)
        .is_terminal()
        .then(|| terminal_from_row(&job));
    let live = state.publish_relay.live(&id);
    let body = Body::from_stream(publish_stream(live, persisted_terminal));
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

/// `POST /publish-jobs/{id}/events` — the publisher streams a progress line while
/// the release runs. Authenticated by the per-job token. The line joins the live
/// stream; it is not persisted (only the terminal result is durable).
pub async fn ingest_events(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(progress): Json<PublishProgress>,
) -> Result<StatusCode, ApiError> {
    authorize_publish_job(&state, &id, &headers).await?;
    state.publish_relay.live(&id).push_progress(progress);
    Ok(StatusCode::NO_CONTENT)
}

/// `POST /publish-jobs/{id}/result` — the publisher reports the terminal outcome of
/// the release. Authenticated by the per-job token.
///
/// On `Succeeded` the backend attaches the produced links to the run, flips it
/// published, queues a public-snapshot refresh
/// ([`crate::db::Db::complete_publish_job`]), and pushes the terminal item onto the
/// live stream. On `Failed` it records the reason on the publish job
/// ([`crate::db::Db::set_publish_job_state`]) and likewise closes the stream. Either
/// way the live stream ends with this exact [`PublishResult`].
#[tracing::instrument(
    name = "publish_jobs.result",
    skip(state, headers, result),
    fields(publish_job.id = %id),
    err(Debug),
)]
pub async fn report_result(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(result): Json<PublishResult>,
) -> Result<StatusCode, ApiError> {
    let job = authorize_publish_job(&state, &id, &headers).await?;
    let now = now_rfc3339()?;

    match result.state {
        PublishState::Succeeded => {
            state
                .db
                .complete_publish_job(
                    &id,
                    &job.run_id,
                    result.source_repo.as_deref(),
                    result.playable_build.as_deref(),
                    &now,
                )
                .await
                .map_err(ApiError::from)?;
            // Coalesced: the dirty flag was set in `complete_publish_job`'s
            // transaction; this only wakes the debounce loop.
            state.publisher.queue_refresh();
            crate::metrics::record_run_published(true);
        }
        PublishState::Failed => {
            let detail = result.detail.as_deref().unwrap_or("publish failed");
            state
                .db
                .set_publish_job_state(&id, "failed", &now, Some(detail))
                .await
                .map_err(ApiError::from)?;
        }
    }

    // The terminal item closes every live subscriber's stream — pushed after the
    // durable write so a subscriber that reacts to it sees a consistent store.
    state.publish_relay.live(&id).finish(result);
    Ok(StatusCode::NO_CONTENT)
}

/// `POST /publish-jobs/{id}/verify-token` — confirm a presented per-job token
/// matches the one minted for publish job `{id}`. The internal call the **artifact
/// service** makes to authenticate the publisher's `tree.tar` download: the
/// publisher presents its publish-job token to the artifact service, which forwards
/// it here (the backend is the token authority) before serving the run's source
/// tree.
///
/// No other auth gates this endpoint — the presented token *is* the secret
/// (publish-job tokens are random UUIDs minted at enqueue), so a caller that does
/// not already hold it learns nothing. `200 No Content` when it matches, `401` when
/// it does not (or the token field is absent), `404` for an unknown publish job.
/// Constant-time comparison via [`token_matches`] keeps the check from leaking the
/// token through timing — the publish path's analogue of
/// [`super::jobs::verify_token`].
pub async fn verify_token(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<VerifyTokenBody>,
) -> Result<StatusCode, ApiError> {
    let job = state
        .db
        .get_publish_job(&id)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found(format!("no publish job `{id}`")))?;
    if body.token.is_empty() || !token_matches(&body.token, &job.job_token) {
        return Err(ApiError::unauthorized("invalid publish-job token"));
    }
    Ok(StatusCode::NO_CONTENT)
}

// --- Helpers ----------------------------------------------------------------

/// Load a publish job and verify the request carries its per-job token. `404` for
/// an unknown publish job, `401` for a missing or wrong token. The publish path's
/// analogue of [`super::jobs::authorize_job`].
async fn authorize_publish_job(
    state: &AppState,
    id: &str,
    headers: &HeaderMap,
) -> Result<publish_job::Model, ApiError> {
    let job = state
        .db
        .get_publish_job(id)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found(format!("no publish job `{id}`")))?;
    let token =
        bearer_token(headers).ok_or_else(|| ApiError::unauthorized("missing publish-job token"))?;
    if !token_matches(&token, &job.job_token) {
        return Err(ApiError::unauthorized("invalid publish-job token"));
    }
    Ok(job)
}

/// Reconstruct the terminal [`PublishResult`] from a persisted publish-job row, for
/// a live subscriber that connects after the in-memory buffer was lost.
fn terminal_from_row(job: &publish_job::Model) -> PublishResult {
    let state = match PublishJobState::from_db(&job.state) {
        PublishJobState::Succeeded => PublishState::Succeeded,
        // Anything else reaching here is a failed (or otherwise non-success)
        // terminal row; the caller only synthesizes for terminal states.
        _ => PublishState::Failed,
    };
    PublishResult {
        state,
        source_repo: job.source_repo.clone(),
        playable_build: job.playable_build.clone(),
        detail: job.detail.clone(),
    }
}

/// The current UTC time as an RFC 3339 string, or a `500` if formatting fails.
fn now_rfc3339() -> Result<String, ApiError> {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|e| ApiError::internal(format!("formatting timestamp: {e}")))
}

/// Build the NDJSON byte stream for a publish job: the replayed backlog, then the
/// live tail, each item one `\n`-terminated JSON line, ending when the publish does
/// (its terminal result). `persisted_terminal` is `Some` when the publish already
/// finished but its live buffer is gone — its result is appended so the stream
/// closes with the outcome rather than waiting on a channel that will never fire.
fn publish_stream(
    live: crate::publish_relay::LivePublish,
    persisted_terminal: Option<PublishResult>,
) -> impl Stream<Item = Result<Bytes, Infallible>> {
    let sub = live.subscribe();
    // The backlog already ends in the terminal result for a finished publish whose
    // buffer survived; only synthesize one when the buffer was lost (the backlog is
    // then empty but the persisted row says terminal).
    let backlog_terminated = sub.terminated;
    let synthesized = (!backlog_terminated)
        .then_some(persisted_terminal)
        .flatten();
    let close_after_backlog = backlog_terminated || synthesized.is_some();

    let backlog = stream::iter(sub.backlog.into_iter().map(|item| Ok(encode_item(&item))));
    let synthesized = stream::iter(
        synthesized
            .into_iter()
            .map(|result| Ok(encode_item(&PublishStreamItem::Result(Box::new(result))))),
    );
    let live_tail = stream::unfold(
        (close_after_backlog, sub.receiver),
        |(done, mut receiver)| async move {
            if done {
                return None;
            }
            loop {
                match receiver.recv().await {
                    // The terminal result is emitted, then the stream closes.
                    Ok(item @ PublishStreamItem::Result(_)) => {
                        return Some((Ok(encode_item(&item)), (true, receiver)));
                    }
                    Ok(item) => return Some((Ok(encode_item(&item)), (false, receiver))),
                    Err(RecvError::Closed) => return None,
                    Err(RecvError::Lagged(_)) => continue,
                }
            }
        },
    );
    backlog.chain(synthesized).chain(live_tail)
}

/// Encode one publish stream item as a `\n`-terminated NDJSON line, tagged with a
/// `type` discriminator (`progress` or `result`) so a subscriber tells the
/// non-terminal progress lines from the terminal result. A defensive empty line
/// stands in for the impossible serialization error rather than aborting the stream.
fn encode_item(item: &PublishStreamItem) -> Bytes {
    let tagged = match item {
        PublishStreamItem::Progress(progress) => {
            tag("progress", serde_json::to_value(progress.as_ref()))
        }
        PublishStreamItem::Result(result) => tag("result", serde_json::to_value(result.as_ref())),
    };
    match serde_json::to_string(&tagged) {
        Ok(mut line) => {
            line.push('\n');
            Bytes::from(line)
        }
        Err(_) => Bytes::from_static(b"\n"),
    }
}

/// Tag a serialized stream item with its `type` discriminator, falling back to an
/// empty object on the impossible serialization error.
fn tag(kind: &str, value: serde_json::Result<serde_json::Value>) -> serde_json::Value {
    let mut value = value.unwrap_or_else(|_| serde_json::json!({}));
    if let Some(object) = value.as_object_mut() {
        object.insert("type".to_string(), serde_json::Value::from(kind));
    }
    value
}

// --- Wire shapes ------------------------------------------------------------

/// The body of `POST /publish-jobs/{id}/verify-token`: the per-job token to check
/// against the one minted for the publish job. Sent by the artifact service to
/// authenticate the publisher's `tree.tar` download. Deserialize-only — no client
/// in this workspace constructs it for the wire — so it is not a codegen contract
/// type, mirroring [`super::jobs::VerifyTokenBody`].
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyTokenBody {
    /// The per-publish-job bearer token the publisher presented to the artifact
    /// service.
    pub token: String,
}

/// The body of `GET /publish-jobs/{id}`: a publish job's current lifecycle state
/// and, on success, the produced links (else the failure reason). The secondary
/// (status) read; the live stream is the primary observation path.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishStatusOut {
    /// The publish job id.
    pub id: String,
    /// The run this publish releases.
    pub run_id: String,
    /// The lifecycle state.
    pub state: PublishJobState,
    /// The produced public source-repo URL, once it succeeded.
    pub source_repo: Option<String>,
    /// The deployed playable-build URL, once it succeeded.
    pub playable_build: Option<String>,
    /// The terminal failure reason, once it failed.
    pub detail: Option<String>,
}

#[cfg(test)]
#[path = "publish_jobs.test.rs"]
mod tests;
