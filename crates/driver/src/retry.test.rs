//! Tests for the finishing calls' shared retry policy: the delays, the deadline
//! counted from the first failure, the backend's refusals, and the cancellation that
//! ends a wait. The report tests run the driver's [`JobClient`] against a stub
//! backend on a paused clock, so an hour-long wait takes no real time.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::Json;
use axum::Router;
use axum::extract::{Path as UrlPath, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use tokio::time::Instant;

use super::*;
use crate::client::{ClientError, JobClient, StoreFields};
use crate::job_api::JobState;
use crate::metrics::*;
use crate::run_record::*;

// --- the policy ----------------------------------------------------------------

#[test]
fn the_waits_double_to_forty_seconds_then_hold_at_sixty() {
    let policy = RetryPolicy::default();
    let delays: Vec<u64> = (1..=7).map(|n| policy.delay_after(n).as_secs()).collect();
    assert_eq!(delays, vec![5, 10, 20, 40, 60, 60, 60]);
    assert_eq!(policy.give_up_after, Duration::from_secs(21_600));
    assert_eq!(policy.stall_limit, Duration::from_secs(300));
    assert_eq!(DEFAULT_REPORT_WAIT, Duration::from_secs(21_600));
    assert_eq!(CANCEL_POLL_INTERVAL, Duration::from_secs(3));
}

#[test]
fn a_canceled_run_waits_at_most_ten_minutes_or_the_shorter_configured_wait() {
    assert_eq!(
        RetryPolicy::default().for_canceled_run().give_up_after,
        Duration::from_secs(600)
    );
    assert_eq!(
        RetryPolicy::waiting_for(Duration::from_secs(30))
            .for_canceled_run()
            .give_up_after,
        Duration::from_secs(30)
    );
}

#[test]
fn only_a_4xx_other_than_408_and_429_is_a_refusal() {
    let status = |code: u16| ClientError::Status {
        what: "status",
        status: reqwest::StatusCode::from_u16(code).expect("status"),
        body: String::new(),
    };
    for code in [400, 401, 403, 404, 409, 410, 413, 422] {
        assert!(status(code).is_refused(), "{code} is a refusal");
        assert!(status(code).is_final(), "{code} ends the call");
    }
    for code in [408, 429, 500, 502, 503, 504, 302] {
        assert!(!status(code).is_refused(), "{code} is retried");
    }
}

// --- the loop, over scripted attempts --------------------------------------------

/// A scripted attempt's failure.
#[derive(Debug)]
struct Scripted {
    is_final: bool,
}

impl std::fmt::Display for Scripted {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "scripted failure (final: {})", self.is_final)
    }
}

impl FinalFailure for Scripted {
    fn is_final(&self) -> bool {
        self.is_final
    }
}

/// The seconds since `start` of each instant in `at`.
fn offsets(start: Instant, at: &[Instant]) -> Vec<u64> {
    at.iter().map(|t| (*t - start).as_secs()).collect()
}

#[tokio::test(start_paused = true)]
async fn attempts_follow_the_delay_sequence_until_one_lands() {
    let start = Instant::now();
    let at = Mutex::new(Vec::new());
    let result = retry_call(
        &RetryPolicy::waiting_for(Duration::from_secs(3600)),
        "scripted",
        std::future::pending(),
        || async {
            let mut at = at.lock().expect("lock");
            at.push(Instant::now());
            if at.len() < 7 {
                Err(Scripted { is_final: false })
            } else {
                Ok(at.len())
            }
        },
    )
    .await;
    assert_eq!(result.expect("lands"), 7);
    assert_eq!(
        offsets(start, &at.lock().expect("lock")),
        vec![0, 5, 15, 35, 75, 135, 195]
    );
}

#[tokio::test(start_paused = true)]
async fn the_deadline_is_counted_from_the_first_failure() {
    let start = Instant::now();
    let at = Mutex::new(Vec::new());
    let failure = retry_call(
        &RetryPolicy::waiting_for(Duration::from_secs(30)),
        "scripted",
        std::future::pending(),
        || async {
            let first = at.lock().expect("lock").is_empty();
            if first {
                // A first attempt that takes longer than the whole wait costs the
                // call none of it.
                tokio::time::sleep(Duration::from_secs(100)).await;
            }
            at.lock().expect("lock").push(Instant::now());
            Err::<(), _>(Scripted { is_final: false })
        },
    )
    .await
    .expect_err("gives up");
    assert_eq!(failure.end, RetryEnd::GaveUp);
    assert!(failure.error.is_some());
    // 100 s for the first failure, then 5, 10 and a last delay cut from 20 to the
    // 15 s left of the 30 s wait.
    assert_eq!(
        offsets(start, &at.lock().expect("lock")),
        vec![100, 105, 115, 130]
    );
}

#[tokio::test(start_paused = true)]
async fn a_zero_wait_makes_a_single_attempt() {
    let attempts = AtomicUsize::new(0);
    let failure = retry_call(
        &RetryPolicy::waiting_for(Duration::ZERO),
        "scripted",
        std::future::pending(),
        || async {
            attempts.fetch_add(1, Ordering::SeqCst);
            Err::<(), _>(Scripted { is_final: false })
        },
    )
    .await
    .expect_err("gives up");
    assert_eq!(failure.end, RetryEnd::GaveUp);
    assert_eq!(attempts.load(Ordering::SeqCst), 1);
}

#[tokio::test(start_paused = true)]
async fn a_final_failure_ends_the_call_after_one_attempt() {
    let attempts = AtomicUsize::new(0);
    let failure = retry_call(
        &RetryPolicy::default(),
        "scripted",
        std::future::pending(),
        || async {
            attempts.fetch_add(1, Ordering::SeqCst);
            Err::<(), _>(Scripted { is_final: true })
        },
    )
    .await
    .expect_err("refused");
    assert_eq!(failure.end, RetryEnd::Refused);
    assert_eq!(attempts.load(Ordering::SeqCst), 1);
}

#[tokio::test(start_paused = true)]
async fn a_cancellation_ends_an_attempt_in_flight() {
    let failure = retry_call(
        &RetryPolicy::default(),
        "scripted",
        tokio::time::sleep(Duration::from_secs(10)),
        || async {
            std::future::pending::<()>().await;
            Ok::<(), Scripted>(())
        },
    )
    .await
    .expect_err("canceled");
    assert_eq!(failure.end, RetryEnd::Canceled);
    assert!(failure.error.is_none(), "no attempt had failed");
}

// --- the reports, against a stub backend -------------------------------------------

/// The stub backend's state.
#[derive(Clone)]
struct Backend {
    /// When the stub came up; `unavailable_for` and `canceled_after` count from it.
    start: Instant,
    /// The statuses `POST /jobs/{id}/status` answers in order before
    /// `unavailable_for` and acceptance apply; consumed one per request.
    script: Arc<Mutex<Vec<StatusCode>>>,
    /// `POST /jobs/{id}/status` answers `503` to the first request and until this
    /// much time has passed, then `204`. `None` answers `503` for ever once the
    /// script is spent.
    unavailable_for: Option<Duration>,
    /// `GET /jobs/{id}` reads `canceled` once the stub has received this many
    /// status requests, and `running` before. `None` never reads `canceled`.
    canceled_after: Option<usize>,
    /// Every status request's body.
    received: Arc<Mutex<Vec<serde_json::Value>>>,
    /// The status requests the stub accepted.
    accepted: Arc<AtomicUsize>,
    /// The state polls the stub answered.
    polls: Arc<AtomicUsize>,
}

impl Backend {
    fn new() -> Self {
        Self {
            start: Instant::now(),
            script: Arc::default(),
            unavailable_for: None,
            canceled_after: None,
            received: Arc::default(),
            accepted: Arc::default(),
            polls: Arc::default(),
        }
    }

    fn script(self, script: &[StatusCode]) -> Self {
        *self.script.lock().expect("lock") = script.to_vec();
        self
    }

    fn unavailable_for(mut self, wait: Duration) -> Self {
        self.unavailable_for = Some(wait);
        self
    }

    fn canceled_after(mut self, after: usize) -> Self {
        self.canceled_after = Some(after);
        self
    }

    fn attempts(&self) -> usize {
        self.received.lock().expect("lock").len()
    }

    /// Serve the stub; returns a client for job `job-1` against it.
    async fn serve(&self) -> JobClient {
        let app = Router::new()
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
        JobClient::new(format!("http://{addr}"), "job-1", "job-token")
    }
}

async fn status(
    State(backend): State<Backend>,
    UrlPath(_id): UrlPath<String>,
    Json(body): Json<serde_json::Value>,
) -> StatusCode {
    let attempts = {
        let mut received = backend.received.lock().expect("lock");
        received.push(body);
        received.len()
    };
    let scripted = {
        let mut script = backend.script.lock().expect("lock");
        (!script.is_empty()).then(|| script.remove(0))
    };
    let answer = scripted.unwrap_or_else(|| match backend.unavailable_for {
        Some(wait) if attempts > 1 && backend.start.elapsed() >= wait => StatusCode::NO_CONTENT,
        _ => StatusCode::SERVICE_UNAVAILABLE,
    });
    if answer.is_success() {
        backend.accepted.fetch_add(1, Ordering::SeqCst);
    }
    answer
}

async fn poll(State(backend): State<Backend>, UrlPath(id): UrlPath<String>) -> Response {
    backend.polls.fetch_add(1, Ordering::SeqCst);
    let state = match backend.canceled_after {
        Some(after) if backend.attempts() >= after => JobState::Canceled,
        _ => JobState::Running,
    };
    Json(serde_json::json!({ "id": id, "state": state })).into_response()
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

/// Post the held report under `policy`, ending on the job's cancellation.
async fn deliver_held(
    client: &JobClient,
    policy: &RetryPolicy,
) -> Result<(), RetryFailure<ClientError>> {
    let record = record();
    retry_call(policy, "the held report", job_canceled(client), || {
        client.post_status_storing(&record, Some("the run failed"))
    })
    .await
}

#[tokio::test(start_paused = true)]
async fn a_report_the_backend_refuses_for_a_minute_lands_once_it_answers() {
    let backend = Backend::new().unavailable_for(Duration::from_secs(60));
    let client = backend.serve().await;
    let start = Instant::now();

    deliver_held(&client, &RetryPolicy::waiting_for(DEFAULT_REPORT_WAIT))
        .await
        .expect("lands");

    assert!(start.elapsed() >= Duration::from_secs(60));
    assert_eq!(backend.accepted.load(Ordering::SeqCst), 1, "lands once");
    assert!(backend.attempts() > 1, "the 503s were retried");
    // Every attempt is the same held report: the record and the run's failure.
    for body in backend.received.lock().expect("lock").iter() {
        assert_eq!(body["state"], "storing");
        assert_eq!(body["record"]["id"], "run-1");
        assert_eq!(body["detail"], "the run failed");
        assert!(body.get("artifactsStored").is_none());
    }
}

#[tokio::test(start_paused = true)]
async fn a_refusal_ends_the_report_after_one_attempt() {
    for refusal in [StatusCode::NOT_FOUND, StatusCode::UNPROCESSABLE_ENTITY] {
        let backend = Backend::new().script(&[refusal]);
        let client = backend.serve().await;

        let failure = deliver_held(&client, &RetryPolicy::default())
            .await
            .expect_err("refused");

        assert_eq!(failure.end, RetryEnd::Refused, "{refusal}");
        assert_eq!(backend.attempts(), 1, "{refusal}");
    }
}

#[tokio::test(start_paused = true)]
async fn a_408_or_a_429_is_retried() {
    let backend = Backend::new()
        .script(&[
            StatusCode::REQUEST_TIMEOUT,
            StatusCode::TOO_MANY_REQUESTS,
            StatusCode::NO_CONTENT,
        ])
        .unavailable_for(Duration::ZERO);
    let client = backend.serve().await;

    deliver_held(&client, &RetryPolicy::default())
        .await
        .expect("lands");

    assert_eq!(backend.attempts(), 3);
    assert_eq!(backend.accepted.load(Ordering::SeqCst), 1);
}

#[tokio::test(start_paused = true)]
async fn a_zero_report_wait_makes_a_single_attempt() {
    let backend = Backend::new();
    let client = backend.serve().await;

    let failure = deliver_held(&client, &RetryPolicy::waiting_for(Duration::ZERO))
        .await
        .expect_err("gives up");

    assert_eq!(failure.end, RetryEnd::GaveUp);
    assert_eq!(backend.attempts(), 1);
}

#[tokio::test(start_paused = true)]
async fn a_canceled_job_ends_the_wait() {
    // The job reads `canceled` once the report has failed twice; the backend never
    // takes the report, and the wait would otherwise run its six hours.
    let backend = Backend::new().canceled_after(2);
    let client = backend.serve().await;
    let start = Instant::now();

    let failure = deliver_held(&client, &RetryPolicy::waiting_for(DEFAULT_REPORT_WAIT))
        .await
        .expect_err("canceled");

    assert_eq!(failure.end, RetryEnd::Canceled);
    assert!(failure.error.is_some(), "the 503 the wait was on");
    assert!(
        start.elapsed() < Duration::from_secs(10 * 60),
        "the wait ends at the cancellation, not at the deadline: {:?}",
        start.elapsed()
    );
    assert!(backend.attempts() >= 2);
    assert_eq!(backend.accepted.load(Ordering::SeqCst), 0);
    assert!(
        backend.polls.load(Ordering::SeqCst) >= 1,
        "the job was polled"
    );
}

#[tokio::test(start_paused = true)]
async fn a_terminal_report_carries_the_store_fields() {
    let backend = Backend::new().script(&[StatusCode::NO_CONTENT, StatusCode::NO_CONTENT]);
    let client = backend.serve().await;

    client
        .post_status_succeeded(
            record(),
            StoreFields {
                artifacts_stored: Some(false),
                store_fault: Some("HTTP 503".into()),
            },
        )
        .await
        .expect("lands");
    client
        .post_status_canceled(record(), StoreFields::default())
        .await
        .expect("lands");

    let received = backend.received.lock().expect("lock").clone();
    assert_eq!(received[0]["state"], "succeeded");
    assert_eq!(received[0]["artifactsStored"], false);
    assert_eq!(received[0]["storeFault"], "HTTP 503");
    assert_eq!(received[1]["state"], "canceled");
    assert!(
        received[1].get("artifactsStored").is_none(),
        "absent when unset"
    );
    assert!(received[1].get("storeFault").is_none());
}
