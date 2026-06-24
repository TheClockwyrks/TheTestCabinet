//! End-to-end tests for the artifact service's HTTP surface, driving the real
//! router over a temp-dir [`LocalFsStore`]:
//!
//! - the upload → serve round-trip (store a fake build, fetch `/runs/{id}/build`
//!   and assert the content plus the per-run base-href rewrite `serve_build_file`
//!   applies);
//! - ungated reads (a build request with no token still succeeds — browser media
//!   cannot carry one);
//! - upload auth (an upload without a valid job token is rejected).
//!
//! Only the upload check talks to an upstream (the backend, the per-job-token
//! authority), so a tiny **stub** server stands in for it: it accepts a fixed
//! "good" job token at `/jobs/{id}/verify-token`, rejecting everything else with
//! `401`. The artifact service is pointed at it, exercising the real verify code
//! path without the real backend.

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

/// Spawn the stub backend server on an ephemeral port and return its base URL. It
/// answers `/jobs/{id}/verify-token` (job token → `204` or `401`) — the only
/// upstream the artifact service calls now that reads are ungated.
async fn spawn_stub() -> String {
    let app = Router::new().route(
        "/jobs/{id}/verify-token",
        post(|body: Json<serde_json::Value>| async move {
            let presented = body.0.get("token").and_then(|t| t.as_str());
            if presented == Some(GOOD_JOB_TOKEN) {
                StatusCode::NO_CONTENT
            } else {
                StatusCode::UNAUTHORIZED
            }
        }),
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

/// Build the artifact router over a fresh temp-dir store pointed at `stub_url` for
/// both auth upstreams. Returns the router and the store (whose temp dir must
/// outlive the test).
async fn app(stub_url: &str) -> (Router, LocalFsStore, TempDir) {
    let dir = TempDir::new().unwrap();
    let store = LocalFsStore::new(dir.path()).unwrap();
    let state = AppState {
        store: Arc::new(store.clone()),
        backend_url: Arc::new(stub_url.trim_end_matches('/').to_string()),
        http: reqwest::Client::new(),
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

#[tokio::test]
async fn upload_then_serve_build_round_trips_with_base_href_rewrite() {
    let stub = spawn_stub().await;
    let (app, _store, _dir) = app(&stub).await;

    // Upload with the good job token.
    let upload = Request::builder()
        .method("POST")
        .uri("/runs/run-1/artifacts")
        .header("authorization", format!("Bearer {GOOD_JOB_TOKEN}"))
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
async fn serving_a_build_without_a_token_succeeds() {
    let stub = spawn_stub().await;
    let (app, _store, _dir) = app(&stub).await;

    // Upload first so the build exists.
    let upload = Request::builder()
        .method("POST")
        .uri("/runs/run-2/artifacts")
        .header("authorization", format!("Bearer {GOOD_JOB_TOKEN}"))
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

    // A wrong token → 401 (the backend stub rejects it).
    let upload = Request::builder()
        .method("POST")
        .uri("/runs/run-3/artifacts")
        .header("authorization", "Bearer not-the-token")
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
