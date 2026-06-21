//! Tournament endpoints: submit a tournament (a background job that runs every
//! pair and auto-publishes to the backend), poll its status, and stream live
//! per-match progress.
//!
//! Once a tournament completes the worker publishes it to the backend, where the
//! gallery reads it — so the worker exposes no list/get/replay routes of its own
//! (those are served by the backend). It only runs the field and reports progress.

use axum::Json;
use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use bytes::Bytes;
use futures_util::stream::{self, Stream, StreamExt};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use tokio::sync::broadcast::error::RecvError;
use tracing::Instrument as _;

use test_cabinet_core::match_play::{ControllerRef, ResolvedController, run_tournament};
use test_cabinet_core::{BackendClient, HttpBackendClient};

use crate::api::AppState;
use crate::arena::resolve_controller;
use crate::error::ApiError;
use crate::tournaments::{StreamItem, TournamentJob, TournamentJobStatus, TournamentProgress};

/// `POST /tournaments` — submit a tournament. Resolves every participant's
/// controller, registers a job, spawns the background task that runs all pairs and
/// publishes the result, and returns the job id immediately (`202 Accepted`).
pub async fn submit(
    State(state): State<AppState>,
    Json(body): Json<TournamentBody>,
) -> Result<Response, ApiError> {
    if body.participants.len() < 2 {
        return Err(ApiError::bad_request(
            "a tournament needs at least two participants",
        ));
    }

    let client = HttpBackendClient::new(state.config.backend_url.clone());
    let test_case = client
        .resolve_version(&body.test_case, &body.version)
        .await
        .map_err(|err| {
            ApiError::bad_request(format!(
                "resolving {}@{}: {err}",
                body.test_case, body.version
            ))
        })?;

    // Resolve every controller up front so a bad participant fails the submit
    // rather than a half-run tournament.
    let mut participants: Vec<ResolvedController> = Vec::with_capacity(body.participants.len());
    for controller in &body.participants {
        participants.push(
            resolve_controller(
                &client,
                &state.config.out_dir,
                &body.test_case,
                &body.version,
                &test_case,
                controller,
            )
            .await
            .map_err(ApiError::bad_request)?,
        );
    }

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
        drive_tournament(client, job, test_case, variant, participants).instrument(job_span),
    );

    let ack = SubmitAck {
        tournament_id: job_id.clone(),
        status_url: format!("/tournaments/{job_id}"),
        events_url: format!("/tournaments/{job_id}/events"),
    };
    Ok((StatusCode::ACCEPTED, Json(ack)).into_response())
}

/// Run a tournament to completion and publish it, recording progress on `job`.
async fn drive_tournament(
    client: HttpBackendClient,
    job: TournamentJob,
    test_case: test_cabinet_core::TestCaseVersion,
    variant: String,
    participants: Vec<ResolvedController>,
) {
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
    // store). The worker always has a backend configured.
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

/// `GET /tournaments/{job}` — the tournament job's current status (and the
/// finished record once it has succeeded).
pub async fn status(
    State(state): State<AppState>,
    Path(job): Path<String>,
) -> Result<Json<TournamentJobStatus>, ApiError> {
    let job = lookup(&state, &job)?;
    Ok(Json(job.status()))
}

/// `GET /tournaments/{job}/events` — the live per-match progress stream as NDJSON.
pub async fn events(
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

/// Build the NDJSON byte stream for a tournament: the replayed backlog of
/// completed matches followed by the live tail, ending when the tournament does.
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
