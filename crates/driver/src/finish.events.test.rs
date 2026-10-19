//! Tests that every terminal status waits on the run's events: the relay settles
//! every event batch before the finishing's terminal report, and the `SIGTERM`
//! handling's `failed` report waits for every event emitted before the signal to be
//! acknowledged. Each runs the real [`relay_task`] and the real finishing (or
//! [`run_until_shutdown`]) against one stub of the backend's job routes that logs
//! every request in the order it arrived, with the answer it gave.

use std::collections::VecDeque;
use std::process::ExitCode;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::Json;
use axum::Router;
use axum::extract::{Path as UrlPath, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use tempfile::TempDir;

use super::*;
use crate::event::{HarnessEvent, HarnessEventExt, SystemStage, SystemStatus};
use crate::job_api::JobState;
use crate::metrics::*;
use crate::run_record::*;
use crate::sigterm::{Sandbox, ShutdownTarget, Stage, run_until_shutdown};
use crate::sink::{self, Outbound, RelaySender, relay_task};

// --- the stub ------------------------------------------------------------------

/// A stub backend: it answers event batches from a script, then `204`, and every
/// status report `204`, logging each request as `events <sequence> <answer>` or
/// the reported state.
#[derive(Clone, Default)]
struct Stub {
    /// The answers to the event batches, in order, before every later one is
    /// answered `204`.
    events_script: Arc<Mutex<VecDeque<u16>>>,
    /// Every event batch answered `503`, whatever the script says.
    events_down: bool,
    /// Every request, in the order it arrived.
    log: Arc<Mutex<Vec<String>>>,
    /// Every event batch body, in order.
    batches: Arc<Mutex<Vec<serde_json::Value>>>,
}

impl Stub {
    fn scripted(answers: &[u16]) -> Self {
        Self {
            events_script: Arc::new(Mutex::new(answers.iter().copied().collect())),
            ..Self::default()
        }
    }

    fn log(&self) -> Vec<String> {
        self.log.lock().expect("lock").clone()
    }

    fn batches(&self) -> Vec<serde_json::Value> {
        self.batches.lock().expect("lock").clone()
    }

    async fn serve(&self) -> String {
        let app = Router::new()
            .route("/jobs/{id}/events", post(events))
            .route("/jobs/{id}/status", post(status))
            .route("/jobs/{id}", get(poll))
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

async fn events(
    State(stub): State<Stub>,
    UrlPath(_id): UrlPath<String>,
    Json(body): Json<serde_json::Value>,
) -> StatusCode {
    let answer = if stub.events_down {
        503
    } else {
        stub.events_script
            .lock()
            .expect("lock")
            .pop_front()
            .unwrap_or(204)
    };
    let sequence = body["sequence"]
        .as_u64()
        .expect("a batch carries its sequence");
    stub.log
        .lock()
        .expect("lock")
        .push(format!("events {sequence} {answer}"));
    stub.batches.lock().expect("lock").push(body);
    StatusCode::from_u16(answer).expect("a status code")
}

async fn status(
    State(stub): State<Stub>,
    UrlPath(_id): UrlPath<String>,
    Json(body): Json<serde_json::Value>,
) -> StatusCode {
    let state = body["state"].as_str().unwrap_or_default().to_string();
    stub.log.lock().expect("lock").push(state);
    StatusCode::NO_CONTENT
}

async fn poll(UrlPath(id): UrlPath<String>) -> Response {
    Json(serde_json::json!({ "id": id, "state": JobState::Running })).into_response()
}

// --- the run -------------------------------------------------------------------

/// The relay's retry policy, with waits short enough for a test.
fn fast_policy() -> RetryPolicy {
    RetryPolicy {
        give_up_after: Duration::from_secs(30),
        delays: vec![Duration::from_millis(100)],
        ..RetryPolicy::default()
    }
}

fn event() -> HarnessEvent {
    HarnessEvent::system(SystemStage::StartContainer, SystemStatus::Started)
}

/// Spawn the relay on a new channel, and emit `count` events onto it.
fn relay_with_events(
    client: &Arc<JobClient>,
    count: usize,
) -> (RelaySender, tokio::task::JoinHandle<sink::RelayOutcome>) {
    let (tx, rx) = sink::channel();
    let task = tokio::spawn(relay_task(client.clone(), rx, fast_policy()));
    for _ in 0..count {
        tx.send(Outbound::Event(event())).expect("the relay runs");
    }
    (tx, task)
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
            test_type: crate::test_case::TestType::EndToEnd,
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

/// Settle the relay as the driver does, then finish `record` with `outcome`, no
/// artifacts or repos service in play.
async fn settle_and_finish(
    client: &JobClient,
    tx: RelaySender,
    task: tokio::task::JoinHandle<sink::RelayOutcome>,
    record: Option<RunRecord>,
    outcome: RunOutcome,
    already_canceled: bool,
) -> Finished {
    let events = sink::settle(tx, task).await;
    let out = TempDir::new().expect("tempdir");
    let target = FinishTarget {
        client,
        artifacts_url: None,
        repos_url: None,
        job_id: "job-1",
        job_token: "job-token",
        out_dir: out.path(),
        upload_wait: Duration::from_secs(30),
        report_wait: Duration::from_secs(30),
        attempt_timeout: Some(Duration::from_secs(10)),
        stage: None,
        events,
    };
    finish(&target, record, outcome, already_canceled, &NoMirrors).await
}

// --- the finishing -------------------------------------------------------------

#[tokio::test]
async fn a_batch_answered_503_then_204_is_delivered_before_the_terminal_status() {
    let stub = Stub::scripted(&[503]);
    let base = stub.serve().await;
    let client = Arc::new(JobClient::new(&base, "job-1", "job-token"));
    let (tx, task) = relay_with_events(&client, 2);

    let finished = settle_and_finish(
        &client,
        tx,
        task,
        Some(record()),
        RunOutcome::Succeeded,
        false,
    )
    .await;

    assert_eq!(
        stub.log(),
        ["events 0 503", "events 0 204", "storing", "succeeded"],
        "the batch is resent and acknowledged before the terminal status"
    );
    let batches = stub.batches();
    assert_eq!(batches[0], batches[1], "the resent batch is the same batch");
    assert_eq!(batches[1]["events"].as_array().map(Vec::len), Some(2));
    assert_eq!(finished.terminal, TerminalState::Succeeded);
    assert_eq!(finished.report, ReportEnd::Landed);
    assert_eq!(finished.exit_code(), ExitCode::SUCCESS);
}

#[tokio::test]
async fn a_failed_run_without_a_record_reports_after_its_events_are_acknowledged() {
    let stub = Stub::scripted(&[503, 502]);
    let base = stub.serve().await;
    let client = Arc::new(JobClient::new(&base, "job-1", "job-token"));
    let (tx, task) = relay_with_events(&client, 1);

    let finished = settle_and_finish(
        &client,
        tx,
        task,
        None,
        RunOutcome::Failed {
            detail: "setup failed".into(),
        },
        false,
    )
    .await;

    assert_eq!(
        stub.log(),
        ["events 0 503", "events 0 502", "events 0 204", "failed"]
    );
    assert_eq!(finished.terminal, TerminalState::Failed);
    assert_eq!(finished.report, ReportEnd::Landed);
    assert_eq!(finished.exit_code(), ExitCode::SUCCESS);
}

#[tokio::test]
async fn a_refused_batch_withholds_the_terminal_status_but_not_the_held_report() {
    let stub = Stub::scripted(&[400]);
    let base = stub.serve().await;
    let client = Arc::new(JobClient::new(&base, "job-1", "job-token"));
    let (tx, task) = relay_with_events(&client, 1);

    let finished = settle_and_finish(
        &client,
        tx,
        task,
        Some(record()),
        RunOutcome::Succeeded,
        false,
    )
    .await;

    assert_eq!(
        stub.log(),
        ["events 0 400", "storing"],
        "the held report is made and no terminal status follows it"
    );
    assert_eq!(finished.held, Some(ReportEnd::Landed));
    assert_eq!(finished.terminal, TerminalState::Succeeded);
    assert_eq!(finished.report, ReportEnd::Withheld);
    assert_eq!(finished.exit_code(), ExitCode::FAILURE);
}

#[tokio::test]
async fn a_canceled_run_with_an_unacknowledged_batch_withholds_its_canceled_status() {
    let stub = Stub::scripted(&[400]);
    let base = stub.serve().await;
    let client = Arc::new(JobClient::new(&base, "job-1", "job-token"));
    let (tx, task) = relay_with_events(&client, 1);

    let finished = settle_and_finish(
        &client,
        tx,
        task,
        Some(record()),
        RunOutcome::Canceled,
        true,
    )
    .await;

    assert_eq!(stub.log(), ["events 0 400", "storing"]);
    assert_eq!(finished.terminal, TerminalState::Canceled);
    assert_eq!(finished.report, ReportEnd::Withheld);
    assert_eq!(finished.exit_code(), ExitCode::FAILURE);
}

#[tokio::test]
async fn a_failed_run_without_a_record_and_a_refused_batch_reports_nothing() {
    let stub = Stub::scripted(&[400]);
    let base = stub.serve().await;
    let client = Arc::new(JobClient::new(&base, "job-1", "job-token"));
    let (tx, task) = relay_with_events(&client, 1);

    let finished = settle_and_finish(
        &client,
        tx,
        task,
        None,
        RunOutcome::Failed {
            detail: "setup failed".into(),
        },
        false,
    )
    .await;

    assert_eq!(stub.log(), ["events 0 400"]);
    assert_eq!(finished.terminal, TerminalState::Failed);
    assert_eq!(finished.report, ReportEnd::Withheld);
    assert_eq!(finished.exit_code(), ExitCode::FAILURE);
}

// --- SIGTERM -------------------------------------------------------------------

/// A sandbox counting its teardowns.
#[derive(Default)]
struct CountingSandbox(AtomicUsize);

impl Sandbox for CountingSandbox {
    async fn teardown(&self) -> bool {
        self.0.fetch_add(1, Ordering::SeqCst);
        true
    }
}

/// Run a job interrupted mid-session: it emits one event, then waits until the
/// stub has received its batch, when `SIGTERM` lands. The relay keeps running
/// beside it, as the driver's spawned relay does.
async fn interrupted_run(stub: &Stub, report_wait: Duration) -> (ExitCode, usize) {
    let base = stub.serve().await;
    let client = Arc::new(JobClient::new(&base, "job-1", "job-token"));
    let (tx, _task) = relay_with_events(&client, 0);
    let progress = tx.progress();
    let stage = crate::sigterm::StageCell::new();
    let sandbox = CountingSandbox::default();
    let run = async {
        stage.set(Stage::Session);
        tx.send(Outbound::Event(event())).expect("the relay runs");
        std::future::pending::<()>().await;
        ExitCode::SUCCESS
    };
    let log = stub.log.clone();
    let shutdown = async move {
        while log.lock().expect("lock").is_empty() {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    };
    let target = ShutdownTarget {
        client: &client,
        report_wait,
        attempt_timeout: Some(Duration::from_secs(10)),
        sweep_interval: Duration::from_millis(10),
        events: Some(&progress),
    };
    let exit = run_until_shutdown(&stage, run, shutdown, &target, &sandbox, |_, _| None).await;
    (exit, sandbox.0.load(Ordering::SeqCst))
}

#[tokio::test]
async fn an_interrupted_run_is_reported_failed_only_after_its_events_are_acknowledged() {
    let stub = Stub::scripted(&[503]);

    let (exit, teardowns) = interrupted_run(&stub, Duration::from_secs(30)).await;

    assert_eq!(stub.log(), ["events 0 503", "events 0 204", "failed"]);
    assert_eq!(exit, ExitCode::SUCCESS);
    assert_eq!(teardowns, 2);
}

#[tokio::test]
async fn an_interrupted_run_whose_events_are_not_acknowledged_in_time_reports_nothing() {
    let stub = Stub {
        events_down: true,
        ..Stub::default()
    };

    let (exit, teardowns) = interrupted_run(&stub, Duration::from_millis(500)).await;

    let log = stub.log();
    assert!(
        log.iter().all(|entry| entry == "events 0 503"),
        "no status is reported: {log:?}"
    );
    assert_eq!(
        exit,
        ExitCode::FAILURE,
        "the withheld report fails the driver"
    );
    assert_eq!(teardowns, 2, "the sandbox is still deleted");
}
