//! Tests for the run endpoints' request validation and lookup behavior, driving
//! the handlers directly (no container runtime, no live run).

use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;

use super::{SubmitBody, status, submit};
use crate::api::AppState;
use crate::config::Config;
use crate::jobs::JobRegistry;

/// A worker state with an empty job registry and a throwaway config, enough to
/// exercise the handlers' validation and lookup paths.
fn test_state() -> AppState {
    AppState {
        config: Arc::new(Config {
            bind: "127.0.0.1:0".to_string(),
            backend_url: "http://127.0.0.1:8787".to_string(),
            out_dir: std::env::temp_dir().join("tcab-worker-test-out"),
            work_dir: std::env::temp_dir().join("tcab-worker-test-work"),
        }),
        jobs: JobRegistry::new(),
    }
}

/// A valid submit body, mutated per-test to exercise each empty-field rejection.
fn valid_body() -> SubmitBody {
    SubmitBody {
        test_case: "pong".to_string(),
        version: "v1.0.0".to_string(),
        variant: "base".to_string(),
        harness: test_cabinet_core::HarnessSlug::Claude,
        model: "claude-sonnet-4-5".to_string(),
        max_runtime_seconds: None,
    }
}

#[tokio::test]
async fn submit_rejects_empty_required_fields_with_400() {
    let state = test_state();

    let mut body = valid_body();
    body.test_case = "  ".to_string();
    let err = submit(State(state.clone()), Json(body))
        .await
        .expect_err("blank test case is rejected");
    assert_eq!(err.status, StatusCode::BAD_REQUEST);

    let mut body = valid_body();
    body.model = String::new();
    let err = submit(State(state), Json(body))
        .await
        .expect_err("blank model is rejected");
    assert_eq!(err.status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn submit_registers_a_job_and_accepts() {
    let state = test_state();
    assert!(state.jobs.is_empty());

    let response = submit(State(state.clone()), Json(valid_body()))
        .await
        .expect("a valid submit is accepted");
    assert_eq!(response.status(), StatusCode::ACCEPTED);

    // The submit registered exactly one job; the background task may fail to
    // start a container in this environment, but the job tracking is what we
    // assert here.
    assert_eq!(state.jobs.len(), 1);
}

#[tokio::test]
async fn status_of_unknown_job_is_404() {
    let state = test_state();
    let err = status(State(state), Path("nope".to_string()))
        .await
        .expect_err("an unknown job id is a 404");
    assert_eq!(err.status, StatusCode::NOT_FOUND);
}
