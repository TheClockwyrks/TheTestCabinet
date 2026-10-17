//! Tests for [`RunWait`], the wait on the artifact store as a run's own driver
//! reports it: what each report puts on the wire, when the run's record is handed
//! over, and how a cancellation is observed.
//!
//! The backend is a stub that answers from a script and keeps every request, so
//! each test states exactly what the backend said and reads exactly what it was
//! sent. Where time matters the clock is paused: the only timers are the wait's
//! own, so the elapsed time is theirs to the second.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::time::Instant;

use super::{RunWait, StoreWait};
use crate::client::JobClient;

/// One request the stub backend received.
#[derive(Debug, Clone)]
struct Received {
    method: String,
    path: String,
    /// The JSON body, or `null` for a request without one.
    body: serde_json::Value,
}

/// A stub backend that answers each request with the next `(status, body)` of
/// `script`, and `500` once the script has run out. Returns its base URL and the
/// requests it has received, in order.
async fn backend(script: &[(u16, &str)]) -> (String, Arc<Mutex<Vec<Received>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("addr");
    let received = Arc::new(Mutex::new(Vec::new()));
    let script: Arc<Mutex<VecDeque<(u16, String)>>> = Arc::new(Mutex::new(
        script
            .iter()
            .map(|(status, body)| (*status, body.to_string()))
            .collect(),
    ));
    tokio::spawn({
        let received = Arc::clone(&received);
        async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    return;
                };
                let mut buf = Vec::new();
                let mut chunk = [0u8; 4096];
                let (header_end, length) = loop {
                    let n = socket.read(&mut chunk).await.expect("read");
                    assert!(n > 0, "the client hung up before sending its request");
                    buf.extend_from_slice(&chunk[..n]);
                    if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                        let head = String::from_utf8_lossy(&buf[..pos]).to_ascii_lowercase();
                        let length = head
                            .lines()
                            .find_map(|line| line.strip_prefix("content-length:"))
                            .and_then(|value| value.trim().parse::<usize>().ok())
                            .unwrap_or(0);
                        break (pos + 4, length);
                    }
                };
                while buf.len() < header_end + length {
                    let n = socket.read(&mut chunk).await.expect("read");
                    assert!(n > 0, "the client hung up mid-body");
                    buf.extend_from_slice(&chunk[..n]);
                }
                let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
                let mut request_line = head.lines().next().unwrap_or_default().split_whitespace();
                let method = request_line.next().unwrap_or_default().to_string();
                let path = request_line.next().unwrap_or_default().to_string();
                let body = if length == 0 {
                    serde_json::Value::Null
                } else {
                    serde_json::from_slice(&buf[header_end..header_end + length]).expect("json")
                };
                received
                    .lock()
                    .unwrap()
                    .push(Received { method, path, body });
                let (status, body) = script
                    .lock()
                    .unwrap()
                    .pop_front()
                    .unwrap_or((500, String::new()));
                let response = format!(
                    "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                socket.write_all(response.as_bytes()).await.expect("write");
            }
        }
    });
    (format!("http://{addr}"), received)
}

/// The `GET /jobs/{id}` body of a job in `state`.
fn job_in(state: &str) -> String {
    format!(r#"{{"id":"job-9","state":"{state}"}}"#)
}

fn client(base: String) -> JobClient {
    JobClient::new(base, "job-9".to_string(), "tok-1".to_string())
}

#[tokio::test]
async fn the_first_report_the_backend_accepts_hands_the_record_over_and_later_ones_do_not() {
    let (base, received) = backend(&[(204, ""), (204, ""), (204, "")]).await;
    let client = client(base);
    let record = super::tests::record(None);
    let wait = RunWait::holding(&client, &record, None);

    wait.waiting("HTTP 503").await;
    wait.waiting("HTTP 500").await;
    wait.over(true).await;

    let received = received.lock().unwrap().clone();
    assert_eq!(received.len(), 3);
    assert!(received.iter().all(|request| request.method == "POST"));
    assert!(
        received
            .iter()
            .all(|request| request.path == "/jobs/job-9/status")
    );
    // The first carries the record the backend keeps for the length of the wait.
    assert_eq!(received[0].body["state"], "storing");
    assert_eq!(received[0].body["detail"], "HTTP 503");
    assert_eq!(received[0].body["record"]["id"], "run-1");
    assert!(received[0].body.get("runFailure").is_none());
    // The backend has it, so the next is the reason alone.
    assert_eq!(received[1].body["state"], "storing");
    assert_eq!(received[1].body["detail"], "HTTP 500");
    assert!(received[1].body["record"].is_null());
    // The end of the wait is the job returning to `validating`, with what became
    // of the tree.
    assert_eq!(received[2].body["state"], "validating");
    assert_eq!(received[2].body["artifactsStored"], true);
}

#[tokio::test]
async fn the_record_is_offered_again_until_a_report_is_accepted() {
    // The backend refuses the first report. A record it never took must not be
    // dropped from the next.
    let (base, received) = backend(&[(503, ""), (204, ""), (204, "")]).await;
    let client = client(base);
    let record = super::tests::record(None);
    let wait = RunWait::holding(&client, &record, None);

    wait.waiting("HTTP 500").await;
    wait.waiting("HTTP 500").await;
    wait.waiting("HTTP 500").await;

    let received = received.lock().unwrap().clone();
    assert_eq!(received[0].body["record"]["id"], "run-1");
    assert_eq!(received[1].body["record"]["id"], "run-1");
    assert!(received[2].body["record"].is_null());
}

#[tokio::test]
async fn a_failed_runs_report_is_handed_over_as_a_failed_one() {
    let (base, received) = backend(&[(204, "")]).await;
    let client = client(base);
    let record = super::tests::record(None);
    let wait = RunWait::holding(
        &client,
        &record,
        Some("the sandbox image could not be pulled"),
    );

    wait.waiting("HTTP 500").await;

    let received = received.lock().unwrap().clone();
    assert_eq!(received[0].body["record"]["id"], "run-1");
    assert_eq!(
        received[0].body["runFailure"],
        "the sandbox image could not be pulled"
    );
}

#[tokio::test]
async fn a_bare_wait_hands_nothing_over() {
    let (base, received) = backend(&[(204, "")]).await;
    let client = client(base);
    let wait = RunWait::bare(&client);

    wait.waiting("HTTP 500").await;

    let received = received.lock().unwrap().clone();
    assert_eq!(received[0].body["state"], "storing");
    assert!(received[0].body["record"].is_null());
}

#[tokio::test]
async fn a_backend_that_is_down_does_not_stop_the_wait() {
    // Nothing answers: each report is dropped and returns, since the tree matters
    // more than the report of it.
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let gone = format!("http://{}", listener.local_addr().expect("addr"));
    drop(listener);
    let client = client(gone);
    let record = super::tests::record(None);
    let wait = RunWait::holding(&client, &record, None);

    wait.waiting("HTTP 503").await;
    wait.over(false).await;
    // And a state nobody could read is not a canceled one.
    assert!(!wait.already_canceled().await);
}

#[tokio::test]
async fn a_run_is_already_canceled_only_when_its_job_reads_canceled() {
    for (state, expected) in [
        ("canceled", true),
        ("running", false),
        ("validating", false),
        ("storing", false),
        ("failed", false),
    ] {
        let (base, received) = backend(&[(200, &job_in(state))]).await;
        let client = client(base);
        let wait = RunWait::bare(&client);

        assert_eq!(wait.already_canceled().await, expected, "{state}");

        let received = received.lock().unwrap().clone();
        assert_eq!(received.len(), 1);
        assert_eq!(received[0].method, "GET");
        assert_eq!(received[0].path, "/jobs/job-9");
    }
}

#[tokio::test(start_paused = true)]
async fn the_wait_is_canceled_by_the_first_poll_that_reads_canceled_and_by_nothing_else() {
    // A job that is waiting, a backend that errors, a job the backend does not
    // know, a job that was failed as lost: none of them is a cancellation, and
    // each leaves the driver holding the tree. The fifth poll reads `canceled`.
    let (base, received) = backend(&[
        (200, &job_in("storing")),
        (500, ""),
        (404, ""),
        (200, &job_in("failed")),
        (200, &job_in("canceled")),
    ])
    .await;
    let client = client(base);
    let wait = RunWait::bare(&client);
    let started = Instant::now();

    wait.canceled().await;

    // One poll every three seconds, and it returned on the fifth.
    assert_eq!(started.elapsed(), Duration::from_secs(15));
    let received = received.lock().unwrap().clone();
    assert_eq!(received.len(), 5);
    assert!(
        received
            .iter()
            .all(|request| request.method == "GET" && request.path == "/jobs/job-9")
    );
}

#[tokio::test(start_paused = true)]
async fn the_wait_is_not_canceled_while_the_backend_is_unreachable() {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let gone = format!("http://{}", listener.local_addr().expect("addr"));
    drop(listener);
    let client = client(gone);
    let wait = RunWait::bare(&client);

    // An hour of polls against nothing: still holding the tree.
    let outcome = tokio::time::timeout(Duration::from_secs(3600), wait.canceled()).await;

    assert!(outcome.is_err(), "an unreachable backend cancels nothing");
}
