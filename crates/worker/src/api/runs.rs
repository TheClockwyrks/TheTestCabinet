//! Run endpoints: submit a run, poll its status, stream its live events.
//!
//! These implement the async job model (`design` resolved decisions): submit
//! returns a job id immediately, and the status and event stream are separate
//! endpoints — the worker never holds one request open for the whole (up to an
//! hour) run.

use axum::Json;
use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use bytes::Bytes;
use futures_util::stream::{self, Stream, StreamExt};
use serde::{Deserialize, Serialize};
use test_cabinet_core::{
    HarnessSlug, ONE_SHOT_SLUG, OrchestratorSelection, RunRecord, RunRequest, find_build_output,
    serve_asset_file, serve_build_file, serve_proof_file,
};
use tokio::sync::broadcast::error::RecvError;
use tracing::Instrument as _;

use crate::api::AppState;
use crate::error::ApiError;
use crate::jobs::{ActiveRun, Job, JobStatus, RunSummary, StreamItem};
use crate::runner::{RunContext, drive_run};

/// The body of `POST /runs`: what to run, with what, against which model.
///
/// This is the HTTP shape of [`RunRequest`]. `version` and `variant` are
/// required (a worker resolves an exact, immutable version from the backend);
/// `maxRuntimeSeconds` optionally overrides the case's default cap.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct SubmitBody {
    /// Test-case slug to run (e.g. `pong`).
    pub test_case: String,
    /// Exact, immutable test-case version (e.g. `v1.0.0`).
    pub version: String,
    /// Variant to run (e.g. `base`).
    pub variant: String,
    /// Agent harness to drive.
    pub harness: HarnessSlug,
    /// Opaque model id passed to the harness.
    pub model: String,
    /// Built-in orchestrator slug that conducts the harness sessions (e.g.
    /// `one-shot` or `ralph`). Omit for the `one-shot` default. A worker resolves
    /// built-in orchestrators only — it has no access to a submitter's local
    /// directory, so there is no external-directory equivalent here.
    #[serde(default)]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub orchestrator: Option<String>,
    /// Optional override for the maximum harness runtime, in seconds.
    #[serde(default)]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub max_runtime_seconds: Option<u64>,
}

/// The response to a successful `POST /runs`: the accepted job's id and the URLs
/// to observe it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct SubmitAck {
    /// The id of the accepted run job.
    pub job_id: String,
    /// Where to poll the job's status.
    pub status_url: String,
    /// Where to stream the job's live harness events (NDJSON).
    pub events_url: String,
}

/// `POST /runs` — submit a run.
///
/// Validates the request, registers a job, spawns the background run task, and
/// returns the job id immediately (`202 Accepted`). The run itself proceeds out
/// of band; observe it via the status and events endpoints.
pub async fn submit(
    State(state): State<AppState>,
    Json(body): Json<SubmitBody>,
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

    let request = RunRequest {
        test_case_slug: body.test_case,
        test_case_version: Some(body.version),
        variant: body.variant,
        harness: body.harness,
        model_id: body.model,
        // A worker resolves built-in orchestrators only (no local directory), so
        // it never carries an external `dir`. Default to `one-shot` when unset.
        orchestrator: OrchestratorSelection {
            slug: body
                .orchestrator
                .unwrap_or_else(|| ONE_SHOT_SLUG.to_string()),
            dir: None,
        },
        max_runtime_override: body.max_runtime_seconds,
        // The base image resolves from the environment in the orchestrator (see
        // `drive_run`), not from the backend; no explicit per-run override.
        container_image: None,
    };

    // Capture the run's display identity now so the active-run list can describe
    // it before it produces a record.
    let summary = RunSummary {
        test_case_slug: request.test_case_slug.clone(),
        variant: request.variant.clone(),
        harness_slug: request.harness.as_str().to_string(),
        model_id: request.model_id.clone(),
    };
    let job = state.jobs.create(summary);
    let job_id = job.id().to_string();

    let ctx = RunContext {
        backend_url: state.config.backend_url.clone(),
        out_dir: state.config.out_dir.clone(),
        work_dir: state.config.work_dir.clone(),
        runtime: state.config.runtime,
        kubernetes: state.config.kubernetes.clone(),
    };

    state.metrics.record_run_submitted();

    // The spawned run outlives this request, so it must not be traced under the
    // request span (which ends when submit returns). Create a dedicated job span,
    // parented to the current request span so the run is reachable from the
    // submitting trace, and attach it to the background future so the whole run —
    // up to an hour of work — is traced under one span keyed by the job id.
    let job_span = tracing::info_span!(
        "run.job",
        job_id = %job_id,
        test_case = %request.test_case_slug,
        variant = %request.variant,
        harness = request.harness.as_str(),
        model = %request.model_id,
    );

    // The run can last up to an hour; drive it on a detached task so submit can
    // return now. The task records its outcome on the job, which the status and
    // event endpoints surface, and publishes a worker-wide completion
    // notification the `/notifications` stream relays.
    tokio::spawn(drive_run(ctx, request, job, state.notifier.clone()).instrument(job_span));

    let ack = SubmitAck {
        job_id: job_id.clone(),
        status_url: format!("/runs/{job_id}"),
        events_url: format!("/runs/{job_id}/events"),
    };
    Ok((StatusCode::ACCEPTED, Json(ack)).into_response())
}

/// A run this worker has produced, in the shape the consoles' gallery reads:
/// the produced [`RunRecord`] and a null review. A worker keeps no review store,
/// so `review` is always absent here — a run only gains one when it is published.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ProducedRun {
    /// The run record's id (its output-directory name).
    pub id: String,
    /// The produced run record, exactly as the run wrote it.
    pub record: RunRecord,
    /// Always `null`: a produced-but-unpublished run carries no review yet.
    #[cfg_attr(feature = "contract", ts(type = "null"))]
    pub review: Option<serde_json::Value>,
}

/// `GET /runs` — list the runs this worker has produced.
///
/// Enumerates the worker's output directory, where each finished run wrote a
/// `{run_id}/run-record.json` (see `RunEngine::write_record`), and returns
/// them as produced runs, newest first by finish time. The consoles read this to
/// surface produced-but-unpublished runs in the gallery; without it a freshly
/// finished run can't be found by id on its detail page (and the runs index shows
/// nothing until a run is published to the backend).
pub async fn list_produced(
    State(state): State<AppState>,
) -> Result<Json<Vec<ProducedRun>>, ApiError> {
    let mut produced = read_produced(&state.config.out_dir)
        .map_err(|err| ApiError::internal(format!("listing produced runs: {err}")))?;
    // Newest first, matching the backend's published-run ordering. Run timestamps
    // are RFC 3339 in UTC, so a lexical compare orders them chronologically.
    produced.sort_by(|a, b| recency(&b.record).cmp(recency(&a.record)));
    Ok(Json(produced))
}

/// `GET /runs/active` — list the runs this worker is currently executing.
///
/// Returns the in-memory job registry's still-running jobs, each described by the
/// identity captured at submit (test case, variant, harness, model) plus its
/// stream/job id. The console seeds its in-progress list from this so a run it is
/// watching survives a page reload — the session-only client state is rebuilt
/// from the worker's own view of what is running.
pub async fn list_active(State(state): State<AppState>) -> Json<Vec<ActiveRun>> {
    Json(state.jobs.active())
}

/// The timestamp a produced run is ordered by: its finish time, falling back to
/// its start time when it never recorded a finish (e.g. it failed late).
fn recency(record: &RunRecord) -> &str {
    if record.finished_at.is_empty() {
        &record.started_at
    } else {
        &record.finished_at
    }
}

/// Read every produced run record under `out_dir`. Each completed run owns a
/// `{run_id}/` subdirectory holding its `run-record.json`. A missing output
/// directory means none have been produced yet; a subdirectory without a parsable
/// record (still running, or a stray) is skipped rather than failing the list.
fn read_produced(out_dir: &std::path::Path) -> std::io::Result<Vec<ProducedRun>> {
    let mut runs = Vec::new();
    let entries = match std::fs::read_dir(out_dir) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(runs),
        Err(err) => return Err(err),
    };
    for entry in entries {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(entry.path().join("run-record.json")) else {
            continue;
        };
        let Ok(mut record) = serde_json::from_str::<RunRecord>(&text) else {
            continue;
        };
        // A produced-but-unpublished run carries no public links (publishing is
        // what deploys the build and fills them in). But its collected static
        // build sits right here on disk, and the worker serves it at
        // `/runs/{id}/build/` — so surface that as the playable link, root-
        // relative, for the UI to resolve against the worker's own origin. This
        // is what lets a reviewer play the build before publishing it.
        if find_build_output(&entry.path().join("implementation")).is_some() {
            record.links.playable_build = Some(format!("/runs/{}/build/", record.id));
        }
        runs.push(ProducedRun {
            id: record.id.clone(),
            record,
            review: None,
        });
    }
    Ok(runs)
}

/// `GET /runs/{id}/build` — serve a produced run's playable build at its root
/// (the build's `index.html`).
pub async fn build_root(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    serve_build(&state, &id, "")
}

/// `GET /runs/{id}/build/{*path}` — serve a file within a produced run's playable
/// build (an asset the `index.html` references).
pub async fn build_path(
    State(state): State<AppState>,
    Path((id, path)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    serve_build(&state, &id, &path)
}

/// Resolve and serve one file from a produced run's static build output, which
/// lives beside the collected implementation at
/// `{out_dir}/{id}/implementation/{dist|build|out}/`. The build is mounted under
/// a per-run base path, so its HTML is relocated to resolve assets there (see
/// [`serve_build_file`]). A `404` covers an unknown run, a run with no build, and
/// a path that does not resolve to a file inside the build.
fn serve_build(state: &AppState, id: &str, rel_path: &str) -> Result<Response, ApiError> {
    let impl_dir = state.config.out_dir.join(id).join("implementation");
    let build_dir = find_build_output(&impl_dir)
        .ok_or_else(|| ApiError::not_found(format!("run `{id}` has no playable build to serve")))?;
    let base_href = format!("/runs/{id}/build/");
    let file = serve_build_file(&build_dir, rel_path, &base_href)
        .ok_or_else(|| ApiError::not_found(format!("no build file `{rel_path}` for run `{id}`")))?;
    Ok(([(header::CONTENT_TYPE, file.content_type)], file.body).into_response())
}

/// `GET /runs/{id}/events.jsonl` — a finished run's recorded, normalized event
/// stream, served verbatim from disk as NDJSON.
///
/// Unlike `/runs/{job}/events` (the *live* stream keyed by job id, which only
/// exists while the job is resident in memory), this reads the persisted
/// `{out_dir}/{id}/events.jsonl` keyed by the run-record id, so it works for any
/// finished run the worker still has on disk — long after the job is gone. Each
/// line is one [`HarnessEvent`](test_cabinet_core::HarnessEvent) as JSON. `404`
/// when the run or its event log is absent.
pub async fn events_file(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    serve_run_stream(&state, &id, "events.jsonl")
}

/// `GET /runs/{id}/raw.jsonl` — a finished run's recorded raw harness output
/// (one [`RawOutputLine`](test_cabinet_core::RawOutputLine) per line), served
/// verbatim from disk as NDJSON. `404` when the run or its raw log is absent.
pub async fn raw_file(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    serve_run_stream(&state, &id, "raw.jsonl")
}

/// `GET /runs/{id}/proof/{file}` — a produced run's proof-of-implementation media
/// (`{file}` is `<proof-id>.<ext>`), served from the collected implementation tree
/// at the proof's recorded `dest`. The proof id is resolved against the run
/// record's `validation.proofs` to find its path, so the agent's chosen location
/// is honored. The content type follows the file extension. `404` when the run,
/// the proof, or the file is absent. The desktop core serves the same media over
/// its proof URI scheme from this same [`serve_proof_file`] resolver.
pub async fn proof_file(
    State(state): State<AppState>,
    Path((id, file)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    let run_dir = state.config.out_dir.join(&id);
    let served = serve_proof_file(&run_dir, &file)
        .ok_or_else(|| ApiError::not_found(format!("run `{id}` has no proof media `{file}`")))?;
    Ok(([(header::CONTENT_TYPE, served.content_type)], served.body).into_response())
}

/// `GET /runs/{id}/asset/{file}` — an asset-generation run's regenerated image,
/// final preview, target, or action log. `{file}` is a single sprite's
/// `regenerated.png`/`preview.png`/`target.png`/`actions.json` or a sprite
/// sheet's per-frame `regenerated-<index>.png` (etc.). Resolved from the run
/// record's `validation.asset` via [`serve_asset_file`], the same resolver the
/// desktop core serves these artifacts over its `tcab-asset://` scheme.
pub async fn asset_file(
    State(state): State<AppState>,
    Path((id, file)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    let run_dir = state.config.out_dir.join(&id);
    let served = serve_asset_file(&run_dir, &file)
        .ok_or_else(|| ApiError::not_found(format!("run `{id}` has no asset media `{file}`")))?;
    Ok(([(header::CONTENT_TYPE, served.content_type)], served.body).into_response())
}

/// Serve a recorded run stream file (`events.jsonl` or `raw.jsonl`) from a
/// finished run's output directory as immutable NDJSON. A finished run's logs
/// never change, so they are safe to cache aggressively. A missing file maps to a
/// `404`; any other read error is a `500`.
fn serve_run_stream(state: &AppState, id: &str, file_name: &str) -> Result<Response, ApiError> {
    let path = state.config.out_dir.join(id).join(file_name);
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Err(ApiError::not_found(format!(
                "run `{id}` has no recorded `{file_name}`"
            )));
        }
        Err(err) => {
            return Err(ApiError::internal(format!(
                "reading `{file_name}` for run `{id}`: {err}"
            )));
        }
    };
    Ok((
        [
            (header::CONTENT_TYPE, "application/x-ndjson"),
            (header::CACHE_CONTROL, "public, max-age=31536000, immutable"),
        ],
        bytes,
    )
        .into_response())
}

/// `GET /runs/{job}` — the current status of a submitted run.
///
/// Returns the job's state and, once finished, the produced run record (or the
/// failure reason). `404` for an unknown job id.
pub async fn status(
    State(state): State<AppState>,
    Path(job): Path<String>,
) -> Result<Json<JobStatus>, ApiError> {
    let job = lookup(&state, &job)?;
    Ok(Json(job.status()))
}

/// `GET /runs/{job}/events` — the live harness-event stream as NDJSON.
///
/// Each line is one normalized [`HarnessEvent`](test_cabinet_core::HarnessEvent)
/// serialized as JSON. A subscriber connecting after submit is first replayed
/// every event so far, then receives new events as the harness produces them; the
/// stream closes when the run reaches a terminal state. A late connection to an
/// already-finished job replays the full backlog and then closes. `404` for an
/// unknown job id.
pub async fn events(
    State(state): State<AppState>,
    Path(job): Path<String>,
) -> Result<Response, ApiError> {
    let job = lookup(&state, &job)?;
    let body = Body::from_stream(event_stream(job));
    Ok((
        [
            (header::CONTENT_TYPE, "application/x-ndjson"),
            // Disable proxy buffering so events are delivered as they arrive
            // rather than withheld until the connection closes.
            (header::CACHE_CONTROL, "no-cache"),
        ],
        body,
    )
        .into_response())
}

/// Build the NDJSON byte stream for a job: the replayed backlog followed by the
/// live tail, each event one `\n`-terminated JSON line, ending when the run does.
fn event_stream(job: Job) -> impl Stream<Item = Result<Bytes, std::convert::Infallible>> {
    let sub = job.subscribe();
    // Replay the backlog first so a subscriber never misses an event produced
    // between submit and connect.
    let backlog = stream::iter(sub.backlog.into_iter().map(|event| Ok(encode_line(&event))));
    // Then replay the latest preview per frame, so a viewer reconnecting mid-run
    // immediately shows the current image of each frame before the live tail.
    let previews = stream::iter(
        sub.previews
            .into_iter()
            .map(|preview| Ok(encode_preview_line(&preview))),
    );

    // Then the live tail: drive the broadcast receiver until the terminal marker.
    // A job that was already terminal at subscribe time emits no live items (the
    // initial `done` short-circuits). A lagged slow reader skips ahead rather than
    // blocking the run; the full event history is always recoverable from the final
    // status, and only the latest preview per frame matters.
    let live = stream::unfold(
        (sub.terminated, sub.receiver),
        |(done, mut receiver)| async move {
            if done {
                return None;
            }
            loop {
                match receiver.recv().await {
                    Ok(StreamItem::Event(event)) => {
                        return Some((Ok(encode_line(&event)), (false, receiver)));
                    }
                    Ok(StreamItem::Preview(preview)) => {
                        return Some((Ok(encode_preview_line(&preview)), (false, receiver)));
                    }
                    Ok(StreamItem::Done) => return None,
                    Err(RecvError::Closed) => return None,
                    // Skip the lagged window and keep streaming live items.
                    Err(RecvError::Lagged(_)) => continue,
                }
            }
        },
    );

    backlog.chain(previews).chain(live)
}

/// Encode one live preview frame as a `\n`-terminated NDJSON line on the shared
/// event stream, tagged `type: "asset_preview"` so a subscriber tells it apart
/// from a [`HarnessEvent`](test_cabinet_core::HarnessEvent) (whose `type` is always
/// one of the closed set of event kinds, never `asset_preview`). Serialization
/// cannot fail for a preview's plain JSON-safe fields, so a defensive empty line
/// stands in for the impossible error rather than aborting the stream.
fn encode_preview_line(preview: &test_cabinet_core::AssetPreview) -> Bytes {
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

/// Encode one event as a `\n`-terminated NDJSON line. Serialization of a
/// `HarnessEvent` cannot fail (its fields are plain JSON-safe scalars), so a
/// defensive empty line is used in the impossible error case rather than aborting
/// the stream.
fn encode_line(event: &test_cabinet_core::HarnessEvent) -> Bytes {
    match serde_json::to_string(event) {
        Ok(mut line) => {
            line.push('\n');
            Bytes::from(line)
        }
        Err(_) => Bytes::from_static(b"\n"),
    }
}

/// Look up a job by id, mapping a miss to a `404`.
fn lookup(state: &AppState, id: &str) -> Result<Job, ApiError> {
    state
        .jobs
        .get(id)
        .ok_or_else(|| ApiError::not_found(format!("no run job with id `{id}`")))
}

#[cfg(test)]
#[path = "runs.test.rs"]
mod tests;
