//! The client's **tool-choice downgrade**: a provider that refuses the pinned `tool_choice` a
//! required-tool request carries is answered with the same request on `auto`, once per run, and
//! the downgrade is announced as one `warn` naming the model and the provider's message.
//!
//! The transport tests run under `start_paused` time against a gateway the client is [answered
//! by](OpenRouterClient::answered_by), exactly as the [retry](super::retry_tests) suite's do.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use serde_json::json;
use test_cabinet_core::gg::GgTelemetryKind;

use super::*;
use crate::model::{Message, ModelClient, ToolDefinition};
use crate::telemetry::{CollectingSink, Emitter};

/// The refusal a thinking-mode provider answers a pinned choice with, recorded verbatim.
const REFUSAL: &str = r#"{"error":{"message":"The tool_choice parameter does not support being set to required or object in thinking mode","code":400}}"#;

/// A reply that makes no call — what a provider on `auto` is free to answer with.
const NO_CALL: &str =
    r#"{"choices":[{"message":{"role":"assistant","content":"done"},"finish_reason":"stop"}]}"#;

/// One scripted reply: a status and its body.
type Reply = (u16, &'static str);

/// A client answered by `replies` in order, the last repeated once they run out; the count of
/// requests it was sent; and the sink its stream lands on.
fn scripted(replies: Vec<Reply>) -> (OpenRouterClient, Arc<AtomicUsize>, CollectingSink) {
    let requests = Arc::new(AtomicUsize::new(0));
    let seen = Arc::clone(&requests);
    let client = OpenRouterClient::new(
        "http://gateway.invalid/api/v1",
        reqwest::Client::new(),
        "qwen/qwen3.8-max-0902",
        "sk-test",
        RetryPolicy::default(),
        None,
    )
    .answered_by(move || {
        let n = seen.fetch_add(1, Ordering::SeqCst);
        let (status, body) = replies[n.min(replies.len() - 1)];
        http::Response::builder()
            .status(status)
            .body(reqwest::Body::from(body))
            .expect("a well-formed response")
            .into()
    });
    let sink = CollectingSink::default();
    client.announce_retries_on(&Emitter::with_sink(None, Box::new(sink.clone())));
    (client, requests, sink)
}

/// The required tool every test pins on.
fn tool() -> ToolDefinition {
    ToolDefinition::new(
        "submit_program",
        "Submit a program.",
        json!({ "type": "object" }),
    )
}

/// Every `warn` line on the sink.
fn warnings(sink: &CollectingSink) -> Vec<String> {
    sink.events()
        .into_iter()
        .filter_map(|event| match event.kind {
            GgTelemetryKind::Log { level, message } if level == "warn" => Some(message),
            _ => None,
        })
        .collect()
}

// ---------------------------------------------------------------------------
// The refusal and the wire shapes
// ---------------------------------------------------------------------------

/// A `400` whose body names `tool_choice` is the refusal, whatever the provider's wording of why;
/// every other status or body is an ordinary fatal 4xx.
#[test]
fn is_tool_choice_refusal_matches_a_400_naming_the_parameter() {
    assert!(is_tool_choice_refusal(400, REFUSAL));
    assert!(is_tool_choice_refusal(
        400,
        r#"{"error":{"message":"tool_choice must be one of auto, none"}}"#
    ));
    // A `400` about something else is not about the pin.
    assert!(!is_tool_choice_refusal(
        400,
        r#"{"error":{"message":"messages: role must be user"}}"#
    ));
    // Nor is a naming body on any other status: a `404` naming the parameter is an unknown
    // route, and a retryable status never reaches the fatal arm at all.
    assert!(!is_tool_choice_refusal(404, REFUSAL));
    assert!(!is_tool_choice_refusal(422, REFUSAL));
    assert!(!is_tool_choice_refusal(500, REFUSAL));
}

/// Pinned, the required-tool body names the one tool; on `auto`, it asks.
#[test]
fn the_required_tool_body_pins_or_asks_as_the_client_has_learned() {
    let tool = tool();
    let messages = [Message::user("build it")];

    let pinned = build_required_tool_request_body(
        "openai/gpt-5.6",
        &messages,
        &tool,
        None,
        CacheTtl::Standard,
        false,
        ToolChoicePin::Pinned.body(&tool),
    );
    assert_eq!(
        pinned["tool_choice"],
        json!({ "type": "function", "function": { "name": "submit_program" } })
    );

    let auto = build_required_tool_request_body(
        "openai/gpt-5.6",
        &messages,
        &tool,
        None,
        CacheTtl::Standard,
        false,
        ToolChoicePin::Auto.body(&tool),
    );
    assert_eq!(auto["tool_choice"], json!("auto"));
    // Only the choice changes: the tool is still the one offered.
    assert_eq!(pinned["tools"], auto["tools"]);
}

// ---------------------------------------------------------------------------
// The downgrade, driven end to end
// ---------------------------------------------------------------------------

/// A pinned request answered by the refusal is re-sent on `auto`, the client stays on `auto` for
/// the rest of the run, and the downgrade is announced once.
#[tokio::test(start_paused = true)]
async fn a_refused_pin_is_resent_on_auto_and_the_client_stays_there() {
    let (client, requests, sink) = scripted(vec![(400, REFUSAL), (200, NO_CALL), (200, NO_CALL)]);

    let first = client
        .complete_requiring(&[Message::user("build it")], &tool())
        .await;
    assert!(first.is_ok(), "the re-sent request answers: {first:?}");
    assert_eq!(requests.load(Ordering::SeqCst), 2, "one retry, on auto");
    assert_eq!(client.tool_choice_pin(), ToolChoicePin::Auto);

    // The next required-tool call — a later turn's, or a handoff compaction's — asks rather
    // than pinning: the pin was tried once, not once per request.
    client
        .complete_requiring(&[Message::user("keep building")], &tool())
        .await
        .expect("the third reply answers");
    assert_eq!(requests.load(Ordering::SeqCst), 3, "no pin to refuse");

    // One warning, naming the model and the provider's message.
    let warnings = warnings(&sink);
    assert_eq!(warnings.len(), 1, "the downgrade is announced once");
    assert!(warnings[0].contains("qwen/qwen3.8-max-0902"));
    assert!(warnings[0].contains("tool_choice"));
    assert!(warnings[0].contains("thinking mode"));
}

/// A refusal of a request already on `auto` is an ordinary fatal 4xx: the downgrade was already
/// taken, and re-sending identically would spin.
#[tokio::test(start_paused = true)]
async fn a_refusal_on_auto_stays_fatal() {
    let (client, requests, _) = scripted(vec![(400, REFUSAL)]);
    client.downgrade_tool_choice();

    let outcome = client
        .complete_requiring(&[Message::user("build it")], &tool())
        .await;

    let err = outcome.expect_err("a refused `auto` request is fatal");
    assert!(matches!(
        err,
        crate::model::ModelError::Fatal { status: 400, .. }
    ));
    assert_eq!(requests.load(Ordering::SeqCst), 1, "one request, no retry");
}

/// A fatal refusal that does not name `tool_choice` is an ordinary fatal 4xx, pin or no pin.
#[tokio::test(start_paused = true)]
async fn an_unrelated_400_stays_fatal_under_the_pin() {
    let (client, requests, _) = scripted(vec![(400, r#"{"error":{"message":"bad request"}}"#)]);

    let outcome = client
        .complete_requiring(&[Message::user("build it")], &tool())
        .await;

    let err = outcome.expect_err("an unrelated refusal is fatal");
    assert!(matches!(
        err,
        crate::model::ModelError::Fatal { status: 400, .. }
    ));
    assert_eq!(requests.load(Ordering::SeqCst), 1, "no retry");
    assert_eq!(
        client.tool_choice_pin(),
        ToolChoicePin::Pinned,
        "the pin stands"
    );
}
