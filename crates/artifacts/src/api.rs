//! The artifact service's HTTP surface: upload a run's tree, serve its build and
//! media.
//!
//! The callers (see [`crate::auth`]):
//!
//! - The **driver** uploads a finished run's collected tree —
//!   `POST /runs/{id}/artifacts` with a `tar` body — authed by its **per-job
//!   token**, which the service forwards to the backend to verify.
//! - The **publisher** Job downloads a run's source tree —
//!   `GET /runs/{id}/tree.tar` — authed by its **per-publish-job token**, which the
//!   service forwards to the backend's publish-job verify endpoint. This is the one
//!   *read* that is token-gated: it is a server-to-server pull (not browser-loaded
//!   media), and a run's source tree is published deliberately, never ambiently.
//! - The **backend** manages the lifetime of a stored tree — `DELETE
//!   /runs/{id}/artifacts` when a run is deleted, and `GET /runs` to enumerate the
//!   stored trees for its reclamation sweep — authed by the shared **control-plane
//!   service token**.
//! - A **reviewer** (through the console) reads the run's playable build and
//!   proof/asset media — `GET /runs/{id}/build` (and the trailing-slash
//!   `/runs/{id}/build/` the console actually loads), `/runs/{id}/build/{*path}`,
//!   `/runs/{id}/proof/{file}`, `/runs/{id}/asset/{file}`, and the recorded
//!   `/runs/{id}/events.jsonl`/`raw.jsonl` logs — and downloads the run's whole
//!   produced tree as one gzip tar, `GET /runs/{id}/archive.tar.gz`. These reads
//!   take the **Access assertion**: the console loads them as
//!   `<img src>`/`<iframe>`/relative build sub-resources and a plain download link
//!   through the edge, which turns the browser's Access cookie into the assertion
//!   on every one of them. The backend's snapshot builder reads media with the
//!   service token instead.
//! - A **person or an analysis tool** reads the run's gg session record,
//!   `GET /runs/{id}/replay`, and its code analysis, `GET /runs/{id}/code-analysis`,
//!   with the same reader identity.
//! - The **backend** publishes a run's media, `POST /runs/{id}/publish-media`
//!   with the service token, and writes each object of the public dataset,
//!   `PUT /public/{key}`; the **CLI** writes an asset reference with the same
//!   route, through the edge with an Access service token (see
//!   [`crate::publish`]).
//!
//! Every route is served at the root, which is what an in-cluster caller uses, and
//! under the edge's [`/artifacts`](crate::auth::EDGE_PREFIX) prefix, which
//! `cloudflared` forwards unchanged. [`crate::auth::identify`] runs in front of all
//! of them; `/healthz` alone is served without an identity.
//!
//! The serve handlers resolve the run's stored tree once, through its pointer
//! (see [`crate::store`]), and read it through the [`playable`](crate::playable)
//! resolvers ([`find_build_output`], [`serve_build_file`], [`serve_proof_file`],
//! [`serve_asset_file`], …), which apply the contracts build-serving rule to
//! object keys: the per-run base-href rewrite and the path-traversal guard are the
//! ones every host serving a build applies. Every body is streamed from the store.

use std::io::Write;
use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Extension, OriginalUri, Path, Request, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use bytes::{Bytes, BytesMut};
use futures_util::StreamExt;
use time::format_description::well_known::Rfc3339;
use tower_http::compression::CompressionLayer;
use tower_http::compression::predicate::{DefaultPredicate, NotForContentType, Predicate};
use tower_http::cors::{AllowHeaders, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::playable::{
    Served, find_build_output, serve_asset_file, serve_build_file, serve_proof_file,
    serve_showcase_file, serve_validation_file,
};

use crate::auth::{
    AccessMode, EDGE_PREFIX, Identity, authorize_public_write, require_reader, verify_job_token,
    verify_publish_job_token,
};
use crate::error::ApiError;
use crate::public::PublicStore;
use crate::publish::{PublishError, Transcoder, check_public_key, publish_run_media};
use crate::store::{ArchiveShape, ArtifactStore, StoreError, start_archive, write_archive};

/// The maximum size of an uploaded run tree's `tar` body, in bytes. A run's
/// collected tree (source + a static build + a handful of media clips) is
/// comfortably under this; 2 GiB is generous headroom for the heavier test cases the
/// benchmark is moving toward.
///
/// The cap bounds the **objects** a tree writes, not memory: the body is streamed
/// into the private container as it arrives (see [`crate::store`]), so the service's
/// peak allocation does not grow with it. It is enforced while the body is read
/// rather than by a `DefaultBodyLimit` layer, because that layer only constrains
/// extractors that buffer (`Bytes`, `String`, `Json`) and is inert against the raw
/// `Body` the upload handler takes.
pub const MAX_UPLOAD_BYTES: u64 = 2 * 1024 * 1024 * 1024;

/// How much of a streamed archive is accumulated before a chunk is handed to the
/// response body. Small enough that the whole pipeline stays far below the pod's
/// ceiling, large enough that a tar of many tiny files does not send a frame per
/// header block.
const STREAM_CHUNK_BYTES: usize = 256 * 1024;

/// How many chunks may sit between the blocking archive walk and the response.
/// This is the back-pressure: once the buffer is full the walk blocks, so a client
/// on a slow link slows the walk down rather than making the service hold the run
/// tree for it.
const STREAM_CHUNK_BUFFER: usize = 8;

/// A [`std::io::Write`] that hands what is written to it to a response body, in
/// [`STREAM_CHUNK_BYTES`] chunks, as it is written.
///
/// This is what lets the two whole-tree downloads — [`tree_tar`] and [`archive`] —
/// write their archive as it is built (see [`write_archive`]) rather than building
/// it in memory before answering. Both used to return a
/// `Vec<u8>`, so the service's peak allocation was the size of the largest tree any
/// caller asked for, and `archive` is any reviewer's to ask for: one clicking Download on
/// a heavy run was enough to take artifact serving down for every run. Prod hit that
/// twice, as an exit 137 against the 1536Mi limit. With this the peak is
/// `STREAM_CHUNK_BUFFER * STREAM_CHUNK_BYTES` (2 MiB) plus the gzip window,
/// independent of tree size.
///
/// It is written from a `spawn_blocking` thread, so it sends with `blocking_send`.
/// A receiver that has gone away — the client hung up mid-download — surfaces as an
/// [`std::io::ErrorKind::BrokenPipe`] out of `write`, which aborts the tar walk
/// instead of spending the rest of the walk building an archive nobody is reading.
struct ChannelWriter {
    /// The response body's end of the pipe.
    tx: tokio::sync::mpsc::Sender<Result<Bytes, std::io::Error>>,
    /// Bytes written but not yet large enough to be worth a frame.
    buffer: BytesMut,
    /// Every byte written, which for `archive` is the *compressed* total — i.e. what
    /// actually went on the wire, which is what the served-bytes log line reports.
    written: u64,
    /// Whether the walk that fed this reached its end.
    ///
    /// Set only by [`Self::finish`] on a walk that succeeded. Anything else — an
    /// error returned out of the walk, or a panic inside it — leaves it false, and
    /// `Drop` then pushes an error into the body so the response is ABORTED rather
    /// than ended. See the `Drop` impl for why nothing weaker will do.
    complete: bool,
}

impl ChannelWriter {
    fn new(tx: tokio::sync::mpsc::Sender<Result<Bytes, std::io::Error>>) -> Self {
        Self {
            tx,
            buffer: BytesMut::with_capacity(STREAM_CHUNK_BYTES),
            written: 0,
            complete: false,
        }
    }

    /// Hand one chunk to the response body, blocking while the buffer is full.
    fn send(&self, chunk: Bytes) -> std::io::Result<()> {
        self.tx.blocking_send(Ok(chunk)).map_err(|_| {
            std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                "the archive download was closed by the client",
            )
        })
    }

    /// Close the body, answering the total byte count.
    ///
    /// `walked` is whether the walk that fed this ran to its end. ON THE FAILURE PATH
    /// THE TAIL IS DELIBERATELY NOT FLUSHED: by the time this is called the tar
    /// builder has already been dropped, and `tar::Builder`'s `Drop` writes the two
    /// zero blocks that TERMINATE an archive (a `GzEncoder`'s `Drop` likewise writes
    /// a valid gzip trailer). Those bytes are sitting in the buffer, and sending them
    /// would hand the client a well-formed archive that is silently missing every
    /// file after the fault. Dropping them, and then letting `Drop` abort the body,
    /// is what makes a partial archive read as a partial archive.
    fn finish(mut self, walked: bool) -> u64 {
        if walked {
            // A flush failure here is a client that hung up; there is no one left to
            // tell, and the aborted body below is the truthful ending anyway.
            if Write::flush(&mut self).is_ok() {
                self.complete = true;
            }
        }
        self.written
    }
}

impl Drop for ChannelWriter {
    /// End an incomplete body with an ERROR rather than with a clean close.
    ///
    /// Simply dropping the sender ends the response body normally, and a normally
    /// ended body is indistinguishable from a complete download: the publisher's
    /// `tar::Archive::unpack` succeeds, `tar -tzf` exits 0, and a run gets released
    /// with part of its tree missing and nothing said anywhere. The archive framing
    /// cannot be relied on to carry that signal, because the tar builder and the gzip
    /// encoder both write their terminators from `Drop` on the way out of the failing
    /// walk. So the signal is put where nothing can complete it by accident: an error
    /// item in the body's own stream, which makes hyper abort the chunked response
    /// without its terminating zero-length chunk. A client sees a transport failure,
    /// which is what a truncated download is.
    ///
    /// This also covers a PANIC inside the walk, which no `Result` could: unwinding
    /// runs this the same way returning does.
    fn drop(&mut self) {
        if self.complete {
            return;
        }
        // Best effort: a receiver that has already gone away is a client that hung
        // up, and there is nobody left to tell.
        let _ = self.tx.blocking_send(Err(std::io::Error::other(
            "the archive ended before the tree had been walked",
        )));
    }
}

impl Write for ChannelWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.buffer.extend_from_slice(buf);
        self.written = self.written.saturating_add(buf.len() as u64);
        while self.buffer.len() >= STREAM_CHUNK_BYTES {
            let chunk = self.buffer.split_to(STREAM_CHUNK_BYTES).freeze();
            self.send(chunk)?;
        }
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        if self.buffer.is_empty() {
            return Ok(());
        }
        let chunk = self.buffer.split().freeze();
        self.send(chunk)
    }
}

/// Run `build` on a blocking thread, writing what it produces into a response body
/// as it goes.
///
/// `what` names the download in the log line the walk emits when it ends; `id` is
/// the run it is for. The caller must have established that the run exists *before*
/// calling this (see [`ArtifactStore::run_tree`]): once the body is returned
/// the status code is already committed, so a failure raised inside `build` can only
/// be logged and the stream ended — the pre-check is what keeps the two real failure
/// modes, an unknown run and an unsafe id, on the path that can still answer `404`
/// or `400`.
fn streamed_archive<F>(id: String, what: &'static str, build: F) -> Body
where
    F: FnOnce(&mut ChannelWriter) -> Result<(), StoreError> + Send + 'static,
{
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Bytes, std::io::Error>>(STREAM_CHUNK_BUFFER);
    tokio::task::spawn_blocking(move || {
        let mut writer = ChannelWriter::new(tx);
        let outcome = build(&mut writer);
        let written = writer.finish(outcome.is_ok());
        match outcome {
            Ok(()) => tracing::info!(run.id = %id, bytes = written, "served {what}"),
            // Mid-walk failures cannot change the status code any more — a file
            // removed under the walk, or the client hanging up. Say so here, and let
            // the ABORTED body be the client's signal: `finish` withholds the
            // terminating blocks and the writer's `Drop` pushes an error into the
            // stream, so a partial download cannot be mistaken for a whole one.
            Err(err) => {
                tracing::warn!(run.id = %id, bytes = written, error = %err, "{what} ended early")
            }
        }
    });
    Body::from_stream(futures_util::stream::unfold(rx, |mut rx| async move {
        rx.recv().await.map(|chunk| (chunk, rx))
    }))
}

/// The shared handler state: the run-tree store, the backend URL for upload auth,
/// the HTTP client the upload-auth call uses, and the credentials the identity
/// layer checks.
#[derive(Clone)]
pub struct AppState {
    /// The run-tree store over the private container.
    pub store: Arc<ArtifactStore>,
    /// The largest upload body accepted, in bytes: [`MAX_UPLOAD_BYTES`] in the
    /// service.
    pub upload_limit: u64,
    /// The backend base URL (no trailing slash) an upload's per-job token is
    /// verified against.
    pub backend_url: Arc<String>,
    /// The HTTP client the upload-auth verify call uses.
    pub http: reqwest::Client,
    /// The shared control-plane service token the backend's two management routes —
    /// the run-tree delete and the `GET /runs` listing — must present, or `None` when
    /// tree management is disabled (both routes then reject every caller). See
    /// [`crate::auth::verify_service_token`].
    pub service_token: Option<Arc<String>>,
    /// The Access verifier an edge request's assertion is checked with, or `None`
    /// when the service takes a person's identity from the local identity header.
    pub access: AccessMode,
    /// The public dataset's store, which `publish-media` and `PUT /public/{key}`
    /// write.
    pub public: Arc<dyn PublicStore>,
    /// What transcodes a published webm clip to mp4.
    pub transcoder: Arc<dyn Transcoder>,
}

/// Every route of the service, served by [`router`] at the root and under the
/// edge prefix. The read routes sit behind [`require_reader`]; the token routes
/// check their own token.
fn routes() -> Router<AppState> {
    let token_routes = Router::new()
        .route("/healthz", get(healthz))
        // Upload a finished run's collected tree (driver → service, per-job token),
        // or delete it (backend → service, shared control-plane service token) when
        // the control plane deletes the run.
        // No `DefaultBodyLimit` layer: `upload` takes the raw `Body` so it can stream
        // it into the store, and that layer only bounds the buffering extractors. The
        // cap is applied as the bytes are read — see `MAX_UPLOAD_BYTES`.
        .route("/runs/{id}/artifacts", post(upload).delete(delete))
        // Enumerate every stored tree (backend → service, shared control-plane
        // service token) so the backend's reclamation sweep can compare the stored
        // trees against its own run rows.
        .route("/runs", get(list_runs))
        // Download a run's source tree as a tar (publisher → service, per-publish-job
        // token): a server-to-server pull the publisher uses to drive the
        // GitHub-repo + Pages release, verified against the backend like an upload.
        .route("/runs/{id}/tree.tar", get(tree_tar))
        // Copy a published run's media into the public store (backend → service,
        // shared control-plane service token).
        .route("/runs/{id}/publish-media", post(publish_media))
        // Write one object of the public dataset (backend → service with the
        // service token; the CLI through the edge with an Access service token).
        // No `DefaultBodyLimit` layer, as for the upload: the body is streamed and
        // capped as it is read.
        .route("/public/{*key}", put(put_public));
    let read_routes = Router::new()
        // Serve the run's playable build and media (reviewer → service, through the
        // edge with the Access assertion), read from the run's stored tree.
        //
        // Both the bare and trailing-slash roots serve the build's `index.html`:
        // the build link the driver emits — and the console loads into its iframe —
        // is `/runs/{id}/build/` *with* a trailing slash (it doubles as the build's
        // `<base href>`), and axum's `{*path}` capture does not match an empty path,
        // so without the explicit trailing-slash route that link would 404.
        .route("/runs/{id}/build", get(build_root))
        .route("/runs/{id}/build/", get(build_root))
        .route("/runs/{id}/build/{*path}", get(build_path))
        // Download the run's whole stored tree as one gzip tar (reviewer → service).
        // The console offers it as a plain `<a href download>`, which the edge
        // authorizes by the Access cookie like the media reads below.
        .route("/runs/{id}/archive.tar.gz", get(archive))
        .route("/runs/{id}/proof/{file}", get(proof_file))
        .route("/runs/{id}/asset/{file}", get(asset_file))
        .route("/runs/{id}/validation/{file}", get(validation_file))
        .route("/runs/{id}/showcase/{file}", get(showcase_file))
        .route("/runs/{id}/events.jsonl", get(events_file))
        .route("/runs/{id}/raw.jsonl", get(raw_file))
        // The gg session record and the code analysis, each a JSON document the
        // tree holds gzipped (person or analysis tool → service).
        .route("/runs/{id}/replay", get(replay_file))
        .route("/runs/{id}/code-analysis", get(code_analysis_file))
        .route_layer(axum::middleware::from_fn(require_reader));
    token_routes.merge(read_routes)
}

/// Build the artifact service's Axum router: every route at the root and under the
/// edge's [`EDGE_PREFIX`], behind the identity layer. The trace middleware
/// continues an inbound W3C trace; CORS is permissive so a browser console reaching
/// the service is never blocked — the same posture as the backend.
pub fn router(state: AppState) -> Router {
    Router::new()
        .merge(routes())
        .nest(EDGE_PREFIX, routes())
        // Innermost, so the trace layer records a refused request, and inside CORS,
        // so a browser's preflight (which carries no credential) is answered by it.
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            crate::auth::identify,
        ))
        .layer(axum::middleware::from_fn(accept_trace))
        .layer(TraceLayer::new_for_http())
        // `permissive()` sets `Access-Control-Allow-Headers: *`, but per the Fetch
        // spec `*` does not cover `Authorization`, so a browser rejects a preflight
        // for a request carrying our bearer token. Mirror the request's headers
        // instead, which echoes `Authorization` back explicitly.
        .layer(CorsLayer::permissive().allow_headers(AllowHeaders::mirror_request()))
        // Compress responses for callers that advertise `Accept-Encoding: gzip`.
        // This service hands a reviewer the run's produced tree — the playable
        // build's HTML/JS/CSS, the `.jsonl` event and raw logs, the uncompressed
        // `archive.tar` — all of which are text that compresses heavily and all of
        // which a console pulls over whatever link the reviewer happens to have.
        //
        // The default predicate already skips tiny bodies, images (the build's
        // sprite/texture output, which is PNG and would only grow), gRPC, and SSE.
        // It does *not* know about `application/gzip`, so exclude that explicitly:
        // `archive.tar.gz` is served pre-compressed, and re-encoding it would burn
        // CPU to hand back slightly larger bytes.
        .layer(
            CompressionLayer::new().gzip(true).compress_when(
                DefaultPredicate::new().and(NotForContentType::const_new("application/gzip")),
            ),
        )
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

/// The header the publisher sets to its **publish-job id** on a `tree.tar`
/// download, so the service verifies the per-publish-job token against the right
/// publish job. As with an upload, the path id is the **run/record id** (the store
/// key), which is a different UUID from the publish-job id the token was minted
/// for — the token authority (the backend) only knows the publish job, so the
/// verify must use the publish-job id, not the store key.
const PUBLISH_JOB_ID_HEADER: &str = "x-tcab-publish-job-id";

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
/// job id in the [`JOB_ID_HEADER`] and the verify uses that.
///
/// The body is streamed into the private container as it arrives, and the response
/// lands once the tree is stored. A tree replaces any prior tree of the same id (an
/// idempotent re-upload) atomically: a read sees the old tree or the new one, never
/// a mix, and an upload that fails leaves the old tree in place. An entry whose path
/// escapes the run's tree, an unreadable archive or one with no files is a `400`; a
/// body over [`MAX_UPLOAD_BYTES`] is a `413`. `201 Created` on success.
#[tracing::instrument(name = "artifacts.upload", skip(state, body), fields(run.id = %id, bytes = tracing::field::Empty), err(Debug))]
async fn upload(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: axum::http::HeaderMap,
    body: Body,
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

    // Stream the body into the store as it arrives, rather than holding it.
    //
    // This handler is the far end of the driver's upload, and it used to take
    // `Bytes` — the whole tarball resident before a single entry was unpacked, up to
    // the 2 GiB cap. That is the one allocation a long-lived shared service must not
    // make: it is the only pod here whose peak is set by a *caller's* payload rather
    // than by its own work, so its memory ceiling could not be sized from anything it
    // does. Prod bore that out — this pod's kernel high-water mark reached 3.2 GiB.
    //
    // Note the body is only touched AFTER the token has been verified above. An
    // unauthenticated caller must not be able to make the service write anything,
    // which is also why the cap is checked per chunk rather than after the fact.
    // Keyed by the run id from the path, not the job id the token was verified
    // against.
    let body: crate::object::ObjectBody = Box::pin(
        body.into_data_stream()
            .map(|chunk| chunk.map_err(std::io::Error::other)),
    );
    let stored = state
        .store
        .store_run(&id, body, state.upload_limit)
        .await
        .map_err(map_store_error)?;
    let written = stored.bytes;
    tracing::Span::current().record("bytes", written);

    tracing::info!(run.id = %id, bytes = written, files = stored.files, "stored run artifacts");
    Ok(StatusCode::CREATED.into_response())
}

/// `DELETE /runs/{id}/artifacts` — remove a run's stored tree (build + media).
///
/// `{id}` is the **run/record id** (the store key). Unlike the reads, which any
/// signed-in reviewer may make, a delete is destructive, so it is gated by the
/// shared control-plane service token
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

    state.store.delete_run(&id).await.map_err(map_store_error)?;

    tracing::info!(run.id = %id, "deleted run artifacts");
    Ok(StatusCode::NO_CONTENT.into_response())
}

/// One entry of the [`list_runs`] response.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredTreeOut {
    /// The run id the tree is keyed by.
    id: String,
    /// When the tree was uploaded (its pointer's last-modified time), RFC 3339 in
    /// UTC, which is what the backend's sweep measures its grace window against.
    modified_at: String,
}

/// The [`list_runs`] response body.
#[derive(serde::Serialize)]
struct TreeListingOut {
    runs: Vec<StoredTreeOut>,
}

/// `GET /runs` — list every run tree the store holds, with each tree's upload
/// time.
///
/// The backend's artifact reclamation sweep is the caller: it compares these ids
/// against its own run rows and deletes the trees nothing references. That is a
/// destructive decision made from this answer, so the route carries the same gate
/// the delete does — the shared control-plane service token
/// (`TCAB_BACKEND_SERVICE_TOKEN`). With no token configured the service rejects
/// every caller (`401`). `200 OK` with `{ "runs": [{ "id", "modifiedAt" }] }`.
#[tracing::instrument(name = "artifacts.list_runs", skip(state, headers), err(Debug))]
async fn list_runs(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Response, ApiError> {
    crate::auth::verify_service_token(
        &headers,
        state.service_token.as_deref().map(String::as_str),
    )?;

    let trees = state.store.list_runs().await.map_err(map_store_error)?;

    let mut runs = Vec::with_capacity(trees.len());
    for tree in trees {
        let modified_at = tree
            .modified
            .to_offset(time::UtcOffset::UTC)
            .format(&Rfc3339)
            .map_err(|err| {
                ApiError::internal(format!("formatting a stored tree's modified time: {err}"))
            })?;
        runs.push(StoredTreeOut {
            id: tree.id,
            modified_at,
        });
    }

    tracing::debug!(trees = runs.len(), "listed stored run trees");
    Ok((StatusCode::OK, axum::Json(TreeListingOut { runs })).into_response())
}

/// `GET /runs/{id}/tree.tar` — stream a tar of run `{id}`'s stored source tree
/// (`implementation/` plus `run-record.json` and, when present, `events.jsonl`) to
/// the publisher Job, which untars it to drive the GitHub-repo + Pages release.
///
/// `{id}` is the **run/record id** (the store key). Unlike the build/media reads —
/// browser-loaded `<img>`/`<iframe>` resources a reviewer's Access assertion
/// authorizes — this is a server-to-server pull, so it is gated by the
/// **per-publish-job token**,
/// verified against the backend exactly as an upload's per-job token is. The token
/// was minted for the **publish-job id**, which differs from the run id in the path,
/// so the publisher sends its publish-job id in the [`PUBLISH_JOB_ID_HEADER`] and the
/// verify uses that. `200 OK` with the tar body on success; `401` for a
/// missing/invalid token or absent publish-job-id header; `404` for a run with no
/// stored tree.
///
/// The body is **streamed**: the tar is written into the response as the tree is
/// walked, so the response is chunked and carries no `Content-Length`. That means
/// the two failures above have to be decided before the first byte — see
/// [`ArtifactStore::run_tree`] — and that a fault arising mid-walk cannot
/// change the status code. Such a fault ABORTS the body instead of ending it, so the
/// publisher sees a transport error rather than a well-formed archive with files
/// missing from it; [`ChannelWriter`]'s `Drop` is where that is arranged and why it
/// cannot be left to the archive's own framing.
#[tracing::instrument(name = "artifacts.tree_tar", skip(state, headers), fields(run.id = %id), err(Debug))]
async fn tree_tar(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: axum::http::HeaderMap,
) -> Result<Response, ApiError> {
    let token = crate::auth::bearer(&headers)
        .ok_or_else(|| ApiError::unauthorized("missing publish-job token"))?;
    // Verify against the publish job the token was minted for — the publish-job id
    // the publisher sends, not the run id in the path (the store key). They are
    // distinct UUIDs; verifying against the run id always fails, since the backend
    // has no publish job by that id.
    let publish_job_id = headers
        .get(PUBLISH_JOB_ID_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            ApiError::unauthorized(format!("missing `{PUBLISH_JOB_ID_HEADER}` header"))
        })?;
    verify_publish_job_token(&state.http, &state.backend_url, publish_job_id, &token).await?;

    // Ask whether the run exists *before* answering, because the answer streams: the
    // moment the body starts the status code is spent, so a `404` for an unknown run
    // has to be decided here. Keyed by the run id from the path, not the publish-job
    // id the token was verified against.
    let tree = state.store.run_tree(&id).await.map_err(map_store_error)?;

    // The tar is framed on a blocking thread as the tree's objects are read, and
    // written into the response body as it goes rather than assembled first — see
    // `write_archive` and `ChannelWriter`.
    let feed = start_archive(tree, ArchiveShape::Source);
    let body = streamed_archive(id, "run source tree", move |out| write_archive(feed, out));
    // No `Content-Length`: the size is not known until the walk finishes, so the
    // response is chunked. The publisher reads the body to the end, which is the only
    // thing it needed the length for.
    Ok(([(header::CONTENT_TYPE, "application/x-tar")], body).into_response())
}

/// `GET /runs/{id}/archive.tar.gz` — download run `{id}`'s entire stored tree as a
/// single gzip tar, for a reviewer pulling a run's produced output onto their
/// machine.
///
/// This exists to replace a transfer that was becoming unusable:
/// `scripts/extract-cluster-assets.sh` can only reach a deployed cluster through
/// `az aks command invoke`, which is a command channel with no file channel, so it
/// moves the tree as base64 over stdout in ~320 KiB chunks — one helper-pod round
/// trip (~15s) each. A full-stack run's tree runs to ~150 chunks, i.e. tens of
/// minutes. The console can reach this service directly, so it can just take the
/// bytes in one response.
///
/// A read like the build/proof/asset reads, and unlike [`tree_tar`]: the console
/// offers this as an ordinary download link through the edge, which authorizes it
/// by the reviewer's Access assertion. `tree_tar` takes the per-publish-job token
/// because it is a server-to-server pull whose caller never crosses the edge.
///
/// The whole stored tree is archived (not `tree_tar`'s publisher-shaped subset)
/// under an `<id>/` prefix, matching what the extract script produced. `Content-Disposition`
/// carries the filename because the console's link is cross-origin, where the
/// anchor's own `download` attribute is ignored by the browser.
///
/// The body is **streamed** — compressed into the response as the tree is walked —
/// which is what keeps this route from setting the service's memory ceiling. Any
/// reviewer may ask for it, so the size of what it is asked to build is a
/// reviewer's choice; holding
/// that whole is how a single Download click became an OOM kill for every run the
/// service was serving. The cost is a chunked response with no `Content-Length`, so
/// the browser shows an indeterminate download.
#[tracing::instrument(name = "artifacts.archive", skip(state), fields(run.id = %id), err(Debug))]
async fn archive(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    // Ask whether the run exists — and that its id is a single safe path segment —
    // before answering, because the answer streams: once the body starts, the `404`
    // for an unknown run and the `400` for an unsafe id can no longer be sent.
    let tree = state.store.run_tree(&id).await.map_err(map_store_error)?;

    // The id is a UUID (`run_tree` rejected anything that is not a single
    // safe path segment just above), so it cannot break out of the quoted filename
    // or inject a header.
    let disposition = format!("attachment; filename=\"run-{id}.tar.gz\"");

    // Compressing is CPU work, so the archive is framed and compressed on a blocking
    // thread as the tree's objects are read, into the response body as it goes rather
    // than holding the finished archive. Any reviewer may call this route, so the size
    // of what it is asked for is a reviewer's choice — see `ChannelWriter` for why
    // that had to stop setting the service's peak allocation.
    let feed = start_archive(tree, ArchiveShape::Whole);
    let body = streamed_archive(id, "run archive", move |out| write_archive(feed, out));

    // The gzip *is* the resource here, so the response carries no `Content-Encoding`:
    // declaring one would have the browser inflate the archive on the way to disk and
    // leave a bare tar sitting under a `.tar.gz` name. There is no `Content-Length`
    // either — the compressed size is not known until the walk ends — so the browser
    // shows an indeterminate download rather than a percentage.
    Ok((
        [
            (header::CONTENT_TYPE, "application/gzip".to_string()),
            (header::CONTENT_DISPOSITION, disposition),
        ],
        body,
    )
        .into_response())
}

/// `GET /runs/{id}/build` — serve a produced run's playable build at its root (the
/// build's `index.html`). Browser-loaded, through the edge.
async fn build_root(
    State(state): State<AppState>,
    OriginalUri(uri): OriginalUri,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    serve_build(&state, mount_prefix(&uri), &id, "").await
}

/// `GET /runs/{id}/build/{*path}` — serve a file within a produced run's playable
/// build (an asset the `index.html` references). Browser-loaded, through the edge.
async fn build_path(
    State(state): State<AppState>,
    OriginalUri(uri): OriginalUri,
    Path((id, path)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    serve_build(&state, mount_prefix(&uri), &id, &path).await
}

/// The prefix the request was routed under: [`EDGE_PREFIX`] for a request that
/// came through the edge, empty for one at the root. A build's HTML is relocated
/// under the path it was requested at, so a build loaded through the edge resolves
/// its assets back through the edge rather than at the origin's root, which is the
/// console's.
fn mount_prefix(uri: &axum::http::Uri) -> &'static str {
    match uri.path().strip_prefix(EDGE_PREFIX) {
        Some(rest) if rest.starts_with('/') => EDGE_PREFIX,
        _ => "",
    }
}

/// Resolve and serve one file from a produced run's static build output, which
/// lives in its stored tree under `implementation/{dist|build|out}/`. The build is
/// mounted under a per-run base path (behind `prefix`, the path the request was
/// routed under), so its HTML is relocated to resolve assets there (see
/// [`serve_build_file`]). A `404` covers an unknown run, a run with no build, and a
/// path that does not resolve to a file inside the build.
async fn serve_build(
    state: &AppState,
    prefix: &str,
    id: &str,
    rel_path: &str,
) -> Result<Response, ApiError> {
    let tree = state.store.run_tree(id).await.map_err(map_store_error)?;
    let build = find_build_output(&tree)
        .await
        .map_err(map_store_error)?
        .ok_or_else(|| ApiError::not_found(format!("run `{id}` has no playable build to serve")))?;
    let base_href = format!("{prefix}/runs/{id}/build/");
    let file = serve_build_file(&tree, build, rel_path, &base_href)
        .await
        .map_err(map_store_error)?
        .ok_or_else(|| ApiError::not_found(format!("no build file `{rel_path}` for run `{id}`")))?;
    Ok(media_response(file))
}

/// `GET /runs/{id}/proof/{file}` — a produced run's proof-of-implementation media
/// (`{file}` is `<proof-id>.<ext>`), resolved from the run record's
/// `validation.proofs` via [`serve_proof_file`], the same resolver the worker
/// used. Browser-loaded, through the edge. `404` when the run, the proof, or the file is
/// absent.
async fn proof_file(
    State(state): State<AppState>,
    Path((id, file)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    let tree = state.store.run_tree(&id).await.map_err(map_store_error)?;
    let served = serve_proof_file(&tree, &file)
        .await
        .map_err(map_store_error)?
        .ok_or_else(|| ApiError::not_found(format!("run `{id}` has no proof media `{file}`")))?;
    Ok(media_response(served))
}

/// `GET /runs/{id}/asset/{file}` — an asset-generation run's regenerated image,
/// final preview, or action log (or an adversarial replay), resolved from the run
/// record's `validation` frame via [`serve_asset_file`], the same resolver the
/// worker used. Browser-loaded as `<img src>`/animation frames, through the edge.
async fn asset_file(
    State(state): State<AppState>,
    Path((id, file)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    let tree = state.store.run_tree(&id).await.map_err(map_store_error)?;
    let served = serve_asset_file(&tree, &file)
        .await
        .map_err(map_store_error)?
        .ok_or_else(|| ApiError::not_found(format!("run `{id}` has no asset media `{file}`")))?;
    Ok(media_response(served))
}

/// `GET /runs/{id}/validation/{file}` — a run's synthesized validation media
/// (`{file}` is the flat `<item>__<output>[.baseline].<ext>` a debug script
/// produced), resolved from the collected tree via [`serve_validation_file`], the
/// same resolver the worker used. Browser-loaded, through the edge. `404` when the run or
/// the media is absent.
async fn validation_file(
    State(state): State<AppState>,
    Path((id, file)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    let tree = state.store.run_tree(&id).await.map_err(map_store_error)?;
    let served = serve_validation_file(&tree, &file)
        .await
        .map_err(map_store_error)?
        .ok_or_else(|| {
            ApiError::not_found(format!("run `{id}` has no validation media `{file}`"))
        })?;
    Ok(media_response(served))
}

/// `GET /runs/{id}/showcase/{file}` — one of a run's showcase files (`{file}` is
/// the plain file name in the produced tree's `showcase/` — a carousel media file,
/// or an image the description references), resolved from the collected tree via
/// [`serve_showcase_file`]. Browser-loaded, through the edge. A `.json.gz` replay serves
/// as JSON travelling gzip-framed, exactly as validation replays do, so a browser
/// inflates it transparently. `404` when the run or the file is absent.
async fn showcase_file(
    State(state): State<AppState>,
    Path((id, file)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    let tree = state.store.run_tree(&id).await.map_err(map_store_error)?;
    let served = serve_showcase_file(&tree, &file)
        .await
        .map_err(map_store_error)?
        .ok_or_else(|| ApiError::not_found(format!("run `{id}` has no showcase file `{file}`")))?;
    Ok(media_response(served))
}

/// Build a media response that declares both what the resource is and how the body
/// is framed.
///
/// A recording is stored gzipped and served that way, so its response says
/// `Content-Type: application/json` with `Content-Encoding: gzip` and the browser
/// inflates it before the player ever sees it. The compression layer leaves a body
/// that already declares an encoding alone, so a recording is never re-encoded on
/// its way out.
///
/// The body is streamed from the store, and carries the length the store reported
/// for it, so a browser knows the size of what it is loading.
fn media_response(served: Served) -> Response {
    let mut response = (
        [(header::CONTENT_TYPE, served.content_type)],
        Body::from_stream(served.body),
    )
        .into_response();
    let headers = response.headers_mut();
    if let Some(encoding) = served.content_encoding {
        headers.insert(
            header::CONTENT_ENCODING,
            header::HeaderValue::from_static(encoding),
        );
    }
    if let Some(length) = served.content_length {
        headers.insert(header::CONTENT_LENGTH, header::HeaderValue::from(length));
    }
    response
}

/// `GET /runs/{id}/events.jsonl` — a finished run's recorded, normalized event
/// stream, served verbatim as NDJSON when it was uploaded alongside the run.
/// Browser-loaded, through the edge. `404` when the run or its event log is absent.
async fn events_file(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    serve_run_stream(&state, &id, "events.jsonl").await
}

/// `GET /runs/{id}/raw.jsonl` — a finished run's recorded raw harness output,
/// served verbatim as NDJSON when it was uploaded. Browser-loaded, through the edge. `404`
/// when the run or its raw log is absent.
async fn raw_file(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    serve_run_stream(&state, &id, "raw.jsonl").await
}

/// Serve a recorded run stream file (`events.jsonl` or `raw.jsonl`) from the run's
/// stored tree as immutable NDJSON, streamed. A finished run's logs never change, so
/// they are safe to cache aggressively. The file is optional in the upload, so its
/// absence is an ordinary `404`, not an error.
async fn serve_run_stream(
    state: &AppState,
    id: &str,
    file_name: &str,
) -> Result<Response, ApiError> {
    let tree = state.store.run_tree(id).await.map_err(map_store_error)?;
    let object = tree
        .get(file_name)
        .await
        .map_err(map_store_error)?
        .ok_or_else(|| ApiError::not_found(format!("run `{id}` has no recorded `{file_name}`")))?;
    let mut response = media_response(Served {
        content_type: "application/x-ndjson",
        content_encoding: None,
        content_length: Some(object.properties.content_length),
        body: object.body,
    });
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("public, max-age=31536000, immutable"),
    );
    Ok(response)
}

/// The run-tree file `GET /runs/{id}/replay` serves: the driver's gg session
/// record.
pub const REPLAY_TREE_FILE: &str = "replay.json.gz";

/// The run-tree file `GET /runs/{id}/code-analysis` serves: the driver's code
/// analysis document.
pub const CODE_ANALYSIS_TREE_FILE: &str = "code-analysis.json.gz";

/// `GET /runs/{id}/replay` — a run's gg session record, the JSON document the
/// driver stores gzipped as [`REPLAY_TREE_FILE`], served as `application/json`
/// with a gzip content encoding. `404` when the run or the record is absent.
async fn replay_file(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    serve_gzipped_json(&state, &id, REPLAY_TREE_FILE).await
}

/// `GET /runs/{id}/code-analysis` — a run's code analysis, the JSON document the
/// driver stores gzipped as [`CODE_ANALYSIS_TREE_FILE`], served as
/// `application/json` with a gzip content encoding. `404` when the run or the
/// document is absent.
async fn code_analysis_file(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    serve_gzipped_json(&state, &id, CODE_ANALYSIS_TREE_FILE).await
}

/// The two bytes every gzip member begins with (RFC 1952 §2.3.1). A JSON
/// document never does, so they tell a framed document from a plain one.
const GZIP_MAGIC: [u8; 2] = [0x1f, 0x8b];

/// Serve the run-tree file `file_name`, a JSON document travelling gzipped, as
/// `application/json` with a gzip content encoding, so a browser or an HTTP
/// client inflates the body before reading it.
///
/// The labels come from the `.json.gz` name, but a tree uploaded with the
/// document left plain is served truthfully rather than mislabelled: the body's
/// first two bytes decide whether the encoding is declared. A finished run's
/// documents never change, so they are cached as the logs are.
async fn serve_gzipped_json(
    state: &AppState,
    id: &str,
    file_name: &str,
) -> Result<Response, ApiError> {
    let tree = state.store.run_tree(id).await.map_err(map_store_error)?;
    let object = tree
        .get(file_name)
        .await
        .map_err(map_store_error)?
        .ok_or_else(|| ApiError::not_found(format!("run `{id}` has no recorded `{file_name}`")))?;
    let length = object.properties.content_length;
    let (head, rest) = peek(object.body, GZIP_MAGIC.len())
        .await
        .map_err(|err| map_store_error(StoreError::Body(err)))?;
    let labels = test_cabinet_suites::content_labels::for_gz(file_name);
    let encoding = if head.starts_with(&GZIP_MAGIC) {
        labels.content_encoding
    } else {
        None
    };
    let body: crate::object::ObjectBody =
        Box::pin(futures_util::stream::iter((!head.is_empty()).then(|| Ok(head))).chain(rest));
    let mut response = media_response(Served {
        content_type: labels.content_type,
        content_encoding: encoding,
        content_length: Some(length),
        body,
    });
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("public, max-age=31536000, immutable"),
    );
    Ok(response)
}

/// Read at least `want` bytes off the front of `body` (fewer when the body is
/// shorter), answering them and the rest of the body.
async fn peek(
    mut body: crate::object::ObjectBody,
    want: usize,
) -> std::io::Result<(Bytes, crate::object::ObjectBody)> {
    let mut head = BytesMut::new();
    while head.len() < want {
        match body.next().await {
            Some(chunk) => head.extend_from_slice(&chunk?),
            None => break,
        }
    }
    Ok((head.freeze(), body))
}

/// `POST /runs/{id}/publish-media` — copy run `{id}`'s publishable media from its
/// stored tree into the public store under `media/runs/<id>/`, and answer the key
/// each file was published under (see [`publish_run_media`]).
///
/// The backend calls it when a run publishes, with the shared control-plane
/// service token; with no token configured every caller is refused (`401`). It is
/// idempotent: a key the public store already holds is left in place and named
/// again. `200 OK` with
/// `{ "proofMedia": [{ "id", "kind", "key" }], "validationMedia": [{ "file", "key" }],
/// "assetMedia": [...], "showcaseMedia": [...] }`; `404` for a run with no stored
/// tree or no run record.
#[tracing::instrument(name = "artifacts.publish_media", skip(state, headers), fields(run.id = %id), err(Debug))]
async fn publish_media(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: axum::http::HeaderMap,
) -> Result<Response, ApiError> {
    crate::auth::verify_service_token(
        &headers,
        state.service_token.as_deref().map(String::as_str),
    )?;
    let tree = state.store.run_tree(&id).await.map_err(map_store_error)?;
    let published = publish_run_media(&tree, state.public.as_ref(), state.transcoder.as_ref())
        .await
        .map_err(|err| match err {
            PublishError::NoRecord(_) => ApiError::not_found(err.to_string()),
            PublishError::Store(err) => map_store_error(err),
            PublishError::BadRecord { .. } | PublishError::Public(_) | PublishError::Staging(_) => {
                ApiError::internal(err.to_string())
            }
        })?;
    Ok((StatusCode::OK, Json(published)).into_response())
}

/// The [`put_public`] response body.
#[derive(serde::Serialize)]
struct PublicWriteOut {
    /// The key written.
    key: String,
    /// The number of bytes written.
    bytes: u64,
}

/// `PUT /public/{key}` — write one object of the public dataset at `key`, whole,
/// with the request's body, its `Content-Type`, and its `Content-Encoding` when it
/// carries one.
///
/// The backend writes a run's document, the index objects and the `index.json`
/// pointer with it, presenting the service token; the CLI writes an
/// asset-generation case's reference frames with it through the edge, presenting
/// an Access service token. A person's assertion is refused (`403`, see
/// [`authorize_public_write`]).
///
/// The key is stored as given, so one that does not name a single object plainly
/// is refused (`400`, see [`check_public_key`]), as is a request with no
/// `Content-Type`. The body is streamed into the store, which commits it whole, so
/// a reader sees the previous object or the new one; a body over the upload limit
/// is refused (`413`) and leaves the previous object in place. `201 Created` with
/// `{ "key", "bytes" }`.
#[tracing::instrument(name = "artifacts.put_public", skip(state, identity, headers, body), fields(key = %key, bytes = tracing::field::Empty), err(Debug))]
async fn put_public(
    State(state): State<AppState>,
    identity: Option<Extension<Identity>>,
    Path(key): Path<String>,
    headers: axum::http::HeaderMap,
    body: Body,
) -> Result<Response, ApiError> {
    authorize_public_write(identity.as_ref().map(|Extension(identity)| identity))?;
    check_public_key(&key)
        .map_err(|reason| ApiError::bad_request(format!("key `{key}`: {reason}")))?;
    let content_type = header_text(&headers, header::CONTENT_TYPE)?
        .ok_or_else(|| ApiError::bad_request("a public write carries a `Content-Type`"))?;
    let content_encoding = header_text(&headers, header::CONTENT_ENCODING)?;

    let limit = state.upload_limit;
    if let Some(length) =
        header_text(&headers, header::CONTENT_LENGTH)?.and_then(|length| length.parse::<u64>().ok())
        && length > limit
    {
        return Err(ApiError::payload_too_large(format!(
            "the body is {length} bytes, over the {limit}-byte limit"
        )));
    }

    // The cap is applied as the body is read, and a body that fails — too long, or
    // broken off by the client — fails the write before the store commits it.
    let outcome = Arc::new(std::sync::Mutex::new(BodyOutcome::Whole));
    let body = capped_body(body, limit, Arc::clone(&outcome));
    let written = state
        .public
        .put(&key, body, &content_type, content_encoding.as_deref())
        .await;
    let written = match written {
        Ok(written) => written,
        Err(err) => {
            let outcome = *outcome
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            return Err(match outcome {
                BodyOutcome::TooLarge => {
                    ApiError::payload_too_large(format!("the body is over the {limit}-byte limit"))
                }
                BodyOutcome::Broken => {
                    ApiError::bad_request(format!("the body did not arrive whole: {err}"))
                }
                BodyOutcome::Whole => ApiError::internal(err.to_string()),
            });
        }
    };
    tracing::Span::current().record("bytes", written);
    tracing::info!(key = %key, bytes = written, "wrote a public object");
    Ok((
        StatusCode::CREATED,
        Json(PublicWriteOut {
            key,
            bytes: written,
        }),
    )
        .into_response())
}

/// How a capped request body ended, recorded as it is read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BodyOutcome {
    /// It arrived whole within the cap (or has not failed yet).
    Whole,
    /// It ran past the cap.
    TooLarge,
    /// The client's body failed.
    Broken,
}

/// `body` as an [`ObjectBody`](crate::object::ObjectBody) that fails once more than
/// `limit` bytes have been read, or when the client's body fails, recording which
/// in `outcome`.
fn capped_body(
    body: Body,
    limit: u64,
    outcome: Arc<std::sync::Mutex<BodyOutcome>>,
) -> crate::object::ObjectBody {
    let mut read = 0u64;
    Box::pin(body.into_data_stream().map(move |chunk| {
        let record = |ended: BodyOutcome| {
            *outcome
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner) = ended;
        };
        match chunk {
            Ok(chunk) => {
                read = read.saturating_add(chunk.len() as u64);
                if read > limit {
                    record(BodyOutcome::TooLarge);
                    Err(std::io::Error::other("the body is over the limit"))
                } else {
                    Ok(chunk)
                }
            }
            Err(err) => {
                record(BodyOutcome::Broken);
                Err(std::io::Error::other(err))
            }
        }
    }))
}

/// The value of header `name` as trimmed text, `None` when absent or empty; a
/// value that is not visible ASCII is a `400`.
fn header_text(
    headers: &axum::http::HeaderMap,
    name: header::HeaderName,
) -> Result<Option<String>, ApiError> {
    let Some(value) = headers.get(&name) else {
        return Ok(None);
    };
    let text = value
        .to_str()
        .map_err(|_| ApiError::bad_request(format!("the `{name}` header is not plain text")))?
        .trim();
    Ok((!text.is_empty()).then(|| text.to_string()))
}

/// Map a [`StoreError`] onto the HTTP envelope: what the caller sent wrong is a
/// `400` (a traversal entry or unsafe id, an unusable archive, a body that failed
/// to arrive) or a `413` (a body over the limit); a read of an unknown run's tree is
/// a `404`; a store fault is the service's (`500`).
fn map_store_error(err: StoreError) -> ApiError {
    match err {
        StoreError::Traversal(_) | StoreError::Archive(_) | StoreError::UploadBody(_) => {
            ApiError::bad_request(err.to_string())
        }
        StoreError::TooLarge(_) => ApiError::payload_too_large(err.to_string()),
        StoreError::NotFound(_) => ApiError::not_found(err.to_string()),
        StoreError::Backend(_)
        | StoreError::Body(_)
        | StoreError::TooLargeToRead(_)
        | StoreError::CorruptPointer(_) => ApiError::internal(err.to_string()),
    }
}

#[cfg(test)]
#[path = "api.test.rs"]
mod tests;

#[cfg(test)]
#[path = "api.replace.test.rs"]
mod replace_tests;

#[cfg(test)]
#[path = "api.stream.test.rs"]
mod stream_tests;

#[cfg(test)]
#[path = "api.publish.test.rs"]
mod publish_tests;
