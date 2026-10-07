//! End-to-end tests for the artifact service's HTTP surface, driving the real
//! router over a temp-dir [`LocalFsStore`]:
//!
//! - the upload → serve round-trip (store a fake build, fetch `/runs/{id}/build`
//!   and assert the content plus the per-run base-href rewrite `serve_build_file`
//!   applies);
//! - ungated reads (a build request with no token still succeeds — browser media
//!   cannot carry one);
//! - upload auth (an upload without a valid job token is rejected);
//! - the `tree.tar` source-tree download (round-trip, publish-job-token auth, and
//!   a `404` for an unknown run);
//! - the ungated `archive.tar.gz` run download (gzip framing, the `<run-id>/`
//!   prefix, the `Content-Disposition` filename, and a `404` for an unknown run);
//! - that both whole-tree downloads **stream** — no `Content-Length`, several body
//!   frames — because a buffered one made this pod's peak allocation a function of
//!   the largest tree any caller happened to ask for.
//!
//! The two token checks talk to an upstream (the backend, the token authority), so
//! a tiny **stub** server stands in for it: it accepts a fixed "good" job token at
//! `/jobs/{id}/verify-token` and a "good" publish-job token at
//! `/publish-jobs/{id}/verify-token`, rejecting everything else with `401`. The
//! artifact service is pointed at it, exercising the real verify code paths without
//! the real backend.

use std::io::Cursor;
use std::net::SocketAddr;
use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::routing::post;
use axum::{Json, Router};
use tempfile::TempDir;
use tower::ServiceExt;

use super::*;
use crate::store::LocalFsStore;

/// The per-job token the stub accepts at `/jobs/{id}/verify-token`.
const GOOD_JOB_TOKEN: &str = "good-job-token";
/// The **job id** the stub accepts the token for. Deliberately not equal to any
/// run id an upload uses as its path/store key, so a test that succeeds proves the
/// service verified against the job id from the `x-tcab-job-id` header, not the run
/// id in the path.
const GOOD_JOB_ID: &str = "job-1";

/// The per-publish-job token the stub accepts at `/publish-jobs/{id}/verify-token`.
const GOOD_PUBLISH_TOKEN: &str = "good-publish-token";
/// The **publish-job id** the stub accepts the publish token for. As with
/// [`GOOD_JOB_ID`], deliberately not a run id a `tree.tar` download uses as its
/// path/store key, so a passing download proves the service verified against the
/// publish-job id from the `x-tcab-publish-job-id` header, not the run id.
const GOOD_PUBLISH_JOB_ID: &str = "publish-1";

/// Spawn the stub backend server on an ephemeral port and return its base URL. It
/// answers `/jobs/{id}/verify-token` (job token → `204` or `401`) — the only
/// upstream the artifact service calls now that reads are ungated. It accepts the
/// good token only for [`GOOD_JOB_ID`], so it also asserts the service forwards the
/// header's job id rather than the upload path's run id.
async fn spawn_stub() -> String {
    let app = Router::new()
        .route(
            "/jobs/{id}/verify-token",
            post(
                |axum::extract::Path(id): axum::extract::Path<String>,
                 body: Json<serde_json::Value>| async move {
                    let presented = body.0.get("token").and_then(|t| t.as_str());
                    if id == GOOD_JOB_ID && presented == Some(GOOD_JOB_TOKEN) {
                        StatusCode::NO_CONTENT
                    } else {
                        StatusCode::UNAUTHORIZED
                    }
                },
            ),
        )
        // The publish path's analogue, the upstream the `tree.tar` download calls.
        // Accepts the good publish token only for `GOOD_PUBLISH_JOB_ID`, so a passing
        // download proves the service forwarded the header's publish-job id.
        .route(
            "/publish-jobs/{id}/verify-token",
            post(
                |axum::extract::Path(id): axum::extract::Path<String>,
                 body: Json<serde_json::Value>| async move {
                    let presented = body.0.get("token").and_then(|t| t.as_str());
                    if id == GOOD_PUBLISH_JOB_ID && presented == Some(GOOD_PUBLISH_TOKEN) {
                        StatusCode::NO_CONTENT
                    } else {
                        StatusCode::UNAUTHORIZED
                    }
                },
            ),
        );

    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
        .await
        .unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{addr}")
}

/// The shared control-plane service token the delete tests present.
const SERVICE_TOKEN: &str = "service-secret";

/// Build the artifact router over a fresh temp-dir store pointed at `stub_url` for
/// upload auth, with **deletion disabled** (no service token). Returns the router
/// and the store (whose temp dir must outlive the test).
async fn app(stub_url: &str) -> (Router, LocalFsStore, TempDir) {
    app_with_service_token(stub_url, None).await
}

/// As [`app`], but with the delete route gated on `service_token` — `Some` enables
/// deletion for callers presenting that token, `None` disables it.
async fn app_with_service_token(
    stub_url: &str,
    service_token: Option<&str>,
) -> (Router, LocalFsStore, TempDir) {
    let dir = TempDir::new().unwrap();
    let store = LocalFsStore::new(dir.path()).unwrap();
    let state = AppState {
        store: Arc::new(store.clone()),
        backend_url: Arc::new(stub_url.trim_end_matches('/').to_string()),
        http: reqwest::Client::new(),
        service_token: service_token.map(|t| Arc::new(t.to_string())),
    };
    (router(state), store, dir)
}

/// A `tar` archive of a minimal build: `implementation/dist/index.html` whose
/// `<head>` references a root-absolute asset, so the base-href rewrite is testable.
fn build_tarball() -> Vec<u8> {
    let html = b"<html><head><script src=\"/assets/app.js\"></script></head><body>hi</body></html>";
    let mut builder = tar::Builder::new(Vec::new());
    let mut header = tar::Header::new_gnu();
    header.set_size(html.len() as u64);
    header.set_mode(0o644);
    header.set_cksum();
    builder
        .append_data(
            &mut header,
            "implementation/dist/index.html",
            Cursor::new(html),
        )
        .unwrap();
    builder.into_inner().unwrap()
}

/// A `tar` archive of a richer run tree: a generated source file under
/// `implementation/`, the `run-record.json`, the recorded `events.jsonl`, and a
/// built `dist/index.html`. Used to assert what `tree.tar` carries.
fn source_tree_tarball() -> Vec<u8> {
    tarball(&[
        ("run-record.json", b"{\"id\":\"src\"}"),
        ("events.jsonl", b"{\"kind\":\"start\"}\n"),
        ("implementation/src/main.ts", b"console.log(1)"),
        ("implementation/dist/index.html", b"<html></html>"),
    ])
}

/// A `tar` archive of the given `(path, contents)` entries, relative to the run root.
fn tarball(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut builder = tar::Builder::new(Vec::new());
    for (path, contents) in entries {
        let mut header = tar::Header::new_gnu();
        header.set_size(contents.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        builder.append_data(&mut header, path, *contents).unwrap();
    }
    builder.into_inner().unwrap()
}

/// Untar a `tree.tar` response body into a `(path, contents)` map.
fn untar_to_map(archive: &[u8]) -> std::collections::BTreeMap<String, Vec<u8>> {
    let mut out = std::collections::BTreeMap::new();
    let mut reader = tar::Archive::new(Cursor::new(archive));
    for entry in reader.entries().unwrap() {
        let mut entry = entry.unwrap();
        if entry.header().entry_type().is_dir() {
            continue;
        }
        let path = entry.path().unwrap().display().to_string();
        let mut contents = Vec::new();
        std::io::copy(&mut entry, &mut contents).unwrap();
        out.insert(path, contents);
    }
    out
}

/// `len` bytes that gzip cannot shrink, from a small deterministic PRNG.
///
/// The streaming assertions need a body that is still several chunks long *after*
/// compression, which text or a repeated byte is not — a megabyte of zeros gzips to
/// about a kilobyte and would arrive in one frame whether the response streamed or
/// not, quietly passing the test it was meant to fail.
fn incompressible(len: usize) -> Vec<u8> {
    let mut state: u64 = 0x2545_f491_4f6c_dd1d;
    (0..len)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            (state >> 24) as u8
        })
        .collect()
}

/// Read a response body as an ordered list of its data frames.
///
/// The frame *count* is the observable that separates a streamed response from a
/// buffered one: a handler that builds its archive first hands the body over as a
/// single `Bytes`, however large.
async fn body_frames(body: Body) -> Vec<bytes::Bytes> {
    use futures_util::StreamExt;
    let mut stream = body.into_data_stream();
    let mut frames = Vec::new();
    while let Some(frame) = stream.next().await {
        frames.push(frame.expect("a body frame"));
    }
    frames
}

/// Concatenate `frames` into the whole body.
fn joined(frames: &[bytes::Bytes]) -> Vec<u8> {
    frames.iter().flat_map(|frame| frame.to_vec()).collect()
}

/// Upload a run tree carrying `payload` as a produced media file, so a download of
/// it is large enough to observe as more than one frame.
async fn seed_heavy_run(app: &Router, run_id: &str, payload: &[u8]) {
    let upload = Request::builder()
        .method("POST")
        .uri(format!("/runs/{run_id}/artifacts"))
        .header("authorization", format!("Bearer {GOOD_JOB_TOKEN}"))
        .header("x-tcab-job-id", GOOD_JOB_ID)
        .body(Body::from(tarball(&[
            ("run-record.json", b"{\"id\":\"heavy\"}"),
            ("implementation/dist/big.bin", payload),
        ])))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(upload).await.unwrap().status(),
        StatusCode::CREATED
    );
}

#[tokio::test]
async fn archive_streams_the_tree_instead_of_buffering_it() {
    // The regression this guards is an exit 137. `archive` is ungated — the console
    // links it as a plain download — so any reviewer could ask this long-lived pod to
    // hold a whole run tree in memory, and prod's largest trees are far past the
    // 1536Mi limit. The body arriving in several frames, with no `Content-Length`, is
    // what says the archive is being compressed into the response as the walk goes
    // rather than assembled first.
    let stub = spawn_stub().await;
    let (app, _store, _dir) = app(&stub).await;
    let payload = incompressible(2 * 1024 * 1024);
    seed_heavy_run(&app, "run-big", &payload).await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/runs/run-big/archive.tar.gz")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(
        response.headers().get("content-length").is_none(),
        "a streamed archive has no length to declare until it is finished"
    );
    // The headers that matter to the reviewer are unchanged by the streaming: the
    // body is the gzip itself, named after the run.
    assert_eq!(
        response.headers().get("content-type").unwrap(),
        "application/gzip"
    );
    assert_eq!(
        response.headers().get("content-disposition").unwrap(),
        "attachment; filename=\"run-run-big.tar.gz\""
    );

    let frames = body_frames(response.into_body()).await;
    assert!(
        frames.len() > 1,
        "the archive arrived as one frame, so it was built whole before answering"
    );
    let bytes = joined(&frames);
    let mut decoded = Vec::new();
    let mut decoder = flate2::read::GzDecoder::new(Cursor::new(&bytes[..]));
    std::io::copy(&mut decoder, &mut decoded).expect("the body is a complete gzip member");
    let entries = untar_to_map(&decoded);
    assert_eq!(
        entries
            .get("run-big/implementation/dist/big.bin")
            .map(Vec::as_slice),
        Some(&payload[..]),
        "streaming it out must produce the same archive, byte for byte"
    );
}

#[tokio::test]
async fn tree_tar_streams_the_tree_instead_of_buffering_it() {
    // Same property for the publisher's pull. It is token-gated and so cannot be
    // triggered by a reviewer, but it reads the same trees off the same pod.
    let stub = spawn_stub().await;
    let (app, _store, _dir) = app(&stub).await;
    let payload = incompressible(2 * 1024 * 1024);
    seed_heavy_run(&app, "run-big-src", &payload).await;

    let response = app
        .clone()
        .oneshot(tree_tar_request(
            "run-big-src",
            Some(GOOD_PUBLISH_TOKEN),
            Some(GOOD_PUBLISH_JOB_ID),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.headers().get("content-length").is_none());
    assert_eq!(
        response.headers().get("content-type").unwrap(),
        "application/x-tar"
    );

    let frames = body_frames(response.into_body()).await;
    assert!(frames.len() > 1, "the source tar was built whole");
    let entries = untar_to_map(&joined(&frames));
    assert_eq!(
        entries
            .get("implementation/dist/big.bin")
            .map(Vec::as_slice),
        Some(&payload[..]),
        "the publisher's tar round-trips unchanged"
    );
}

/// Build a `GET /runs/{run_id}/tree.tar` request with optional bearer token and
/// optional `x-tcab-publish-job-id` header.
fn tree_tar_request(
    run_id: &str,
    token: Option<&str>,
    publish_job_id: Option<&str>,
) -> Request<Body> {
    let mut builder = Request::builder()
        .method("GET")
        .uri(format!("/runs/{run_id}/tree.tar"));
    if let Some(token) = token {
        builder = builder.header("authorization", format!("Bearer {token}"));
    }
    if let Some(id) = publish_job_id {
        builder = builder.header("x-tcab-publish-job-id", id);
    }
    builder.body(Body::empty()).unwrap()
}

#[tokio::test]
async fn tree_tar_round_trips_source_record_and_events() {
    let stub = spawn_stub().await;
    let (app, _store, _dir) = app(&stub).await;

    // Seed a run tree. The path id (`run-src`, the store key) differs from the
    // publish-job id (`publish-1`, in the header) the publish token is verified
    // against.
    let upload = Request::builder()
        .method("POST")
        .uri("/runs/run-src/artifacts")
        .header("authorization", format!("Bearer {GOOD_JOB_TOKEN}"))
        .header("x-tcab-job-id", GOOD_JOB_ID)
        .body(Body::from(source_tree_tarball()))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(upload).await.unwrap().status(),
        StatusCode::CREATED
    );

    let response = app
        .clone()
        .oneshot(tree_tar_request(
            "run-src",
            Some(GOOD_PUBLISH_TOKEN),
            Some(GOOD_PUBLISH_JOB_ID),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let entries = untar_to_map(&bytes);

    assert_eq!(
        entries.get("run-record.json").map(Vec::as_slice),
        Some(&b"{\"id\":\"src\"}"[..]),
        "the record is in the source tar"
    );
    assert_eq!(
        entries.get("events.jsonl").map(Vec::as_slice),
        Some(&b"{\"kind\":\"start\"}\n"[..]),
        "the events are in the source tar"
    );
    assert_eq!(
        entries.get("implementation/src/main.ts").map(Vec::as_slice),
        Some(&b"console.log(1)"[..]),
        "the generated source is in the tar under its `implementation/` prefix"
    );
}

#[tokio::test]
async fn tree_tar_without_a_publish_token_is_rejected() {
    let stub = spawn_stub().await;
    let (app, _store, _dir) = app(&stub).await;

    // No token → 401.
    assert_eq!(
        app.clone()
            .oneshot(tree_tar_request("run-x", None, Some(GOOD_PUBLISH_JOB_ID)))
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );

    // A wrong token (with the right header) → 401 (the backend stub rejects it).
    assert_eq!(
        app.clone()
            .oneshot(tree_tar_request(
                "run-x",
                Some("not-the-token"),
                Some(GOOD_PUBLISH_JOB_ID),
            ))
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );

    // A good token but no `x-tcab-publish-job-id` header → 401: the service cannot
    // verify the token without the publish-job id (the run id in the path is a
    // different value the backend has no publish job for).
    assert_eq!(
        app.clone()
            .oneshot(tree_tar_request("run-x", Some(GOOD_PUBLISH_TOKEN), None))
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn tree_tar_for_an_unknown_run_is_not_found() {
    let stub = spawn_stub().await;
    let (app, _store, _dir) = app(&stub).await;

    // A valid publish token but no stored tree → 404 (auth passes, the run is
    // unknown).
    let response = app
        .clone()
        .oneshot(tree_tar_request(
            "no-such-run",
            Some(GOOD_PUBLISH_TOKEN),
            Some(GOOD_PUBLISH_JOB_ID),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn upload_then_serve_build_round_trips_with_base_href_rewrite() {
    let stub = spawn_stub().await;
    let (app, _store, _dir) = app(&stub).await;

    // Upload with the good job token. The path id (`run-1`, the store key) differs
    // from the job id (`job-1`, in the header) the token is verified against.
    let upload = Request::builder()
        .method("POST")
        .uri("/runs/run-1/artifacts")
        .header("authorization", format!("Bearer {GOOD_JOB_TOKEN}"))
        .header("x-tcab-job-id", GOOD_JOB_ID)
        .body(Body::from(build_tarball()))
        .unwrap();
    let response = app.clone().oneshot(upload).await.unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);

    // Serve the build root with no token — reads are ungated.
    let get = Request::builder()
        .method("GET")
        .uri("/runs/run-1/build")
        .body(Body::empty())
        .unwrap();
    let response = app.clone().oneshot(get).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let html = String::from_utf8(bytes.to_vec()).unwrap();

    // `serve_build_file` injected the per-run base and de-absolutized the asset ref.
    assert!(
        html.contains("<base href=\"/runs/run-1/build/\">"),
        "base href injected; got: {html}"
    );
    assert!(
        html.contains("src=\"assets/app.js\""),
        "root-absolute asset de-absolutized; got: {html}"
    );
}

#[tokio::test]
async fn serving_the_trailing_slash_build_root_succeeds() {
    let stub = spawn_stub().await;
    let (app, _store, _dir) = app(&stub).await;

    // Upload first so the build exists.
    let upload = Request::builder()
        .method("POST")
        .uri("/runs/run-slash/artifacts")
        .header("authorization", format!("Bearer {GOOD_JOB_TOKEN}"))
        .header("x-tcab-job-id", GOOD_JOB_ID)
        .body(Body::from(build_tarball()))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(upload).await.unwrap().status(),
        StatusCode::CREATED
    );

    // The build link the driver emits — and the console loads into its iframe — is
    // `/runs/{id}/build/` *with* a trailing slash (it doubles as the build's
    // `<base href>`). It must serve the `index.html`, not 404: the bare-root and
    // `{*path}` routes alone leave this exact link unmatched.
    let get = Request::builder()
        .method("GET")
        .uri("/runs/run-slash/build/")
        .body(Body::empty())
        .unwrap();
    let response = app.clone().oneshot(get).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let html = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(
        html.contains("<base href=\"/runs/run-slash/build/\">"),
        "trailing-slash build root serves the rewritten index.html; got: {html}"
    );
}

#[tokio::test]
async fn serving_a_build_without_a_token_succeeds() {
    let stub = spawn_stub().await;
    let (app, _store, _dir) = app(&stub).await;

    // Upload first so the build exists.
    let upload = Request::builder()
        .method("POST")
        .uri("/runs/run-2/artifacts")
        .header("authorization", format!("Bearer {GOOD_JOB_TOKEN}"))
        .header("x-tcab-job-id", GOOD_JOB_ID)
        .body(Body::from(build_tarball()))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(upload).await.unwrap().status(),
        StatusCode::CREATED
    );

    // No token → still served: the console loads build/media as browser requests
    // (`<img>`/`<iframe>`/relative sub-resources) that carry no Authorization
    // header, so reads are ungated and rely on the private-network boundary.
    let get = Request::builder()
        .method("GET")
        .uri("/runs/run-2/build")
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        app.clone().oneshot(get).await.unwrap().status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn uploading_without_a_job_token_is_rejected() {
    let stub = spawn_stub().await;
    let (app, store, _dir) = app(&stub).await;

    // No token → 401, nothing stored.
    let upload = Request::builder()
        .method("POST")
        .uri("/runs/run-3/artifacts")
        .body(Body::from(build_tarball()))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(upload).await.unwrap().status(),
        StatusCode::UNAUTHORIZED
    );

    // A wrong token → 401 (the backend stub rejects it). Carries the job-id header
    // so the request reaches the token verify rather than failing the header check.
    let upload = Request::builder()
        .method("POST")
        .uri("/runs/run-3/artifacts")
        .header("authorization", "Bearer not-the-token")
        .header("x-tcab-job-id", GOOD_JOB_ID)
        .body(Body::from(build_tarball()))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(upload).await.unwrap().status(),
        StatusCode::UNAUTHORIZED
    );

    assert!(
        !store.run_dir("run-3").exists(),
        "a rejected upload stored nothing"
    );
}

#[tokio::test]
async fn uploading_without_the_job_id_header_is_rejected() {
    let stub = spawn_stub().await;
    let (app, store, _dir) = app(&stub).await;

    // A good token but no `x-tcab-job-id` header → 401: the service cannot verify
    // the token without the job id (the run id in the path is a different value the
    // backend has no job for). This is the regression that left every produced
    // run's artifacts unstored — the driver uploaded under the run id and the
    // verify hit `/jobs/{run-id}/verify-token`, which never matched.
    let upload = Request::builder()
        .method("POST")
        .uri("/runs/run-4/artifacts")
        .header("authorization", format!("Bearer {GOOD_JOB_TOKEN}"))
        .body(Body::from(build_tarball()))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(upload).await.unwrap().status(),
        StatusCode::UNAUTHORIZED
    );

    // And a job-id header that is not the run id but also not a real job → 401: the
    // header value, not the path, is what is verified.
    let upload = Request::builder()
        .method("POST")
        .uri("/runs/run-4/artifacts")
        .header("authorization", format!("Bearer {GOOD_JOB_TOKEN}"))
        .header("x-tcab-job-id", "not-a-job")
        .body(Body::from(build_tarball()))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(upload).await.unwrap().status(),
        StatusCode::UNAUTHORIZED
    );

    assert!(
        !store.run_dir("run-4").exists(),
        "a rejected upload stored nothing"
    );
}

/// Upload a stored tree under `run_id` so a delete test has something to remove.
async fn seed_upload(app: &Router, run_id: &str) {
    let upload = Request::builder()
        .method("POST")
        .uri(format!("/runs/{run_id}/artifacts"))
        .header("authorization", format!("Bearer {GOOD_JOB_TOKEN}"))
        .header("x-tcab-job-id", GOOD_JOB_ID)
        .body(Body::from(build_tarball()))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(upload).await.unwrap().status(),
        StatusCode::CREATED
    );
}

fn delete_request(run_id: &str, token: Option<&str>) -> Request<Body> {
    let mut builder = Request::builder()
        .method("DELETE")
        .uri(format!("/runs/{run_id}/artifacts"));
    if let Some(token) = token {
        builder = builder.header("authorization", format!("Bearer {token}"));
    }
    builder.body(Body::empty()).unwrap()
}

#[tokio::test]
async fn deleting_with_the_service_token_removes_the_tree() {
    let stub = spawn_stub().await;
    let (app, store, _dir) = app_with_service_token(&stub, Some(SERVICE_TOKEN)).await;
    seed_upload(&app, "run-del").await;
    assert!(store.run_dir("run-del").exists());

    let response = app
        .clone()
        .oneshot(delete_request("run-del", Some(SERVICE_TOKEN)))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert!(
        !store.run_dir("run-del").exists(),
        "the run's tree was removed"
    );

    // Idempotent: deleting again (no tree now) still succeeds.
    let response = app
        .clone()
        .oneshot(delete_request("run-del", Some(SERVICE_TOKEN)))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn deleting_without_or_with_a_wrong_token_is_rejected_and_keeps_the_tree() {
    let stub = spawn_stub().await;
    let (app, store, _dir) = app_with_service_token(&stub, Some(SERVICE_TOKEN)).await;
    seed_upload(&app, "run-keep").await;

    // No token, then a wrong token → 401 both times, tree untouched.
    for token in [None, Some("not-the-secret")] {
        let response = app
            .clone()
            .oneshot(delete_request("run-keep", token))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
    assert!(
        store.run_dir("run-keep").exists(),
        "a rejected delete left the tree in place"
    );
}

#[tokio::test]
async fn deleting_when_no_service_token_is_configured_is_disabled() {
    let stub = spawn_stub().await;
    // Deletion disabled (no service token): even a bearer token is rejected.
    let (app, store, _dir) = app_with_service_token(&stub, None).await;
    seed_upload(&app, "run-disabled").await;

    let response = app
        .clone()
        .oneshot(delete_request("run-disabled", Some(SERVICE_TOKEN)))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(store.run_dir("run-disabled").exists());
}

#[tokio::test]
async fn cors_preflight_covers_the_authorization_header() {
    // A browser preflight for a request carrying a bearer token: the CORS layer must
    // echo `Authorization` back in `Access-Control-Allow-Headers`. `permissive()`'s
    // `*` does not cover `Authorization` per the Fetch spec, so a plain permissive
    // layer leaves it uncovered and the browser blocks the request.
    let (app, _store, _dir) = app("http://backend.invalid").await;

    let preflight = Request::builder()
        .method("OPTIONS")
        .uri("/runs/run-x/asset/mesh-0.glb")
        .header("Origin", "http://console.example")
        .header("Access-Control-Request-Method", "GET")
        .header("Access-Control-Request-Headers", "authorization")
        .body(Body::empty())
        .unwrap();

    let response = app.oneshot(preflight).await.unwrap();
    let allow = response
        .headers()
        .get("access-control-allow-headers")
        .expect("preflight response carries allow-headers")
        .to_str()
        .unwrap()
        .to_ascii_lowercase();
    assert!(
        allow.contains("authorization"),
        "allow-headers must cover Authorization, got {allow:?}"
    );
}

#[tokio::test]
async fn archive_downloads_the_whole_run_tree_ungated() {
    let stub = spawn_stub().await;
    let (app, _store, _dir) = app(&stub).await;

    let upload = Request::builder()
        .method("POST")
        .uri("/runs/run-arc/artifacts")
        .header("authorization", format!("Bearer {GOOD_JOB_TOKEN}"))
        .header("x-tcab-job-id", GOOD_JOB_ID)
        .body(Body::from(source_tree_tarball()))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(upload).await.unwrap().status(),
        StatusCode::CREATED
    );

    // No `Authorization` header at all: the console links this as an ordinary
    // download, which cannot carry one — the same posture as the build/media reads.
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/runs/run-arc/archive.tar.gz")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let headers = response.headers().clone();
    assert_eq!(
        headers.get("content-type").unwrap(),
        "application/gzip",
        "the body is gzip, not a plain tar"
    );
    // The console's link is cross-origin, where the anchor's `download` attribute is
    // ignored — so the filename has to come from the response.
    assert_eq!(
        headers.get("content-disposition").unwrap(),
        "attachment; filename=\"run-run-arc.tar.gz\"",
        "the download names itself after the run"
    );

    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let mut decoded = Vec::new();
    let mut decoder = flate2::read::GzDecoder::new(Cursor::new(&bytes[..]));
    std::io::copy(&mut decoder, &mut decoded).expect("the body is gzip-framed");
    let entries = untar_to_map(&decoded);

    assert_eq!(
        entries.get("run-arc/run-record.json").map(Vec::as_slice),
        Some(&b"{\"id\":\"src\"}"[..]),
        "the tree arrives under a `<run-id>/` prefix, as the extract script produced"
    );
    assert!(entries.contains_key("run-arc/implementation/src/main.ts"));
    assert!(entries.contains_key("run-arc/events.jsonl"));
}

#[tokio::test]
async fn archive_for_an_unknown_run_is_not_found() {
    let stub = spawn_stub().await;
    let (app, _store, _dir) = app(&stub).await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/runs/no-such-run/archive.tar.gz")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn a_text_build_file_is_gzipped_for_a_client_that_accepts_it() {
    let stub = spawn_stub().await;
    let (app, _store, _dir) = app(&stub).await;

    let upload = Request::builder()
        .method("POST")
        .uri("/runs/run-gz/artifacts")
        .header("authorization", format!("Bearer {GOOD_JOB_TOKEN}"))
        .header("x-tcab-job-id", GOOD_JOB_ID)
        .body(Body::from(build_tarball()))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(upload).await.unwrap().status(),
        StatusCode::CREATED
    );

    // The build's HTML/JS/CSS is the bulk of what a reviewer pulls over whatever
    // link they have, and is what the compression layer exists for.
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/runs/run-gz/build")
                .header("accept-encoding", "gzip")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers().get("content-encoding").unwrap(),
        "gzip",
        "a text build file should be gzipped for a client that accepts it"
    );
}

#[tokio::test]
async fn a_stored_recording_is_served_as_json_framed_in_gzip() {
    let stub = spawn_stub().await;
    let (app, _store, _dir) = app(&stub).await;

    // Gzip magic followed by a stub member body; the route serves what is stored, so
    // the bytes only have to be recognisable, not inflatable.
    let stored: &[u8] = &[0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00];
    let upload = Request::builder()
        .method("POST")
        .uri("/runs/run-replay/artifacts")
        .header("authorization", format!("Bearer {GOOD_JOB_TOKEN}"))
        .header("x-tcab-job-id", GOOD_JOB_ID)
        .body(Body::from(tarball(&[(
            "implementation/.vendor/validation/no-tunnel__serve.json.gz",
            stored,
        )])))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(upload).await.unwrap().status(),
        StatusCode::CREATED
    );

    // A recording is a JSON document that travels compressed, so the response says
    // both halves and the browser inflates it before the replay player sees a byte.
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/runs/run-replay/validation/no-tunnel__serve.json.gz")
                .header("accept-encoding", "gzip")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers().get("content-type").unwrap(),
        "application/json"
    );
    assert_eq!(response.headers().get("content-encoding").unwrap(), "gzip");
    // Declaring the framing must not invite the compression layer to add a second
    // one: the body is the stored member, byte for byte.
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(body.as_ref(), stored);
}

#[tokio::test]
async fn the_pre_compressed_archive_is_not_re_encoded() {
    let stub = spawn_stub().await;
    let (app, _store, _dir) = app(&stub).await;

    let upload = Request::builder()
        .method("POST")
        .uri("/runs/run-gz2/artifacts")
        .header("authorization", format!("Bearer {GOOD_JOB_TOKEN}"))
        .header("x-tcab-job-id", GOOD_JOB_ID)
        .body(Body::from(source_tree_tarball()))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(upload).await.unwrap().status(),
        StatusCode::CREATED
    );

    // `archive.tar.gz` is served already gzipped (`application/gzip`). Re-encoding
    // it would spend CPU to hand back slightly larger bytes, so the compression
    // layer's predicate excludes that content type — this is the regression guard
    // for that exclusion.
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/runs/run-gz2/archive.tar.gz")
                .header("accept-encoding", "gzip")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers().get("content-type").unwrap(),
        "application/gzip"
    );
    assert!(
        response.headers().get("content-encoding").is_none(),
        "an already-gzipped archive must not be gzipped a second time"
    );
}

/// A `GET /runs` request, optionally presenting `token` as a bearer.
fn list_request(token: Option<&str>) -> Request<Body> {
    let mut builder = Request::builder().method("GET").uri("/runs");
    if let Some(token) = token {
        builder = builder.header("authorization", format!("Bearer {token}"));
    }
    builder.body(Body::empty()).unwrap()
}

#[tokio::test]
async fn listing_with_the_service_token_reports_every_stored_tree() {
    let stub = spawn_stub().await;
    let (app, _store, _dir) = app_with_service_token(&stub, Some(SERVICE_TOKEN)).await;
    seed_upload(&app, "run-a").await;
    seed_upload(&app, "run-b").await;

    let response = app
        .clone()
        .oneshot(list_request(Some(SERVICE_TOKEN)))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let runs = body.get("runs").unwrap().as_array().unwrap();

    let mut ids: Vec<&str> = runs
        .iter()
        .map(|run| run.get("id").unwrap().as_str().unwrap())
        .collect();
    ids.sort();
    assert_eq!(ids, vec!["run-a", "run-b"]);

    // Every entry carries an RFC-3339 `modifiedAt`, which is what the backend's
    // sweep measures its grace window against.
    for run in runs {
        let modified = run.get("modifiedAt").unwrap().as_str().unwrap();
        time::OffsetDateTime::parse(modified, &time::format_description::well_known::Rfc3339)
            .unwrap_or_else(|err| panic!("`{modified}` is not RFC 3339: {err}"));
    }

    // A deleted tree leaves the listing, so the two management routes agree on what
    // the store holds.
    assert_eq!(
        app.clone()
            .oneshot(delete_request("run-a", Some(SERVICE_TOKEN)))
            .await
            .unwrap()
            .status(),
        StatusCode::NO_CONTENT
    );
    let response = app
        .clone()
        .oneshot(list_request(Some(SERVICE_TOKEN)))
        .await
        .unwrap();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let runs = body.get("runs").unwrap().as_array().unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].get("id").unwrap().as_str(), Some("run-b"));
}

#[tokio::test]
async fn listing_without_or_with_a_wrong_token_is_rejected() {
    let stub = spawn_stub().await;
    let (app, _store, _dir) = app_with_service_token(&stub, Some(SERVICE_TOKEN)).await;
    seed_upload(&app, "run-a").await;

    for token in [None, Some("not-the-secret")] {
        let response = app.clone().oneshot(list_request(token)).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
}

#[tokio::test]
async fn listing_when_no_service_token_is_configured_is_disabled() {
    let stub = spawn_stub().await;
    // Tree management disabled (no service token): even a bearer token is rejected,
    // exactly as the delete route is.
    let (app, _store, _dir) = app_with_service_token(&stub, None).await;
    seed_upload(&app, "run-a").await;

    let response = app
        .clone()
        .oneshot(list_request(Some(SERVICE_TOKEN)))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}
