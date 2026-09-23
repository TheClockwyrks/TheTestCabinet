//! The two clocks that bound one model call — the [per-attempt
//! ceiling](DEFAULT_MODEL_CALL_TIMEOUT) and the [stream-idle
//! bound](DEFAULT_MODEL_STREAM_IDLE) — against a **stalled gateway**: one that accepts the request
//! and never answers it again, which is exactly the failure that once held a run twenty minutes
//! inside one call with nothing able to interrupt it.
//!
//! Each test states the figure its client was built with, so what is asserted is the bound the
//! run configured rather than one gg picked.
//!
//! Every test here runs under `start_paused` time, so a bound elapses the moment the runtime has
//! nothing left to do rather than after the bound's figure in real seconds, and the paused clock
//! reads exactly the duration that cut the call — which is what shows it was the configured one.
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
use crate::telemetry::{CollectingSink, Emitter};

/// The [per-attempt ceiling](DEFAULT_MODEL_CALL_TIMEOUT) the tests configure: unlike the default,
/// so a call cut by the default instead reads differently on the paused clock.
const CONFIGURED: Duration = Duration::from_secs(37);

/// The [stream-idle bound](DEFAULT_MODEL_STREAM_IDLE) the tests configure: unlike the default, for
/// the same reason — and short enough that a stall is spent quickly on the paused clock.
const CONFIGURED_IDLE: Duration = Duration::from_secs(11);

/// The one SSE event a stalling stream sends before it goes quiet, naming the provider serving it.
const FIRST_EVENT: &str = "data: {\"provider\":\"slowco\",\"choices\":[{\"index\":0,\
                           \"delta\":{\"content\":\"working\"}}]}\n\n";

/// A schedule of two retries against a one-second base and the usual sixty-second ceiling: small
/// enough that the waits a test asserts on are the schedule's own arithmetic rather than a figure
/// the default policy had to spend first.
fn two_retries() -> RetryPolicy {
    RetryPolicy {
        max_attempts: 3,
        base_delay: Duration::from_secs(1),
        max_delay: Duration::from_secs(60),
    }
}

/// A gateway that answers `200` with `first` as the whole of what its body ever delivers, and then
/// never delivers another byte nor ends. Returns the client answered by it — on the retry schedule
/// and the two bounds the test names — and the count of the requests it was sent, the direct
/// evidence of how many attempts the client spent.
fn stalled_client(
    first: &'static str,
    retry: RetryPolicy,
    ceiling: Duration,
    idle: Duration,
) -> (OpenRouterClient, Arc<AtomicUsize>) {
    let requests = Arc::new(AtomicUsize::new(0));
    let seen = Arc::clone(&requests);
    let client = OpenRouterClient::new(
        "http://gateway.invalid/api/v1",
        reqwest::Client::new(),
        "openai/gpt-5.6",
        "sk-test",
        retry,
        None,
    )
    .with_model_call_timeout(ceiling)
    .with_stream_idle(idle)
    .answered_by(move |_| {
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

/// A stream that goes quiet without ever sending a delta is cut on **idleness** and **retried**: the
/// attempt is cancelled at the configured idle bound, the retry is announced naming the stall, and
/// the next attempt runs — so a provider that stops answering costs the run the idle bound per
/// attempt, not the call ceiling per turn. There is no provider to name, because no chunk that could
/// have named one ever arrived.
#[tokio::test(start_paused = true)]
async fn a_stalled_gateway_is_cancelled_at_the_idle_bound_and_retried() {
    let (client, requests) = stalled_client("", two_retries(), CONFIGURED, CONFIGURED_IDLE);

    let started = tokio::time::Instant::now();
    let outcome = client.complete(&[Message::user("build it")], &[]).await;

    assert_eq!(
        started.elapsed(),
        3 * CONFIGURED_IDLE + Duration::from_secs(1) + Duration::from_secs(2),
        "each stall cost its idle bound, and the waits between them are the schedule's own"
    );
    assert_eq!(requests.load(Ordering::SeqCst), 3);
    assert!(
        matches!(
            outcome,
            Err(ModelError::RetryExhausted { attempts: 3, .. })
        ),
        "a stall retried to the end of the schedule is a transport failure: {outcome:?}"
    );
}

/// The [call ceiling](DEFAULT_MODEL_CALL_TIMEOUT) bounds **each attempt's whole duration**, not the
/// backoff between them: a schedule whose waits add up to far more than the ceiling runs to its
/// answer, and an attempt that runs past the ceiling after earlier ones failed is cut at the
/// ceiling measured from its own start.
///
/// The stalled third attempt is served by a client whose idle bound is the wider of its two
/// clocks, so it is the ceiling that cuts it — the same reading a provider that streams nothing
/// until its reply is complete produces.
#[tokio::test(start_paused = true)]
async fn the_ceiling_bounds_each_attempt_and_leaves_the_backoff_outside() {
    let requests = Arc::new(AtomicUsize::new(0));
    let seen = Arc::clone(&requests);
    let client = OpenRouterClient::new(
        "http://gateway.invalid/api/v1",
        reqwest::Client::new(),
        "openai/gpt-5.6",
        "sk-test",
        two_retries(),
        None,
    )
    .with_model_call_timeout(CONFIGURED)
    .with_stream_idle(CONFIGURED + CONFIGURED)
    .answered_by(move |_| {
        let attempt = seen.fetch_add(1, Ordering::SeqCst);
        let builder = http::Response::builder();
        match attempt {
            // Two `503`s asking for a minute each: two minutes of waiting, past the ceiling.
            0 | 1 => builder
                .status(503)
                .header("retry-after", "60")
                .body(reqwest::Body::from("overloaded")),
            // Then an attempt that never answers at all — a silence only the ceiling bounds.
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
        "the stalled third attempt is cut by the ceiling: {outcome:?}"
    );
    assert_eq!(requests.load(Ordering::SeqCst), 3);
    assert_eq!(
        started.elapsed(),
        Duration::from_secs(120) + CONFIGURED,
        "both waits ran in full, and the ceiling was measured from the third attempt"
    );
}

/// A stream that stalls **mid-reply**, after a delta arrived, is cut on idleness at the configured
/// bound and retried, and the retry's `warn` names the provider the chunk that did arrive named —
/// a stalled provider is blacklistable by name exactly as a failing one is.
#[tokio::test(start_paused = true)]
async fn a_mid_stream_stall_is_cancelled_at_the_idle_bound_naming_its_provider() {
    let (client, requests) = stalled_client(FIRST_EVENT, two_retries(), CONFIGURED, CONFIGURED_IDLE);
    let sink = CollectingSink::new();
    client.announce_retries_on(&Emitter::with_sink(None, Box::new(sink.clone())));

    let started = tokio::time::Instant::now();
    let outcome = client.complete(&[Message::user("build it")], &[]).await;

    assert_eq!(
        started.elapsed(),
        3 * CONFIGURED_IDLE + Duration::from_secs(1) + Duration::from_secs(2)
    );
    assert_eq!(requests.load(Ordering::SeqCst), 3);
    assert!(
        matches!(outcome, Err(ModelError::RetryExhausted { .. })),
        "{outcome:?}"
    );
    let warned = sink
        .events()
        .into_iter()
        .filter_map(|event| match event.kind {
            GgTelemetryKind::Log { level, message } if level == "warn" => Some(message),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(warned.len(), 2, "one warn per retry: {warned:?}");
    assert!(
        warned[0].contains(
            "the stream stalled: no delta from the model for 11s (provider: slowco)"
        ),
        "the retry is announced as a stall naming the provider: {warned:?}"
    );
}

/// A call cut by the [ceiling](DEFAULT_MODEL_CALL_TIMEOUT) surfaces as [`ModelError::Timeout`]
/// **immediately**, without spending the retry budget: each internal retry of a ceiling-long
/// silence would cost the full ceiling again, and the turn-level retry is the bounded one the
/// error ceilings govern.
#[tokio::test(start_paused = true)]
async fn a_ceiling_long_silence_times_out_without_spending_retries() {
    let (client, requests) = stalled_client(
        "",
        two_retries(),
        CONFIGURED,
        // The idle bound is the wider of the two clocks, so the ceiling is the one that fires.
        CONFIGURED + CONFIGURED,
    );

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
                "a silence that never sent a chunk read nothing that could name a provider"
            );
        }
        other => panic!("a ceiling-long silence must time out, got {other:?}"),
    }
    assert_eq!(
        requests.load(Ordering::SeqCst),
        1,
        "the ceiling is not retried internally"
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
    let config = Some(resolved_config());

    let idle = Duration::from_secs(5);
    let started = tokio::time::Instant::now();
    let outcome = read_stream(stream, config, started + DEFAULT_MODEL_CALL_TIMEOUT, idle).await;
    assert_eq!(started.elapsed(), idle);
    match outcome {
        StreamOutcome::Stalled { idle, provider } => {
            assert_eq!(idle, Duration::from_secs(5));
            assert_eq!(
                provider.as_deref(),
                Some("slowco"),
                "the chunk that did arrive named who was serving the stalled stream"
            );
        }
        _ => panic!("a stream that stopped producing must end as a stall"),
    }
}

/// Keep-alive comments and blank lines do not restart the idle clock: a provider that has stopped
/// answering can send them forever, and a reader that mistook one for progress would wait the call
/// ceiling out on each. The stall is measured from the **delta**, and the paused clock reads the
/// delta's gap plus the bound, not the keep-alive's arrival.
#[tokio::test(start_paused = true)]
async fn keep_alives_do_not_restart_the_idle_clock() {
    let stream = futures_util::stream::iter([Ok::<_, std::convert::Infallible>(
        FIRST_EVENT.as_bytes(),
    )])
    .chain(futures_util::stream::unfold((), |()| async move {
        // A keep-alive comment every two seconds, forever, and never a delta again.
        tokio::time::sleep(Duration::from_secs(2)).await;
        Some((Ok(": OPENROUTER PROCESSING\n\n".as_bytes()), ()))
    }));
    let idle = Duration::from_secs(5);
    let started = tokio::time::Instant::now();
    let outcome = read_stream(
        Box::pin(stream),
        None,
        started + DEFAULT_MODEL_CALL_TIMEOUT,
        idle,
    )
    .await;
    // The delta arrived at 0 s; keep-alives at 2 s and 4 s; the bound expires at 5 s — a clock
    // restarted by either keep-alive would have read 6 s or 7 s instead.
    assert_eq!(started.elapsed(), idle);
    assert!(
        matches!(outcome, StreamOutcome::Stalled { idle, .. } if idle == Duration::from_secs(5)),
        "keep-alives are not progress: {outcome:?}"
    );
}

/// The detector configuration the streaming tests arm, resolved the way the client resolves it.
fn resolved_config() -> LoopGuardConfig {
    LoopGuardConfig {
        window_words: 256,
        repeat_threshold: 32,
        min_offenders: 2,
        min_saturated_run: 3000,
        max_response_chars: 0,
    }
}
