//! Tests for the run endpoints' request validation and lookup behavior, driving
//! the handlers directly (no container runtime, no live run).

use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;

use test_cabinet_core::{
    Cost, HarnessSlug, RunEnvironment, RunLinks, RunMetrics, RunRecord, RunState, RunStatus,
    RunSubject, RunTooling, TokenCounts, ValidationSummary,
};

use super::{SubmitBody, list_produced, status, submit};
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

/// A worker state whose output directory is `out_dir`, for exercising the
/// produced-run listing against records on disk.
fn state_with_out_dir(out_dir: std::path::PathBuf) -> AppState {
    AppState {
        config: Arc::new(Config {
            bind: "127.0.0.1:0".to_string(),
            backend_url: "http://127.0.0.1:8787".to_string(),
            out_dir,
            work_dir: std::env::temp_dir().join("tcab-worker-test-work"),
        }),
        jobs: JobRegistry::new(),
    }
}

/// A minimal completed run record, identified by `id` and finishing at
/// `finished_at` (so listing order can be asserted).
fn record(id: &str, finished_at: &str) -> RunRecord {
    RunRecord {
        id: id.to_string(),
        started_at: "2026-06-18T18:00:00Z".to_string(),
        finished_at: finished_at.to_string(),
        subject: RunSubject {
            test_case_slug: "pong".to_string(),
            test_case_version: "v1.0.0".to_string(),
            variant: "base".to_string(),
            harness_slug: HarnessSlug::Claude,
            harness_version: None,
            model_id: "claude-haiku-4-5".to_string(),
        },
        tooling: RunTooling::default(),
        environment: RunEnvironment {
            os: "linux".to_string(),
            container_image: "img".to_string(),
            node_version: None,
        },
        metrics: RunMetrics {
            run_time_seconds: 0.0,
            tokens: TokenCounts::default(),
            cost: Cost::default(),
        },
        validation: ValidationSummary {
            loaded: true,
            detail: None,
            install: None,
            build: None,
            checks: vec![],
        },
        links: RunLinks::default(),
        status: RunStatus {
            state: RunState::Completed,
            detail: None,
        },
    }
}

/// Write a run record to disk the way a finished run does: under
/// `{out_dir}/{id}/run-record.json`.
fn write_record(out_dir: &std::path::Path, record: &RunRecord) {
    let run_dir = out_dir.join(&record.id);
    std::fs::create_dir_all(&run_dir).expect("create run dir");
    let json = serde_json::to_string(record).expect("serialize record");
    std::fs::write(run_dir.join("run-record.json"), json).expect("write record");
}

#[tokio::test]
async fn list_produced_returns_records_newest_first() {
    let out_dir = std::env::temp_dir().join("tcab-worker-list-newest");
    let _ = std::fs::remove_dir_all(&out_dir);
    write_record(&out_dir, &record("older", "2026-06-18T10:00:00Z"));
    write_record(&out_dir, &record("newer", "2026-06-18T20:00:00Z"));
    // A stray directory without a record is skipped rather than failing the list.
    std::fs::create_dir_all(out_dir.join("stray")).expect("create stray dir");

    let state = state_with_out_dir(out_dir.clone());
    let Json(runs) = list_produced(State(state)).await.expect("listing succeeds");

    assert_eq!(runs.len(), 2);
    // Newest finish time leads; each entry's id mirrors its record id, and a
    // produced run carries no review yet.
    assert_eq!(runs[0].id, "newer");
    assert_eq!(runs[0].record.id, "newer");
    assert!(runs[0].review.is_none());
    assert_eq!(runs[1].id, "older");

    let _ = std::fs::remove_dir_all(&out_dir);
}

#[tokio::test]
async fn list_produced_with_no_output_dir_is_empty() {
    let out_dir = std::env::temp_dir().join("tcab-worker-list-missing");
    let _ = std::fs::remove_dir_all(&out_dir);

    let state = state_with_out_dir(out_dir);
    let Json(runs) = list_produced(State(state)).await.expect("listing succeeds");
    assert!(runs.is_empty());
}

#[tokio::test]
async fn status_of_unknown_job_is_404() {
    let state = test_state();
    let err = status(State(state), Path("nope".to_string()))
        .await
        .expect_err("an unknown job id is a 404");
    assert_eq!(err.status, StatusCode::NOT_FOUND);
}
