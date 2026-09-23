//! The run's **routing key** on the wire: one minted cuid2, sent as both `session_id` and
//! `prompt_cache_key` (and as the `x-session-id` header) on every request of the run, on the one
//! transport, whatever the run's session id is.
//!
//! The client tests drive real requests through a gateway the client is
//! [answered by](OpenRouterClient::answered_by), which is handed the request exactly as it would
//! have gone out, so they read the headers and body the provider would have read.

use std::sync::{Arc, Mutex};

use serde_json::json;
use test_cabinet_core::gg::{GgLoopDetection, GgSlotBinding, PRIMARY_SLOT};

use super::*;
use crate::model::{Message, ModelClient, ToolDefinition};

/// A usable streamed completion: one text chunk, a stop, and the terminator.
const ANSWER: &str = concat!(
    r#"data: {"choices":[{"index":0,"delta":{"content":"done"}}]}"#,
    "\n\n",
    r#"data: {"choices":[{"delta":{},"finish_reason":"stop"}]}"#,
    "\n\n",
    "data: [DONE]\n\n",
);

/// What one request carried: its `x-session-id` header and its parsed body.
type Sent = (Option<String>, Value);

/// `client` answered with `answer`, and the requests it sends as they went out.
fn recorded(
    client: OpenRouterClient,
    answer: &'static str,
) -> (OpenRouterClient, Arc<Mutex<Vec<Sent>>>) {
    let sent = Arc::new(Mutex::new(Vec::new()));
    let log = Arc::clone(&sent);
    let client = client.answered_by(move |request| {
        let header = request
            .headers()
            .get(SESSION_ID_HEADER)
            .map(|value| value.to_str().expect("an ASCII header").to_string());
        let body = request
            .body()
            .and_then(reqwest::Body::as_bytes)
            .map(|bytes| serde_json::from_slice(bytes).expect("a JSON body"))
            .expect("a request body");
        log.lock().expect("the log").push((header, body));
        http::Response::builder()
            .status(200)
            .header("content-type", "text/event-stream")
            .body(reqwest::Body::from(answer))
            .expect("a well-formed response")
            .into()
    });
    (client, sent)
}

/// A loop-detection declaration that arms the detector — which decides only whether anything
/// watches the stream, since every reply is streamed either way.
fn armed() -> GgLoopDetection {
    GgLoopDetection {
        enabled: true,
        window_words: Some(256),
        repeat_threshold: Some(32),
        min_offenders: Some(2),
        min_saturated_run: Some(3_000),
        max_response_chars: Some(250_000),
    }
}

/// Build both of an agent's possible clients from the production constructor for one run's `key`:
/// one with the detector off and one for an agent that armed it — both of them streaming, which is
/// what the request bodies below are read from.
///
/// Each nextest test runs in its own process, so setting the credential here is isolated.
fn clients_for(key: &RoutingKey) -> (OpenRouterClient, OpenRouterClient) {
    let saved = std::env::var_os(API_KEY_ENV);
    // SAFETY: nextest isolates each test in its own process.
    unsafe {
        std::env::set_var(API_KEY_ENV, "sk-test");
    }
    let unwatched = OpenRouterClient::from_binding(
        &GgSlotBinding::new(PRIMARY_SLOT, "openai/gpt-5.6-sol"),
        key,
    );
    let watched = OpenRouterClient::from_binding(
        &GgSlotBinding::new(PRIMARY_SLOT, "openai/gpt-5.6-sol").with_loop_detection(armed()),
        key,
    );
    // Restore before asserting so a failure does not leave the process holding a fake credential.
    unsafe {
        match saved {
            Some(value) => std::env::set_var(API_KEY_ENV, value),
            None => std::env::remove_var(API_KEY_ENV),
        }
    }
    let unwatched = unwatched.expect("a client with the detector off");
    let watched = watched.expect("a client with the detector armed");
    assert!(
        unwatched.loop_guard.is_none() && watched.loop_guard.is_some(),
        "arming the detector decides only whether anything watches the stream"
    );
    (unwatched, watched)
}

fn submit_tool() -> ToolDefinition {
    ToolDefinition {
        name: "submit_program".to_string(),
        description: "Submit a program.".to_string(),
        parameters: json!({ "type": "object" }),
    }
}

// ---------------------------------------------------------------------------
// The key itself
// ---------------------------------------------------------------------------

/// A minted key is a 24-character cuid2, inside OpenRouter's 256-character cap on `session_id` and
/// OpenAI's 64-character cap on `prompt_cache_key`, and each mint is a fresh key.
#[test]
fn a_minted_key_is_a_cuid2_inside_every_providers_cap() {
    let key = RoutingKey::mint();
    assert!(cuid2::is_cuid2(key.as_str()), "a cuid2: {key}");
    assert_eq!(key.as_str().len(), 24);
    assert_eq!(key.to_string(), key.as_str());
    assert_ne!(key, RoutingKey::mint());
}

// ---------------------------------------------------------------------------
// The request body
// ---------------------------------------------------------------------------

/// The key rides the body as **`session_id`**, OpenRouter's sticky-routing field, and as
/// `prompt_cache_key` for the providers that read the OpenAI-style field instead — the same value in
/// both, on an ordinary turn's body and on a turn that requires a tool call.
#[test]
fn the_body_carries_the_routing_key_as_both_fields() {
    let key = RoutingKey::mint();
    let messages = [Message::user("hi")];
    for body in [
        build_request_body("m", &messages, &[], Some(&key), None, CacheTtl::Standard),
        build_required_tool_request_body(
            "m",
            &messages,
            &submit_tool(),
            Some(&key),
            None,
            CacheTtl::Standard,
        ),
    ] {
        assert_eq!(body["session_id"], json!(key.as_str()));
        assert_eq!(body["prompt_cache_key"], json!(key.as_str()));
    }
}

/// No key leaves both fields off the wire entirely.
#[test]
fn the_body_omits_both_fields_without_a_key() {
    let body = build_request_body(
        "m",
        &[Message::user("hi")],
        &[],
        None,
        None,
        CacheTtl::Standard,
    );
    assert!(body.get("session_id").is_none());
    assert!(body.get("prompt_cache_key").is_none());
}

// ---------------------------------------------------------------------------
// What a run's clients send
// ---------------------------------------------------------------------------

/// Every request of one run carries the one minted key — in `session_id`, in `prompt_cache_key` and
/// in the `x-session-id` header — across successive requests, across an ordinary turn and one that
/// requires a tool call, and whether or not the agent armed the detector.
#[tokio::test]
async fn every_request_of_a_run_carries_the_one_minted_key() {
    let key = RoutingKey::mint();
    let (unwatched, watched) = clients_for(&key);
    let (unwatched, unwatched_sent) = recorded(unwatched, ANSWER);
    let (watched, watched_sent) = recorded(watched, ANSWER);
    let messages = [Message::user("hi")];

    for client in [&unwatched, &watched] {
        client.complete(&messages, &[]).await.expect("a first turn");
        client
            .complete(&messages, &[])
            .await
            .expect("a second turn");
        client
            .complete_requiring(&messages, &submit_tool())
            .await
            .expect("a required-tool turn");
    }

    let sent: Vec<Sent> = [unwatched_sent, watched_sent]
        .iter()
        .flat_map(|log| log.lock().expect("the log").clone())
        .collect();
    assert_eq!(sent.len(), 6, "three requests on each client");
    for (header, body) in &sent {
        assert_eq!(header.as_deref(), Some(key.as_str()));
        assert_eq!(body["session_id"], json!(key.as_str()));
        assert_eq!(body["prompt_cache_key"], json!(key.as_str()));
        assert_eq!(
            body["stream"],
            json!(true),
            "every reply is read as a stream, detector or none"
        );
    }
}
