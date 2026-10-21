//! Tests for the backoff policy, the transient classifier, and the retried
//! network steps (the preflight read, the result report and the download)
//! against stub servers answering a scripted sequence of statuses.
//!
//! The tests run on paused time: a backoff pause completes as soon as the
//! runtime is idle, so they never sleep for real, and the virtual time that
//! passes is exactly the sum of the pauses taken.

use super::*;

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use axum::Router;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use test_cabinet_contracts::publish_job_api::{PublishResult, PublishState};
use tokio::net::TcpListener;
use tokio::time::Instant;

use crate::client::PublishJobClient;
use crate::download::download_run_tree;

/// A policy of `attempts` runs with pauses of 1, 2, 4, … seconds, capped at 4.
fn policy(attempts: u32) -> Backoff {
    Backoff {
        attempts,
        initial_delay: Duration::from_secs(1),
        max_delay: Duration::from_secs(4),
    }
}

/// A failure whose transience the test chooses.
#[derive(Debug)]
struct Failure {
    transient: bool,
}

impl Transient for Failure {
    fn is_transient(&self) -> bool {
        self.transient
    }
}

impl Display for Failure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "failure (transient: {})", self.transient)
    }
}

#[test]
fn the_pause_doubles_up_to_the_cap() {
    let policy = policy(10);
    let pauses: Vec<u64> = (1..=5).map(|n| policy.delay(n).as_secs()).collect();
    assert_eq!(pauses, [1, 2, 4, 4, 4]);
    // A huge retry number saturates rather than overflowing.
    assert_eq!(policy.delay(u32::MAX), Duration::from_secs(4));
}

#[test]
fn the_default_policy_spans_about_half_a_minute() {
    let policy = Backoff::default();
    let total: Duration = (1..policy.attempts).map(|n| policy.delay(n)).sum();
    assert_eq!(policy.attempts, 6);
    assert_eq!(total, Duration::from_secs(31));
}

#[test]
fn only_timeouts_rate_limits_and_server_errors_are_transient_statuses() {
    for status in [408, 429, 500, 502, 503, 504, 599] {
        assert!(status_is_transient(status), "{status}");
    }
    for status in [200, 301, 400, 401, 403, 404, 409, 410, 422] {
        assert!(!status_is_transient(status), "{status}");
    }
}

#[test]
fn the_release_errors_are_classified() {
    assert!(Error::Command("`git push` failed".to_string()).is_transient());
    assert!(
        Error::PagesApi {
            status: None,
            detail: String::new()
        }
        .is_transient()
    );
    for status in [429, 503] {
        assert!(
            Error::PagesApi {
                status: Some(status),
                detail: String::new()
            }
            .is_transient(),
            "{status}"
        );
    }
    for status in [200, 401, 404] {
        assert!(
            !Error::PagesApi {
                status: Some(status),
                detail: String::new()
            }
            .is_transient(),
            "{status}"
        );
    }
    assert!(!Error::Diverged("TheClockwyrks/tcab-x".to_string()).is_transient());
    assert!(!Error::Publish("no Cloudflare API is configured".to_string()).is_transient());
}

#[test]
fn an_archive_that_does_not_unpack_is_permanent() {
    let err = DownloadError::Unpack {
        path: "/work/run".to_string(),
        source: std::io::Error::other("disk full"),
    };
    assert!(!err.is_transient());
}

#[tokio::test(start_paused = true)]
async fn a_transient_failure_is_retried_until_the_step_succeeds() {
    let runs = Mutex::new(0u32);
    let started = Instant::now();

    let value = retry(&policy(5), "a step", || async {
        let mut runs = runs.lock().expect("lock");
        *runs += 1;
        if *runs < 3 {
            Err(Failure { transient: true })
        } else {
            Ok(*runs)
        }
    })
    .await
    .expect("the third run succeeds");

    assert_eq!(value, 3);
    // Two pauses: 1 s, then 2 s.
    assert_eq!(started.elapsed(), Duration::from_secs(3));
}

#[tokio::test(start_paused = true)]
async fn a_permanent_failure_is_returned_at_once() {
    let runs = Mutex::new(0u32);
    let started = Instant::now();

    let err = retry(&policy(5), "a step", || async {
        *runs.lock().expect("lock") += 1;
        Err::<(), _>(Failure { transient: false })
    })
    .await
    .expect_err("a permanent failure");

    assert!(!err.transient);
    assert_eq!(*runs.lock().expect("lock"), 1);
    assert_eq!(started.elapsed(), Duration::ZERO);
}

#[tokio::test(start_paused = true)]
async fn the_runs_are_bounded_by_the_attempts() {
    let runs = Mutex::new(0u32);
    let started = Instant::now();

    let err = retry(&policy(4), "a step", || async {
        *runs.lock().expect("lock") += 1;
        Err::<(), _>(Failure { transient: true })
    })
    .await
    .expect_err("every run fails");

    assert!(err.transient);
    assert_eq!(*runs.lock().expect("lock"), 4);
    // Three pauses: 1 + 2 + 4 seconds, and none after the last run.
    assert_eq!(started.elapsed(), Duration::from_secs(7));
}

#[tokio::test(start_paused = true)]
async fn a_policy_of_no_attempts_still_runs_the_step_once() {
    let runs = Mutex::new(0u32);
    let _ = retry(&policy(0), "a step", || async {
        *runs.lock().expect("lock") += 1;
        Err::<(), _>(Failure { transient: true })
    })
    .await;
    assert_eq!(*runs.lock().expect("lock"), 1);
}

/// A stub answering each request with the next status of a script, then with
/// the last one for good. A success is answered with `body`.
#[derive(Clone)]
struct Script {
    statuses: Arc<Mutex<VecDeque<StatusCode>>>,
    hits: Arc<Mutex<u32>>,
    body: Arc<Vec<u8>>,
}

impl Script {
    fn new(statuses: &[StatusCode], body: impl Into<Vec<u8>>) -> Self {
        Self {
            statuses: Arc::new(Mutex::new(statuses.iter().copied().collect())),
            hits: Arc::new(Mutex::new(0)),
            body: Arc::new(body.into()),
        }
    }

    fn hits(&self) -> u32 {
        *self.hits.lock().expect("lock")
    }

    fn answer(&self) -> Response {
        *self.hits.lock().expect("lock") += 1;
        let status = {
            let mut statuses = self.statuses.lock().expect("lock");
            if statuses.len() > 1 {
                statuses.pop_front().expect("a status")
            } else {
                *statuses.front().expect("a status")
            }
        };
        if status.is_success() {
            (status, self.body.as_ref().clone()).into_response()
        } else {
            (status, "scripted failure").into_response()
        }
    }
}

/// Serve the backend's `GET /runs/{id}` and `POST /publish-jobs/{id}/result`
/// and the artifact service's `GET /runs/{id}/tree.tar`, all from `script`.
async fn serve(script: Script) -> String {
    let run = script.clone();
    let result = script.clone();
    let tree = script;
    let app = Router::new()
        .route("/runs/{id}", get(move || async move { run.answer() }))
        .route(
            "/publish-jobs/{id}/result",
            post(move || async move { result.answer() }),
        )
        .route(
            "/runs/{id}/tree.tar",
            get(move || async move { tree.answer() }),
        );
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("addr");
    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("serve");
    });
    format!("http://{addr}")
}

/// A publish job's client of the backend at `base`, retrying with `policy(4)`.
fn client(base: &str) -> PublishJobClient {
    PublishJobClient::new(base, "pub-job-1", "pub-tok").with_backoff(policy(4))
}

fn failed_result() -> PublishResult {
    PublishResult {
        state: PublishState::Failed,
        source_repo: None,
        playable_build: None,
        detail: Some("the push was refused".to_string()),
    }
}

#[tokio::test(start_paused = true)]
async fn the_preflight_rides_out_a_503() {
    let script = Script::new(
        &[StatusCode::SERVICE_UNAVAILABLE, StatusCode::OK],
        r#"{"published":false}"#,
    );
    let base = serve(script.clone()).await;

    let published = client(&base)
        .published_run("run-1")
        .await
        .expect("the second read succeeds");

    assert_eq!(published, None);
    assert_eq!(script.hits(), 2);
}

#[tokio::test(start_paused = true)]
async fn the_preflight_fails_at_once_on_a_404_or_401() {
    for status in [StatusCode::NOT_FOUND, StatusCode::UNAUTHORIZED] {
        let script = Script::new(&[status], "");
        let base = serve(script.clone()).await;

        let err = client(&base)
            .published_run("run-1")
            .await
            .expect_err("a client error is permanent");

        assert!(
            matches!(&err, ClientError::Status { status: got, .. } if *got == status),
            "{err}"
        );
        assert_eq!(script.hits(), 1, "{status}");
    }
}

#[tokio::test(start_paused = true)]
async fn an_unreadable_preflight_answer_is_not_retried() {
    let script = Script::new(&[StatusCode::OK], "not json");
    let base = serve(script.clone()).await;

    client(&base)
        .published_run("run-1")
        .await
        .expect_err("an unreadable answer fails");

    assert_eq!(script.hits(), 1);
}

#[tokio::test(start_paused = true)]
async fn the_result_report_rides_out_a_503_and_a_429() {
    let script = Script::new(
        &[
            StatusCode::SERVICE_UNAVAILABLE,
            StatusCode::TOO_MANY_REQUESTS,
            StatusCode::NO_CONTENT,
        ],
        "",
    );
    let base = serve(script.clone()).await;

    client(&base)
        .post_result(&failed_result())
        .await
        .expect("the third report lands");

    assert_eq!(script.hits(), 3);
}

#[tokio::test(start_paused = true)]
async fn the_result_report_is_bounded_by_the_attempts() {
    let script = Script::new(&[StatusCode::BAD_GATEWAY], "");
    let base = serve(script.clone()).await;

    let err = client(&base)
        .post_result(&failed_result())
        .await
        .expect_err("every report fails");

    assert!(
        matches!(
            &err,
            ClientError::Status {
                status: StatusCode::BAD_GATEWAY,
                ..
            }
        ),
        "{err}"
    );
    assert_eq!(script.hits(), 4);
}

#[tokio::test(start_paused = true)]
async fn an_unreachable_backend_is_retried_then_fails() {
    // Bind a port and release it, so the address refuses connections.
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("addr");
    drop(listener);
    let started = Instant::now();

    let err = client(&format!("http://{addr}"))
        .post_result(&failed_result())
        .await
        .expect_err("nothing answers");

    assert!(matches!(err, ClientError::Transport { .. }), "{err}");
    assert!(err.is_transient());
    // Four runs: 1 + 2 + 4 seconds of pauses between them.
    assert_eq!(started.elapsed(), Duration::from_secs(7));
}

/// A `tree.tar` holding a single `run-record.json`.
fn tarball() -> Vec<u8> {
    let mut builder = tar::Builder::new(Vec::new());
    let contents = br#"{"id":"run-1"}"#;
    let mut header = tar::Header::new_gnu();
    header.set_size(contents.len() as u64);
    header.set_mode(0o644);
    header.set_cksum();
    builder
        .append_data(&mut header, "run-record.json", &contents[..])
        .expect("append");
    builder.into_inner().expect("finish tar")
}

#[tokio::test(start_paused = true)]
async fn the_download_rides_out_a_503() {
    let script = Script::new(
        &[StatusCode::SERVICE_UNAVAILABLE, StatusCode::OK],
        tarball(),
    );
    let base = serve(script.clone()).await;
    let dest = tempfile::tempdir().expect("tempdir");

    let run_dir = download_run_tree(
        &base,
        "run-1",
        "pub-job-1",
        "pub-tok",
        dest.path(),
        &policy(4),
    )
    .await
    .expect("the second download succeeds");

    assert_eq!(
        std::fs::read_to_string(run_dir.join("run-record.json")).expect("record"),
        r#"{"id":"run-1"}"#
    );
    assert_eq!(script.hits(), 2);
}

#[tokio::test(start_paused = true)]
async fn the_download_fails_at_once_on_a_404() {
    let script = Script::new(&[StatusCode::NOT_FOUND], "");
    let base = serve(script.clone()).await;
    let dest = tempfile::tempdir().expect("tempdir");

    let err = download_run_tree(
        &base,
        "run-1",
        "pub-job-1",
        "pub-tok",
        dest.path(),
        &policy(4),
    )
    .await
    .expect_err("a missing tree is permanent");

    assert!(matches!(err, DownloadError::NoStoredTree { .. }), "{err}");
    assert_eq!(script.hits(), 1);
}

#[tokio::test(start_paused = true)]
async fn the_download_is_bounded_by_the_attempts() {
    let script = Script::new(&[StatusCode::INTERNAL_SERVER_ERROR], "");
    let base = serve(script.clone()).await;
    let dest = tempfile::tempdir().expect("tempdir");

    download_run_tree(
        &base,
        "run-1",
        "pub-job-1",
        "pub-tok",
        dest.path(),
        &policy(4),
    )
    .await
    .expect_err("every download fails");

    assert_eq!(script.hits(), 4);
}
