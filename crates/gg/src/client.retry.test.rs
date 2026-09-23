//! The client's **retry schedule**: which statuses it retries, how long it waits between attempts,
//! when it honours a provider's `Retry-After`, what it says on the calling agent's stream as it
//! goes, and what it returns once the schedule is spent.
//!
//! Every test that drives a request runs under `start_paused` time against a gateway the client
//! is [answered by](OpenRouterClient::answered_by), so a minute of backoff elapses the moment the
//! runtime has nothing else to do, and the paused clock reads exactly the waits the schedule took.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use test_cabinet_core::gg::GgTelemetryKind;

use super::*;
use crate::model::{Message, ModelClient, ModelError};
use crate::telemetry::{CollectingSink, Emitter};

/// A usable completion body, for the attempt that finally answers.
const ANSWER: &str =
    r#"{"choices":[{"message":{"role":"assistant","content":"done"},"finish_reason":"stop"}]}"#;

/// One scripted reply: a status, the `Retry-After` it carries if any, and its body.
type Reply = (u16, Option<&'static str>, &'static str);

/// A client on `policy` answered by `replies` in order, the last repeated once they run out, and
/// the count of requests it was sent.
fn scripted(policy: RetryPolicy, replies: Vec<Reply>) -> (OpenRouterClient, Arc<AtomicUsize>) {
    let requests = Arc::new(AtomicUsize::new(0));
    let seen = Arc::clone(&requests);
    let client = OpenRouterClient::new(
        "http://gateway.invalid/api/v1",
        reqwest::Client::new(),
        "openai/gpt-5.6",
        "sk-test",
        policy,
        None,
    )
    .answered_by(move |_| {
        let n = seen.fetch_add(1, Ordering::SeqCst);
        let (status, retry_after, body) = replies[n.min(replies.len() - 1)];
        let mut builder = http::Response::builder().status(status);
        if let Some(value) = retry_after {
            builder = builder.header("retry-after", value);
        }
        builder
            .body(reqwest::Body::from(body))
            .expect("a well-formed response")
            .into()
    });
    (client, requests)
}

/// A schedule of `retries` retries against a `ceiling`-second delay ceiling, read the way a run's
/// declared limits are.
fn schedule(retries: u64, ceiling: u64) -> RetryPolicy {
    crate::limits::declared_retry_policy(&test_cabinet_core::gg::GgRunLimits {
        max_model_retries: Some(retries),
        model_retry_max_delay_secs: Some(ceiling),
        ..Default::default()
    })
}

/// Every `warn` line on the sink, with the agent id it was stamped with.
fn warnings(sink: &CollectingSink) -> Vec<(Option<String>, String)> {
    sink.events()
        .into_iter()
        .filter_map(|event| match event.kind {
            GgTelemetryKind::Log { level, message } if level == "warn" => {
                Some((event.agent_id, message))
            }
            _ => None,
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Classification and the schedule's arithmetic
// ---------------------------------------------------------------------------

/// 2xx succeed, 429 and 5xx retry, everything else (auth, validation) is fatal.
#[test]
fn classify_status_partitions_retryable_from_fatal() {
    assert_eq!(classify_status(200), StatusClass::Success);
    assert_eq!(classify_status(204), StatusClass::Success);
    assert_eq!(classify_status(429), StatusClass::Retryable);
    assert_eq!(classify_status(500), StatusClass::Retryable);
    assert_eq!(classify_status(502), StatusClass::Retryable);
    assert_eq!(classify_status(503), StatusClass::Retryable);
    assert_eq!(classify_status(401), StatusClass::Fatal);
    assert_eq!(classify_status(400), StatusClass::Fatal);
    assert_eq!(classify_status(404), StatusClass::Fatal);
}

/// Backoff starts at one second, doubles per attempt, and is capped at `max_delay`.
#[test]
fn backoff_delay_doubles_and_caps() {
    let policy = RetryPolicy::default();
    assert_eq!(backoff_delay(1, &policy), Duration::from_secs(1));
    assert_eq!(backoff_delay(2, &policy), Duration::from_secs(2));
    assert_eq!(backoff_delay(3, &policy), Duration::from_secs(4));
    assert_eq!(backoff_delay(4, &policy), Duration::from_secs(8));
    assert_eq!(backoff_delay(6, &policy), Duration::from_secs(32));
    assert_eq!(backoff_delay(7, &policy), Duration::from_secs(60));
    // Beyond the cap it saturates rather than overflowing.
    assert_eq!(backoff_delay(64, &policy), Duration::from_secs(60));
}

/// The default policy is the absent-key schedule: ten retries after the first attempt, the first
/// waiting a second and doubling to a sixty-second ceiling, which is about five minutes of waiting
/// across the ten.
#[test]
fn the_default_policy_is_the_absent_key_schedule() {
    let policy = RetryPolicy::default();
    assert_eq!(DEFAULT_MAX_MODEL_RETRIES, 10);
    assert_eq!(policy.max_attempts, DEFAULT_MAX_MODEL_RETRIES + 1);
    assert_eq!(policy.base_delay, Duration::from_secs(1));
    assert_eq!(policy.max_delay, Duration::from_secs(60));
    // One wait after each of the first ten attempts; the eleventh is the last.
    let waited: u64 = (1..policy.max_attempts)
        .map(|attempt| backoff_delay(attempt, &policy).as_secs())
        .sum();
    // 1 + 2 + 4 + 8 + 16 + 32 + 60 + 60 + 60 + 60.
    assert_eq!(waited, 303);
}

/// Thirty retries at the default ceiling wait about half an hour, the figure an operator is told
/// the schedule scales to.
#[test]
fn thirty_retries_at_the_default_ceiling_wait_about_half_an_hour() {
    let policy = schedule(30, 60);
    let waited: u64 = (1..policy.max_attempts)
        .map(|attempt| backoff_delay(attempt, &policy).as_secs())
        .sum();
    assert_eq!(waited, 63 + 24 * 60);
}

/// A `Retry-After` header is read as its seconds form; a date, a malformed value and an absent
/// header are each read as no answer, which leaves the schedule's own delay standing.
#[test]
fn retry_after_reads_the_seconds_form_only() {
    let with_header = |value: &str| -> reqwest::Response {
        http::Response::builder()
            .status(503)
            .header("retry-after", value)
            .body(reqwest::Body::from(""))
            .expect("a well-formed response")
            .into()
    };
    assert_eq!(
        retry_after_delay(&with_header("120")),
        Some(Duration::from_secs(120))
    );
    assert_eq!(
        retry_after_delay(&with_header(" 45 ")),
        Some(Duration::from_secs(45))
    );
    assert_eq!(retry_after_delay(&with_header("soon")), None);
    assert_eq!(
        retry_after_delay(&with_header("Wed, 21 Oct 2026 07:28:00 GMT")),
        None
    );
    let without: reqwest::Response = http::Response::builder()
        .status(429)
        .body(reqwest::Body::from(""))
        .expect("a well-formed response")
        .into();
    assert_eq!(retry_after_delay(&without), None);
}

/// The wait before a retry is the schedule's delay, or the `Retry-After` the provider asked for
/// when that is the longer one.
#[test]
fn retry_wait_takes_the_longer_of_the_schedule_and_retry_after() {
    let policy = RetryPolicy::default();
    assert_eq!(
        retry_wait(3, &policy, Some(Duration::from_secs(1))),
        Duration::from_secs(4)
    );
    assert_eq!(
        retry_wait(3, &policy, Some(Duration::from_secs(90))),
        Duration::from_secs(90)
    );
    assert_eq!(retry_wait(3, &policy, None), Duration::from_secs(4));
}

// ---------------------------------------------------------------------------
// The schedule driven end to end
// ---------------------------------------------------------------------------

/// A failing gateway is retried on the configured schedule, and a `503` carrying a longer
/// `Retry-After` waits the header's figure rather than the schedule's.
#[tokio::test(start_paused = true)]
async fn retries_run_on_the_configured_schedule_with_retry_after_honoured() {
    let (client, requests) = scripted(
        RetryPolicy::default(),
        vec![
            (429, None, "slow down"),
            (502, None, "bad gateway"),
            (503, Some("120"), "overloaded"),
            (200, None, ANSWER),
        ],
    );

    let started = tokio::time::Instant::now();
    let outcome = client.complete(&[Message::user("build it")], &[]).await;
    assert!(outcome.is_ok(), "the fourth attempt answers: {outcome:?}");
    assert_eq!(requests.load(Ordering::SeqCst), 4);
    // 1 s, 2 s, then the 120 s the `503` asked for over the schedule's 4 s.
    assert_eq!(started.elapsed(), Duration::from_secs(123));
}

/// A `429` carrying a `Retry-After` is honoured the same way a `503` is.
#[tokio::test(start_paused = true)]
async fn a_429_retry_after_is_honoured() {
    let (client, _) = scripted(
        RetryPolicy::default(),
        vec![(429, Some("45"), "rate limited"), (200, None, ANSWER)],
    );
    let started = tokio::time::Instant::now();
    client
        .complete(&[Message::user("build it")], &[])
        .await
        .expect("the second attempt answers");
    assert_eq!(started.elapsed(), Duration::from_secs(45));
}

/// A `Retry-After` on any other retryable status is not read: the schedule's own delay stands.
#[tokio::test(start_paused = true)]
async fn a_retry_after_on_a_500_is_not_read() {
    let (client, _) = scripted(
        RetryPolicy::default(),
        vec![(500, Some("120"), "boom"), (200, None, ANSWER)],
    );
    let started = tokio::time::Instant::now();
    client
        .complete(&[Message::user("build it")], &[])
        .await
        .expect("the second attempt answers");
    assert_eq!(started.elapsed(), Duration::from_secs(1));
}

/// The schedule spent ends in `RetryExhausted` naming every attempt, after exactly the waits the
/// configured count and ceiling allow.
#[tokio::test(start_paused = true)]
async fn a_spent_schedule_is_retry_exhausted_after_its_configured_waits() {
    let (client, requests) = scripted(schedule(3, 2), vec![(503, None, "down")]);

    let started = tokio::time::Instant::now();
    let outcome = client.complete(&[Message::user("build it")], &[]).await;

    match outcome {
        Err(ModelError::RetryExhausted { attempts, last }) => {
            assert_eq!(attempts, 4);
            assert!(last.starts_with("HTTP 503"), "{last}");
        }
        other => panic!("a spent schedule is retry-exhausted, got {other:?}"),
    }
    assert_eq!(requests.load(Ordering::SeqCst), 4);
    // 1 s, then 2 s twice: the doubling capped at the two-second ceiling.
    assert_eq!(started.elapsed(), Duration::from_secs(5));
}

/// Zero retries is honoured as written: one attempt, no wait, and the failure returned.
#[tokio::test(start_paused = true)]
async fn zero_retries_give_up_on_the_first_failure() {
    let (client, requests) = scripted(schedule(0, 60), vec![(502, None, "bad gateway")]);
    let sink = CollectingSink::new();
    client.announce_retries_on(&Emitter::with_sink(None, Box::new(sink.clone())));

    let started = tokio::time::Instant::now();
    let outcome = client.complete(&[Message::user("build it")], &[]).await;

    assert!(
        matches!(outcome, Err(ModelError::RetryExhausted { attempts: 1, .. })),
        "{outcome:?}"
    );
    assert_eq!(requests.load(Ordering::SeqCst), 1);
    assert_eq!(started.elapsed(), Duration::ZERO);
    assert!(warnings(&sink).is_empty(), "no retry, nothing to announce");
}

/// A fatal status is returned on the first attempt with nothing retried.
#[tokio::test(start_paused = true)]
async fn a_fatal_status_is_not_retried() {
    let (client, requests) = scripted(RetryPolicy::default(), vec![(400, None, "bad request")]);
    let outcome = client.complete(&[Message::user("build it")], &[]).await;
    assert!(
        matches!(outcome, Err(ModelError::Fatal { status: 400, .. })),
        "{outcome:?}"
    );
    assert_eq!(requests.load(Ordering::SeqCst), 1);
}

/// Each retry is a `warn` on the stream the calling agent handed the client, naming the attempt,
/// the status that failed it, and the wait before the next.
#[tokio::test(start_paused = true)]
async fn each_retry_is_announced_on_the_calling_agents_stream() {
    let (client, _) = scripted(
        schedule(4, 60),
        vec![
            (502, None, "bad gateway"),
            (429, Some("30"), "rate limited"),
            (200, None, ANSWER),
        ],
    );
    let sink = CollectingSink::new();
    let base = Emitter::with_sink(Some("run-1".to_string()), Box::new(sink.clone()));
    client.announce_retries_on(&base.for_agent("worker-7", Some("root".to_string())));

    client
        .complete(&[Message::user("build it")], &[])
        .await
        .expect("the third attempt answers");

    let worker = Some("worker-7".to_string());
    assert_eq!(
        warnings(&sink),
        vec![
            (
                worker.clone(),
                "model request attempt 1 of 5 failed (HTTP 502: bad gateway); retrying in 1.0s"
                    .to_string()
            ),
            (
                worker,
                "model request attempt 2 of 5 failed (HTTP 429: rate limited); retrying in 30.0s"
                    .to_string()
            ),
        ]
    );
}

/// The streaming transport retries on the same schedule and honours `Retry-After` the same way.
#[tokio::test(start_paused = true)]
async fn the_streaming_transport_retries_on_the_same_schedule() {
    let (client, requests) = scripted(
        schedule(2, 60),
        vec![(503, Some("20"), "overloaded"), (502, None, "bad gateway")],
    );
    let client = client.with_loop_detection(test_cabinet_core::gg::GgLoopDetection {
        enabled: true,
        window_words: Some(256),
        repeat_threshold: Some(32),
        min_offenders: Some(2),
        min_saturated_run: Some(3000),
        max_response_chars: Some(0),
    });
    assert!(
        client.streams(),
        "loop detection puts the client on the streaming transport"
    );
    let sink = CollectingSink::new();
    client.announce_retries_on(&Emitter::with_sink(None, Box::new(sink.clone())));

    let started = tokio::time::Instant::now();
    let outcome = client.complete(&[Message::user("build it")], &[]).await;

    assert!(
        matches!(outcome, Err(ModelError::RetryExhausted { attempts: 3, .. })),
        "{outcome:?}"
    );
    assert_eq!(requests.load(Ordering::SeqCst), 3);
    // The 20 s the `503` asked for, then the schedule's 2 s.
    assert_eq!(started.elapsed(), Duration::from_secs(22));
    assert_eq!(warnings(&sink).len(), 2);
}
