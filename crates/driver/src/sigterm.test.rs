//! Tests for the driver's `SIGTERM` handling. Each runs [`run_until_shutdown`]
//! against one stub serving the backend's job routes and the artifacts service's
//! tree upload, with a fake sandbox counting its teardowns and a shutdown future
//! the test resolves.

use std::process::ExitCode;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::Json;
use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path as UrlPath, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use tempfile::TempDir;
use tokio::sync::Notify;

use super::*;
use crate::EventSink;
use crate::artifacts::TreeStore;
use crate::client::JobClient;
use crate::finish::{FinishTarget, NoMirrors, RunOutcome, finish};
use crate::job_api::JobState;
use crate::metrics::*;
use crate::run_record::*;
use crate::sink::BackendEventSink;

// --- the stub ------------------------------------------------------------------

/// One stub for the backend and the artifacts service.
#[derive(Clone, Default)]
struct Stub {
    /// How many `storing` reports are answered `503` before one is accepted.
    storing_unavailable: usize,
    /// Every status report answered `503`.
    backend_down: bool,
    /// Every status report body, in order.
    reports: Arc<Mutex<Vec<serde_json::Value>>>,
    /// The `storing` reports seen so far.
    storing_seen: Arc<AtomicUsize>,
    /// Notified when a tree upload arrives.
    tree_arrived: Arc<Notify>,
    /// Released to answer the tree upload.
    tree_release: Arc<Notify>,
}

impl Stub {
    fn reports(&self) -> Vec<serde_json::Value> {
        self.reports.lock().expect("lock").clone()
    }

    async fn serve(&self) -> String {
        let app = Router::new()
            .route("/jobs/{id}/status", post(status))
            .route("/jobs/{id}", get(poll))
            .route("/runs/{id}/artifacts", post(tree))
            .with_state(self.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind");
        let addr = listener.local_addr().expect("addr");
        tokio::spawn(async move {
            axum::serve(listener, app).await.expect("serve");
        });
        format!("http://{addr}")
    }
}

async fn status(
    State(stub): State<Stub>,
    UrlPath(_id): UrlPath<String>,
    Json(body): Json<serde_json::Value>,
) -> StatusCode {
    let storing = body["state"] == "storing";
    stub.reports.lock().expect("lock").push(body);
    if stub.backend_down {
        return StatusCode::SERVICE_UNAVAILABLE;
    }
    if storing && stub.storing_seen.fetch_add(1, Ordering::SeqCst) < stub.storing_unavailable {
        return StatusCode::SERVICE_UNAVAILABLE;
    }
    StatusCode::NO_CONTENT
}

async fn poll(UrlPath(id): UrlPath<String>) -> Response {
    Json(serde_json::json!({ "id": id, "state": JobState::Running })).into_response()
}

async fn tree(State(stub): State<Stub>, UrlPath(_id): UrlPath<String>, _body: Bytes) -> StatusCode {
    stub.tree_arrived.notify_one();
    stub.tree_release.notified().await;
    StatusCode::CREATED
}

/// A sandbox counting its teardowns, releasing the stub's tree upload on the
/// first so a run's finishing can only end after its sandbox was deleted.
struct FakeSandbox {
    teardowns: AtomicUsize,
    release: Option<Arc<Notify>>,
}

impl FakeSandbox {
    fn new(release: Option<Arc<Notify>>) -> Self {
        Self {
            teardowns: AtomicUsize::new(0),
            release,
        }
    }

    fn teardowns(&self) -> usize {
        self.teardowns.load(Ordering::SeqCst)
    }
}

impl Sandbox for FakeSandbox {
    async fn teardown(&self) -> bool {
        self.teardowns.fetch_add(1, Ordering::SeqCst);
        if let Some(release) = &self.release {
            release.notify_one();
        }
        true
    }
}

/// Sets its flag when dropped: whether the run future was dropped.
struct DropFlag(Arc<AtomicBool>);

impl Drop for DropFlag {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

fn target(client: &JobClient, report_wait: Duration) -> ShutdownTarget<'_> {
    ShutdownTarget {
        client,
        report_wait,
        attempt_timeout: None,
        sweep_interval: Duration::from_millis(10),
        events: None,
    }
}

/// A run's record.
fn record() -> RunRecord {
    RunRecord {
        id: "run-1".into(),
        started_at: "2026-06-14T10:00:00Z".into(),
        finished_at: "2026-06-14T10:05:00Z".into(),
        subject: RunSubject {
            test_case_slug: "pacman".into(),
            test_case_version: "v1.0.0".into(),
            test_type: crate::test_case::TestType::Adversarial,
            variant: "base".into(),
            harness_slug: HarnessSlug::Claude,
            harness_version: None,
            orchestrator_slug: "one-shot".into(),
            engine_slug: "none".into(),
            engine_version: None,
            model_id: "anthropic/claude-opus-4".into(),
            gg_capability_set: None,
            gg_summary: None,
        },
        tooling: RunTooling {
            test_cabinet_commit: None,
        },
        environment: RunEnvironment {
            os: "linux".into(),
            container_image: "img".into(),
            node_version: None,
            auth_mode: AuthMode::ApiKey,
        },
        metrics: RunMetrics::default(),
        validation: Default::default(),
        links: RunLinks {
            source_repo: None,
            playable_build: None,
        },
        status: RunStatus {
            state: RunState::Completed,
            detail: None,
        },
        game_jam_readme: None,
        tool_calls: Default::default(),
        game_jam_prior_entries: Vec::new(),
        seed_commit: None,
        code_analysis: None,
        toolchain: None,
        showcase: None,
    }
}

/// The failed record main builds for an interrupted run, from `state` and
/// `detail`.
fn interrupted(state: RunState, detail: &str) -> Option<RunRecord> {
    let mut record = record();
    record.status = RunStatus {
        state,
        detail: Some(detail.to_string()),
    };
    Some(record)
}

fn states(reports: &[serde_json::Value]) -> Vec<String> {
    reports
        .iter()
        .map(|body| body["state"].as_str().unwrap_or_default().to_string())
        .collect()
}

/// A run stuck in `stage` until it is dropped.
async fn stuck_in(stage: &StageCell, at: Stage, dropped: Arc<AtomicBool>) -> ExitCode {
    let _flag = DropFlag(dropped);
    stage.set(at);
    std::future::pending::<()>().await;
    ExitCode::SUCCESS
}

// --- the stage -----------------------------------------------------------------

#[test]
fn the_detail_names_the_stage() {
    assert_eq!(
        interrupted_detail(Stage::Session),
        "driver interrupted by SIGTERM during session"
    );
    assert_eq!(
        interrupted_detail(Stage::SandboxStart),
        "driver interrupted by SIGTERM during sandbox start"
    );
}

#[test]
fn a_run_at_finishing_stays_there() {
    let stage = StageCell::new();
    assert_eq!(stage.stage(), Stage::Setup);
    stage.set(Stage::Collection);
    assert_eq!(stage.stage(), Stage::Collection);
    stage.hold(&record(), None);
    assert_eq!(stage.stage(), Stage::Finishing);
    assert!(stage.holds_record());
    stage.set(Stage::Session);
    assert_eq!(stage.stage(), Stage::Finishing);
}

#[test]
fn the_backend_event_sink_moves_the_stage() {
    let (tx, _rx) = crate::sink::channel();
    let stage = Arc::new(StageCell::new());
    let mut sink = BackendEventSink::new(tx).with_stage(stage.clone());
    sink.stage(Stage::Session);
    assert_eq!(stage.stage(), Stage::Session);
}

// --- no record yet -------------------------------------------------------------

#[tokio::test]
async fn shutdown_mid_session_reports_an_infrastructure_failure_naming_the_stage() {
    let stub = Stub::default();
    let base = stub.serve().await;
    let client = JobClient::new(&base, "job-1", "job-token");
    let stage = StageCell::new();
    let sandbox = FakeSandbox::new(None);
    let dropped = Arc::new(AtomicBool::new(false));

    let exit = run_until_shutdown(
        &stage,
        stuck_in(&stage, Stage::Session, dropped.clone()),
        async {},
        &target(&client, Duration::from_secs(30)),
        &sandbox,
        interrupted,
    )
    .await;

    assert_eq!(exit, ExitCode::SUCCESS);
    assert!(dropped.load(Ordering::SeqCst), "the run future was dropped");
    let reports = stub.reports();
    assert_eq!(states(&reports), ["failed"]);
    assert_eq!(
        reports[0]["detail"],
        "driver interrupted by SIGTERM during session"
    );
    assert_eq!(reports[0]["record"]["status"]["state"], "infrastructure");
    assert_eq!(
        reports[0]["record"]["status"]["detail"],
        "driver interrupted by SIGTERM during session"
    );
    // The sandbox is deleted, and swept for once more.
    assert_eq!(sandbox.teardowns(), 2);
}

#[tokio::test]
async fn an_unbuildable_record_still_reports_the_failure() {
    let stub = Stub::default();
    let base = stub.serve().await;
    let client = JobClient::new(&base, "job-1", "job-token");
    let stage = StageCell::new();
    let sandbox = FakeSandbox::new(None);

    let exit = run_until_shutdown(
        &stage,
        stuck_in(&stage, Stage::Setup, Arc::default()),
        async {},
        &target(&client, Duration::from_secs(30)),
        &sandbox,
        |_, _| None,
    )
    .await;

    assert_eq!(exit, ExitCode::SUCCESS);
    let reports = stub.reports();
    assert_eq!(states(&reports), ["failed"]);
    assert_eq!(
        reports[0]["detail"],
        "driver interrupted by SIGTERM during setup"
    );
    assert!(reports[0].get("record").is_none_or(|r| r.is_null()));
    assert_eq!(sandbox.teardowns(), 2);
}

#[tokio::test]
async fn an_undelivered_interrupted_report_exits_non_zero_after_the_teardown() {
    let stub = Stub {
        backend_down: true,
        ..Stub::default()
    };
    let base = stub.serve().await;
    let client = JobClient::new(&base, "job-1", "job-token");
    let stage = StageCell::new();
    let sandbox = FakeSandbox::new(None);

    let exit = run_until_shutdown(
        &stage,
        stuck_in(&stage, Stage::Collection, Arc::default()),
        async {},
        &target(&client, Duration::ZERO),
        &sandbox,
        interrupted,
    )
    .await;

    assert_eq!(exit, ExitCode::FAILURE);
    assert_eq!(states(&stub.reports()), ["failed"]);
    assert_eq!(sandbox.teardowns(), 2);
}

#[tokio::test]
async fn a_run_that_ends_before_the_signal_is_untouched() {
    let stub = Stub::default();
    let base = stub.serve().await;
    let client = JobClient::new(&base, "job-1", "job-token");
    let stage = StageCell::new();
    let sandbox = FakeSandbox::new(None);

    let exit = run_until_shutdown(
        &stage,
        async { ExitCode::FAILURE },
        std::future::pending(),
        &target(&client, Duration::from_secs(30)),
        &sandbox,
        interrupted,
    )
    .await;

    assert_eq!(exit, ExitCode::FAILURE);
    assert!(stub.reports().is_empty());
    assert_eq!(sandbox.teardowns(), 0);
}

// --- holding the record --------------------------------------------------------

/// Finish `record()` against `base`, recording into `stage`.
async fn finishing(
    base: &str,
    client: &JobClient,
    out: &std::path::Path,
    stage: &StageCell,
    report_wait: Duration,
) -> ExitCode {
    let target = FinishTarget {
        client,
        artifacts_url: Some(base),
        repos_url: None,
        job_id: "job-1",
        job_token: "job-token",
        out_dir: out,
        upload_wait: Duration::from_secs(3600),
        report_wait,
        attempt_timeout: None,
        stage: Some(stage),
        events: crate::sink::RelayOutcome::Delivered,
    };
    let finished = finish(
        &target,
        Some(record()),
        RunOutcome::Succeeded,
        false,
        &NoMirrors,
    )
    .await;
    assert!(matches!(finished.tree, TreeStore::Stored), "{finished:?}");
    finished.exit_code()
}

/// A run tree for `run-1` under a new directory.
fn run_tree() -> TempDir {
    let out = TempDir::new().expect("tempdir");
    let run_dir = out.path().join("run-1");
    std::fs::create_dir_all(run_dir.join("implementation")).expect("mkdir");
    std::fs::write(run_dir.join("run-record.json"), br#"{"id":"run-1"}"#).expect("write");
    out
}

#[tokio::test]
async fn shutdown_during_the_uploads_keeps_finishing_with_the_held_report_landed() {
    let stub = Stub::default();
    let base = stub.serve().await;
    let client = JobClient::new(&base, "job-1", "job-token");
    let out = run_tree();
    let stage = StageCell::new();
    let sandbox = FakeSandbox::new(Some(stub.tree_release.clone()));
    let at_shutdown = Mutex::new(None);

    let exit = run_until_shutdown(
        &stage,
        finishing(&base, &client, out.path(), &stage, Duration::from_secs(30)),
        async {
            stub.tree_arrived.notified().await;
            *at_shutdown.lock().expect("lock") = Some((
                stage.stage(),
                stage.is_held_landed(),
                states(&stub.reports()),
            ));
        },
        &target(&client, Duration::from_secs(30)),
        &sandbox,
        interrupted,
    )
    .await;

    // The signal found the run finishing, its held report already accepted.
    let (at, landed, reports) = at_shutdown
        .lock()
        .expect("lock")
        .clone()
        .expect("shut down");
    assert_eq!(at, Stage::Finishing);
    assert!(landed);
    assert_eq!(reports, ["storing"]);
    // The sandbox was deleted (which released the upload), and the finishing went
    // on to its terminal report without a second held report.
    assert_eq!(sandbox.teardowns(), 1);
    assert_eq!(exit, ExitCode::SUCCESS);
    let reports = stub.reports();
    assert_eq!(states(&reports), ["storing", "succeeded"]);
    assert_eq!(reports[1]["artifactsStored"], true);
}

#[tokio::test]
async fn shutdown_before_the_held_report_landed_posts_it_at_once() {
    // The finishing's own held report is answered `503` and, with a zero report
    // wait, not retried: only the shutdown's post can land it.
    let stub = Stub {
        storing_unavailable: 1,
        ..Stub::default()
    };
    let base = stub.serve().await;
    let client = JobClient::new(&base, "job-1", "job-token");
    let out = run_tree();
    let stage = StageCell::new();
    let sandbox = FakeSandbox::new(Some(stub.tree_release.clone()));

    let exit = run_until_shutdown(
        &stage,
        finishing(&base, &client, out.path(), &stage, Duration::ZERO),
        async {
            stub.tree_arrived.notified().await;
            assert!(!stage.is_held_landed());
        },
        &target(&client, Duration::from_secs(30)),
        &sandbox,
        interrupted,
    )
    .await;

    assert!(stage.is_held_landed());
    assert_eq!(sandbox.teardowns(), 1);
    assert_eq!(exit, ExitCode::SUCCESS);
    let mut states = states(&stub.reports());
    states.sort();
    assert_eq!(states, ["storing", "storing", "succeeded"]);
    assert_eq!(stub.storing_seen.load(Ordering::SeqCst), 2);
}
