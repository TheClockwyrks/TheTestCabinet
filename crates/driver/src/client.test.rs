//! Tests for what the driver tells the backend about its run's artifact tree: the
//! terminal status report's account of it, and the report of a wait on the store.
//!
//! The backend learns whether a run's tree was stored from this report and from
//! nowhere else at the moment the run lands, so the wire form is pinned here: the
//! field is present with the driver's answer, and absent when the driver had no
//! artifact service to answer about.

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::JobClient;
use crate::artifacts::{TreeStore, UploadEnd};

/// A stub backend that accepts one status report, answers `204`, and hands back
/// the request path and its JSON body.
async fn stub_backend() -> (String, tokio::task::JoinHandle<(String, serde_json::Value)>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("addr");
    let handle = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.expect("accept");
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
                    .expect("a JSON body declares its length");
                break (pos + 4, length);
            }
        };
        while buf.len() < header_end + length {
            let n = socket.read(&mut chunk).await.expect("read");
            assert!(n > 0, "the client hung up mid-body");
            buf.extend_from_slice(&chunk[..n]);
        }
        let path = String::from_utf8_lossy(&buf[..header_end])
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .unwrap_or_default()
            .to_string();
        let body = serde_json::from_slice(&buf[header_end..header_end + length]).expect("json");
        socket
            .write_all(b"HTTP/1.1 204 No Content\r\ncontent-length: 0\r\nconnection: close\r\n\r\n")
            .await
            .expect("write");
        (path, body)
    });
    (format!("http://{addr}"), handle)
}

/// A tree that was not stored because the driver gave up on the store.
fn lost_to_the_store() -> TreeStore {
    TreeStore::NotStored {
        end: UploadEnd::GaveUp,
        store_fault: Some("the artifact service rejected the upload: HTTP 500".to_string()),
    }
}

#[tokio::test]
async fn a_terminal_report_carries_that_the_tree_was_not_stored_and_that_the_store_was_why() {
    let (base, server) = stub_backend().await;
    let client = JobClient::new(base, "job-9".to_string(), "tok-1".to_string());

    client
        .post_status_failed("harness unavailable", None, &lost_to_the_store())
        .await
        .expect("the report is accepted");

    let (path, body) = server.await.expect("join");
    assert_eq!(path, "/jobs/job-9/status");
    assert_eq!(body["state"], "failed");
    assert_eq!(body["artifactsStored"], false);
    assert_eq!(
        body["storeFault"],
        "the artifact service rejected the upload: HTTP 500"
    );
}

#[tokio::test]
async fn a_tree_refused_as_the_runs_own_does_not_name_the_store() {
    let (base, server) = stub_backend().await;
    let client = JobClient::new(base, "job-9".to_string(), "tok-1".to_string());
    let tree = TreeStore::NotStored {
        end: UploadEnd::RunsOwn,
        store_fault: None,
    };

    client
        .post_status_failed("harness unavailable", None, &tree)
        .await
        .expect("the report is accepted");

    let (_, body) = server.await.expect("join");
    assert_eq!(body["artifactsStored"], false);
    assert!(body.get("storeFault").is_none(), "{body}");
}

#[tokio::test]
async fn a_terminal_report_carries_that_the_tree_was_stored() {
    let (base, server) = stub_backend().await;
    let client = JobClient::new(base, "job-9".to_string(), "tok-1".to_string());

    client
        .post_status_failed("the build never loaded", None, &TreeStore::Stored)
        .await
        .expect("the report is accepted");

    let (_, body) = server.await.expect("join");
    assert_eq!(body["artifactsStored"], true);
    assert!(body.get("storeFault").is_none(), "{body}");
}

#[tokio::test]
async fn a_report_with_no_artifact_service_omits_the_field() {
    // Absent, not `null`: the backend reads an absent field as "nothing to record"
    // and leaves what it holds for the run alone.
    let (base, server) = stub_backend().await;
    let client = JobClient::new(base, "job-9".to_string(), "tok-1".to_string());

    client
        .post_status_failed("harness unavailable", None, &TreeStore::NoService)
        .await
        .expect("the report is accepted");

    let (_, body) = server.await.expect("join");
    assert!(
        body.get("artifactsStored").is_none(),
        "an unknown outcome is not sent: {body}"
    );
}

#[tokio::test]
async fn a_wait_on_the_store_is_reported_with_its_reason() {
    let (base, server) = stub_backend().await;
    let client = JobClient::new(base, "job-9".to_string(), "tok-1".to_string());

    client
        .post_status_storing(
            "the artifact service rejected the upload: HTTP 500",
            None,
            None,
        )
        .await
        .expect("the report is accepted");

    let (path, body) = server.await.expect("join");
    assert_eq!(path, "/jobs/job-9/status");
    assert_eq!(body["state"], "storing");
    assert_eq!(
        body["detail"],
        "the artifact service rejected the upload: HTTP 500"
    );
    assert!(body.get("artifactsStored").is_none());
    assert!(body.get("runFailure").is_none());
}

#[tokio::test]
async fn the_end_of_a_wait_says_whether_the_tree_landed() {
    // Landed: the backend reads this as the store taking uploads again.
    let (base, server) = stub_backend().await;
    let client = JobClient::new(base, "job-9".to_string(), "tok-1".to_string());
    client.post_status_wait_over(true).await.expect("accepted");
    let (_, body) = server.await.expect("join");
    assert_eq!(body["state"], "running");
    assert_eq!(body["artifactsStored"], true);

    // Not landed: nothing is claimed here; the terminal report says what happened.
    let (base, server) = stub_backend().await;
    let client = JobClient::new(base, "job-9".to_string(), "tok-1".to_string());
    client.post_status_wait_over(false).await.expect("accepted");
    let (_, body) = server.await.expect("join");
    assert_eq!(body["state"], "running");
    assert!(body.get("artifactsStored").is_none(), "{body}");
}
