//! The [per-model-call ceiling](DEFAULT_MODEL_CALL_TIMEOUT) against a **stalled gateway** — one
//! that accepts the request and never finishes answering it, which is exactly the failure that once
//! held a run twenty minutes inside one call with nothing able to interrupt it.
//!
//! Each test states the ceiling its client was built with, so what is asserted is the figure the
//! run configured rather than one gg picked.
//!
//! Every test here runs under `start_paused` time, so a ceiling elapses the moment the runtime has
//! nothing left to do rather than after the ceiling's figure in real seconds, and the paused clock
//! reads exactly the ceiling that cut the call — which is what shows it was the configured one.
//!
//! The gateway is a stand-in the client is [answered by](OpenRouterClient::answered_by) rather than
//! a socket: a response whose body is exactly the chunks the test chooses, ready at once, and then
//! a stream that never yields again. A real loopback socket cannot be combined with a paused clock
//! deterministically — whether the client has read what the gateway wrote before the runtime next
//! idles is up to the scheduler, and when it has not, the clock jumps. What the stand-in replaces is
//! reqwest's socket; everything from the response onward is gg's own path, the one a real reply
//! takes.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use super::*;
use crate::model::Message;

/// A gateway that answers `200` with `first` as the whole of what its body ever delivers, and then
/// never delivers another byte nor ends. Returns the client answered by it and the count of the
/// requests it was sent — the direct evidence of how many attempts the client spent.
fn stalled_client(first: &'static str) -> (OpenRouterClient, Arc<AtomicUsize>) {
    let requests = Arc::new(AtomicUsize::new(0));
    let seen = Arc::clone(&requests);
    let client = OpenRouterClient::new(
        "http://gateway.invalid/api/v1",
        reqwest::Client::new(),
        "openai/gpt-5.6",
        "sk-test",
        RetryPolicy::default(),
        None,
    )
    .with_model_call_timeout(CONFIGURED)
    .answered_by(move || {
        seen.fetch_add(1, Ordering::SeqCst);
        let chunks = futures_util::stream::iter(
            (!first.is_empty()).then_some(Ok::<_, std::io::Error>(first)),
        )
        .chain(futures_util::stream::pending());
        http::Response::builder()
            .status(200)
            .header("content-type", "text/event-stream")
            .body(reqwest::Body::wrap_stream(chunks))
            .expect("a well-formed response")
            .into()
    });
    (client, requests)
}

/// The ceiling the tests configure: unlike [`DEFAULT_MODEL_CALL_TIMEOUT`], so a call cut by the
/// default instead reads differently on the paused clock.
const CONFIGURED: Duration = Duration::from_secs(37);

/// The one SSE event a stalling stream sends before it goes quiet, naming the provider serving it.
const FIRST_EVENT: &str = "data: {\"provider\":\"slowco\",\"choices\":[{\"index\":0,\
                           \"delta\":{\"content\":\"working\"}}]}\n\n";

/// The buffered transport under a gateway whose reply never finishes: the attempt is cut at the
/// total-duration ceiling the run configured, surfaces as [`ModelError::Timeout`], and spends
/// exactly **one** request: a stall is never retried inside the client, because each internal
/// retry would cost the full ceiling again and the turn-level retry is the bounded one.
#[tokio::test(start_paused = true)]
async fn a_stalled_gateway_times_out_the_buffered_call_without_spending_retries() {
    let (client, requests) = stalled_client("");

    let started = tokio::time::Instant::now();
    let outcome = client.complete(&[Message::user("build it")], &[]).await;
    assert_eq!(
        started.elapsed(),
        CONFIGURED,
        "the call was cut by a bound other than the configured ceiling"
    );

    match outcome {
        Err(ModelError::Timeout { after, provider }) => {
            assert_eq!(after, CONFIGURED);
            assert!(
                provider.is_none(),
                "a buffered stall read nothing that could name a provider"
            );
        }
        other => panic!("a stalled call must time out, got {other:?}"),
    }
    assert_eq!(
        requests.load(Ordering::SeqCst),
        1,
        "a stall is not retried internally"
    );
}

/// The buffered ceiling bounds **each attempt**, not the backoff between them: a schedule whose
/// waits add up to far more than the ceiling runs to its answer, and an attempt that stalls after
/// earlier ones failed is cut at the ceiling measured from its own start.
#[tokio::test(start_paused = true)]
async fn the_buffered_ceiling_bounds_each_attempt_and_leaves_the_backoff_outside() {
    let requests = Arc::new(AtomicUsize::new(0));
    let seen = Arc::clone(&requests);
    let client = OpenRouterClient::new(
        "http://gateway.invalid/api/v1",
        reqwest::Client::new(),
        "openai/gpt-5.6",
        "sk-test",
        RetryPolicy::default(),
        None,
    )
    .with_model_call_timeout(CONFIGURED)
    .answered_by(move || {
        let attempt = seen.fetch_add(1, Ordering::SeqCst);
        let builder = http::Response::builder();
        match attempt {
            // Two `503`s asking for a minute each: two minutes of waiting, past the ceiling.
            0 | 1 => builder
                .status(503)
                .header("retry-after", "60")
                .body(reqwest::Body::from("overloaded")),
            // Then an attempt that never finishes answering.
            _ => builder.status(200).body(reqwest::Body::wrap_stream(
                futures_util::stream::pending::<Result<&'static str, std::io::Error>>(),
            )),
        }
        .expect("a well-formed response")
        .into()
    });

    let started = tokio::time::Instant::now();
    let outcome = client.complete(&[Message::user("build it")], &[]).await;

    assert!(
        matches!(outcome, Err(ModelError::Timeout { after, .. }) if after == CONFIGURED),
        "the stalled third attempt times out: {outcome:?}"
    );
    assert_eq!(requests.load(Ordering::SeqCst), 3);
    assert_eq!(
        started.elapsed(),
        Duration::from_secs(120) + CONFIGURED,
        "both waits ran in full, and the ceiling was measured from the third attempt"
    );
}

/// The streaming transport under a gateway that stalls **mid-reply**: the call is cut at the
/// configured ceiling and surfaces as [`ModelError::Timeout`] naming the provider the chunk that did
/// arrive named, never as a retry-exhausted transport failure.
///
/// The provider is what shows the reply's own stream reached [`read_stream`] and that its verdict
/// reached the error: a call cut anywhere before the body has read nothing that could name one.
#[tokio::test(start_paused = true)]
async fn a_mid_stream_stall_times_out_at_the_configured_ceiling() {
    let (client, requests) = stalled_client(FIRST_EVENT);
    let client = client.with_loop_detection(armed_loop_detection());

    let started = tokio::time::Instant::now();
    let outcome = client.complete(&[Message::user("build it")], &[]).await;
    assert_eq!(
        started.elapsed(),
        CONFIGURED,
        "the call was cut by a bound other than the configured ceiling"
    );

    match outcome {
        Err(ModelError::Timeout { after, provider }) => {
            assert_eq!(after, CONFIGURED);
            assert_eq!(
                provider.as_deref(),
                Some("slowco"),
                "the stalled stream's first chunk named who was serving it"
            );
        }
        other => panic!("a stalled stream must time out, got {other:?}"),
    }
    assert_eq!(
        requests.load(Ordering::SeqCst),
        1,
        "a stall is not retried internally"
    );
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

    let started = tokio::time::Instant::now();
    let outcome = read_stream(stream, config, DEFAULT_MODEL_CALL_TIMEOUT).await;
    assert_eq!(started.elapsed(), DEFAULT_MODEL_CALL_TIMEOUT);
    match outcome {
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
