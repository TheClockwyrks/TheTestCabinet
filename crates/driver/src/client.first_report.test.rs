//! Tests for how the driver reads a failure of its first report: a refusal means
//! the job returned to the queue and is no longer this driver's, so it exits
//! successfully; anything else is a backend it cannot reach, so it fails.

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::{FirstReportFailure, JobClient, first_report_failure};

/// A stub backend answering every request with `status`.
async fn stub_backend(status: &'static str) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("addr");
    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            let mut buf = Vec::new();
            let mut chunk = [0u8; 4096];
            while !buf.windows(4).any(|w| w == b"\r\n\r\n") {
                match socket.read(&mut chunk).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => buf.extend_from_slice(&chunk[..n]),
                }
            }
            let response =
                format!("HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            let _ = socket.write_all(response.as_bytes()).await;
        }
    });
    format!("http://{addr}")
}

/// The failure of a `starting` report against a backend answering `status`.
async fn starting_against(status: &'static str) -> FirstReportFailure {
    let client = JobClient::new(stub_backend(status).await, "job-1", "stale-token");
    let error = client
        .post_status_starting()
        .await
        .expect_err("the stub answers no success");
    first_report_failure(&error)
}

#[tokio::test]
async fn a_withdrawn_token_ends_the_driver_successfully() {
    let failure = starting_against("401 Unauthorized").await;

    assert_eq!(failure, FirstReportFailure::Withdrawn);
    assert!(failure.exits_successfully());
}

#[tokio::test]
async fn any_refusal_of_the_first_report_withdraws_the_driver() {
    for status in ["403 Forbidden", "404 Not Found", "409 Conflict"] {
        assert_eq!(
            starting_against(status).await,
            FirstReportFailure::Withdrawn,
            "{status} is a refusal"
        );
    }
}

#[tokio::test]
async fn a_backend_that_does_not_answer_fails_the_driver() {
    for status in [
        "500 Internal Server Error",
        "503 Service Unavailable",
        "408 Request Timeout",
        "429 Too Many Requests",
    ] {
        let failure = starting_against(status).await;
        assert_eq!(
            failure,
            FirstReportFailure::Unreachable,
            "{status} is retryable"
        );
        assert!(!failure.exits_successfully());
    }
}

#[tokio::test]
async fn an_unreachable_backend_fails_the_driver() {
    // Bind then drop, so the port is closed and the connection is refused.
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("addr");
    drop(listener);
    let client = JobClient::new(format!("http://{addr}"), "job-1", "tok-1");

    let error = client
        .post_status_starting()
        .await
        .expect_err("nothing listens");

    assert_eq!(
        first_report_failure(&error),
        FirstReportFailure::Unreachable
    );
}
