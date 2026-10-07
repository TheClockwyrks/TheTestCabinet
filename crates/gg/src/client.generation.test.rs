//! Tests for the **generation ledger**: the [generation id](StreamAccumulator::generation_id) a
//! streamed reply names, the [record](AbandonedReplies) a reply abandoned to
//! [loop detection](crate::loopguard) is kept on, and the [lookup](OpenRouterClient::lookup_generation)
//! that reads its price back at session end.
//!
//! Split from `client.test.rs` on the terms the coding policy allows: one file per subject, both
//! ending in `.test.rs`. Everything here is network-free — the client is
//! [answered by](OpenRouterClient::answered_by) a gateway closure, and the lookup's retry schedule
//! runs under `start_paused` time so its whole budget elapses the moment the runtime has nothing
//! else to do.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use serde_json::json;

use super::*;

/// A fully specified armed [detector](GgLoopDetection) with knobs small enough that a repetition of
/// `void 0;` trips it inside a single chunk: a window of eight words, an offender at more than
/// three occurrences, two offenders required, and six saturated words before the trip.
fn tripping_declaration() -> GgLoopDetection {
    GgLoopDetection {
        enabled: true,
        window_words: Some(8),
        repeat_threshold: Some(3),
        min_offenders: Some(2),
        min_saturated_run: Some(6),
        max_response_chars: Some(0),
    }
}

/// One server-sent event carrying `chunk`.
fn event(chunk: Value) -> String {
    format!("data: {chunk}\n\n")
}

/// A `200` streaming `body`.
fn stream(body: String) -> reqwest::Response {
    http::Response::builder()
        .status(200)
        .header("content-type", "text/event-stream")
        .body(reqwest::Body::wrap_stream(futures_util::stream::iter([
            Ok::<String, std::io::Error>(body),
        ])))
        .expect("a well-formed response")
        .into()
}

/// A plain-body response — the generation ledger's JSON (or its error).
fn json_response(status: u16, body: &str) -> reqwest::Response {
    http::Response::builder()
        .status(status)
        .body(reqwest::Body::from(body.to_string()))
        .expect("a well-formed response")
        .into()
}

/// A stream whose one chunk is the repetition the detector abandons: `void 0;` over and over,
/// named `id`.
fn looping_stream(id: &str) -> reqwest::Response {
    let content = "void 0; ".repeat(40);
    stream(event(
        json!({ "id": id, "choices": [{ "delta": { "content": content } }] }),
    ))
}

/// A short, ordinary reply under `id`, delivered whole and ended.
fn reply_stream(id: &str) -> reqwest::Response {
    stream(format!(
        "{}{}{}",
        event(json!({ "id": id, "choices": [{ "delta": { "content": "hello" } }] })),
        event(json!({ "id": id, "choices": [{ "delta": {}, "finish_reason": "stop" }] })),
        "data: [DONE]\n\n",
    ))
}

/// A client on the default schedule, answered by `gateway`, resolved for the `implementer` agent
/// profile and keeping its abandons on `record`.
fn client_keeping(
    record: AbandonedReplies,
    gateway: impl Fn(&reqwest::Request) -> reqwest::Response + Send + Sync + 'static,
) -> OpenRouterClient {
    OpenRouterClient::new(
        "http://gateway.invalid/api/v1",
        reqwest::Client::new(),
        "openai/gpt-5.6",
        "sk-test",
        RetryPolicy::default(),
        None,
    )
    .with_profile("implementer")
    .with_abandoned_replies(record)
    .answered_by(gateway)
}

/// **The generation id is the `id` on the first streamed chunk** — read by the time a reply is
/// abandoned, which is the whole reason it can be priced at all: the stream is dropped mid-reply
/// and never delivers its usage, so this id is the only handle the price has.
#[test]
fn the_generation_id_is_the_id_on_the_first_chunk() {
    let mut accumulator = StreamAccumulator::new();
    assert_eq!(accumulator.generation_id(), None);

    // A chunk that names none leaves it unset — and the usage trailer carries none either.
    accumulator
        .push_bytes(event(json!({ "choices": [{ "delta": { "content": "hi" } }] })).as_bytes())
        .expect("a readable chunk");
    assert_eq!(accumulator.generation_id(), None);

    accumulator
        .push_bytes(
            event(json!({ "id": "gen-7", "choices": [{ "delta": { "content": "there" } }] }))
                .as_bytes(),
        )
        .expect("a readable chunk");
    assert_eq!(accumulator.generation_id(), Some("gen-7"));

    // The first one wins: a later chunk repeating another id does not move it.
    accumulator
        .push_bytes(
            event(json!({ "id": "gen-8", "choices": [{ "delta": { "content": "!" } }] }))
                .as_bytes(),
        )
        .expect("a readable chunk");
    assert_eq!(accumulator.generation_id(), Some("gen-7"));
}

/// **An abandoned reply keeps its generation id and its size on the run's record** — the one
/// record carrying what the detector counted and what the ledger will price it under. The retry
/// that follows the abandonment works normally and carries the tally, so a turn that survives a
/// loop and the record agree about how many replies were thrown away.
#[tokio::test(start_paused = true)]
async fn an_abandoned_reply_keeps_its_generation_id_and_size_on_the_record() {
    let record = AbandonedReplies::default();
    let attempts = Arc::new(AtomicUsize::new(0));
    let seen = Arc::clone(&attempts);
    let client = client_keeping(record.clone(), move |_| {
        if seen.fetch_add(1, Ordering::SeqCst) == 0 {
            looping_stream("gen-loop")
        } else {
            reply_stream("gen-good")
        }
    })
    .with_loop_detection(tripping_declaration());

    let reply = client
        .complete(&[Message::user("go")], &[])
        .await
        .expect("the retry answered");
    assert_eq!(reply.loop_aborts.attempts, 1, "one reply was abandoned");
    assert_eq!(attempts.load(Ordering::SeqCst), 2);

    let kept = record.list();
    assert_eq!(kept.len(), 1, "the abandoned reply is kept: {kept:?}");
    assert_eq!(kept[0].generation_id.as_deref(), Some("gen-loop"));
    assert!(
        kept[0].words > 0,
        "the record carries the size: {:?}",
        kept[0]
    );
    assert!(kept[0].chars > 0, "in both units: {:?}", kept[0]);
    assert_eq!(kept[0].profile_id, "implementer", "and the slot it ran on");
    assert_eq!(kept[0].model_id, "openai/gpt-5.6");
}

/// **The lookup reads what the ledger reported**: the `total_cost`, the token counts mapped onto
/// the shared metrics contract exactly as a stream's usage block is (cached input subtracted from
/// the prompt total, reasoning subtracted from the completion total), who served it, and the
/// record verbatim beside the figures mapped off it.
#[tokio::test(start_paused = true)]
async fn the_generation_lookup_reads_what_the_ledger_reported() {
    let record = json!({
        "id": "gen-1",
        "total_cost": 0.35,
        "provider_name": "Z.AI",
        "streamed": true,
        "cancelled": true,
        "native_tokens_prompt": 1_200,
        "native_tokens_cached": 200,
        "native_tokens_completion": 5_080,
        "native_tokens_reasoning": 80,
    });
    let asked: Arc<Mutex<Option<(String, String)>>> = Arc::new(Mutex::new(None));
    let seen = Arc::clone(&asked);
    let ledger_record = record.clone();
    let client = client_keeping(AbandonedReplies::default(), move |request| {
        *seen
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) =
            Some((request.method().to_string(), request.url().to_string()));
        json_response(200, &json!({ "data": ledger_record.clone() }).to_string())
    });

    let spend = client
        .price_generation("gen-1")
        .await
        .expect("the ledger answered");

    let (method, url) = asked
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone()
        .expect("the lookup asked the gateway");
    assert_eq!(method, "GET");
    assert_eq!(url, "http://gateway.invalid/api/v1/generation?id=gen-1");
    assert_eq!(
        spend.tokens,
        TokenCounts {
            uncached_input: Some(1_000),
            cached_input: Some(200),
            output: Some(5_000),
            reasoning: Some(80),
        },
        "the token counts land in the shared classes"
    );
    assert_eq!(
        spend.cost,
        Some(Cost {
            comparable: Some(0.35),
            actual: Some(0.35),
        }),
        "and `total_cost` is the price"
    );
    assert_eq!(spend.provider.as_deref(), Some("Z.AI"));
    assert_eq!(spend.wire, Some(record), "the record verbatim rides beside");
    assert!(!spend.reconciled, "the ledger's own split stands");
}

/// **A `404` is "not yet" and is retried**: the ledger settles a cancelled stream's entry only
/// after a delay, so the lookup asks again on its short schedule until it answers.
#[tokio::test(start_paused = true)]
async fn the_generation_lookup_retries_a_404_until_the_ledger_answers() {
    let attempts = Arc::new(AtomicUsize::new(0));
    let seen = Arc::clone(&attempts);
    let client = client_keeping(AbandonedReplies::default(), move |_| {
        if seen.fetch_add(1, Ordering::SeqCst) < 2 {
            json_response(404, r#"{"error":{"message":"generation not found"}}"#)
        } else {
            json_response(
                200,
                &json!({ "data": { "id": "gen-1", "total_cost": 0.35 } }).to_string(),
            )
        }
    });

    let spend = client.price_generation("gen-1").await;
    assert!(spend.is_some(), "the settled entry is priced");
    assert_eq!(
        attempts.load(Ordering::SeqCst),
        3,
        "two `404`s, then the answer"
    );
}

/// **A lookup the ledger never answers is bounded by its budget** — a few tens of seconds in
/// total, after which the reply stays unpriced rather than holding the session's epilogue open.
#[tokio::test(start_paused = true)]
async fn a_generation_lookup_the_ledger_never_answers_is_bounded_by_its_budget() {
    let attempts = Arc::new(AtomicUsize::new(0));
    let seen = Arc::clone(&attempts);
    let client = client_keeping(AbandonedReplies::default(), move |_| {
        seen.fetch_add(1, Ordering::SeqCst);
        json_response(404, r#"{"error":{"message":"generation not found"}}"#)
    });

    let started = tokio::time::Instant::now();
    assert!(client.price_generation("gen-1").await.is_none());
    assert_eq!(started.elapsed(), GENERATION_LOOKUP_BUDGET);
    assert_eq!(
        attempts.load(Ordering::SeqCst),
        16,
        "one attempt every two seconds across the whole budget"
    );
}

/// **A status other than `404` is the ledger answering as best it ever will** — retried would be
/// hammering a gateway that has already said something other than "not yet" — so the lookup gives
/// up at once and the reply stays unpriced.
#[tokio::test(start_paused = true)]
async fn a_generation_lookup_gives_up_on_any_status_but_a_404() {
    let attempts = Arc::new(AtomicUsize::new(0));
    let seen = Arc::clone(&attempts);
    let client = client_keeping(AbandonedReplies::default(), move |_| {
        seen.fetch_add(1, Ordering::SeqCst);
        json_response(500, r#"{"error":{"message":"boom"}}"#)
    });

    assert!(client.price_generation("gen-1").await.is_none());
    assert_eq!(attempts.load(Ordering::SeqCst), 1);
}

/// **A body that is no generation record reads as no answer** — the same unpriced outcome as a
/// lookup that never resolved — so a gateway that answers `200` with something unreadable can
/// never put a figure into the run's totals that nothing said.
#[test]
fn a_body_that_is_no_generation_record_reads_as_no_answer() {
    assert!(generation_spend("not json").is_none());
    assert!(generation_spend("{}").is_none());
    assert!(generation_spend(r#"{"data": "not a record"}"#).is_none());
}
