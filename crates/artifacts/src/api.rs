//! The artifact service's HTTP surface: upload a run's tree, serve its build and
//! media.
//!
//! Three callers (see [`crate::auth`]):
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
//!   /runs/{id}/artifacts` when a run is deleted, `GET /runs` to enumerate the
//!   stored trees for its reclamation sweep, `GET /runs/{id}/artifacts` to ask
//!   whether one run's tree is stored before it enqueues a publish, and
//!   `GET /capacity` to read the store volume's free space — authed by the shared
//!   **control-plane service token**.
//! - A **reviewer** (through the console) reads the run's playable build and
//!   proof/asset media — `GET /runs/{id}/build` (and the trailing-slash
//!   `/runs/{id}/build/` the console actually loads), `/runs/{id}/build/{*path}`,
//!   `/runs/{id}/proof/{file}`, `/runs/{id}/asset/{file}`, and the recorded
//!   `/runs/{id}/events.jsonl`/`raw.jsonl` logs — and downloads the run's whole
//!   produced tree as one gzip tar, `GET /runs/{id}/archive.tar.gz`. These are
//!   **not** token-gated: the console loads them as
//!   `<img src>`/`<iframe>`/relative build sub-resources (and offers the archive as
//!   a plain download link), none of which carry an `Authorization` header, so read
//!   protection is the private-network boundary, exactly as for the backend's run
//!   reads.
//!
//! The serve handlers **reuse the core resolvers**
//! ([`find_build_output`], [`serve_build_file`], [`read_proof_file`],
//! [`read_asset_file`]) exactly as the
//! worker did, only reading from the artifact store's per-run root instead of the
//! worker's out_dir — so the per-run base-href rewrite and the path-traversal
//! guard are identical.

use std::io::{Seek, Write};
use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Path, Request, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use bytes::{Bytes, BytesMut};
use futures_util::StreamExt;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use tokio::io::AsyncWriteExt;
use tower_http::compression::CompressionLayer;
use tower_http::compression::predicate::{DefaultPredicate, NotForContentType, Predicate};
use tower_http::cors::{AllowHeaders, CorsLayer};
use tower_http::trace::TraceLayer;

use test_cabinet_core::{
    find_build_output, read_asset_file, read_proof_file, read_showcase_file, read_validation_file,
    serve_build_file,
};

use crate::auth::{verify_job_token, verify_publish_job_token};
use crate::error::ApiError;
use crate::store::{ArtifactStore, impl_dir};

/// The maximum size of an uploaded artifact tarball, in bytes. A run's collected
/// tree (source + a static build + a handful of media clips) is comfortably under
/// this; 2 GiB is generous headroom for the heavier test cases the benchmark is
/// moving toward.
///
/// The cap now bounds **disk**, not memory: the body is spooled to the store's
/// scratch dir as it arrives rather than buffered, so it is the store filling up
/// that a hostile upload threatens, not the service's address space. It is enforced
/// by [`upload`] while writing rather than by a `DefaultBodyLimit` layer, because
/// that layer only constrains extractors that buffer (`Bytes`, `String`, `Json`) and
/// is inert against the raw `Body` this handler now takes.
const MAX_UPLOAD_BYTES: usize = 2 * 1024 * 1024 * 1024;

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
/// stop building their archive in memory before answering. Both used to return a
/// `Vec<u8>`, so the service's peak allocation was the size of the largest tree any
/// caller asked for, and `archive` is **ungated**: one reviewer clicking Download on
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
/// calling this (see [`ArtifactStore::ensure_run_tree`]): once the body is returned
/// the status code is already committed, so a failure raised inside `build` can only
/// be logged and the stream ended — the pre-check is what keeps the two real failure
/// modes, an unknown run and an unsafe id, on the path that can still answer `404`
/// or `400`.
fn streamed_archive<F>(id: String, what: &'static str, build: F) -> Body
where
    F: FnOnce(&mut ChannelWriter) -> Result<(), crate::store::StoreError> + Send + 'static,
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
    /// The shared control-plane service token the backend's management routes — the
    /// run-tree delete, the presence check, the `GET /runs` listing and the
    /// `GET /capacity` reading — must present, or `None` when tree management is
    /// disabled (those routes then reject every caller). See
    /// [`crate::auth::verify_service_token`].
    pub service_token: Option<Arc<String>>,
    /// The `GET /capacity` reading in flight, if one is, and the last one that
    /// returned.
    pub capacity_reads: Arc<CapacityReads>,
}

/// What the `GET /capacity` handler keeps between requests, so that one reading runs at a time.
///
/// A reading is a `statvfs` and a [write check](ArtifactStore::probe_write), and
/// on a volume that hangs rather than errors both block for as long as it does.
/// The backend polls every few seconds and gives up on each answer long before
/// that, so without this each poll would park one more thread of the blocking
/// pool, which is the pool uploads are unpacked on.
#[derive(Debug, Default)]
pub struct CapacityReads {
    /// Whether a reading is running on the blocking pool right now.
    running: std::sync::atomic::AtomicBool,
    /// The byte figures of the last reading that returned.
    last: std::sync::Mutex<Option<crate::store::StoreCapacity>>,
}

/// Marks a reading as running for as long as it lives. Held by the blocking task,
/// so a request the caller abandoned still clears the mark when its reading
/// returns, and a reading that never returns never clears it.
struct RunningRead(Arc<CapacityReads>);

impl Drop for RunningRead {
    fn drop(&mut self) {
        self.0
            .running
            .store(false, std::sync::atomic::Ordering::Release);
    }
}

/// What a `GET /capacity` answers while the reading before it has not returned.
const READ_IN_FLIGHT: &str = "the previous write check has not returned";

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
        // No `DefaultBodyLimit` layer: `upload` takes the raw `Body` so it can spool
        // to disk, and that layer only bounds the buffering extractors. The cap is
        // applied as the bytes are written — see `MAX_UPLOAD_BYTES`.
        .route(
            "/runs/{id}/artifacts",
            post(upload).delete(delete).get(presence),
        )
        // Enumerate every stored tree (backend → service, shared control-plane
        // service token) so the backend's reclamation sweep can compare the volume's
        // contents against its own run rows.
        .route("/runs", get(list_runs))
        // The store volume's free and total space (backend → service, shared
        // control-plane service token), which the backend holds new runs back on.
        .route("/capacity", get(capacity))
        // Download a run's source tree as a tar (publisher → service, per-publish-job
        // token). The one *gated* read: a server-to-server pull the publisher uses to
        // drive the GitHub-repo + Pages release, verified against the backend like an
        // upload — not browser-loaded media.
        .route("/runs/{id}/tree.tar", get(tree_tar))
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
        // Download the run's whole stored tree as one gzip tar (reviewer → service,
        // ungated). Same posture, and the same reason, as the media reads below: the
        // console offers it as a plain `<a href download>`, which carries no
        // Authorization header.
        .route("/runs/{id}/archive.tar.gz", get(archive))
        .route("/runs/{id}/proof/{file}", get(proof_file))
        .route("/runs/{id}/asset/{file}", get(asset_file))
        .route("/runs/{id}/validation/{file}", get(validation_file))
        .route("/runs/{id}/showcase/{file}", get(showcase_file))
        // The names of the validation and showcase files a run's tree holds
        // (backend → service, ungated like the media reads whose names it lists).
        .route("/runs/{id}/media", get(media_listing))
        // One of the files at the root of a run's tree that no media route
        // reaches (backend → service, ungated like the archive that carries them).
        .route("/runs/{id}/root/{name}", get(root_file))
        .route("/runs/{id}/events.jsonl", get(events_file))
        .route("/runs/{id}/raw.jsonl", get(raw_file))
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

/// Write `body` to an unnamed file in `scratch_dir` as it arrives, refusing it once
/// more than `max_bytes` have been written. Returns the file rewound, plus the byte
/// count.
///
/// The file is created with `tempfile_in`, so it carries **no directory entry**: a
/// partial upload — one that errored, or one refused for exceeding the cap — is
/// reclaimed by the kernel when the handle drops, and a store listing never sees an
/// in-flight upload. That is what lets every failure path here simply return.
///
/// The cap is applied per chunk rather than from `Content-Length`, which a chunked
/// request does not carry and a hostile one may understate.
async fn spool_to_disk(
    body: Body,
    scratch_dir: std::path::PathBuf,
    max_bytes: usize,
) -> Result<(std::fs::File, usize), ApiError> {
    let spooled = tokio::task::spawn_blocking(move || tempfile::tempfile_in(scratch_dir))
        .await
        .map_err(|err| ApiError::internal(format!("upload spool task failed: {err}")))?
        .map_err(|err| ApiError::internal(format!("creating the upload spool file: {err}")))?;

    let mut spooled = tokio::fs::File::from_std(spooled);
    let mut stream = body.into_data_stream();
    let mut written: usize = 0;
    while let Some(chunk) = stream.next().await {
        // A body that stops arriving is a fault of the connection, not a refusal of
        // the tree, and the status has to say so: a driver gives up at once on a
        // `400`, and holds its tree and retries on this.
        let chunk = chunk
            .map_err(|err| ApiError::unavailable(format!("reading the upload body: {err}")))?;
        written = written.saturating_add(chunk.len());
        if written > max_bytes {
            return Err(ApiError::payload_too_large(format!(
                "upload exceeds the {max_bytes} byte limit"
            )));
        }
        spooled
            .write_all(&chunk)
            .await
            .map_err(|err| ApiError::internal(format!("spooling the upload: {err}")))?;
    }
    spooled
        .flush()
        .await
        .map_err(|err| ApiError::internal(format!("flushing the upload spool: {err}")))?;

    let mut spooled = spooled.into_std().await;
    // The caller reads from the start; writing left the cursor at the end.
    spooled
        .rewind()
        .map_err(|err| ApiError::internal(format!("rewinding the upload spool: {err}")))?;
    Ok((spooled, written))
}

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

    // Spool the body to disk as it arrives, rather than extracting it into memory.
    //
    // This handler is the far end of the driver's upload, and it used to take
    // `Bytes` — the whole tarball resident before a single entry was unpacked, up to
    // the 2 GiB cap. That is the one allocation a long-lived shared service must not
    // make: it is the only pod here whose peak is set by a *caller's* payload rather
    // than by its own work, so its memory ceiling could not be sized from anything it
    // does. Prod bears that out — this pod's kernel high-water mark reached 3.2 GiB
    // against a node with ~4.7 GiB schedulable, on a service that requests nothing at
    // all and so can land beside a run pod.
    //
    // Note the body is only touched AFTER the token has been verified above. An
    // unauthenticated caller must not be able to make the service write anything,
    // which is also why the cap is checked per chunk rather than after the fact.
    let (mut spooled, written) =
        spool_to_disk(body, state.store.scratch_dir(), MAX_UPLOAD_BYTES).await?;
    tracing::Span::current().record("bytes", written);

    // The store I/O is blocking (tar unpack writes many small files); run it off
    // the async runtime so a large upload does not stall other connections. Keyed by
    // the run id from the path, not the job id the token was verified against.
    let store = state.store.clone();
    let id_for_task = id.clone();
    tokio::task::spawn_blocking(move || store.store_run(&id_for_task, &mut spooled))
        .await
        .map_err(|err| ApiError::internal(format!("artifact unpack task failed: {err}")))?
        .map_err(map_store_error)?;

    tracing::info!(run.id = %id, bytes = written, "stored run artifacts");
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

/// The [`presence`] response body.
#[derive(serde::Serialize)]
struct TreePresenceOut {
    /// The run id asked about.
    id: String,
    /// Whether the store holds a tree for it.
    stored: bool,
}

/// `GET /runs/{id}/artifacts` — whether run `{id}` has a stored tree.
///
/// The backend asks this before it enqueues a publish: a release is built from the
/// stored tree, so a run without one must not be handed to a publisher. Absence is
/// answered in the body of a `200`, never as a `404`, so the caller cannot mistake
/// a misrouted or unreachable service for a run with no tree; the two lead to
/// different decisions there.
///
/// Gated by the shared control-plane service token like the listing, since it is
/// the same information one run at a time. `200 OK` with `{ "id", "stored" }`;
/// `401` without the token; `400` for an unsafe id. The check is one `stat`.
#[tracing::instrument(name = "artifacts.presence", skip(state, headers), fields(run.id = %id), err(Debug))]
async fn presence(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: axum::http::HeaderMap,
) -> Result<Response, ApiError> {
    crate::auth::verify_service_token(
        &headers,
        state.service_token.as_deref().map(String::as_str),
    )?;
    let stored = state.store.has_run_tree(&id).map_err(map_store_error)?;
    Ok((StatusCode::OK, axum::Json(TreePresenceOut { id, stored })).into_response())
}

/// The [`media_listing`] response body.
#[derive(serde::Serialize)]
struct MediaListingOut {
    /// The run id asked about.
    id: String,
    /// Whether the store holds a tree for it. Both lists are empty when not.
    stored: bool,
    /// The names the `/validation/{file}` route serves for this run.
    validation: Vec<String>,
    /// The names the `/showcase/{file}` route serves for this run.
    showcase: Vec<String>,
    /// The names the `/root/{name}` route serves for this run. A caller reads
    /// the field's presence as this service having that route.
    root: Vec<String>,
}

/// `GET /runs/{id}/media` — the names of the validation and showcase files run
/// `{id}`'s tree holds.
///
/// The backend's snapshot refresh asks this for a published run whose media it has
/// not confirmed in the bucket. A run's record names its declared outputs, but two
/// file sets are named by nothing except the directory they sit in: the image
/// store its recordings share, and showcase files that neither the carousel nor
/// the description mentions. Without the listing the refresh cannot know they
/// exist, and the backend deletes a published run's tree once it believes
/// everything the run published is in the bucket.
///
/// Ungated, like the media routes whose names it lists. As with [`presence`], a
/// run with no tree is answered in the body of a `200`, so the caller cannot
/// mistake an unreachable or misrouted service for a run with nothing to list.
/// `400` for an unsafe id; `500` when a directory of the tree cannot be read,
/// which the caller must not take for an empty one.
#[tracing::instrument(name = "artifacts.media_listing", skip(state), fields(run.id = %id), err(Debug))]
async fn media_listing(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    let stored = state.store.has_run_tree(&id).map_err(map_store_error)?;
    let (validation, showcase, root) = if stored {
        let run_dir = state.store.run_dir(&id);
        let listed = tokio::task::spawn_blocking(move || {
            Ok::<_, std::io::Error>((
                test_cabinet_core::list_validation_files(&run_dir)?,
                test_cabinet_core::list_showcase_files(&run_dir)?,
                test_cabinet_core::list_tree_root_files(&run_dir)?,
            ))
        })
        .await
        .map_err(|err| ApiError::internal(format!("listing run `{id}`'s media: {err}")))?;
        listed.map_err(|err| ApiError::internal(format!("listing run `{id}`'s media: {err}")))?
    } else {
        (Vec::new(), Vec::new(), Vec::new())
    };
    Ok((
        StatusCode::OK,
        axum::Json(MediaListingOut {
            id,
            stored,
            validation,
            showcase,
            root,
        }),
    )
        .into_response())
}

/// One entry of the [`list_runs`] response.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredTreeOut {
    /// The run id the tree is keyed by.
    id: String,
    /// When the tree was last written, RFC 3339 in UTC. This is the run's upload
    /// time, which is what the backend's sweep measures its grace window against.
    modified_at: String,
}

/// The [`list_runs`] response body.
#[derive(serde::Serialize)]
struct TreeListingOut {
    runs: Vec<StoredTreeOut>,
}

/// `GET /runs` — list every run tree the store holds, with each tree's last-write
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

    // Reading the root's directory entries and stat-ing each one is blocking, and the
    // store can hold thousands of trees; keep it off the async runtime.
    let store = state.store.clone();
    let trees = tokio::task::spawn_blocking(move || store.list_runs())
        .await
        .map_err(|err| ApiError::internal(format!("artifact listing task failed: {err}")))?
        .map_err(map_store_error)?;

    let mut runs = Vec::with_capacity(trees.len());
    for tree in trees {
        let modified_at = OffsetDateTime::from(tree.modified)
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

/// The [`capacity`] response body.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CapacityOut {
    /// Bytes an upload can still be written into.
    free_bytes: u64,
    /// The size of the filesystem the store root is on.
    total_bytes: u64,
    /// Whether the write check made for this request passed.
    writable: bool,
    /// Why the write check failed, when it did.
    #[serde(skip_serializing_if = "Option::is_none")]
    write_error: Option<String>,
}

/// `GET /capacity` — the free and total space of the volume the store is on, and
/// whether the store can take a write right now.
///
/// The backend polls this and hands out new runs only while the volume has room
/// for the trees of the runs already in flight and the write check passes. It
/// describes the store as a whole rather than any run, and it is the control
/// plane's alone to read, so it carries the same gate as the listing: the shared
/// control-plane service token (`TCAB_BACKEND_SERVICE_TOKEN`), with every caller
/// rejected (`401`) when none is configured.
///
/// `200 OK` with `{ "freeBytes", "totalBytes", "writable" }`, plus `writeError`
/// when the check failed. The byte figures are one `statvfs`; the write check is
/// [`ArtifactStore::probe_write`]. A
/// failed check is an answer rather than an error status, so the backend can tell
/// a store that cannot be written from a service it could not read.
///
/// One reading runs at a time ([`CapacityReads`]). A request that arrives while
/// the one before it is still blocked on the volume starts nothing: it answers
/// with the last byte figures and a failed check, or `503` when no reading has
/// ever returned.
#[tracing::instrument(name = "artifacts.capacity", skip(state, headers), err(Debug))]
async fn capacity(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Response, ApiError> {
    crate::auth::verify_service_token(
        &headers,
        state.service_token.as_deref().map(String::as_str),
    )?;
    let reads = state.capacity_reads.clone();
    if reads
        .running
        .swap(true, std::sync::atomic::Ordering::AcqRel)
    {
        // The reading before this one is still blocked on the volume, which is
        // itself the answer: the store is not taking a write. It is reported with
        // the last byte figures read, and as the service being unavailable when
        // none has been.
        tracing::warn!("{READ_IN_FLIGHT}; answering without starting another");
        let last = *reads.last.lock().expect("capacity reads mutex poisoned");
        let Some(capacity) = last else {
            return Err(ApiError::unavailable(READ_IN_FLIGHT));
        };
        return Ok(capacity_response(
            capacity,
            Some(READ_IN_FLIGHT.to_string()),
        ));
    }
    // Both halves block on the volume, so both run off the async runtime: a
    // `statvfs` against a volume that hangs would otherwise stall a worker thread
    // that every other request shares.
    let store = state.store.clone();
    let running = RunningRead(reads);
    let (capacity, write_error) = tokio::task::spawn_blocking(move || {
        let running = running;
        let capacity = store.capacity()?;
        *running
            .0
            .last
            .lock()
            .expect("capacity reads mutex poisoned") = Some(capacity);
        let write_error = store.probe_write().err().map(|err| err.to_string());
        Ok::<_, crate::store::StoreError>((capacity, write_error))
    })
    .await
    .map_err(|err| ApiError::internal(format!("capacity task failed: {err}")))?
    .map_err(map_store_error)?;
    if let Some(error) = &write_error {
        tracing::warn!(error = %error, "the artifact store's write check failed");
    }
    Ok(capacity_response(capacity, write_error))
}

/// The `200` answer of [`capacity`]: the byte figures, and the write check's
/// result as `write_error` has it.
fn capacity_response(
    capacity: crate::store::StoreCapacity,
    write_error: Option<String>,
) -> Response {
    (
        StatusCode::OK,
        axum::Json(CapacityOut {
            free_bytes: capacity.free_bytes,
            total_bytes: capacity.total_bytes,
            writable: write_error.is_none(),
            write_error,
        }),
    )
        .into_response()
}

/// `GET /runs/{id}/tree.tar` — stream a tar of run `{id}`'s stored source tree
/// (`implementation/` plus `run-record.json` and, when present, `events.jsonl`) to
/// the publisher Job, which untars it to drive the GitHub-repo + Pages release.
///
/// `{id}` is the **run/record id** (the store key). Unlike the ungated build/media
/// reads — browser-loaded `<img>`/`<iframe>` resources that cannot carry a token —
/// this is a server-to-server pull, so it is gated by the **per-publish-job token**,
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
/// [`ArtifactStore::ensure_run_tree`] — and that a fault arising mid-walk cannot
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
    let store = state.store.clone();
    let id_for_check = id.clone();
    tokio::task::spawn_blocking(move || store.ensure_run_tree(&id_for_check))
        .await
        .map_err(|err| ApiError::internal(format!("artifact tar task failed: {err}")))?
        .map_err(map_store_error)?;

    // Building the tar is blocking (it reads many small files off the store); it runs
    // off the async runtime so a large source tree does not stall other connections,
    // and it writes into the response body as it walks rather than assembling the
    // whole archive first — see `ChannelWriter`.
    let store = state.store.clone();
    let id_for_task = id.clone();
    let body = streamed_archive(id, "run source tree", move |out| {
        store.write_run_tree(&id_for_task, out)
    });
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
/// **Ungated**, like the build/proof/asset reads and unlike
/// [`tree_tar`]: the console offers this as an ordinary download link,
/// which carries no `Authorization` header, and the artifact service is reachable
/// only across the private-network boundary. That boundary — not a token — is what
/// protects every read here. `tree_tar` stays gated because it is a
/// server-to-server pull whose caller *can* hold a token.
///
/// The whole run root is archived (not `tree_tar`'s publisher-shaped subset) under
/// an `<id>/` prefix, matching what the extract script produced. `Content-Disposition`
/// carries the filename because the console's link is cross-origin, where the
/// anchor's own `download` attribute is ignored by the browser.
///
/// The body is **streamed** — compressed into the response as the tree is walked —
/// which is what keeps this route from setting the service's memory ceiling. It is
/// ungated, so the size of what it is asked to build is a reviewer's choice; holding
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
    let store = state.store.clone();
    let id_for_check = id.clone();
    tokio::task::spawn_blocking(move || store.ensure_run_tree(&id_for_check))
        .await
        .map_err(|err| ApiError::internal(format!("artifact archive task failed: {err}")))?
        .map_err(map_store_error)?;

    // The id is a UUID (`ensure_run_tree` rejected anything that is not a single
    // safe path segment just above), so it cannot break out of the quoted filename
    // or inject a header.
    let disposition = format!("attachment; filename=\"run-{id}.tar.gz\"");

    // Building the archive is blocking (it reads and compresses the whole tree); it
    // runs off the async runtime so a large run does not stall other connections, and
    // it compresses into the response body as it walks rather than holding the
    // finished archive. This route is ungated, so the size of what it is asked for is
    // a reviewer's choice — see `ChannelWriter` for why that had to stop setting the
    // service's peak allocation.
    let store = state.store.clone();
    let id_for_task = id.clone();
    let body = streamed_archive(id, "run archive", move |out| {
        store.write_run_archive(&id_for_task, out)
    });

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

/// Read one media file of run `id`'s tree with `read`, off the async runtime, and
/// answer with it.
///
/// `404` only when the tree positively holds no such file. A tree that could not
/// say answers `500`: its run record is missing, unreadable or does not parse, or
/// the file is there and could not be read. The backend's snapshot refresh
/// records a file as existing nowhere on a `404` from here, and the tree is
/// deleted once its run is confirmed, so a read that failed must never answer
/// one.
async fn tree_media<T, F>(
    state: &AppState,
    id: &str,
    file: &str,
    what: &'static str,
    read: F,
    respond: fn(T) -> Response,
) -> Result<Response, ApiError>
where
    T: Send + 'static,
    F: FnOnce(&std::path::Path, &str) -> std::io::Result<Option<T>> + Send + 'static,
{
    let run_dir = state.store.run_dir(id);
    let asked = file.to_string();
    let fault = |detail: String| {
        ApiError::internal(format!("reading {what} `{file}` of run `{id}`: {detail}"))
    };
    let served = tokio::task::spawn_blocking(move || read(&run_dir, &asked))
        .await
        .map_err(|err| fault(err.to_string()))?
        .map_err(|err| fault(err.to_string()))?
        .ok_or_else(|| ApiError::not_found(format!("run `{id}` has no {what} `{file}`")))?;
    Ok(respond(served))
}

/// `GET /runs/{id}/proof/{file}` — a produced run's proof-of-implementation media
/// (`{file}` is `<proof-id>.<ext>`), resolved from the run record's
/// `validation.proofs` via [`read_proof_file`], the same resolver the worker
/// used. Ungated (browser-loaded). `404` when the run, the proof, or the file is
/// absent, and `500` when the tree could not say (see [`tree_media`]).
#[tracing::instrument(name = "artifacts.proof_file", skip(state), fields(run.id = %id), err(Debug))]
async fn proof_file(
    State(state): State<AppState>,
    Path((id, file)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    tree_media(
        &state,
        &id,
        &file,
        "proof media",
        read_proof_file,
        |served| media_response(served.content_type, served.content_encoding, served.body),
    )
    .await
}

/// `GET /runs/{id}/asset/{file}` — an asset-generation run's regenerated image,
/// final preview, or action log (or an adversarial replay), resolved from the run
/// record's `validation` frame via [`read_asset_file`], the same resolver the
/// worker used. Ungated (browser-loaded as `<img src>`/animation frames). `404`
/// when the run or the file is absent, and `500` when the tree could not say (see
/// [`tree_media`]).
#[tracing::instrument(name = "artifacts.asset_file", skip(state), fields(run.id = %id), err(Debug))]
async fn asset_file(
    State(state): State<AppState>,
    Path((id, file)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    tree_media(
        &state,
        &id,
        &file,
        "asset media",
        read_asset_file,
        |served| media_response(served.content_type, served.content_encoding, served.body),
    )
    .await
}

/// `GET /runs/{id}/validation/{file}` — a run's synthesized validation media
/// (`{file}` is the flat `<item>__<output>[.baseline].<ext>` a debug script
/// produced), resolved from the collected tree via [`read_validation_file`], the
/// same resolver the worker used. Ungated (browser-loaded). `404` when the run or
/// the media is absent, and `500` when it is there and could not be read.
#[tracing::instrument(name = "artifacts.validation_file", skip(state), fields(run.id = %id), err(Debug))]
async fn validation_file(
    State(state): State<AppState>,
    Path((id, file)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    tree_media(
        &state,
        &id,
        &file,
        "validation media",
        read_validation_file,
        |served| media_response(served.content_type, served.content_encoding, served.body),
    )
    .await
}

/// `GET /runs/{id}/showcase/{file}` — one of a run's showcase files (`{file}` is
/// the plain file name in the produced tree's `showcase/` — a carousel media file,
/// or an image the description references), resolved from the collected tree via
/// [`read_showcase_file`]. Ungated (browser-loaded). A `.json.gz` replay serves
/// as JSON travelling gzip-framed, exactly as validation replays do, so a browser
/// inflates it transparently. `404` when the run or the file is absent, and `500`
/// when it is there and could not be read.
#[tracing::instrument(name = "artifacts.showcase_file", skip(state), fields(run.id = %id), err(Debug))]
async fn showcase_file(
    State(state): State<AppState>,
    Path((id, file)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    tree_media(
        &state,
        &id,
        &file,
        "showcase file",
        read_showcase_file,
        |served| media_response(served.content_type, served.content_encoding, served.body),
    )
    .await
}

/// `GET /runs/{id}/root/{name}` — one of the files of a run's tree that sit
/// outside its media directories, under the name the backend stores it as
/// ([`TREE_ROOT_FILES`](test_cabinet_core::TREE_ROOT_FILES)): the controller
/// module an adversarial run's record names, and the code-analysis document.
///
/// The backend's snapshot refresh reads a published run's file from here when its
/// own store has lost it. The bytes are served as the tree holds them, so the
/// document arrives gzipped, exactly as the driver mirrors it into the backend
/// store. `404` for any other name and for a file the tree does not hold. `500`
/// for a file that could not be read: the refresh records a file as lost for good
/// only on a `404`, so a read that failed must not answer one.
#[tracing::instrument(name = "artifacts.root_file", skip(state), fields(run.id = %id), err(Debug))]
async fn root_file(
    State(state): State<AppState>,
    Path((id, name)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    state.store.has_run_tree(&id).map_err(map_store_error)?;
    let run_dir = state.store.run_dir(&id);
    let asked = name.clone();
    let read =
        tokio::task::spawn_blocking(move || test_cabinet_core::tree_root_file(&run_dir, &asked))
            .await
            .map_err(|err| ApiError::internal(format!("reading `{name}` of run `{id}`: {err}")))?;
    let bytes = read
        .map_err(|err| ApiError::internal(format!("reading `{name}` of run `{id}`: {err}")))?
        .ok_or_else(|| ApiError::not_found(format!("run `{id}` has no root file `{name}`")))?;
    Ok(([(header::CONTENT_TYPE, "application/octet-stream")], bytes).into_response())
}

/// Build a media response that declares both what the resource is and how the body
/// is framed.
///
/// A recording is stored gzipped and served that way, so its response says
/// `Content-Type: application/json` with `Content-Encoding: gzip` and the browser
/// inflates it before the player ever sees it. The compression layer leaves a body
/// that already declares an encoding alone, so a recording is never re-encoded on
/// its way out.
fn media_response(
    content_type: &'static str,
    content_encoding: Option<&'static str>,
    body: Vec<u8>,
) -> Response {
    let mut response = ([(header::CONTENT_TYPE, content_type)], body).into_response();
    if let Some(encoding) = content_encoding {
        response.headers_mut().insert(
            header::CONTENT_ENCODING,
            header::HeaderValue::from_static(encoding),
        );
    }
    response
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
/// traversal attempt is the client's bad upload (`400`); an archive that cannot be
/// read is the upload's own too (`422`); a read of an unknown run's tree is a
/// `404`; an I/O fault is the service's (`500`).
///
/// The split between the first two and the last is what an uploading driver acts
/// on: it gives up at once on a refusal of its tree, and holds the tree and
/// retries on a fault of the store.
fn map_store_error(err: crate::store::StoreError) -> ApiError {
    use crate::store::StoreError;
    match err {
        StoreError::Traversal(_) => ApiError::bad_request(err.to_string()),
        StoreError::Malformed(_) => ApiError::unprocessable(err.to_string()),
        StoreError::NotFound(_) => ApiError::not_found(err.to_string()),
        StoreError::Io(_) => ApiError::internal(err.to_string()),
    }
}

#[cfg(test)]
#[path = "api.test.rs"]
mod tests;

#[cfg(test)]
#[path = "api.capacity.test.rs"]
mod capacity_tests;

#[cfg(test)]
#[path = "api.spool.test.rs"]
mod spool_tests;

#[cfg(test)]
#[path = "api.stream.test.rs"]
mod stream_tests;
