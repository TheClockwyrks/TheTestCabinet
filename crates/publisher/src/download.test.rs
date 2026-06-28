//! Tests for the source-tree download + untar against a stub artifact service.
//!
//! A small axum server stands in for the artifact service's `tree.tar` route: it
//! records the bearer token + publish-job-id header so the assertions can check the
//! download authenticates correctly, and answers with a fixture tarball whose
//! entries are the run-directory layout (`run-record.json` + `implementation/...`).
//! The test then asserts the bytes round-trip onto disk under `{dest}/{run_id}/`.

use super::*;

use std::sync::{Arc, Mutex};

use axum::Router;
use axum::extract::{Path as AxumPath, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use tokio::net::TcpListener;

/// What the stub captured about the download request.
#[derive(Debug, Clone, Default)]
struct Captured {
    /// The `{id}` the download addressed (the run/store key).
    run_id: String,
    /// The bearer token presented.
    token: Option<String>,
    /// The publish-job-id header presented.
    publish_job_id: Option<String>,
}

/// The stub's shared state: the capture slot, the tarball to serve, and the status.
#[derive(Clone)]
struct StubState {
    captured: Arc<Mutex<Option<Captured>>>,
    tarball: Arc<Vec<u8>>,
    status: StatusCode,
}

/// Build a fixture `tree.tar`: `run-record.json` and a nested
/// `implementation/index.html`, rooted at the run-directory contents exactly as the
/// driver's upload tars them.
fn fixture_tarball(record_json: &str) -> Vec<u8> {
    let mut builder = tar::Builder::new(Vec::new());
    append_file(&mut builder, "run-record.json", record_json.as_bytes());
    append_file(
        &mut builder,
        "implementation/index.html",
        b"<!doctype html><title>run</title>",
    );
    builder.into_inner().expect("finish tar")
}

/// Append one in-memory file to the tar under `path`.
fn append_file(builder: &mut tar::Builder<Vec<u8>>, path: &str, contents: &[u8]) {
    let mut header = tar::Header::new_gnu();
    header.set_size(contents.len() as u64);
    header.set_mode(0o644);
    header.set_cksum();
    builder
        .append_data(&mut header, path, contents)
        .expect("append file");
}

/// Spin up a stub artifact service serving `tarball` (or `status` when not 2xx) and
/// recording the request. Returns its base URL and the capture slot.
async fn stub_artifacts(
    tarball: Vec<u8>,
    status: StatusCode,
) -> (String, Arc<Mutex<Option<Captured>>>) {
    let captured = Arc::new(Mutex::new(None));
    let state = StubState {
        captured: captured.clone(),
        tarball: Arc::new(tarball),
        status,
    };
    let app = Router::new()
        .route("/runs/{id}/tree.tar", get(serve))
        .with_state(state);
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("addr");
    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("serve");
    });
    (format!("http://{addr}"), captured)
}

/// The stub `tree.tar` handler: record the auth, then serve the tarball (or the
/// configured error status).
async fn serve(
    State(state): State<StubState>,
    AxumPath(run_id): AxumPath<String>,
    headers: HeaderMap,
) -> Response {
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::to_string);
    let publish_job_id = headers
        .get("x-tcab-publish-job-id")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    *state.captured.lock().unwrap() = Some(Captured {
        run_id,
        token,
        publish_job_id,
    });
    if !state.status.is_success() {
        return (state.status, "boom").into_response();
    }
    (
        [(header::CONTENT_TYPE, "application/x-tar")],
        state.tarball.as_ref().clone(),
    )
        .into_response()
}

#[tokio::test]
async fn downloads_and_untars_the_run_tree() {
    let record_json = r#"{"id":"run-9"}"#;
    let (base, captured) = stub_artifacts(fixture_tarball(record_json), StatusCode::OK).await;
    let dest = tempfile::tempdir().expect("tempdir");

    let run_dir = download_run_tree(&base, "run-9", "pub-job-1", "pub-tok", dest.path())
        .await
        .expect("download should succeed");

    // Untarred under {dest}/{run_id}/ with the run-directory layout intact.
    assert_eq!(run_dir, dest.path().join("run-9"));
    assert_eq!(
        std::fs::read_to_string(run_dir.join("run-record.json")).expect("record"),
        record_json
    );
    assert!(
        run_dir.join("implementation/index.html").is_file(),
        "the nested implementation tree should round-trip"
    );

    // The download authenticated with the publish-job token, sent the publish-job id
    // in the header (not the run id, which is the path key), and addressed the run.
    let captured = captured.lock().unwrap().clone().expect("a request");
    assert_eq!(captured.run_id, "run-9");
    assert_eq!(captured.token.as_deref(), Some("pub-tok"));
    assert_eq!(captured.publish_job_id.as_deref(), Some("pub-job-1"));
}

#[tokio::test]
async fn a_rejected_download_is_surfaced_as_a_status_error() {
    let (base, _captured) = stub_artifacts(Vec::new(), StatusCode::UNAUTHORIZED).await;
    let dest = tempfile::tempdir().expect("tempdir");

    let err = download_run_tree(&base, "run-9", "pub-job-1", "bad-tok", dest.path())
        .await
        .expect_err("a 401 must surface as an error");
    match err {
        DownloadError::Status { status, .. } => {
            assert_eq!(status, reqwest::StatusCode::UNAUTHORIZED);
        }
        other => panic!("expected a Status error, got {other:?}"),
    }
}
