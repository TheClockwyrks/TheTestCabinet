//! The [per-model-call ceiling](DEFAULT_MODEL_CALL_TIMEOUT) against a **stalled gateway** — a live
//! socket that accepts the request and never answers it, which is exactly the failure that once
//! held a run twenty minutes inside one call with nothing able to interrupt it.
//!
//! Each test states the ceiling its client was built with, so what is asserted is the figure the
//! run configured rather than one gg picked.
//!
//! Every test here runs under `start_paused` time, so a ceiling elapses the moment the runtime has
//! nothing left to do rather than after the ceiling's figure in real seconds:
//!
//! - The socket tests hold the contract the turn loop is built on: a stall surfaces as
//!   [`ModelError::Timeout`] at the configured figure, without spending the client's internal retry
//!   budget on more full-ceiling waits. They are real loopback sockets, so they do not assert which
//!   half of the ceiling cut the call — under paused time the wait for the response head is itself
//!   an idle runtime.
//! - Which half cut it, and what it names, is asserted on [`read_stream`] directly: a chunk that is
//!   ready without any I/O and then a stream that never yields again, so the only way the read can
//!   end is the idle half of the ceiling, after the chunk has named its provider.

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
        let chunk = format!("{:x}\r\n{FIRST_EVENT}\r\n", FIRST_EVENT.len());
        let _ = socket.write_all(head.as_bytes()).await;
        let _ = socket.write_all(chunk.as_bytes()).await;
        let _ = socket.flush().await;
        // Never send another chunk and never close: the idle half of the ceiling's job.
        std::future::pending::<()>().await;
    });
    format!("http://127.0.0.1:{port}/api/v1")
}

/// The one SSE event a stalling stream sends before it goes quiet, naming the provider serving it.
const FIRST_EVENT: &str = "data: {\"provider\":\"slowco\",\"choices\":[{\"index\":0,\
                           \"delta\":{\"content\":\"working\"}}]}\n\n";

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

/// The streaming transport under a gateway that stalls **mid-reply**: the call is cut at the
/// configured ceiling and surfaces as [`ModelError::Timeout`], never as a retry-exhausted transport
/// failure.
#[tokio::test(start_paused = true)]
async fn a_mid_stream_stall_times_out_at_the_configured_ceiling() {
    let base_url = mid_stream_stalled_gateway().await;
    let configured_timeout = DEFAULT_MODEL_CALL_TIMEOUT;
    let client = OpenRouterClient::new(
        base_url,
        reqwest::Client::new(),
        "openai/gpt-5.6",
        "sk-test",
        RetryPolicy::default(),
        None,
    )
    .with_model_call_timeout(configured_timeout)
    .with_loop_detection(armed_loop_detection());

    let outcome = client.complete(&[Message::user("build it")], &[]).await;

    match outcome {
        Err(ModelError::Timeout { after, .. }) => assert_eq!(after, configured_timeout),
        other => panic!("a stalled stream must time out, got {other:?}"),
    }
}

/// A stream that stalls after its first chunk is cut on **idleness** — a total cap would kill
/// legitimately long streams, so a stream that is still producing is never cut — and the stall
/// names the provider the chunk did.
#[tokio::test(start_paused = true)]
async fn a_stream_that_goes_quiet_after_a_chunk_is_a_stall_naming_its_provider() {
    let stream =
        futures_util::stream::iter([Ok::<_, std::convert::Infallible>(FIRST_EVENT.as_bytes())])
            .chain(futures_util::stream::pending());
    let config = resolved_config();

    match read_stream(stream, config, DEFAULT_MODEL_CALL_TIMEOUT).await {
        StreamOutcome::Stalled { provider } => assert_eq!(
            provider.as_deref(),
            Some("slowco"),
            "the chunk that did arrive named who was serving the stalled stream"
        ),
        _ => panic!("a stream that stopped producing must end as a stall"),
    }
}

/// The detector the streaming tests arm, which is what routes a call through the streaming
/// transport at all.
fn armed_loop_detection() -> GgLoopDetection {
    GgLoopDetection {
        enabled: true,
        window_words: Some(256),
        repeat_threshold: Some(32),
        min_offenders: Some(2),
        min_saturated_run: Some(3000),
        max_response_chars: Some(0),
    }
}

/// The detector configuration [`armed_loop_detection`] resolves to.
fn resolved_config() -> LoopGuardConfig {
    LoopGuardConfig {
        window_words: 256,
        repeat_threshold: 32,
        min_offenders: 2,
        min_saturated_run: 3000,
        max_response_chars: 0,
    }
}
