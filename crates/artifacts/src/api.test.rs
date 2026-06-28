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
//!   a `404` for an unknown run).
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
    let entries: &[(&str, &[u8])] = &[
        ("run-record.json", b"{\"id\":\"src\"}"),
        ("events.jsonl", b"{\"kind\":\"start\"}\n"),
        ("implementation/src/main.ts", b"console.log(1)"),
        ("implementation/dist/index.html", b"<html></html>"),
    ];
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
