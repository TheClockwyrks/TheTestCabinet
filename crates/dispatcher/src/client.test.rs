//! Tests for the dispatcher's backend client against a stub backend.
//!
//! The stub stands in for the backend's `GET /jobs/{id}`: like the backend's
//! identity layer it answers `401` to a request that does not present
//! `Bearer <service token>`, so a read that forgets the credential fails here as
//! it would against the real backend.

use super::*;

use axum::Router;
use axum::extract::Path as AxumPath;
use axum::http::{HeaderMap, StatusCode as AxumStatus};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use tokio::net::TcpListener;

/// The service token the stub accepts.
const SERVICE_TOKEN: &str = "svc-token";

/// Answer a `GET /jobs/{id}`: `401` without the service token, `404` for the job
/// `gone`, and `running` for any other job.
async fn job(AxumPath(id): AxumPath<String>, headers: HeaderMap) -> Response {
    let presented = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    if presented != Some(&format!("Bearer {SERVICE_TOKEN}")) {
        return AxumStatus::UNAUTHORIZED.into_response();
    }
    if id == "gone" {
        return AxumStatus::NOT_FOUND.into_response();
    }
    (
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        format!(r#"{{"id":"{id}","state":"running"}}"#),
    )
        .into_response()
}

/// Spin up the stub backend and return its base URL.
async fn stub_backend() -> String {
    let app = Router::new().route("/jobs/{id}", get(job));
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("addr");
    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("serve");
    });
    format!("http://{addr}")
}

#[tokio::test]
async fn job_state_presents_the_service_token() {
    let base = stub_backend().await;
    let client = BackendClient::new(base, SERVICE_TOKEN);
    let state = client.job_state("j1").await.expect("job state");
    assert_eq!(state, Some(JobState::Running));
}

#[tokio::test]
async fn job_state_reads_an_unknown_job_as_none() {
    let base = stub_backend().await;
    let client = BackendClient::new(base, SERVICE_TOKEN);
    let state = client.job_state("gone").await.expect("job state");
    assert_eq!(state, None);
}

#[tokio::test]
async fn job_state_surfaces_a_refused_credential() {
    let base = stub_backend().await;
    let client = BackendClient::new(base, "wrong-token");
    let error = client.job_state("j1").await.expect_err("refused");
    assert!(
        matches!(
            error,
            ClientError::Status { status, .. } if status == StatusCode::UNAUTHORIZED
        ),
        "unexpected error: {error:?}"
    );
}
