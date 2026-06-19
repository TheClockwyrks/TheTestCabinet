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

use super::{SubmitBody, build_path, build_root, list_active, list_produced, status, submit};
use crate::api::AppState;
use crate::config::Config;
use crate::jobs::{JobRegistry, RunSummary};
use crate::notify::WorkerNotifier;

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
        notifier: WorkerNotifier::new(),
        metrics: crate::metrics::Metrics::new(),
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
        notifier: WorkerNotifier::new(),
        metrics: crate::metrics::Metrics::new(),
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
            proofs: vec![],
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

/// Write a static build beside a run's implementation, the way a finished run's
/// collected output sits at `{out_dir}/{id}/implementation/dist/`.
fn write_build(out_dir: &std::path::Path, id: &str, files: &[(&str, &str)]) {
    let build = out_dir.join(id).join("implementation").join("dist");
    for (rel, contents) in files {
        let target = build.join(rel);
        std::fs::create_dir_all(target.parent().unwrap()).expect("create build dirs");
        std::fs::write(target, contents).expect("write build file");
    }
}

#[tokio::test]
async fn list_produced_sets_playable_build_only_when_a_build_exists() {
    let out_dir = std::env::temp_dir().join("tcab-worker-playable-link");
    let _ = std::fs::remove_dir_all(&out_dir);
    write_record(&out_dir, &record("with-build", "2026-06-18T20:00:00Z"));
    write_record(&out_dir, &record("no-build", "2026-06-18T10:00:00Z"));
    // Only `with-build` collected a static build, so only it gets a playable link
    // — the worker serves it at `/runs/{id}/build/` for review before publishing.
    write_build(&out_dir, "with-build", &[("index.html", "<html></html>")]);

    let state = state_with_out_dir(out_dir.clone());
    let Json(runs) = list_produced(State(state)).await.expect("listing succeeds");
    let by_id = |id: &str| runs.iter().find(|r| r.id == id).expect("run present");
    assert_eq!(
        by_id("with-build").record.links.playable_build.as_deref(),
        Some("/runs/with-build/build/"),
    );
    assert!(by_id("no-build").record.links.playable_build.is_none());

    let _ = std::fs::remove_dir_all(&out_dir);
}

#[tokio::test]
async fn build_root_serves_relocated_index_and_unknown_run_is_404() {
    let out_dir = std::env::temp_dir().join("tcab-worker-build-serve");
    let _ = std::fs::remove_dir_all(&out_dir);
    write_build(
        &out_dir,
        "run1",
        &[(
            "index.html",
            "<html><head><script src=\"/assets/x.js\"></script></head><body></body></html>",
        )],
    );
    let state = state_with_out_dir(out_dir.clone());

    let res = build_root(State(state.clone()), Path("run1".to_string()))
        .await
        .expect("the build index serves");
    assert_eq!(res.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .expect("read body");
    let html = String::from_utf8(bytes.to_vec()).expect("utf-8 body");
    // The build is relocated under its per-run base: the base tag is injected and
    // the absolute asset reference is de-absolutized so it resolves there.
    assert!(html.contains("<base href=\"/runs/run1/build/\">"));
    assert!(html.contains("src=\"assets/x.js\""));

    // A run with no build on disk is a 404.
    let err = build_root(State(state), Path("ghost".to_string()))
        .await
        .expect_err("a missing build is a 404");
    assert_eq!(err.status, StatusCode::NOT_FOUND);

    let _ = std::fs::remove_dir_all(&out_dir);
}

#[tokio::test]
async fn build_path_serves_assets_and_refuses_traversal() {
    let out_dir = std::env::temp_dir().join("tcab-worker-build-asset");
    let _ = std::fs::remove_dir_all(&out_dir);
    write_build(&out_dir, "run1", &[("assets/x.js", "console.log('hi')")]);
    // A secret beside the build that a traversal must not reach.
    std::fs::write(
        out_dir.join("run1").join("implementation").join("secret"),
        "nope",
    )
    .expect("write secret");
    let state = state_with_out_dir(out_dir.clone());

    let res = build_path(
        State(state.clone()),
        Path(("run1".to_string(), "assets/x.js".to_string())),
    )
    .await
    .expect("the asset serves");
    assert_eq!(res.status(), StatusCode::OK);

    let err = build_path(
        State(state),
        Path(("run1".to_string(), "../secret".to_string())),
    )
    .await
    .expect_err("a traversal is refused");
    assert_eq!(err.status, StatusCode::NOT_FOUND);

    let _ = std::fs::remove_dir_all(&out_dir);
}

#[tokio::test]
async fn list_active_reports_running_jobs_only() {
    let state = test_state();
    let running = state.jobs.create(RunSummary {
        test_case_slug: "pong".to_string(),
        variant: "base".to_string(),
        harness_slug: "claude".to_string(),
        model_id: "claude-haiku-4-5".to_string(),
    });
    let done = state.jobs.create(RunSummary {
        test_case_slug: "snake".to_string(),
        variant: "base".to_string(),
        harness_slug: "claude".to_string(),
        model_id: "claude-haiku-4-5".to_string(),
    });
    done.finish_failed("never started");

    let Json(active) = list_active(State(state)).await;
    assert_eq!(active.len(), 1, "only the still-running job is active");
    assert_eq!(active[0].run_id, running.id());
    assert_eq!(active[0].summary.test_case_slug, "pong");
    assert_eq!(active[0].state, "running");
}

#[tokio::test]
async fn status_of_unknown_job_is_404() {
    let state = test_state();
    let err = status(State(state), Path("nope".to_string()))
        .await
        .expect_err("an unknown job id is a 404");
    assert_eq!(err.status, StatusCode::NOT_FOUND);
}
