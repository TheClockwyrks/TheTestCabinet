//! The [per-model-call ceiling](DEFAULT_MODEL_CALL_TIMEOUT) against a **stalled gateway** — a live
//! socket that accepts the request and never answers it, which is exactly the failure that once
//! held a run twenty minutes inside one call with nothing able to interrupt it.
//!
//! Each test states the ceiling its client was built with, so what is asserted is the figure the
//! run configured rather than one gg picked.
//!
//! The sockets are real in both tests — a bound listener on a loopback port. What they hold is the
//! contract the turn loop is built on: a stall surfaces as [`ModelError::Timeout`] — promptly,
//! without spending the client's internal retry budget on more full-ceiling waits — and carries the
//! provider when the stream got far enough to name one.
//!
//! The two are clocked differently, and deliberately:
//!
//! - A gateway that answers **nothing** can be tested under `start_paused` time. Nothing has to
//!   arrive before the ceiling may fire, so letting the ceiling elapse the moment the runtime goes
//!   idle on the socket costs milliseconds and races nothing.
//! - A gateway that stalls **mid-reply** cannot. The first chunk has to arrive before the idle half
//!   of the ceiling is what cuts the call, and under paused time the wait for that chunk is exactly
//!   an idle runtime — so the clock jumps the whole ceiling and the call is cut waiting for the
//!   response head instead, at whichever figure the ceiling happens to hold. That test therefore
//!   runs on **real** time at a ceiling small enough to pay for in a test suite.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::*;
use crate::model::Message;

/// A gateway that accepts connections, reads the request, and never answers. Returns its base URL
/// and the count of connections it accepted — the direct evidence of how many attempts the client
/// spent.
async fn stalled_gateway() -> (String, Arc<AtomicUsize>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let connections = Arc::new(AtomicUsize::new(0));
    let seen = Arc::clone(&connections);
    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                return;
            };
            seen.fetch_add(1, Ordering::SeqCst);
            tokio::spawn(async move {
                // Drain the request and then hold the connection open forever, answering nothing.
                let mut sink = [0u8; 4096];
                while matches!(socket.read(&mut sink).await, Ok(read) if read > 0) {}
            });
        }
    });
    (format!("http://127.0.0.1:{port}/api/v1"), connections)
}

/// A gateway that serves the response head and the first SSE chunk — naming its provider — and
/// then stalls mid-stream forever.
async fn mid_stream_stalled_gateway() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let port = listener.local_addr().expect("addr").port();
    tokio::spawn(async move {
        let Ok((mut socket, _)) = listener.accept().await else {
            return;
        };
        // Read the request head; the body length does not matter to a server that will stall.
        let mut sink = [0u8; 8192];
        let _ = socket.read(&mut sink).await;
        let head = "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\n\
                    transfer-encoding: chunked\r\n\r\n";
        let event = "data: {\"provider\":\"slowco\",\"choices\":[{\"index\":0,\
                     \"delta\":{\"content\":\"working\"}}]}\n\n";
        let chunk = format!("{:x}\r\n{event}\r\n", event.len());
        let _ = socket.write_all(head.as_bytes()).await;
        let _ = socket.write_all(chunk.as_bytes()).await;
        let _ = socket.flush().await;
        // Never send another chunk and never close: the idle half of the ceiling's job.
        std::future::pending::<()>().await;
    });
    format!("http://127.0.0.1:{port}/api/v1")
}

/// The ceiling the [mid-stream test](a_mid_stream_stall_times_out_on_idleness_and_names_the_provider)
/// runs at, in real time.
///
/// Two bounds meet here, and the gap between them is wide. It has to be long enough that a response
/// head and one chunk cross a loopback socket inside it, and short enough that a suite pays it
/// without noticing — and since the test passes *by* timing out, it pays the figure every time
/// rather than only when something is wrong. Two seconds against a loopback round trip of
/// milliseconds leaves room for a runner sharing its cores with the rest of the suite, which is the
/// machine this actually has to hold on.
const SHORT_CEILING: Duration = Duration::from_secs(2);

/// The buffered transport under a gateway that never answers: the whole call — retries included —
/// is cut at the total-duration ceiling the run configured, surfaces as
/// [`ModelError::Timeout`], and spends exactly **one** connection: a stall is never retried
/// inside the client, because each internal retry would cost the full ceiling again and the
/// turn-level retry is the bounded one.
#[tokio::test(start_paused = true)]
async fn a_stalled_gateway_times_out_the_buffered_call_without_spending_retries() {
    let (base_url, connections) = stalled_gateway().await;
    let configured_timeout = DEFAULT_MODEL_CALL_TIMEOUT;
    let client = OpenRouterClient::new(
        base_url,
        reqwest::Client::new(),
        "openai/gpt-5.6",
        "sk-test",
        RetryPolicy::default(),
        None,
    )
    .with_model_call_timeout(configured_timeout);

    let outcome = client.complete(&[Message::user("build it")], &[]).await;

    match outcome {
        Err(ModelError::Timeout { after, provider }) => {
            assert_eq!(after, configured_timeout);
            assert!(
                provider.is_none(),
                "a buffered stall read nothing that could name a provider"
            );
        }
        other => panic!("a stalled call must time out, got {other:?}"),
    }
    assert_eq!(
        connections.load(Ordering::SeqCst),
        1,
        "the ceiling covers the whole call — a stall is not retried internally"
    );
}

/// The streaming transport under a gateway that stalls **mid-reply**: the per-chunk idle half of
/// the ceiling cuts it (a total cap would kill legitimately long streams, so a stream that is
/// still producing is never cut), and the surfaced timeout names the provider the chunks did.
///
/// **Real time, at a figure the test chose.** This is the one case in this module that cannot be
/// clocked by `start_paused`: what it asserts is that the call was cut *between chunks*, which
/// requires the first chunk to have arrived, and waiting for a socket is precisely when paused time
/// auto-advances. Under paused time the ceiling would therefore fire on the wait for the response
/// head — provider unnamed — except when the loopback round trip happened to win the race, which
/// made the test's result a function of the ceiling's magnitude rather than of the transport's
/// behaviour.
///
/// [`SHORT_CEILING`] is what makes real time affordable, and running at a figure the test chose
/// rather than at [`DEFAULT_MODEL_CALL_TIMEOUT`] is a second reading of what the buffered case
/// above shows: the run's own figure is the one that reaches the transport and the one the error
/// reports.
#[tokio::test]
async fn a_mid_stream_stall_times_out_on_idleness_and_names_the_provider() {
    let base_url = mid_stream_stalled_gateway().await;
    let configured_timeout = SHORT_CEILING;
    let client = OpenRouterClient::new(
        base_url,
        reqwest::Client::new(),
        "openai/gpt-5.6",
        "sk-test",
        RetryPolicy::default(),
        None,
    )
    .with_model_call_timeout(configured_timeout)
    .with_loop_detection(GgLoopDetection {
        enabled: true,
        window_words: Some(256),
        repeat_threshold: Some(32),
        min_offenders: Some(2),
        min_saturated_run: Some(3000),
        max_response_chars: Some(0),
    });

    let outcome = client.complete(&[Message::user("build it")], &[]).await;

    match outcome {
        Err(ModelError::Timeout { after, provider }) => {
            assert_eq!(after, configured_timeout);
            assert_eq!(
                provider.as_deref(),
                Some("slowco"),
                "the chunk that did arrive named who was serving the stalled stream"
            );
        }
        other => panic!("a stalled stream must time out, got {other:?}"),
    }
}
