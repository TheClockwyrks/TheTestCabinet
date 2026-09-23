//! The client's tool-choice downgrade: a provider that refuses the pinned `tool_choice` of a
//! required-tool request is answered with the same request on `auto`, the refusal is recorded
//! run-wide per model, and the downgrade is logged once.
//!
//! The transport tests run under `start_paused` time against a gateway the client is [answered
//! by](OpenRouterClient::answered_by), which records the body of every request it is sent.

use std::sync::{Arc, Mutex};

use serde_json::{Value, json};
use test_cabinet_core::gg::{GgLoopDetection, GgTelemetryKind};

use super::*;
use crate::model::{Message, ModelClient, ModelError, ToolDefinition};
use crate::telemetry::{CollectingSink, Emitter};

/// The model the refusal was first seen on.
const MODEL: &str = "qwen/qwen3.8-max-0902";

/// The refusal a thinking-mode provider answers a pinned choice with.
const REFUSAL: &str = r#"{"error":{"message":"The tool_choice parameter does not support being set to required or object in thinking mode","code":400}}"#;

/// A buffered reply that makes no call, which a provider on `auto` is free to answer with.
const NO_CALL: &str =
    r#"{"choices":[{"message":{"role":"assistant","content":"done"},"finish_reason":"stop"}]}"#;

/// The same reply as a server-sent event stream, for a client on the streaming transport.
const NO_CALL_STREAMED: &str = "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"done\"},\
                                \"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n";

/// One scripted reply: a status and its body.
type Reply = (u16, &'static str);

/// Every request body a scripted client was sent, in order.
type Sent = Arc<Mutex<Vec<Value>>>;

/// A client for `model` answered by `replies` in order, the last repeated once they run out,
/// recording `memory`'s refusals; the bodies it was sent; and the sink its stream lands on.
fn scripted(
    model: &str,
    memory: &ToolChoiceMemory,
    replies: Vec<Reply>,
) -> (OpenRouterClient, Sent, CollectingSink) {
    let sent: Sent = Arc::default();
    let seen = Arc::clone(&sent);
    let client = OpenRouterClient::new(
        "http://gateway.invalid/api/v1",
        reqwest::Client::new(),
        model,
        "sk-test",
        RetryPolicy::default(),
        None,
    )
    .with_tool_choice_memory(memory.clone())
    .answered_by(move |request| {
        let body = request
            .body()
            .and_then(reqwest::Body::as_bytes)
            .map(|bytes| serde_json::from_slice(bytes).expect("a JSON body"))
            .expect("a buffered body");
        let mut seen = seen.lock().expect("the request log");
        let (status, reply) = replies[seen.len().min(replies.len() - 1)];
        seen.push(body);
        http::Response::builder()
            .status(status)
            .body(reqwest::Body::from(reply))
            .expect("a well-formed response")
            .into()
    });
    let sink = CollectingSink::default();
    client.announce_retries_on(&Emitter::with_sink(None, Box::new(sink.clone())));
    (client, sent, sink)
}

/// The required tool every test asks for.
fn tool() -> ToolDefinition {
    ToolDefinition::new(
        "submit_program",
        "Submit a program.",
        json!({ "type": "object" }),
    )
}

/// The `tool_choice` a pinned request carries.
fn pinned() -> Value {
    json!({ "type": "function", "function": { "name": "submit_program" } })
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

/// `body` with its `tool_choice` removed, so two requests can be compared on everything else.
fn without_choice(body: &Value) -> Value {
    let mut body = body.clone();
    body.as_object_mut()
        .expect("a request body is an object")
        .remove("tool_choice");
    body
}

/// A `400` whose body names `tool_choice` is the refusal, whatever the provider's wording of why.
/// Every other status or body is an ordinary fatal refusal.
#[test]
fn is_tool_choice_refusal_matches_a_400_naming_the_parameter() {
    assert!(is_tool_choice_refusal(400, REFUSAL));
    assert!(is_tool_choice_refusal(
        400,
        r#"{"error":{"message":"tool_choice must be one of auto, none"}}"#
    ));
    assert!(!is_tool_choice_refusal(
        400,
        r#"{"error":{"message":"messages: role must be user"}}"#
    ));
    assert!(!is_tool_choice_refusal(404, REFUSAL));
    assert!(!is_tool_choice_refusal(422, REFUSAL));
}

/// A refused pin is answered by the same request on `auto`, at once and outside the retry
/// schedule, and the client's next required-tool request is sent on `auto` from the start. The
/// downgrade is one `warn` naming the model and the provider's message, and no retry line.
#[tokio::test(start_paused = true)]
async fn a_refused_pin_is_resent_on_auto_and_later_requests_start_there() {
    let memory = ToolChoiceMemory::default();
    let (client, sent, sink) = scripted(MODEL, &memory, vec![(400, REFUSAL), (200, NO_CALL)]);

    let started = tokio::time::Instant::now();
    let first = client
        .complete_requiring(&[Message::user("build it")], &tool())
        .await;
    assert!(first.is_ok(), "the re-sent request answers: {first:?}");
    assert_eq!(
        started.elapsed(),
        Duration::ZERO,
        "the re-send waits out no backoff"
    );

    client
        .complete_requiring(&[Message::user("keep building")], &tool())
        .await
        .expect("the second call answers");

    let sent = sent.lock().expect("the request log").clone();
    assert_eq!(
        sent.len(),
        3,
        "one refused pin, its re-send, one later call"
    );
    assert_eq!(sent[0]["tool_choice"], pinned());
    assert_eq!(sent[1]["tool_choice"], json!("auto"));
    assert_eq!(
        without_choice(&sent[0]),
        without_choice(&sent[1]),
        "the re-send is the same request"
    );
    assert_eq!(sent[2]["tool_choice"], json!("auto"));
    assert!(memory.refused(MODEL));

    let warnings = warnings(&sink);
    assert_eq!(
        warnings,
        vec![tool_choice_downgrade_message(MODEL, REFUSAL)]
    );
}

/// The streaming transport takes the same downgrade.
#[tokio::test(start_paused = true)]
async fn a_refused_pin_is_resent_on_auto_by_the_streaming_transport() {
    let memory = ToolChoiceMemory::default();
    let (client, sent, sink) = scripted(
        MODEL,
        &memory,
        vec![(400, REFUSAL), (200, NO_CALL_STREAMED)],
    );
    let client = client.with_loop_detection(GgLoopDetection {
        enabled: true,
        window_words: Some(256),
        repeat_threshold: Some(32),
        min_offenders: Some(2),
        min_saturated_run: Some(3000),
        max_response_chars: Some(0),
    });

    let reply = client
        .complete_requiring(&[Message::user("build it")], &tool())
        .await
        .expect("the re-sent request answers");
    assert!(reply.tool_calls.is_empty());

    let sent = sent.lock().expect("the request log").clone();
    assert_eq!(sent.len(), 2);
    assert_eq!(sent[0]["stream"], json!(true));
    assert_eq!(sent[0]["tool_choice"], pinned());
    assert_eq!(sent[1]["tool_choice"], json!("auto"));
    assert_eq!(without_choice(&sent[0]), without_choice(&sent[1]));
    assert_eq!(warnings(&sink).len(), 1);
}

/// The refusal is the run's, not the client's: another client for the same model sharing the
/// record, such as a handoff compaction's or an agent's successor's, sends `auto` from its first
/// request and logs nothing. A client for another model still pins.
#[tokio::test(start_paused = true)]
async fn a_refusal_is_shared_by_every_client_for_the_model() {
    let memory = ToolChoiceMemory::default();
    let (agent, _, agent_sink) = scripted(MODEL, &memory, vec![(400, REFUSAL), (200, NO_CALL)]);
    agent
        .complete_requiring(&[Message::user("build it")], &tool())
        .await
        .expect("the agent's re-sent request answers");

    let (compaction, compaction_sent, compaction_sink) =
        scripted(MODEL, &memory, vec![(200, NO_CALL)]);
    compaction
        .complete_requiring(&[Message::user("summarize")], &tool())
        .await
        .expect("the compaction request answers");
    let compaction_sent = compaction_sent.lock().expect("the request log").clone();
    assert_eq!(compaction_sent.len(), 1, "nothing was refused");
    assert_eq!(compaction_sent[0]["tool_choice"], json!("auto"));

    let (other, other_sent, _) = scripted("openai/gpt-5.6", &memory, vec![(200, NO_CALL)]);
    other
        .complete_requiring(&[Message::user("build it")], &tool())
        .await
        .expect("the other model's request answers");
    assert_eq!(
        other_sent.lock().expect("the request log")[0]["tool_choice"],
        pinned()
    );

    assert_eq!(warnings(&agent_sink).len(), 1, "logged once for the run");
    assert!(warnings(&compaction_sink).is_empty());
}

/// A refusal of a request already on `auto` is an ordinary fatal refusal: there is nothing left
/// to downgrade.
#[tokio::test(start_paused = true)]
async fn a_refusal_on_auto_stays_fatal() {
    let memory = ToolChoiceMemory::default();
    memory.record_refusal(MODEL);
    let (client, sent, _) = scripted(MODEL, &memory, vec![(400, REFUSAL)]);

    let err = client
        .complete_requiring(&[Message::user("build it")], &tool())
        .await
        .expect_err("a refused `auto` request is fatal");

    assert!(matches!(err, ModelError::Fatal { status: 400, .. }));
    assert_eq!(sent.lock().expect("the request log").len(), 1);
}

/// A `400` that does not name `tool_choice` is an ordinary fatal refusal, and the pin stands.
#[tokio::test(start_paused = true)]
async fn an_unrelated_400_stays_fatal_under_the_pin() {
    let memory = ToolChoiceMemory::default();
    let (client, sent, sink) = scripted(
        MODEL,
        &memory,
        vec![(400, r#"{"error":{"message":"bad request"}}"#)],
    );

    let err = client
        .complete_requiring(&[Message::user("build it")], &tool())
        .await
        .expect_err("an unrelated refusal is fatal");

    assert!(matches!(err, ModelError::Fatal { status: 400, .. }));
    assert_eq!(sent.lock().expect("the request log").len(), 1);
    assert!(!memory.refused(MODEL));
    assert!(warnings(&sink).is_empty());
}
