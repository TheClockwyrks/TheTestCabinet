//! Tests for the publish-job reporting client against a stub backend.
//!
//! A small axum server stands in for the backend's publish-job API: it records the
//! path, bearer token, and JSON body of every request so the assertions can check
//! the client hits `/publish-jobs/{id}/events` and `/result` with the per-job token
//! and the expected payloads — and that a non-2xx is surfaced as a [`ClientError`].

use super::*;

use std::sync::{Arc, Mutex};

use axum::Router;
use axum::extract::{Path as AxumPath, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use serde_json::Value;
use tokio::net::TcpListener;

/// One request the stub captured.
#[derive(Debug, Clone)]
struct Captured {
    /// The `{id}` path segment the request addressed.
    id: String,
    /// The sub-path (`events` or `result`).
    suffix: String,
    /// The bearer token presented, if any.
    token: Option<String>,
    /// The parsed JSON body.
    body: Value,
}

/// The shared state the stub records into and the status it answers with.
#[derive(Clone)]
struct StubState {
    captured: Arc<Mutex<Vec<Captured>>>,
    status: StatusCode,
}

/// Spin up a stub backend that records every publish-job request and answers
/// `status`. Returns its base URL and the capture buffer.
async fn stub_backend(status: StatusCode) -> (String, Arc<Mutex<Vec<Captured>>>) {
    let captured = Arc::new(Mutex::new(Vec::new()));
    let state = StubState {
        captured: captured.clone(),
        status,
    };
    let app = Router::new()
        .route("/publish-jobs/{id}/events", post(record))
        .route("/publish-jobs/{id}/result", post(record))
        .with_state(state);

    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("addr");
    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("serve");
    });
    (format!("http://{addr}"), captured)
}

/// The stub handler shared by both routes: record the request and answer the
/// configured status. The sub-path is recovered from the matched route.
async fn record(
    State(state): State<StubState>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
    uri: axum::http::Uri,
    body: axum::body::Bytes,
) -> StatusCode {
    let suffix = uri
        .path()
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .to_string();
    let token = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::to_string);
    let body = serde_json::from_slice(&body).unwrap_or(Value::Null);
    state.captured.lock().unwrap().push(Captured {
        id,
        suffix,
        token,
        body,
    });
    state.status
}

#[tokio::test]
async fn post_progress_hits_events_with_the_token_and_message() {
    let (base, captured) = stub_backend(StatusCode::NO_CONTENT).await;
    let client = PublishJobClient::new(base, "pub-job-1", "pub-tok");

    client
        .post_progress("creating repo")
        .await
        .expect("progress should post");

    let captured = captured.lock().unwrap();
    assert_eq!(captured.len(), 1);
    let req = &captured[0];
    assert_eq!(req.id, "pub-job-1");
    assert_eq!(req.suffix, "events");
    assert_eq!(req.token.as_deref(), Some("pub-tok"));
    assert_eq!(req.body["message"], "creating repo");
}

#[tokio::test]
async fn post_result_hits_result_with_the_links() {
    let (base, captured) = stub_backend(StatusCode::NO_CONTENT).await;
    let client = PublishJobClient::new(base, "pub-job-2", "pub-tok");

    let result = PublishResult {
        state: test_cabinet_core::PublishState::Succeeded,
        source_repo: Some("https://github.com/TheClockwyrks/tcab-pong".to_string()),
        playable_build: Some("https://abc.test-cabinet-runs.pages.dev".to_string()),
        detail: None,
    };
    client.post_result(&result).await.expect("result should post");

    let captured = captured.lock().unwrap();
    assert_eq!(captured.len(), 1);
    let req = &captured[0];
    assert_eq!(req.id, "pub-job-2");
    assert_eq!(req.suffix, "result");
    assert_eq!(req.token.as_deref(), Some("pub-tok"));
    assert_eq!(req.body["state"], "succeeded");
    assert_eq!(
        req.body["sourceRepo"],
        "https://github.com/TheClockwyrks/tcab-pong"
    );
    assert_eq!(
        req.body["playableBuild"],
        "https://abc.test-cabinet-runs.pages.dev"
    );
}

#[tokio::test]
async fn a_non_success_status_is_surfaced_as_an_error() {
    let (base, _captured) = stub_backend(StatusCode::INTERNAL_SERVER_ERROR).await;
    let client = PublishJobClient::new(base, "pub-job-3", "pub-tok");

    let err = client
        .post_progress("nope")
        .await
        .expect_err("a 500 must surface as an error");
    match err {
        ClientError::Status { what, status, .. } => {
            assert_eq!(what, "events");
            assert_eq!(status, reqwest::StatusCode::INTERNAL_SERVER_ERROR);
        }
        other => panic!("expected a Status error, got {other:?}"),
    }
}
