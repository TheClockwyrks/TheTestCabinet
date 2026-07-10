//! The arena service's HTTP surface: list the controllers a case can pit, run one
//! head-to-head match, submit a tournament, and observe a tournament live.
//!
//! All of these are the **execution** endpoints the deleted worker served and the
//! web console still expects — the run-and-stream surface, not the read/publish one
//! (published tournaments, stored replays, and controller listings are read from the
//! backend). The handler/return shapes are ported verbatim from the worker so the
//! console's hand-typed `httpArena.ts` reads them unchanged.
//!
//! These endpoints are **unauthenticated** behind the private-network boundary,
//! faithful to the worker: the console posts matches/tournaments token-less today.
//! Their CPU-bound wasm execution is gated by the [`MatchExecutor`] capacity guard,
//! not by auth.

use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use bytes::Bytes;
use futures_util::stream::{self, Stream, StreamExt};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use tokio::sync::broadcast::error::RecvError;
use tower_http::cors::{AllowHeaders, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing::Instrument as _;

use foray_core::replay::Replay;
use test_cabinet_core::match_play::{
    ControllerRef, MatchSummary, ResolvedController, run_quick_match, run_tournament,
};
use test_cabinet_core::{BackendClient, HttpBackendClient};

use crate::arena_resolve::{list_controllers, resolve_controller, with_pushed_controllers};
use crate::error::ApiError;
use crate::executor::MatchExecutor;
use crate::tournaments::{
    StreamItem, TournamentJob, TournamentJobStatus, TournamentProgress, TournamentRegistry,
};

/// The shared handler state: the backend URL the service fetches inputs from and
/// persists results to, the in-memory tournament registry (per-pod), and the
/// capacity guard the CPU-bound work runs through.
#[derive(Clone)]
pub struct AppState {
    /// The backend base URL (no trailing slash). Every handler builds a fresh
    /// [`HttpBackendClient`] from it to resolve controllers and publish tournaments.
    pub backend_url: Arc<String>,
    /// The per-pod tournament-job tracker.
    pub tournaments: TournamentRegistry,
    /// Bounds concurrent CPU-bound match/tournament execution.
    pub executor: Arc<MatchExecutor>,
}

impl AppState {
    /// A backend client pointed at the configured backend.
    fn backend(&self) -> HttpBackendClient {
        HttpBackendClient::new((*self.backend_url).clone())
    }
}

/// Build the arena service's Axum router. The trace middleware continues an inbound
/// W3C trace; CORS is permissive so a browser console reaching the service is never
/// blocked — the same posture as the backend and artifact services.
pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/matches/controllers", get(controllers))
        .route("/matches", post(run_match_handler))
        .route("/tournaments", post(submit_tournament))
        .route("/tournaments/{id}", get(tournament_status))
        .route("/tournaments/{id}/events", get(tournament_events))
        .layer(axum::middleware::from_fn(accept_trace))
        .layer(TraceLayer::new_for_http())
        // `permissive()` sets `Access-Control-Allow-Headers: *`, but per the Fetch
        // spec `*` does not cover `Authorization`, so a browser rejects a preflight
        // for a request carrying our bearer token. Mirror the request's headers
        // instead, which echoes `Authorization` back explicitly.
        .layer(CorsLayer::permissive().allow_headers(AllowHeaders::mirror_request()))
        .with_state(state)
}

/// Continue any inbound W3C trace context so spans stitch across the call (a no-op
/// when no propagator is installed, i.e. telemetry disabled).
async fn accept_trace(request: axum::extract::Request, next: axum::middleware::Next) -> Response {
    test_cabinet_telemetry::propagation::accept_inbound(request.headers());
    next.run(request).await
}

/// Liveness/readiness probe.
async fn healthz() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok" }))
}

// --- Matches ----------------------------------------------------------------

/// `POST /matches` — run one head-to-head match between two controllers and return
/// its replay (for immediate browser playback) plus the summary. Transient: nothing
/// is persisted.
async fn run_match_handler(
    State(state): State<AppState>,
    Json(body): Json<MatchBody>,
) -> Result<Json<MatchResponse>, ApiError> {
    let client = state.backend();
    let test_case = client
        .resolve_version(&body.test_case, &body.version)
        .await
        .map_err(|err| {
            ApiError::bad_request(format!(
                "resolving {}@{}: {err}",
                body.test_case, body.version
            ))
        })?;

    let red = resolve_controller(&client, &body.test_case, &body.version, &body.red)
        .await
        .map_err(ApiError::bad_request)?;
    let blue = resolve_controller(&client, &body.test_case, &body.version, &body.blue)
        .await
        .map_err(ApiError::bad_request)?;

    // A match is CPU-bound wasm execution; run it off the async runtime under the
    // capacity guard (which rejects with `503` at capacity rather than queueing).
    let outcome = state
        .executor
        .run_match(move || run_quick_match(&test_case, &red, &blue))
        .await?
        .map_err(|err| ApiError::internal(format!("running the match: {err}")))?;

    Ok(Json(MatchResponse {
        replay: outcome.replay,
        summary: outcome.summary,
    }))
}

/// `GET /matches/controllers?testCase=` — the controllers available to pit for a
/// case: the committed arena opponents (the model-facing baselines plus the hidden
/// references) and the case's **pushed** adversarial controllers resolved from the
/// backend.
async fn controllers(
    State(state): State<AppState>,
    Query(params): Query<ControllersParams>,
) -> Json<ControllersResponse> {
    let baselines = list_controllers(&params.test_case);
    let client = state.backend();
    let controllers = with_pushed_controllers(&client, &params.test_case, baselines).await;
    Json(ControllersResponse { controllers })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchBody {
    pub test_case: String,
    pub version: String,
    pub red: ControllerRef,
    pub blue: ControllerRef,
}

#[derive(Debug, Serialize)]
pub struct MatchResponse {
    /// The browser-playable replay, or `null` when a controller failed to load.
    replay: Option<Replay>,
    summary: MatchSummary,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControllersParams {
    pub test_case: String,
}

#[derive(Debug, Serialize)]
pub struct ControllersResponse {
    controllers: Vec<ControllerRef>,
}

// --- Tournaments ------------------------------------------------------------

/// `POST /tournaments` — submit a tournament. Resolves every participant's
/// controller, acquires a capacity permit, registers a job, spawns the background
/// task that runs all pairs and publishes the result, and returns the job id
/// immediately (`202 Accepted`). At capacity the submit is rejected with `503`
/// rather than queued, so the console sees the rejection.
async fn submit_tournament(
    State(state): State<AppState>,
    Json(body): Json<TournamentBody>,
) -> Result<Response, ApiError> {
    if body.participants.len() < 2 {
        return Err(ApiError::bad_request(
            "a tournament needs at least two participants",
        ));
    }

    let client = state.backend();
    let test_case = client
        .resolve_version(&body.test_case, &body.version)
        .await
        .map_err(|err| {
            ApiError::bad_request(format!(
                "resolving {}@{}: {err}",
                body.test_case, body.version
            ))
        })?;

    // Resolve every controller up front so a bad participant fails the submit rather
    // than a half-run tournament.
    let mut participants: Vec<ResolvedController> = Vec::with_capacity(body.participants.len());
    for controller in &body.participants {
        participants.push(
            resolve_controller(&client, &body.test_case, &body.version, controller)
                .await
                .map_err(ApiError::bad_request)?,
        );
    }

    // Acquire the capacity permit before accepting the job: at capacity the submit
    // is rejected with `503` so the console can retry, rather than queueing CPU-bound
    // work the pod can't keep up with. The permit is held across the whole drive.
    let permit = state.executor.acquire()?;

    let job = state.tournaments.create();
    let job_id = job.id().to_string();
    let variant = if body.variant.trim().is_empty() {
        "base".to_string()
    } else {
        body.variant
    };

    let job_span = tracing::info_span!(
        "tournament.job",
        tournament_id = %job_id,
        test_case = %body.test_case,
        participants = participants.len(),
    );
    tokio::spawn(
        drive_tournament(client, job, test_case, variant, participants, permit)
            .instrument(job_span),
    );

    let ack = SubmitAck {
        tournament_id: job_id.clone(),
        status_url: format!("/tournaments/{job_id}"),
        events_url: format!("/tournaments/{job_id}/events"),
    };
    Ok((StatusCode::ACCEPTED, Json(ack)).into_response())
}

/// Run a tournament to completion and publish it, recording progress on `job`. Holds
/// the capacity `permit` for the whole drive (dropped when this future returns).
async fn drive_tournament(
    client: HttpBackendClient,
    job: TournamentJob,
    test_case: test_cabinet_core::TestCaseVersion,
    variant: String,
    participants: Vec<ResolvedController>,
    permit: tokio::sync::OwnedSemaphorePermit,
) {
    // Hold the permit until the tournament finishes (every pair plus publishing).
    let _permit = permit;
    let tournament_id = job.id().to_string();
    let created_at = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_default();

    // The matches are CPU-bound wasm execution; run them off the async runtime,
    // pushing live progress as each pair completes.
    let progress_job = job.clone();
    let blocking_id = tournament_id.clone();
    let build = tokio::task::spawn_blocking(move || {
        run_tournament(
            &test_case,
            &variant,
            &blocking_id,
            &created_at,
            participants,
            |played, total, summary| {
                progress_job.push_progress(TournamentProgress {
                    played,
                    total,
                    summary: summary.clone(),
                });
            },
        )
    })
    .await;

    let build = match build {
        Ok(Ok(build)) => build,
        Ok(Err(err)) => return job.finish_failed(format!("running the tournament: {err}")),
        Err(err) => return job.finish_failed(format!("tournament task panicked: {err}")),
    };

    // Publish the record and each match's replay to the backend (the gallery's
    // store).
    if let Err(err) = client.publish_tournament(&build.record).await {
        return job.finish_failed(format!("publishing the tournament: {err}"));
    }
    for (match_id, replay) in &build.replays {
        if let Err(err) = client
            .publish_tournament_match(&tournament_id, match_id, replay.to_json().into_bytes())
            .await
        {
            return job.finish_failed(format!("publishing match `{match_id}`: {err}"));
        }
    }

    job.finish_succeeded(build.record);
}

/// `GET /tournaments/{job}` — the tournament job's current status (and the finished
/// record once it has succeeded).
async fn tournament_status(
    State(state): State<AppState>,
    Path(job): Path<String>,
) -> Result<Json<TournamentJobStatus>, ApiError> {
    let job = lookup(&state, &job)?;
    Ok(Json(job.status()))
}

/// `GET /tournaments/{job}/events` — the live per-match progress stream as NDJSON.
async fn tournament_events(
    State(state): State<AppState>,
    Path(job): Path<String>,
) -> Result<Response, ApiError> {
    let job = lookup(&state, &job)?;
    let body = Body::from_stream(progress_stream(job));
    Ok((
        [
            (header::CONTENT_TYPE, "application/x-ndjson"),
            (header::CACHE_CONTROL, "no-cache"),
        ],
        body,
    )
        .into_response())
}

/// Look up a tournament job by id, 404 if unknown.
fn lookup(state: &AppState, id: &str) -> Result<TournamentJob, ApiError> {
    state
        .tournaments
        .get(id)
        .ok_or_else(|| ApiError::not_found(format!("tournament `{id}` not found")))
}

/// Build the NDJSON byte stream for a tournament: the replayed backlog of completed
/// matches followed by the live tail, ending when the tournament does.
fn progress_stream(
    job: TournamentJob,
) -> impl Stream<Item = Result<Bytes, std::convert::Infallible>> {
    let sub = job.subscribe();
    let backlog = stream::iter(sub.backlog.into_iter().map(|p| Ok(encode_line(&p))));
    let live = stream::unfold(
        (sub.terminated, sub.receiver),
        |(done, mut receiver)| async move {
            if done {
                return None;
            }
            loop {
                match receiver.recv().await {
                    Ok(StreamItem::Progress(progress)) => {
                        return Some((Ok(encode_line(&progress)), (false, receiver)));
                    }
                    Ok(StreamItem::Done) => return None,
                    Err(RecvError::Closed) => return None,
                    Err(RecvError::Lagged(_)) => continue,
                }
            }
        },
    );
    backlog.chain(live)
}

/// Encode one progress item as a `\n`-terminated NDJSON line. A progress item's
/// fields are plain JSON-safe scalars, so a defensive empty line stands in for the
/// impossible serialization error rather than aborting the stream.
fn encode_line(progress: &TournamentProgress) -> Bytes {
    match serde_json::to_string(progress) {
        Ok(mut line) => {
            line.push('\n');
            Bytes::from(line)
        }
        Err(_) => Bytes::from_static(b"\n"),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TournamentBody {
    pub test_case: String,
    pub version: String,
    #[serde(default)]
    pub variant: String,
    pub participants: Vec<ControllerRef>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitAck {
    /// The id of the accepted tournament (also the persisted tournament's id).
    pub tournament_id: String,
    /// Where to poll the tournament's status.
    pub status_url: String,
    /// Where to stream live per-match progress (NDJSON).
    pub events_url: String,
}

#[cfg(test)]
#[path = "api.test.rs"]
mod tests;
