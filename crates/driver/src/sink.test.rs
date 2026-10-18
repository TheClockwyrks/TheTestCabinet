//! Unit tests for the backend-streaming relay.
//!
//! These drive events and previews through the real sinks and the real
//! [`relay_task`] against a tiny in-process stub of the backend's job API (a raw
//! TCP loop that records each `POST /jobs/{id}/{events|preview|status}` and its
//! body). Asserting through the actual [`JobClient`] exercises the whole path —
//! the channel drain, the event batching, and the per-preview posting — not just
//! the batch helper in isolation.

use std::sync::Arc;
use std::sync::Mutex;

use test_cabinet_core::EventSink;
use test_cabinet_core::PreviewSink;
use test_cabinet_core::event::{HarnessEvent, SystemStage, SystemStatus};
use test_cabinet_core::preview::AssetPreview;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use crate::client::JobClient;

use super::{BackendEventSink, BackendPreviewSink, channel, relay_task};

/// One request the stub backend received: the path's trailing segment
/// (`events`/`preview`/`status`), how many JSON items the body carried (the
/// length of a top-level array, or `1` for a single object), and the `state` a
/// status report carried.
#[derive(Debug, Clone)]
struct Received {
    kind: String,
    item_count: usize,
    state: Option<String>,
}

/// A stub backend that records the requests the relay posts. Returns its base URL
/// and a handle to the recorded requests, which fill in as the relay runs.
async fn stub_backend() -> (String, Arc<Mutex<Vec<Received>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("addr");
    let received = Arc::new(Mutex::new(Vec::new()));
    let sink = received.clone();
    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                return;
            };
            let sink = sink.clone();
            tokio::spawn(async move {
                if let Some(req) = read_request(&mut socket).await {
                    sink.lock().expect("lock").push(req);
                }
                // A bare 204 so the client sees success.
                let _ = socket
                    .write_all(b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n")
                    .await;
                let _ = socket.flush().await;
            });
        }
    });
    (format!("http://{addr}"), received)
}

/// Read one HTTP request from `socket`, returning its trailing path segment and
/// the number of JSON items in the body. Reads until the full
/// `Content-Length` body has arrived (the bodies here are small).
async fn read_request(socket: &mut tokio::net::TcpStream) -> Option<Received> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    // Read headers (up to the blank line).
    let header_end = loop {
        let n = socket.read(&mut chunk).await.ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(pos) = find_subslice(&buf, b"\r\n\r\n") {
            break pos + 4;
        }
    };
    let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let request_line = head.lines().next()?;
    let path = request_line.split_whitespace().nth(1)?;
    let kind = path.rsplit('/').next()?.to_string();
    let content_length = head
        .lines()
        .find_map(|line| {
            let lower = line.to_ascii_lowercase();
            lower
                .strip_prefix("content-length:")
                .map(|v| v.trim().parse::<usize>().unwrap_or(0))
        })
        .unwrap_or(0);
    // Drain the rest of the body.
    while buf.len() < header_end + content_length {
        let n = socket.read(&mut chunk).await.ok()?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    let body = &buf[header_end..(header_end + content_length).min(buf.len())];
    let value: serde_json::Value = serde_json::from_slice(body).unwrap_or(serde_json::Value::Null);
    let state = value
        .get("state")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);
    let item_count = match value {
        serde_json::Value::Array(items) => items.len(),
        _ => 1,
    };
    Some(Received {
        kind,
        item_count,
        state,
    })
}

/// Find the first occurrence of `needle` in `haystack`.
fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn event() -> HarnessEvent {
    HarnessEvent::system(SystemStage::StartContainer, SystemStatus::Started)
}

fn preview(frame: u32) -> AssetPreview {
    AssetPreview {
        frame,
        operation_count: 1,
        operation: None,
        image: String::new(),
        mesh: None,
        system: None,
        skinned_glb: None,
        rig: None,
        audio: None,
    }
}

#[tokio::test]
async fn relay_batches_events_into_one_post() {
    let (base, received) = stub_backend().await;
    let client = Arc::new(JobClient::new(base, "job-1", "tok"));

    let (tx, rx) = channel();
    // Push a burst of events synchronously before the relay starts draining, so
    // they are all queued in one wakeup and coalesce into a single batch.
    let mut sink = BackendEventSink::new(tx.clone());
    for _ in 0..5 {
        sink.emit(&event());
    }
    drop(sink);
    drop(tx);

    relay_task(client, rx).await;

    let calls = received.lock().expect("lock").clone();
    assert_eq!(
        calls.len(),
        1,
        "five queued events should post once: {calls:?}"
    );
    assert_eq!(calls[0].kind, "events");
    assert_eq!(
        calls[0].item_count, 5,
        "the batch should carry all five events"
    );
}

#[tokio::test]
async fn relay_posts_each_preview_individually() {
    let (base, received) = stub_backend().await;
    let client = Arc::new(JobClient::new(base, "job-2", "tok"));

    let (tx, rx) = channel();
    let preview_sink = BackendPreviewSink::new(tx.clone());
    preview_sink.preview(preview(0));
    preview_sink.preview(preview(1));
    drop(preview_sink);
    drop(tx);

    relay_task(client, rx).await;

    let calls = received.lock().expect("lock").clone();
    assert_eq!(calls.len(), 2, "two previews should post twice: {calls:?}");
    assert!(calls.iter().all(|c| c.kind == "preview"));
    assert!(calls.iter().all(|c| c.item_count == 1));
}

#[tokio::test]
async fn relay_flushes_pending_events_before_a_preview() {
    let (base, received) = stub_backend().await;
    let client = Arc::new(JobClient::new(base, "job-3", "tok"));

    let (tx, rx) = channel();
    // Events then a preview then an event, all queued in one wakeup: the relay must
    // flush the leading event batch before the preview, then post the trailing
    // event as its own batch — so order is preserved and previews never ride in an
    // event batch.
    let _ = tx.send(super::Outbound::Event(event()));
    let _ = tx.send(super::Outbound::Event(event()));
    let _ = tx.send(super::Outbound::Preview(preview(0)));
    let _ = tx.send(super::Outbound::Event(event()));
    drop(tx);

    relay_task(client, rx).await;

    let calls = received.lock().expect("lock").clone();
    assert_eq!(
        calls.len(),
        3,
        "leading batch, preview, trailing batch: {calls:?}"
    );
    assert_eq!(calls[0].kind, "events");
    assert_eq!(calls[0].item_count, 2);
    assert_eq!(calls[1].kind, "preview");
    assert_eq!(calls[2].kind, "events");
    assert_eq!(calls[2].item_count, 1);
}

#[tokio::test]
async fn the_end_of_the_session_is_reported_after_every_event_before_it() {
    let (base, received) = stub_backend().await;
    let client = Arc::new(JobClient::new(base, "job-4", "tok"));

    let (tx, rx) = channel();
    // The session's events, its end, then the teardown's event, all queued in one
    // wakeup: the relay must post the session's events before it reports
    // `validating`, and the teardown's event after.
    let mut sink = BackendEventSink::new(tx.clone());
    sink.emit(&event());
    sink.emit(&event());
    sink.emit(&event());
    sink.session_ended();
    sink.emit(&event());
    drop(sink);
    drop(tx);

    relay_task(client, rx).await;

    let calls = received.lock().expect("lock").clone();
    assert_eq!(
        calls.len(),
        3,
        "session batch, status, teardown batch: {calls:?}"
    );
    assert_eq!(calls[0].kind, "events");
    assert_eq!(calls[0].item_count, 3, "{calls:?}");
    assert_eq!(calls[1].kind, "status");
    assert_eq!(calls[1].state.as_deref(), Some("validating"), "{calls:?}");
    assert_eq!(calls[2].kind, "events");
    assert_eq!(calls[2].item_count, 1, "{calls:?}");
}

#[tokio::test]
async fn a_refused_validating_report_does_not_stop_the_relay() {
    // A backend that answers nothing: every post fails. The relay logs the lost
    // `validating` report and goes on draining, so the run is never held up by it.
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let gone = format!("http://{}", listener.local_addr().expect("addr"));
    drop(listener);
    let client = Arc::new(JobClient::new(gone, "job-5", "tok"));

    let (tx, rx) = channel();
    let mut sink = BackendEventSink::new(tx.clone());
    sink.session_ended();
    sink.emit(&event());
    drop(sink);
    drop(tx);

    relay_task(client, rx).await;
}
