//! The artifact service's HTTP surface: upload a run's tree, serve its build and
//! media.
//!
//! Two callers (see [`crate::auth`]):
//!
//! - The **driver** uploads a finished run's collected tree —
//!   `POST /runs/{id}/artifacts` with a `tar` body — authed by its **per-job
//!   token**, which the service forwards to the backend to verify.
//! - A **reviewer** (through the console) reads the run's playable build and
//!   proof/asset media — `GET /runs/{id}/build` (and the trailing-slash
//!   `/runs/{id}/build/` the console actually loads), `/runs/{id}/build/{*path}`,
//!   `/runs/{id}/proof/{file}`, `/runs/{id}/asset/{file}`, and the recorded
//!   `/runs/{id}/events.jsonl`/`raw.jsonl` logs. These are **not** token-gated: the
//!   console loads them as `<img src>`/`<iframe>`/relative build sub-resources,
//!   which carry no `Authorization` header, so read protection is the
//!   private-network boundary, exactly as for the backend's run reads.
//!
//! The serve handlers **reuse the core resolvers**
//! ([`find_build_output`](test_cabinet_core::find_build_output),
//! [`serve_build_file`](test_cabinet_core::serve_build_file),
//! [`serve_proof_file`](test_cabinet_core::serve_proof_file),
//! [`serve_asset_file`](test_cabinet_core::serve_asset_file)) exactly as the
//! worker did, only reading from the artifact store's per-run root instead of the
//! worker's out_dir — so the per-run base-href rewrite and the path-traversal
//! guard are identical.

use std::io::Cursor;
use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Path, Request, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

use test_cabinet_core::{find_build_output, serve_asset_file, serve_build_file, serve_proof_file};

use crate::auth::verify_job_token;
use crate::error::ApiError;
use crate::store::{ArtifactStore, impl_dir};

/// The maximum size of an uploaded artifact tarball, in bytes. A run's collected
/// tree (source + a static build + a handful of media clips) is comfortably under
/// this; the cap stops a malformed or hostile upload from exhausting memory, since
/// the body is buffered before it is unpacked. 2 GiB is generous headroom for the
/// heavier test cases the benchmark is moving toward.
const MAX_UPLOAD_BYTES: usize = 2 * 1024 * 1024 * 1024;

/// The shared handler state: the backing store, the backend URL for upload auth,
/// and the HTTP client the upload-auth call uses.
#[derive(Clone)]
pub struct AppState {
    /// The artifact backing store (local-fs today). Boxed behind the trait so an
    /// R2 impl can replace it without touching the handlers.
    pub store: Arc<dyn ArtifactStore>,
    /// The backend base URL (no trailing slash) an upload's per-job token is
    /// verified against.
    pub backend_url: Arc<String>,
    /// The HTTP client the upload-auth verify call uses.
    pub http: reqwest::Client,
    /// The shared control-plane service token a run-tree delete must present, or
    /// `None` when deletion is disabled (the delete route then rejects every
    /// caller). See [`crate::auth::verify_service_token`].
    pub service_token: Option<Arc<String>>,
}

/// Build the artifact service's Axum router. The upload route carries its own
/// generous body limit (a tarball is buffered to unpack); the trace middleware
/// continues an inbound W3C trace; CORS is permissive so a browser console reaching
/// the service is never blocked — the same posture as the backend and auth service.
pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        // Upload a finished run's collected tree (driver → service, per-job token),
        // or delete it (backend → service, shared control-plane service token) when
        // the control plane deletes the run.
        .route(
            "/runs/{id}/artifacts",
            post(upload)
                .delete(delete)
                .layer(DefaultBodyLimit::max(MAX_UPLOAD_BYTES)),
        )
        // Serve the run's playable build and media (reviewer → service, ungated:
        // browser-loaded media carries no Authorization header). These mirror the
        // worker's handlers exactly, reading from the store's per-run root.
        //
        // Both the bare and trailing-slash roots serve the build's `index.html`:
        // the build link the driver emits — and the console loads into its iframe —
        // is `/runs/{id}/build/` *with* a trailing slash (it doubles as the build's
        // `<base href>`), and axum's `{*path}` capture does not match an empty path,
        // so without the explicit trailing-slash route that link would 404.
        .route("/runs/{id}/build", get(build_root))
        .route("/runs/{id}/build/", get(build_root))
        .route("/runs/{id}/build/{*path}", get(build_path))
        .route("/runs/{id}/proof/{file}", get(proof_file))
        .route("/runs/{id}/asset/{file}", get(asset_file))
        .route("/runs/{id}/events.jsonl", get(events_file))
        .route("/runs/{id}/raw.jsonl", get(raw_file))
        .layer(axum::middleware::from_fn(accept_trace))
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive())
        .with_state(state)
}

/// Continue any inbound W3C trace context so spans stitch across the call (a no-op
/// when no propagator is installed, i.e. telemetry disabled).
async fn accept_trace(request: Request, next: axum::middleware::Next) -> Response {
    test_cabinet_telemetry::propagation::accept_inbound(request.headers());
    next.run(request).await
}

/// Liveness/readiness probe.
async fn healthz() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok" }))
}

/// The header a driver sets to its **job id** on an upload, so the service can
/// verify the per-job token against the right job. The path id is the **run/record
/// id** (the artifact store key the console addresses media by), which is a
/// different UUID from the job id — the token authority (the backend) only knows
/// the job, so the verify must use the job id, not the store key.
const JOB_ID_HEADER: &str = "x-tcab-job-id";

/// `POST /runs/{id}/artifacts` — store a finished run's collected artifact tree.
///
/// `{id}` is the **run/record id**: the store key, and how the console later
/// addresses this run's build and media. The body is a `tar` archive of the
/// driver's `{out_dir}/{id}/` directory (`run-record.json`, `implementation/`, and
/// optionally the `events.jsonl`/`raw.jsonl` logs).
///
/// The per-job bearer token authenticates the driver and is verified against the
/// backend (the token authority) before the tree is written — so only the driver
/// that holds the job's token may upload for it. The token was minted for the
/// **job id**, which differs from the run id in the path, so the driver sends its
/// job id in the [`JOB_ID_HEADER`] and the verify uses that. A path that escapes
/// the run directory is rejected as a `400`. Replaces any prior tree for the same
/// id (an idempotent re-upload). `201 Created` on success.
#[tracing::instrument(name = "artifacts.upload", skip(state, body), fields(run.id = %id, bytes = body.len()), err(Debug))]
async fn upload(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: axum::http::HeaderMap,
    body: Bytes,
) -> Result<Response, ApiError> {
    let token =
        crate::auth::bearer(&headers).ok_or_else(|| ApiError::unauthorized("missing job token"))?;
    // Verify the token against the job it was minted for — the job id the driver
    // sends, not the run id in the path (the store key). They are distinct UUIDs;
    // verifying against the run id always fails, since the backend has no job by
    // that id.
    let job_id = headers
        .get(JOB_ID_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::unauthorized(format!("missing `{JOB_ID_HEADER}` header")))?;
    verify_job_token(&state.http, &state.backend_url, job_id, &token).await?;

    // The store I/O is blocking (tar unpack writes many small files); run it off
    // the async runtime so a large upload does not stall other connections. Keyed by
    // the run id from the path, not the job id the token was verified against.
    let store = state.store.clone();
    let id_for_task = id.clone();
    tokio::task::spawn_blocking(move || {
        let mut cursor = Cursor::new(body.as_ref());
        store.store_run(&id_for_task, &mut cursor)
    })
    .await
    .map_err(|err| ApiError::internal(format!("artifact unpack task failed: {err}")))?
    .map_err(map_store_error)?;

    tracing::info!(run.id = %id, "stored run artifacts");
    Ok(StatusCode::CREATED.into_response())
}

/// `DELETE /runs/{id}/artifacts` — remove a run's stored tree (build + media).
///
/// `{id}` is the **run/record id** (the store key). Unlike the ungated reads, a
/// delete is destructive, so it is gated by the shared control-plane service token
/// (`TCAB_BACKEND_SERVICE_TOKEN`): only the backend, pruning a deleted run, may
/// call it. With no token configured the service has deletion disabled and rejects
/// every caller (`401`). Idempotent: deleting a run with no stored tree still
/// succeeds. `204 No Content` on success; `400` for an unsafe id.
#[tracing::instrument(name = "artifacts.delete", skip(state, headers), fields(run.id = %id), err(Debug))]
async fn delete(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: axum::http::HeaderMap,
) -> Result<Response, ApiError> {
    crate::auth::verify_service_token(
        &headers,
        state.service_token.as_deref().map(String::as_str),
    )?;

    // `delete_run` is blocking (it removes a directory tree); run it off the async
    // runtime so a large tree does not stall other connections.
    let store = state.store.clone();
    let id_for_task = id.clone();
    tokio::task::spawn_blocking(move || store.delete_run(&id_for_task))
        .await
        .map_err(|err| ApiError::internal(format!("artifact delete task failed: {err}")))?
        .map_err(map_store_error)?;

    tracing::info!(run.id = %id, "deleted run artifacts");
    Ok(StatusCode::NO_CONTENT.into_response())
}

/// `GET /runs/{id}/build` — serve a produced run's playable build at its root (the
/// build's `index.html`). Ungated (browser-loaded).
async fn build_root(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    serve_build(&state, &id, "")
}

/// `GET /runs/{id}/build/{*path}` — serve a file within a produced run's playable
/// build (an asset the `index.html` references). Ungated (browser-loaded).
async fn build_path(
    State(state): State<AppState>,
    Path((id, path)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    serve_build(&state, &id, &path)
}

/// Resolve and serve one file from a produced run's static build output, which
/// lives under the store at `<root>/{id}/implementation/{dist|build|out}/`. The
/// build is mounted under a per-run base path, so its HTML is relocated to resolve
/// assets there (see [`serve_build_file`]). A `404` covers an unknown run, a run
/// with no build, and a path that does not resolve to a file inside the build —
/// identical to the worker's `serve_build`, only reading from the store.
fn serve_build(state: &AppState, id: &str, rel_path: &str) -> Result<Response, ApiError> {
    let impl_dir = impl_dir(state.store.as_ref(), id);
    let build_dir = find_build_output(&impl_dir)
        .ok_or_else(|| ApiError::not_found(format!("run `{id}` has no playable build to serve")))?;
    let base_href = format!("/runs/{id}/build/");
    let file = serve_build_file(&build_dir, rel_path, &base_href)
        .ok_or_else(|| ApiError::not_found(format!("no build file `{rel_path}` for run `{id}`")))?;
    Ok(([(header::CONTENT_TYPE, file.content_type)], file.body).into_response())
}

/// `GET /runs/{id}/proof/{file}` — a produced run's proof-of-implementation media
/// (`{file}` is `<proof-id>.<ext>`), resolved from the run record's
/// `validation.proofs` via [`serve_proof_file`], the same resolver the worker
/// used. Ungated (browser-loaded). `404` when the run, the proof, or the file is
/// absent.
async fn proof_file(
    State(state): State<AppState>,
    Path((id, file)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    let run_dir = state.store.run_dir(&id);
    let served = serve_proof_file(&run_dir, &file)
        .ok_or_else(|| ApiError::not_found(format!("run `{id}` has no proof media `{file}`")))?;
    Ok(([(header::CONTENT_TYPE, served.content_type)], served.body).into_response())
}

/// `GET /runs/{id}/asset/{file}` — an asset-generation run's regenerated image,
/// final preview, or action log (or an adversarial replay), resolved from the run
/// record's `validation` frame via [`serve_asset_file`], the same resolver the
/// worker used. Ungated (browser-loaded as `<img src>`/animation frames).
async fn asset_file(
    State(state): State<AppState>,
    Path((id, file)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    let run_dir = state.store.run_dir(&id);
    let served = serve_asset_file(&run_dir, &file)
        .ok_or_else(|| ApiError::not_found(format!("run `{id}` has no asset media `{file}`")))?;
    Ok(([(header::CONTENT_TYPE, served.content_type)], served.body).into_response())
}

/// `GET /runs/{id}/events.jsonl` — a finished run's recorded, normalized event
/// stream, served verbatim as NDJSON when it was uploaded alongside the run.
/// Ungated (browser-loaded). `404` when the run or its event log is absent.
async fn events_file(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    serve_run_stream(&state, &id, "events.jsonl")
}

/// `GET /runs/{id}/raw.jsonl` — a finished run's recorded raw harness output,
/// served verbatim as NDJSON when it was uploaded. Ungated (browser-loaded). `404`
/// when the run or its raw log is absent.
async fn raw_file(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    serve_run_stream(&state, &id, "raw.jsonl")
}

/// Serve a recorded run stream file (`events.jsonl` or `raw.jsonl`) from the
/// store's per-run root as immutable NDJSON, matching the worker's `serve_run_stream`.
/// A finished run's logs never change, so they are safe to cache aggressively. A
/// missing file maps to a `404`; any other read error is a `500`. The file is
/// optional in the upload, so its absence is an ordinary `404`, not an error.
fn serve_run_stream(state: &AppState, id: &str, file_name: &str) -> Result<Response, ApiError> {
    let path = state.store.run_dir(id).join(file_name);
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

/// Map a [`StoreError`](crate::store::StoreError) onto the HTTP envelope: a
/// traversal attempt is the client's bad upload (`400`); an I/O fault is the
/// service's (`500`).
fn map_store_error(err: crate::store::StoreError) -> ApiError {
    use crate::store::StoreError;
    match err {
        StoreError::Traversal(_) => ApiError::bad_request(err.to_string()),
        StoreError::Io(_) => ApiError::internal(err.to_string()),
    }
}

#[cfg(test)]
#[path = "api.test.rs"]
mod tests;
