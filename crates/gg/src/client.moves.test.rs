//! **Moving to the next candidate** on the live client: a schedule spent on a provider's failures
//! and a candidate the gateway refuses both move the run, the last candidate does not, and a
//! provider that keeps missing its cache is left at the next request.
//!
//! Every test runs under `start_paused` time against a gateway that answers by the provider the
//! request named, so each test reads exactly which candidate every attempt was sent to.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use test_cabinet_core::gg::{GgProviderCandidate, GgProviderFault, GgTelemetryKind};

use super::*;
use crate::model::{Message, ModelClient, ModelError};
use crate::telemetry::{CollectingSink, Emitter};

const MODEL: &str = "z-ai/glm-5.3";

/// A reply served by `provider` whose usage reports `prompt` input tokens, `cached` of them read
/// from the cache.
fn answer(provider: &str, prompt: u64, cached: u64) -> String {
    let chunk = |body: Value| format!("data: {body}\n\n");
    [
        chunk(json!({
            "provider": provider,
            "choices": [{ "index": 0, "delta": { "content": "done" } }]
        })),
        chunk(json!({
            "provider": provider,
            "choices": [{ "index": 0, "delta": {}, "finish_reason": "stop" }]
        })),
        chunk(json!({
            "provider": provider,
            "choices": [],
            "usage": {
                "prompt_tokens": prompt,
                "completion_tokens": 5,
                "prompt_tokens_details": { "cached_tokens": cached }
            }
        })),
        "data: [DONE]\n\n".to_string(),
    ]
    .concat()
}

/// What the gateway answers a request naming one provider: a status and a body.
type Script = Arc<dyn Fn(&str, usize) -> (u16, String) + Send + Sync>;

/// A client for [`MODEL`] on the candidates `providers` (all `fp8`), retrying `retries` times,
/// answered by `script` given the provider each request named and how many requests that provider
/// has been sent. Returns the client, the providers every request named in order, and the sink its
/// events land on.
fn client_on(
    providers: &[&str],
    retries: u32,
    miss_limit: u64,
    script: Script,
) -> (OpenRouterClient, Arc<Mutex<Vec<String>>>, CollectingSink) {
    let named = Arc::new(Mutex::new(Vec::<String>::new()));
    let seen = Arc::clone(&named);
    let roster = ProviderRoster::new(BTreeMap::from([(
        MODEL.to_string(),
        providers
            .iter()
            .map(|provider| GgProviderCandidate::new(*provider, "fp8"))
            .collect(),
    )]));
    let client = OpenRouterClient::new(
        "http://gateway.invalid/api/v1",
        reqwest::Client::new(),
        MODEL,
        "sk-test",
        RetryPolicy {
            max_attempts: retries + 1,
            ..RetryPolicy::default()
        },
        None,
    )
    .with_stream_idle(Duration::from_secs(9))
    .with_roster(roster.with_miss_limit(miss_limit))
    .answered_by(move |request| {
        let body: Value = serde_json::from_slice(
            request
                .body()
                .and_then(reqwest::Body::as_bytes)
                .expect("a buffered body"),
        )
        .expect("a JSON body");
        assert_eq!(body["provider"]["allow_fallbacks"], json!(false));
        assert_eq!(body["provider"]["quantizations"], json!(["fp8"]));
        let provider = body["provider"]["only"][0]
            .as_str()
            .expect("every request names a provider")
            .to_string();
        let mut named = seen.lock().unwrap();
        let count = named.iter().filter(|seen| **seen == provider).count();
        named.push(provider.clone());
        let (status, text) = script(&provider, count);
        let mut builder = http::Response::builder().status(status);
        if status == 200 {
            builder = builder.header("content-type", "text/event-stream");
        }
        builder
            .body(reqwest::Body::from(text))
            .expect("a well-formed response")
            .into()
    });
    let sink = CollectingSink::new();
    client.announce_retries_on(&Emitter::with_sink(None, Box::new(sink.clone())));
    (client, named, sink)
}

/// Every `provider_switch` and `provider_fault` the client emitted, in order.
fn provider_events(sink: &CollectingSink) -> Vec<GgTelemetryKind> {
    sink.events()
        .into_iter()
        .map(|event| event.kind)
        .filter(|kind| {
            matches!(
                kind,
                GgTelemetryKind::ProviderSwitch { .. } | GgTelemetryKind::ProviderFault { .. }
            )
        })
        .collect()
}

/// A schedule spent on `5xx`s moves the run to the next candidate for the same request, which is
/// asked there on a fresh schedule, and every later request names the new candidate.
#[tokio::test(start_paused = true)]
async fn a_spent_schedule_moves_the_run_to_the_next_candidate() {
    let script: Script = Arc::new(|provider, _| match provider {
        "Z.AI" => (502, "bad gateway".to_string()),
        _ => (200, answer(provider, 10, 0)),
    });
    let (client, named, sink) = client_on(&["Z.AI", "Baidu"], 2, 2, script);

    let reply = client
        .complete(&[Message::user("build it")], &[])
        .await
        .expect("the next candidate answers");
    assert_eq!(reply.provider.as_deref(), Some("Baidu"));
    client
        .complete(&[Message::user("again")], &[])
        .await
        .expect("still on the next candidate");

    assert_eq!(
        *named.lock().unwrap(),
        ["Z.AI", "Z.AI", "Z.AI", "Baidu", "Baidu"]
    );
    assert_eq!(
        provider_events(&sink),
        [GgTelemetryKind::ProviderSwitch {
            model_id: MODEL.to_string(),
            from: "Z.AI".to_string(),
            to: "Baidu".to_string(),
            fault: GgProviderFault::FailedCall,
            detail: "HTTP 502: bad gateway".to_string(),
        }]
    );
}

/// A `404` is the gateway refusing the candidate outright, so the run moves at once with nothing
/// retried.
#[tokio::test(start_paused = true)]
async fn a_refused_candidate_moves_the_run_at_once() {
    let script: Script = Arc::new(|provider, _| match provider {
        "DeepSeek" => (
            404,
            "0 endpoints available matching your data policy".to_string(),
        ),
        _ => (200, answer(provider, 10, 0)),
    });
    let (client, named, sink) = client_on(&["DeepSeek", "DeepInfra"], 10, 2, script);

    let started = tokio::time::Instant::now();
    client
        .complete(&[Message::user("build it")], &[])
        .await
        .expect("the next candidate answers");
    assert_eq!(started.elapsed(), Duration::ZERO, "nothing was waited for");
    assert_eq!(*named.lock().unwrap(), ["DeepSeek", "DeepInfra"]);
    assert!(matches!(
        provider_events(&sink).as_slice(),
        [GgTelemetryKind::ProviderSwitch {
            fault: GgProviderFault::Unavailable,
            ..
        }]
    ));
}

/// On the model's last candidate there is nowhere to move: a spent schedule is the failed call it
/// always was, and a refusal is the fatal status it always was.
#[tokio::test(start_paused = true)]
async fn the_last_candidate_fails_the_request() {
    let script: Script = Arc::new(|_, _| (502, "bad gateway".to_string()));
    let (client, named, sink) = client_on(&["Z.AI", "Baidu"], 1, 2, script);
    let outcome = client.complete(&[Message::user("build it")], &[]).await;
    assert!(
        matches!(outcome, Err(ModelError::RetryExhausted { attempts: 2, .. })),
        "{outcome:?}"
    );
    assert_eq!(*named.lock().unwrap(), ["Z.AI", "Z.AI", "Baidu", "Baidu"]);
    assert_eq!(provider_events(&sink).len(), 1, "one move, then the end");

    let refused: Script = Arc::new(|_, _| (404, "no endpoints".to_string()));
    let (client, _, _) = client_on(&["Z.AI"], 3, 2, refused);
    let outcome = client.complete(&[Message::user("build it")], &[]).await;
    assert!(
        matches!(outcome, Err(ModelError::Fatal { status: 404, .. })),
        "{outcome:?}"
    );
}

/// A reply from a provider other than the one the request named is a mismatch, measured against
/// the candidate the request was sent to.
#[tokio::test(start_paused = true)]
async fn a_reply_from_another_provider_is_a_mismatch_against_the_named_candidate() {
    let script: Script = Arc::new(|_, _| (200, answer("Azure", 10, 0)));
    let (client, _, _) = client_on(&["OpenAI", "Baidu"], 0, 2, script);
    let outcome = client.complete(&[Message::user("build it")], &[]).await;
    assert!(
        matches!(
            &outcome,
            Err(ModelError::ProviderMismatch { pinned, served })
                if pinned == "OpenAI" && served == "Azure"
        ),
        "{outcome:?}"
    );
}

/// A conversation big enough to be owed a warm cache: a long system prompt and `turns` turns.
fn thread(turns: usize) -> Vec<Message> {
    let mut messages = vec![Message::system("s".repeat(40_000))];
    for turn in 0..turns {
        messages.push(Message::user(format!("turn {turn}")));
    }
    messages
}

/// Each reply that reads nothing of a warm prefix is a miss held against its provider; the one
/// that reaches the limit stands, and the next request goes to the next candidate.
#[tokio::test(start_paused = true)]
async fn a_provider_reaching_the_miss_limit_is_left_at_the_next_request() {
    let script: Script = Arc::new(|provider, _| (200, answer(provider, 12_000, 0)));
    let (client, named, sink) = client_on(&["Z.AI", "Baidu"], 0, 2, script);

    for turns in 1..=4 {
        let reply = client
            .complete(&thread(turns), &[])
            .await
            .expect("every miss is a good reply");
        assert_eq!(reply.text.as_deref(), Some("done"));
    }

    assert_eq!(*named.lock().unwrap(), ["Z.AI", "Z.AI", "Z.AI", "Baidu"]);
    let miss = |provider: &str| GgTelemetryKind::ProviderFault {
        model_id: MODEL.to_string(),
        provider: provider.to_string(),
        fault: GgProviderFault::CacheMiss,
    };
    assert_eq!(
        provider_events(&sink),
        [
            miss("Z.AI"),
            miss("Z.AI"),
            GgTelemetryKind::ProviderSwitch {
                model_id: MODEL.to_string(),
                from: "Z.AI".to_string(),
                to: "Baidu".to_string(),
                fault: GgProviderFault::CacheMiss,
                detail: "2 unexpected cache misses reached the limit of 2".to_string(),
            },
        ]
    );
}

/// A provider that reads its cache is never blamed, and the last candidate is kept whatever it
/// misses.
#[tokio::test(start_paused = true)]
async fn warm_reads_and_the_last_candidate_are_never_left_for_misses() {
    let warm: Script = Arc::new(|provider, _| (200, answer(provider, 12_000, 11_000)));
    let (client, named, sink) = client_on(&["Z.AI", "Baidu"], 0, 1, warm);
    for turns in 1..=3 {
        client.complete(&thread(turns), &[]).await.expect("a reply");
    }
    assert_eq!(*named.lock().unwrap(), ["Z.AI", "Z.AI", "Z.AI"]);
    assert!(provider_events(&sink).is_empty());

    let cold: Script = Arc::new(|provider, _| (200, answer(provider, 12_000, 0)));
    let (client, named, sink) = client_on(&["Z.AI"], 0, 1, cold);
    for turns in 1..=3 {
        client.complete(&thread(turns), &[]).await.expect("a reply");
    }
    assert_eq!(*named.lock().unwrap(), ["Z.AI", "Z.AI", "Z.AI"]);
    assert!(
        provider_events(&sink)
            .iter()
            .all(|event| matches!(event, GgTelemetryKind::ProviderFault { .. })),
        "misses are still recorded, but nothing moves"
    );
}

/// A stall is recorded as a fault against the provider the request named, beside its retry.
#[tokio::test(start_paused = true)]
async fn a_stall_is_a_fault_against_the_named_provider() {
    let named = Arc::new(Mutex::new(0usize));
    let seen = Arc::clone(&named);
    let client = OpenRouterClient::new(
        "http://gateway.invalid/api/v1",
        reqwest::Client::new(),
        MODEL,
        "sk-test",
        RetryPolicy {
            max_attempts: 2,
            ..RetryPolicy::default()
        },
        None,
    )
    .with_stream_idle(Duration::from_secs(9))
    .with_roster(ProviderRoster::pinned(
        MODEL,
        GgProviderCandidate::new("Z.AI", "fp8"),
    ))
    .answered_by(move |_| {
        let mut attempts = seen.lock().unwrap();
        *attempts += 1;
        let body = if *attempts == 1 {
            reqwest::Body::wrap_stream(futures_util::stream::pending::<
                Result<&'static str, std::io::Error>,
            >())
        } else {
            reqwest::Body::from(answer("Z.AI", 10, 0))
        };
        http::Response::builder()
            .status(200)
            .header("content-type", "text/event-stream")
            .body(body)
            .expect("a well-formed response")
            .into()
    });
    let sink = CollectingSink::new();
    client.announce_retries_on(&Emitter::with_sink(None, Box::new(sink.clone())));

    client
        .complete(&[Message::user("build it")], &[])
        .await
        .expect("the retry answers");
    assert_eq!(
        provider_events(&sink),
        [GgTelemetryKind::ProviderFault {
            model_id: MODEL.to_string(),
            provider: "Z.AI".to_string(),
            fault: GgProviderFault::Stall,
        }]
    );
}
