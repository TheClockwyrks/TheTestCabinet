//! Unit tests for the backend-streaming relay.
//!
//! These drive events and previews through the real sinks and the real
//! [`relay_task`] against a tiny in-process stub of the backend's job API (a raw
//! TCP loop that records each `POST /jobs/{id}/{events|preview|status}` and its
//! body). Asserting through the actual [`JobClient`] exercises the whole path —
//! the channel drain, the event batching, and the per-preview posting — not just
//! the batch helper in isolation.

use std::collections::VecDeque;
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Duration;

use crate::EventSink;
use crate::PreviewSink;
use crate::event::{HarnessEvent, HarnessEventExt, SystemStage, SystemStatus};
use crate::preview::AssetPreview;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use crate::client::JobClient;

use crate::retry::RetryPolicy;

use super::{BackendEventSink, BackendPreviewSink, Outbound, RelayOutcome, channel, relay_task};

/// One request the stub backend received: the path's trailing segment
/// (`events`/`preview`/`status`) and its JSON body.
#[derive(Debug, Clone)]
struct Received {
    kind: String,
    body: serde_json::Value,
}

impl Received {
    /// An event batch's first sequence.
    fn sequence(&self) -> u64 {
        self.body["sequence"]
            .as_u64()
            .expect("a batch carries its sequence")
    }

    /// How many events an event batch carried.
    fn event_count(&self) -> usize {
        self.body["events"]
            .as_array()
            .expect("a batch carries its events")
            .len()
    }
}

/// The recorded requests of a stub backend.
type Log = Arc<Mutex<Vec<Received>>>;

/// A stub backend that records the requests the relay posts and answers `204`.
/// Returns its base URL and a handle to the recorded requests, which fill in as
/// the relay runs.
async fn stub_backend() -> (String, Log) {
    scripted_backend("events", Vec::new()).await
}

/// A stub backend whose answers to posts of `kind` (`events` or `preview`) are
/// `statuses`, in order, then `204` for every later one; every other post is
/// answered `204`.
async fn scripted_backend(kind: &'static str, statuses: Vec<u16>) -> (String, Log) {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("addr");
    let received: Log = Arc::new(Mutex::new(Vec::new()));
    let script = Arc::new(Mutex::new(VecDeque::from(statuses)));
    let sink = received.clone();
    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                return;
            };
            let sink = sink.clone();
            let script = script.clone();
            tokio::spawn(async move {
                let Some(req) = read_request(&mut socket).await else {
                    return;
                };
                let status = if req.kind == kind {
                    script.lock().expect("lock").pop_front().unwrap_or(204)
                } else {
                    204
                };
                sink.lock().expect("lock").push(req);
                let response = format!(
                    "HTTP/1.1 {status} Stub\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                );
                let _ = socket.write_all(response.as_bytes()).await;
                let _ = socket.flush().await;
            });
        }
    });
    (format!("http://{addr}"), received)
}

/// Read one HTTP request from `socket`, returning its trailing path segment and
/// its JSON body. Reads until the full `Content-Length` body has arrived (the
/// bodies here are small).
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
    let body = serde_json::from_slice(body).unwrap_or(serde_json::Value::Null);
    Some(Received { kind, body })
}

/// Find the first occurrence of `needle` in `haystack`.
fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

/// The driver's retry policy with waits short enough for a test.
fn fast_policy() -> RetryPolicy {
    RetryPolicy {
        give_up_after: Duration::from_secs(10),
        delays: vec![Duration::from_millis(200)],
        ..RetryPolicy::default()
    }
}

/// Wait, briefly, until the stub has recorded `count` requests.
async fn until_received(received: &Log, count: usize) {
    tokio::time::timeout(Duration::from_secs(10), async {
        while received.lock().expect("lock").len() < count {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("the stub should receive the requests");
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

    relay_task(client, rx, fast_policy()).await;

    let calls = received.lock().expect("lock").clone();
    assert_eq!(
        calls.len(),
        1,
        "five queued events should post once: {calls:?}"
    );
    assert_eq!(calls[0].kind, "events");
    assert_eq!(
        calls[0].event_count(),
        5,
        "the batch should carry all five events"
    );
    assert_eq!(calls[0].sequence(), 0, "a job's events are numbered from 0");
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

    relay_task(client, rx, fast_policy()).await;

    let calls = received.lock().expect("lock").clone();
    assert_eq!(calls.len(), 2, "two previews should post twice: {calls:?}");
    assert!(calls.iter().all(|c| c.kind == "preview"));
    assert!(calls.iter().all(|c| c.body["frame"].is_u64()));
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
    let _ = tx.send(Outbound::Event(event()));
    let _ = tx.send(Outbound::Event(event()));
    let _ = tx.send(Outbound::Preview(preview(0)));
    let _ = tx.send(Outbound::Event(event()));
    drop(tx);

    relay_task(client, rx, fast_policy()).await;

    let calls = received.lock().expect("lock").clone();
    assert_eq!(
        calls.len(),
        3,
        "leading batch, preview, trailing batch: {calls:?}"
    );
    assert_eq!(calls[0].kind, "events");
    assert_eq!(calls[0].event_count(), 2);
    assert_eq!(calls[0].sequence(), 0);
    assert_eq!(calls[1].kind, "preview");
    assert_eq!(calls[2].kind, "events");
    assert_eq!(calls[2].event_count(), 1);
    assert_eq!(
        calls[2].sequence(),
        2,
        "the trailing batch continues the sequence"
    );
}

#[tokio::test]
async fn sequences_run_contiguously_across_batches() {
    let (base, received) = stub_backend().await;
    let client = Arc::new(JobClient::new(base, "job-4", "tok"));

    let (tx, rx) = channel();
    let progress = rx.progress();
    let relay = tokio::spawn(relay_task(client, rx, fast_policy()));
    let mut sink = BackendEventSink::new(tx.clone());

    // Three separate wakeups, each acknowledged before the next is emitted, so
    // each is its own batch.
    for size in [2, 3, 1] {
        for _ in 0..size {
            sink.emit(&event());
        }
        assert_eq!(progress.acknowledged().await, RelayOutcome::Delivered);
    }
    assert_eq!(progress.acknowledged_count(), 6);
    drop(sink);
    drop(tx);
    assert_eq!(relay.await.expect("relay"), RelayOutcome::Delivered);

    let calls = received.lock().expect("lock").clone();
    let batches: Vec<(u64, usize)> = calls
        .iter()
        .map(|c| (c.sequence(), c.event_count()))
        .collect();
    assert_eq!(batches, vec![(0, 2), (2, 3), (5, 1)], "{calls:?}");
}

#[tokio::test]
async fn an_unanswered_batch_is_resent_unchanged_and_delivered_once() {
    let (base, received) = scripted_backend("events", vec![503]).await;
    let client = Arc::new(JobClient::new(base, "job-5", "tok"));

    let (tx, rx) = channel();
    let progress = rx.progress();
    let _ = tx.send(Outbound::Event(event()));
    let _ = tx.send(Outbound::Event(event()));
    let relay = tokio::spawn(relay_task(client, rx, fast_policy()));

    // The first attempt is answered `503`; an event emitted while the relay waits
    // to resend must not join the batch in flight.
    until_received(&received, 1).await;
    let _ = tx.send(Outbound::Event(event()));
    drop(tx);

    let outcome = tokio::time::timeout(Duration::from_secs(10), relay)
        .await
        .expect("the relay should finish")
        .expect("relay");
    assert_eq!(outcome, RelayOutcome::Delivered);
    assert_eq!(progress.acknowledged_count(), 3);
    assert_eq!(progress.acknowledged().await, RelayOutcome::Delivered);

    let calls = received.lock().expect("lock").clone();
    assert_eq!(
        calls.len(),
        3,
        "first attempt, resend, next batch: {calls:?}"
    );
    assert_eq!(calls[0].body, calls[1].body, "the resend is the same batch");
    assert_eq!((calls[1].sequence(), calls[1].event_count()), (0, 2));
    assert_eq!(
        (calls[2].sequence(), calls[2].event_count()),
        (2, 1),
        "the event emitted meanwhile follows in the next batch"
    );
}

#[tokio::test]
async fn a_refused_batch_is_abandoned_without_holding_the_relay() {
    let (base, received) = scripted_backend("events", vec![400]).await;
    let client = Arc::new(JobClient::new(base, "job-6", "tok"));

    let (tx, rx) = channel();
    let progress = rx.progress();
    let _ = tx.send(Outbound::Event(event()));
    let _ = tx.send(Outbound::Event(event()));
    let relay = tokio::spawn(relay_task(client, rx, fast_policy()));
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(5), progress.acknowledged())
            .await
            .expect("a refused batch settles at once"),
        RelayOutcome::Undelivered
    );
    let _ = tx.send(Outbound::Event(event()));
    drop(tx);

    let outcome = tokio::time::timeout(Duration::from_secs(5), relay)
        .await
        .expect("a refused batch must not hold the relay")
        .expect("relay");
    assert_eq!(outcome, RelayOutcome::Undelivered);
    assert_eq!(progress.acknowledged_count(), 1);

    let calls = received.lock().expect("lock").clone();
    assert_eq!(calls.len(), 2, "a refused batch is not resent: {calls:?}");
    assert_eq!(
        (calls[1].sequence(), calls[1].event_count()),
        (2, 1),
        "the sequence moves past the abandoned batch"
    );
}

#[tokio::test]
async fn a_batch_still_unanswered_when_its_wait_passes_is_abandoned() {
    let (base, received) = scripted_backend("events", vec![503; 64]).await;
    let client = Arc::new(JobClient::new(base, "job-7", "tok"));
    let policy = RetryPolicy {
        give_up_after: Duration::from_millis(300),
        delays: vec![Duration::from_millis(50)],
        ..RetryPolicy::default()
    };

    let (tx, rx) = channel();
    let _ = tx.send(Outbound::Event(event()));
    drop(tx);

    let outcome = tokio::time::timeout(Duration::from_secs(10), relay_task(client, rx, policy))
        .await
        .expect("the wait bounds the relay");
    assert_eq!(outcome, RelayOutcome::Undelivered);
    let calls = received.lock().expect("lock").clone();
    assert!(
        calls.len() > 1,
        "the batch was resent before the wait passed"
    );
    assert!(calls.iter().all(|c| c.sequence() == 0));
}

#[tokio::test]
async fn a_failed_preview_is_dropped_and_the_events_after_it_follow() {
    let (base, received) = scripted_backend("preview", vec![503]).await;
    let client = Arc::new(JobClient::new(base, "job-8", "tok"));

    let (tx, rx) = channel();
    let progress = rx.progress();
    let previews = BackendPreviewSink::new(tx.clone());
    previews.preview(preview(0));
    let _ = tx.send(Outbound::Event(event()));
    drop(previews);
    drop(tx);
    assert_eq!(
        relay_task(client, rx, fast_policy()).await,
        RelayOutcome::Delivered,
        "a preview is not part of the stored stream"
    );
    assert_eq!(progress.acknowledged_count(), 1);

    let calls = received.lock().expect("lock").clone();
    let kinds: Vec<&str> = calls.iter().map(|c| c.kind.as_str()).collect();
    assert_eq!(kinds, vec!["preview", "events"], "a preview is tried once");
    assert_eq!(calls[1].sequence(), 0, "previews take no sequence");
}
