//! Tests for the finishing sequence: the order of its calls, the terminal report
//! and the exit code. Each runs [`finish`] against one stub serving the backend's
//! job routes, the artifacts service's tree upload and the repos service's bundle
//! upload, on a paused clock, so a minute-long outage takes no real time.

use std::path::Path;
use std::process::{Command, ExitCode};
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
use tokio::time::Instant;

use super::*;
use crate::artifacts::{TreeStore, UploadEnd};
use crate::client::JobClient;
use crate::job_api::JobState;
use crate::metrics::*;
use crate::run_record::*;

// --- the stub ------------------------------------------------------------------

/// How the stub backend answers a status report.
#[derive(Clone, Copy)]
enum Backend {
    /// `503` until this long after the stub started, then `204`.
    UnavailableFor(Duration),
    /// Never answers, status reports and polls alike.
    Silent,
}

/// How the stub artifacts service answers a tree upload.
#[derive(Clone, Copy)]
enum Artifacts {
    Accept,
    Answer(StatusCode),
    /// Takes the body and never answers.
    Hang,
}

/// One stub for all three services, logging every request it is sent in order.
#[derive(Clone)]
struct Stub {
    backend: Backend,
    artifacts: Artifacts,
    /// The job reads `canceled` once a tree upload has arrived.
    cancel_on_upload: bool,
    /// The job reads `canceled` from the start.
    canceled: bool,
    start: Instant,
    /// Every request but the polls: `storing`, `succeeded`, `tree`, `bundle`…
    log: Arc<Mutex<Vec<String>>>,
    /// Every request that was accepted, in the same form.
    accepted: Arc<Mutex<Vec<String>>>,
    /// The bodies of the status reports, in order.
    reports: Arc<Mutex<Vec<serde_json::Value>>>,
}

impl Stub {
    fn new(backend: Backend, artifacts: Artifacts) -> Self {
        Self {
            backend,
            artifacts,
            cancel_on_upload: false,
            canceled: false,
            start: Instant::now(),
            log: Arc::default(),
            accepted: Arc::default(),
            reports: Arc::default(),
        }
    }

    fn log(&self) -> Vec<String> {
        self.log.lock().expect("lock").clone()
    }

    fn accepted(&self) -> Vec<String> {
        self.accepted.lock().expect("lock").clone()
    }

    fn reports(&self) -> Vec<serde_json::Value> {
        self.reports.lock().expect("lock").clone()
    }

    fn note(&self, what: &str, accepted: bool) {
        self.log.lock().expect("lock").push(what.to_string());
        if accepted {
            self.accepted.lock().expect("lock").push(what.to_string());
        }
    }

    /// Serve the stub; returns its base URL.
    async fn serve(&self) -> String {
        let app = Router::new()
            .route("/jobs/{id}/status", post(status))
            .route("/jobs/{id}", get(poll))
            .route("/runs/{id}/artifacts", post(tree))
            .route("/runs/{id}/bundle", post(bundle))
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
    let state = body["state"].as_str().unwrap_or_default().to_string();
    stub.reports.lock().expect("lock").push(body);
    let answer = match stub.backend {
        Backend::UnavailableFor(wait) if stub.start.elapsed() >= wait => StatusCode::NO_CONTENT,
        Backend::UnavailableFor(_) => StatusCode::SERVICE_UNAVAILABLE,
        Backend::Silent => {
            stub.note(&state, false);
            return std::future::pending().await;
        }
    };
    stub.note(&state, answer.is_success());
    answer
}

async fn poll(State(stub): State<Stub>, UrlPath(id): UrlPath<String>) -> Response {
    if matches!(stub.backend, Backend::Silent) {
        return std::future::pending().await;
    }
    let uploaded = stub.log().iter().any(|what| what == "tree");
    let state = if stub.canceled || (stub.cancel_on_upload && uploaded) {
        JobState::Canceled
    } else {
        JobState::Running
    };
    Json(serde_json::json!({ "id": id, "state": state })).into_response()
}

async fn tree(State(stub): State<Stub>, UrlPath(_id): UrlPath<String>, _body: Bytes) -> StatusCode {
    let answer = match stub.artifacts {
        Artifacts::Accept => StatusCode::CREATED,
        Artifacts::Answer(status) => status,
        Artifacts::Hang => {
            stub.note("tree", false);
            return std::future::pending().await;
        }
    };
    stub.note("tree", answer.is_success());
    answer
}

async fn bundle(
    State(stub): State<Stub>,
    UrlPath(_id): UrlPath<String>,
    _body: Bytes,
) -> StatusCode {
    stub.note("bundle", true);
    StatusCode::CREATED
}

// --- the run -------------------------------------------------------------------

/// Run git in `dir`, isolated from the host's configuration.
fn git(dir: &Path, args: &[&str]) {
    let output = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .output()
        .expect("git runs");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

/// A produced run tree for `run-1` under `out_dir`: a seeded repository with a
/// static build.
fn run_tree(out_dir: &Path) {
    let run_dir = out_dir.join("run-1");
    let implementation = run_dir.join("implementation");
    std::fs::create_dir_all(implementation.join("dist")).expect("mkdir");
    std::fs::write(implementation.join("dist/index.html"), b"<!doctype html>").expect("write");
    std::fs::write(implementation.join("main.ts"), b"// seed\n").expect("write");
    std::fs::write(run_dir.join("run-record.json"), br#"{"id":"run-1"}"#).expect("write");
    git(
        &implementation,
        &["init", "--quiet", "--initial-branch", "main"],
    );
    git(&implementation, &["config", "user.name", "Clockwyrks"]);
    git(
        &implementation,
        &["config", "user.email", "runs@clockwyrks.invalid"],
    );
    git(&implementation, &["add", "main.ts"]);
    git(
        &implementation,
        &[
            "commit",
            "--quiet",
            "--message",
            crate::seeding::SEED_COMMIT_MESSAGE,
        ],
    );
}

/// A finished run's record.
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

/// Mirrors that log when they run.
struct LoggedMirrors(Arc<Mutex<Vec<String>>>);

impl Mirrors for LoggedMirrors {
    async fn mirror(&self, _record: &RunRecord) {
        self.0.lock().expect("lock").push("mirrors".into());
    }
}

/// Finish `record` against `stub` with `report_wait`.
async fn run(
    stub: &Stub,
    attempt_timeout: Option<Duration>,
    record: Option<RunRecord>,
    outcome: RunOutcome,
    already_canceled: bool,
    report_wait: Duration,
) -> Finished {
    let base = stub.serve().await;
    let out = TempDir::new().expect("tempdir");
    run_tree(out.path());
    let client = JobClient::new(&base, "job-1", "job-token");
    let target = FinishTarget {
        client: &client,
        artifacts_url: Some(&base),
        repos_url: Some(&base),
        job_id: "job-1",
        job_token: "job-token",
        out_dir: out.path(),
        upload_wait: Duration::from_secs(3600),
        report_wait,
        attempt_timeout,
        stage: None,
        events: crate::sink::RelayOutcome::Delivered,
    };
    finish(
        &target,
        record,
        outcome,
        already_canceled,
        &LoggedMirrors(stub.log.clone()),
    )
    .await
}

fn states(reports: &[serde_json::Value]) -> Vec<String> {
    reports
        .iter()
        .map(|body| body["state"].as_str().unwrap_or_default().to_string())
        .collect()
}

// --- the sequence --------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn a_backend_down_for_a_minute_delays_the_run_and_every_call_lands_once() {
    let stub = Stub::new(
        Backend::UnavailableFor(Duration::from_secs(60)),
        Artifacts::Accept,
    );

    let finished = run(
        &stub,
        None,
        Some(record()),
        RunOutcome::Succeeded,
        false,
        Duration::from_secs(21_600),
    )
    .await;

    assert_eq!(finished.held, Some(ReportEnd::Landed));
    assert_eq!(finished.tree, TreeStore::Stored);
    assert_eq!(finished.bundle_stored, Some(true));
    assert_eq!(finished.terminal, TerminalState::Succeeded);
    assert_eq!(finished.report, ReportEnd::Landed);
    assert_eq!(finished.exit_code(), ExitCode::SUCCESS);
    // The held report was retried through the outage and each call landed once, in
    // the documented order.
    assert_eq!(
        stub.accepted(),
        ["storing", "tree", "bundle", "succeeded"],
        "every call lands exactly once, in order"
    );
    let log = stub.log();
    assert!(
        log.iter().filter(|what| *what == "storing").count() > 1,
        "the 503s were retried: {log:?}"
    );
    let first_upload = log.iter().position(|what| what == "tree").expect("tree");
    let mirrors = log
        .iter()
        .position(|what| what == "mirrors")
        .expect("mirrors");
    let terminal = log
        .iter()
        .position(|what| what == "succeeded")
        .expect("succeeded");
    assert!(log[..first_upload].iter().all(|what| what == "storing"));
    assert!(first_upload < mirrors && mirrors < terminal);
    // The terminal report carries the stored tree and its build link.
    let reports = stub.reports();
    let terminal = reports.last().expect("terminal");
    assert_eq!(terminal["state"], "succeeded");
    assert_eq!(terminal["artifactsStored"], true);
    assert!(terminal.get("storeFault").is_none());
    assert_eq!(
        terminal["record"]["links"]["playableBuild"],
        "/runs/run-1/build/"
    );
}

#[tokio::test(start_paused = true)]
async fn a_tree_the_artifacts_service_refuses_as_too_large_is_tried_once_and_reported_unstored() {
    let stub = Stub::new(
        Backend::UnavailableFor(Duration::ZERO),
        Artifacts::Answer(StatusCode::PAYLOAD_TOO_LARGE),
    );

    let finished = run(
        &stub,
        None,
        Some(record()),
        RunOutcome::Succeeded,
        false,
        Duration::from_secs(21_600),
    )
    .await;

    assert_eq!(
        finished.tree,
        TreeStore::NotStored {
            end: UploadEnd::RunsOwn,
            store_fault: None
        }
    );
    assert_eq!(finished.exit_code(), ExitCode::SUCCESS);
    let log = stub.log();
    assert_eq!(
        log.iter().filter(|what| *what == "tree").count(),
        1,
        "one upload attempt: {log:?}"
    );
    // The run's own failure is not a wait on the store: no repeated storing report.
    assert_eq!(states(&stub.reports()), ["storing", "succeeded"]);
    let reports = stub.reports();
    let terminal = reports.last().expect("terminal");
    assert_eq!(terminal["artifactsStored"], false);
    assert!(terminal.get("storeFault").is_none());
    assert!(terminal["record"]["links"]["playableBuild"].is_null());
}

#[tokio::test(start_paused = true)]
async fn a_backend_that_never_answers_still_gets_the_uploads_and_the_driver_exits_non_zero() {
    let stub = Stub::new(Backend::Silent, Artifacts::Accept);
    let start = Instant::now();

    let finished = run(
        &stub,
        Some(REPORT_ATTEMPT_TIMEOUT),
        Some(record()),
        RunOutcome::Failed {
            detail: "the build failed".into(),
        },
        false,
        Duration::from_secs(5),
    )
    .await;

    assert_eq!(finished.held, Some(ReportEnd::GaveUp));
    assert_eq!(
        finished.tree,
        TreeStore::Stored,
        "the held report's deadline does not stop the uploads"
    );
    assert_eq!(finished.bundle_stored, Some(true));
    assert_eq!(finished.terminal, TerminalState::Failed);
    assert_eq!(finished.report, ReportEnd::GaveUp);
    assert_eq!(finished.exit_code(), ExitCode::FAILURE);
    let log = stub.log();
    assert_eq!(
        log.first().map(String::as_str),
        Some("storing"),
        "the held report goes first: {log:?}"
    );
    let first_upload = log.iter().position(|what| what == "tree").expect("tree");
    assert!(
        log[..first_upload].iter().all(|what| what == "storing"),
        "{log:?}"
    );
    assert!(
        log[first_upload..].iter().any(|what| what == "failed"),
        "{log:?}"
    );
    // Each unanswered attempt is abandoned and retried within the deadline.
    assert!(start.elapsed() >= REPORT_ATTEMPT_TIMEOUT * 2);
    let reports = stub.reports();
    assert_eq!(reports[0]["detail"], "the build failed");
    assert_eq!(reports[0]["record"]["id"], "run-1");
}

#[tokio::test(start_paused = true)]
async fn a_cancellation_during_the_upload_ends_it_and_the_run_is_reported_canceled() {
    let mut stub = Stub::new(Backend::UnavailableFor(Duration::ZERO), Artifacts::Hang);
    stub.cancel_on_upload = true;

    let finished = run(
        &stub,
        None,
        Some(record()),
        RunOutcome::Succeeded,
        false,
        Duration::from_secs(21_600),
    )
    .await;

    assert_eq!(
        finished.tree,
        TreeStore::NotStored {
            end: UploadEnd::Canceled,
            store_fault: None
        }
    );
    assert_eq!(finished.bundle_stored, None, "nothing more is waited on");
    assert_eq!(finished.terminal, TerminalState::Canceled);
    assert_eq!(finished.report, ReportEnd::Landed);
    assert_eq!(finished.exit_code(), ExitCode::SUCCESS);
    assert_eq!(states(&stub.reports()), ["storing", "canceled"]);
    let reports = stub.reports();
    let terminal = reports.last().expect("terminal");
    assert_eq!(
        terminal["record"]["id"], "run-1",
        "canceled carries the record"
    );
    assert_eq!(terminal["artifactsStored"], false);
    assert!(!stub.log().iter().any(|what| what == "bundle"));
}

#[tokio::test(start_paused = true)]
async fn an_already_canceled_run_still_stores_its_files_and_reports_canceled() {
    let mut stub = Stub::new(Backend::UnavailableFor(Duration::ZERO), Artifacts::Accept);
    stub.canceled = true;

    let finished = run(
        &stub,
        None,
        Some(record()),
        RunOutcome::Succeeded,
        true,
        Duration::from_secs(21_600),
    )
    .await;

    assert_eq!(finished.tree, TreeStore::Stored);
    assert_eq!(finished.bundle_stored, Some(true));
    assert_eq!(finished.terminal, TerminalState::Canceled);
    assert_eq!(stub.accepted(), ["storing", "tree", "bundle", "canceled"]);
    let reports = stub.reports();
    assert_eq!(reports.last().expect("terminal")["artifactsStored"], true);
}

#[tokio::test(start_paused = true)]
async fn a_failed_run_without_a_record_is_reported_failed_alone() {
    let stub = Stub::new(
        Backend::UnavailableFor(Duration::from_secs(10)),
        Artifacts::Accept,
    );

    let finished = run(
        &stub,
        None,
        None,
        RunOutcome::Failed {
            detail: "no sandbox".into(),
        },
        false,
        Duration::from_secs(21_600),
    )
    .await;

    assert_eq!(finished.held, None);
    assert_eq!(finished.terminal, TerminalState::Failed);
    assert_eq!(finished.report, ReportEnd::Landed);
    assert_eq!(stub.accepted(), ["failed"]);
    let reports = stub.reports();
    let terminal = reports.last().expect("terminal");
    assert_eq!(terminal["detail"], "no sandbox");
    assert!(terminal["record"].is_null());
}

#[tokio::test(start_paused = true)]
async fn a_refused_terminal_report_ends_the_finishing_successfully() {
    // The backend answers 204 to the held report and refuses everything after it.
    #[derive(Clone)]
    struct Refusing(Arc<Mutex<usize>>);
    async fn status(State(stub): State<Refusing>) -> StatusCode {
        let mut seen = stub.0.lock().expect("lock");
        *seen += 1;
        if *seen == 1 {
            StatusCode::NO_CONTENT
        } else {
            StatusCode::CONFLICT
        }
    }
    let seen = Refusing(Arc::default());
    let app = Router::new()
        .route("/jobs/{id}/status", post(status))
        .with_state(seen.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let addr = listener.local_addr().expect("addr");
    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("serve");
    });
    let client = JobClient::new(format!("http://{addr}"), "job-1", "job-token");
    let out = TempDir::new().expect("tempdir");
    let target = FinishTarget {
        client: &client,
        artifacts_url: None,
        repos_url: None,
        job_id: "job-1",
        job_token: "job-token",
        out_dir: out.path(),
        upload_wait: Duration::from_secs(3600),
        report_wait: Duration::from_secs(3600),
        attempt_timeout: None,
        stage: None,
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

    assert_eq!(finished.tree, TreeStore::NoService);
    assert_eq!(finished.report, ReportEnd::Refused);
    assert_eq!(finished.exit_code(), ExitCode::SUCCESS);
    assert_eq!(
        *seen.0.lock().expect("lock"),
        2,
        "the refusal is not retried"
    );
}

#[tokio::test(start_paused = true)]
async fn an_unanswered_report_attempt_fails_at_its_limit_and_is_retried() {
    let start = Instant::now();
    let error = timed(Some(REPORT_ATTEMPT_TIMEOUT), std::future::pending())
        .await
        .expect_err("times out");
    assert_eq!(start.elapsed(), REPORT_ATTEMPT_TIMEOUT);
    assert!(!error.is_final(), "an unanswered attempt is retried");
    assert_eq!(REPORT_ATTEMPT_TIMEOUT, Duration::from_secs(60));
}
