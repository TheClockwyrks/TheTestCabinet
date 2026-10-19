//! Tests for the driver's per-job backend client: every call, the state poll
//! included, presents the per-job token.

use std::sync::{Arc, Mutex};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::JobClient;

/// A stub backend answering every request `404` and recording each request's head.
async fn stub_backend() -> (String, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("addr");
    let heads = Arc::new(Mutex::new(Vec::new()));
    let sink = heads.clone();
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
            sink.lock()
                .expect("lock")
                .push(String::from_utf8_lossy(&buf).to_string());
            let _ = socket
                .write_all(
                    b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .await;
        }
    });
    (format!("http://{addr}"), heads)
}

#[tokio::test]
async fn the_state_poll_presents_the_per_job_token() {
    let (base, heads) = stub_backend().await;
    let client = JobClient::new(base, "job-1", "tok-1");

    let state = client.poll_state().await.expect("a 404 is not an error");

    assert_eq!(state, None, "an unknown job reads as nothing to act on");
    let heads = heads.lock().expect("lock").clone();
    assert_eq!(heads.len(), 1);
    assert!(heads[0].starts_with("GET /jobs/job-1 "), "{}", heads[0]);
    assert!(
        heads[0]
            .lines()
            .any(|line| line.eq_ignore_ascii_case("authorization: Bearer tok-1")),
        "the poll carries the per-job token: {}",
        heads[0],
    );
}
