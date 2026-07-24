use super::*;
use crate::model::{FinishReason, Message, ModelClient, ToolCall, ToolDefinition};
use serde_json::json;
use std::time::Duration;
use test_cabinet_core::gg::{GgSlotBinding, PRIMARY_SLOT};

// ---------------------------------------------------------------------------
// Request building
// ---------------------------------------------------------------------------

/// A tool is serialized in the OpenAI `{type:"function", function:{…}}` shape, and
/// `tool_choice`/`usage` are set as gg sends them.
#[test]
fn build_request_body_uses_openai_tools_shape() {
    let messages = [Message::system("sys"), Message::user("build it")];
    let tools = [ToolDefinition::new(
        "write_file",
        "Write a file.",
        json!({ "type": "object", "properties": { "path": { "type": "string" } } }),
    )];

    let body = build_request_body("anthropic/claude-opus-4-8", &messages, &tools);

    assert_eq!(body["model"], json!("anthropic/claude-opus-4-8"));
    assert_eq!(body["messages"][0]["role"], json!("system"));
    assert_eq!(body["messages"][0]["content"], json!("sys"));
    assert_eq!(body["messages"][1]["role"], json!("user"));
    assert_eq!(body["tool_choice"], json!("auto"));
    assert_eq!(body["usage"]["include"], json!(true));

    let tool = &body["tools"][0];
    assert_eq!(tool["type"], json!("function"));
    assert_eq!(tool["function"]["name"], json!("write_file"));
    assert_eq!(tool["function"]["description"], json!("Write a file."));
    assert_eq!(
        tool["function"]["parameters"]["properties"]["path"]["type"],
        json!("string")
    );
}

/// An assistant tool call is serialized with its `arguments` as a JSON **string** (not
/// a nested object), and a tool result carries its `tool_call_id`.
#[test]
fn build_request_body_encodes_tool_call_arguments_as_string() {
    let call = ToolCall {
        id: "call_1".to_string(),
        name: "write_file".to_string(),
        arguments: json!({ "path": "index.html", "contents": "<html></html>" }),
    };
    let messages = [
        Message::assistant(None, vec![call]),
        Message::tool_result("call_1", "wrote 13 bytes"),
    ];

    let body = build_request_body("m", &messages, &[]);

    let wire_call = &body["messages"][0]["tool_calls"][0];
    assert_eq!(wire_call["id"], json!("call_1"));
    assert_eq!(wire_call["type"], json!("function"));
    assert_eq!(wire_call["function"]["name"], json!("write_file"));
    // The arguments must be a string containing JSON, not a JSON object.
    let raw = wire_call["function"]["arguments"]
        .as_str()
        .expect("arguments serialized as a string");
    let reparsed: serde_json::Value = serde_json::from_str(raw).expect("arguments are JSON");
    assert_eq!(
        reparsed,
        json!({ "path": "index.html", "contents": "<html></html>" })
    );

    let tool_msg = &body["messages"][1];
    assert_eq!(tool_msg["role"], json!("tool"));
    assert_eq!(tool_msg["tool_call_id"], json!("call_1"));
    assert_eq!(tool_msg["content"], json!("wrote 13 bytes"));
}

/// With no tools offered, neither `tools` nor `tool_choice` is present.
#[test]
fn build_request_body_omits_tools_when_none() {
    let body = build_request_body("m", &[Message::user("hi")], &[]);
    assert!(body.get("tools").is_none());
    assert!(body.get("tool_choice").is_none());
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

/// A response with text, a tool call (arguments as a JSON string), and plain usage
/// parses into the domain shape.
#[test]
fn parse_response_extracts_text_tool_calls_and_usage() {
    let body = r#"{
        "choices": [{
            "message": {
                "role": "assistant",
                "content": "Creating the file.",
                "tool_calls": [{
                    "id": "call_1",
                    "type": "function",
                    "function": {
                        "name": "write_file",
                        "arguments": "{\"path\":\"index.html\",\"contents\":\"<html></html>\"}"
                    }
                }]
            },
            "finish_reason": "tool_calls"
        }],
        "usage": { "prompt_tokens": 1200, "completion_tokens": 180, "total_tokens": 1380 }
    }"#;

    let response = parse_response(body).expect("parse");

    assert_eq!(response.text.as_deref(), Some("Creating the file."));
    assert_eq!(response.finish_reason, FinishReason::ToolCalls);
    assert_eq!(response.tool_calls.len(), 1);
    let call = &response.tool_calls[0];
    assert_eq!(call.id, "call_1");
    assert_eq!(call.name, "write_file");
    assert_eq!(call.arguments["path"], json!("index.html"));
    assert_eq!(call.arguments["contents"], json!("<html></html>"));

    // Plain usage maps to input/output with no cached/reasoning split and no cost.
    assert_eq!(
        response.usage,
        TokenCounts {
            uncached_input: Some(1200),
            cached_input: None,
            output: Some(180),
            reasoning: None,
        }
    );
    assert!(response.cost.is_none());
}

/// Cached-input and reasoning details are subtracted from the input/output totals
/// (per the metrics contract), and a reported cost maps onto both cost figures.
#[test]
fn parse_response_maps_cached_reasoning_and_cost() {
    let body = r#"{
        "choices": [{ "message": { "role": "assistant", "content": "done" }, "finish_reason": "stop" }],
        "usage": {
            "prompt_tokens": 1000,
            "completion_tokens": 300,
            "total_tokens": 1300,
            "cost": 0.0123,
            "prompt_tokens_details": { "cached_tokens": 400 },
            "completion_tokens_details": { "reasoning_tokens": 120 }
        }
    }"#;

    let response = parse_response(body).expect("parse");

    assert_eq!(response.finish_reason, FinishReason::Stop);
    assert!(response.tool_calls.is_empty());
    assert_eq!(
        response.usage,
        TokenCounts {
            uncached_input: Some(600), // 1000 - 400 cached
            cached_input: Some(400),
            output: Some(180), // 300 - 120 reasoning
            reasoning: Some(120),
        }
    );
    assert_eq!(
        response.cost,
        Some(Cost {
            comparable: Some(0.0123),
            actual: Some(0.0123),
        })
    );
}

/// A missing `usage` block yields default (all-unknown) token counts and no cost.
#[test]
fn parse_response_defaults_missing_usage() {
    let body = r#"{ "choices": [{ "message": { "content": "hi" }, "finish_reason": "stop" }] }"#;
    let response = parse_response(body).expect("parse");
    assert_eq!(response.usage, TokenCounts::default());
    assert!(response.cost.is_none());
}

/// A response that returned tool calls but omitted `finish_reason` is normalized to
/// `ToolCalls`.
#[test]
fn parse_response_normalizes_missing_finish_reason_with_tool_calls() {
    let body = r#"{
        "choices": [{
            "message": {
                "tool_calls": [{ "id": "c", "function": { "name": "t", "arguments": "" } }]
            }
        }]
    }"#;
    let response = parse_response(body).expect("parse");
    assert_eq!(response.finish_reason, FinishReason::ToolCalls);
    // Empty arguments become an empty object.
    assert_eq!(response.tool_calls[0].arguments, json!({}));
}

/// A response with no choices, or a provider error object, is a parse failure.
#[test]
fn parse_response_rejects_empty_and_error_bodies() {
    assert!(parse_response(r#"{ "choices": [] }"#).is_err());
    assert!(parse_response(r#"{ "error": { "message": "rate limited" } }"#).is_err());
    assert!(parse_response("not json at all").is_err());
}

// ---------------------------------------------------------------------------
// Retry classification & backoff
// ---------------------------------------------------------------------------

/// `2xx` is success, `429`/`5xx` are retryable, other statuses (incl. auth) are fatal.
#[test]
fn classify_status_partitions_retryable_from_fatal() {
    assert_eq!(classify_status(200), StatusClass::Success);
    assert_eq!(classify_status(204), StatusClass::Success);
    assert_eq!(classify_status(429), StatusClass::Retryable);
    assert_eq!(classify_status(500), StatusClass::Retryable);
    assert_eq!(classify_status(503), StatusClass::Retryable);
    // Auth and other 4xx are fatal — retrying will not help.
    assert_eq!(classify_status(401), StatusClass::Fatal);
    assert_eq!(classify_status(400), StatusClass::Fatal);
    assert_eq!(classify_status(404), StatusClass::Fatal);
}

/// Backoff doubles per attempt and is capped at `max_delay`.
#[test]
fn backoff_delay_doubles_and_caps() {
    let policy = RetryPolicy::default(); // 500ms base, 8s cap
    assert_eq!(backoff_delay(1, &policy), Duration::from_millis(500));
    assert_eq!(backoff_delay(2, &policy), Duration::from_millis(1000));
    assert_eq!(backoff_delay(3, &policy), Duration::from_millis(2000));
    assert_eq!(backoff_delay(4, &policy), Duration::from_millis(4000));
    // Beyond the cap it saturates rather than overflowing.
    assert_eq!(backoff_delay(5, &policy), Duration::from_secs(8));
    assert_eq!(backoff_delay(64, &policy), Duration::from_secs(8));
}

// ---------------------------------------------------------------------------
// Provider selection
// ---------------------------------------------------------------------------

fn binding(model_id: &str, provider: Option<&str>) -> GgSlotBinding {
    GgSlotBinding {
        slot: PRIMARY_SLOT.to_string(),
        model_id: model_id.to_string(),
        provider: provider.map(str::to_string),
    }
}

/// The `mock` provider, the `mock/…` model prefix, and the fake-model override each
/// select the mock; a real provider/model does not.
#[test]
fn resolve_provider_kind_selects_mock_by_provider_prefix_or_override() {
    // Explicit provider, case-insensitive.
    assert_eq!(
        resolve_provider_kind(&binding("anything", Some("mock")), false),
        ProviderKind::Mock
    );
    assert_eq!(
        resolve_provider_kind(&binding("anything", Some("MOCK")), false),
        ProviderKind::Mock
    );
    // Model-id prefix.
    assert_eq!(
        resolve_provider_kind(&binding("mock/echo", None), false),
        ProviderKind::Mock
    );
    assert_eq!(
        resolve_provider_kind(&binding("mock:echo", None), false),
        ProviderKind::Mock
    );
    // A real binding resolves to OpenRouter…
    assert_eq!(
        resolve_provider_kind(&binding("anthropic/claude-opus-4-8", None), false),
        ProviderKind::OpenRouter
    );
    // …unless the offline override forces the mock.
    assert_eq!(
        resolve_provider_kind(&binding("anthropic/claude-opus-4-8", None), true),
        ProviderKind::Mock
    );
    assert!(ProviderKind::Mock.is_offline());
    assert!(!ProviderKind::OpenRouter.is_offline());
}

/// `client_for_slot` builds a working mock client for a mock binding.
#[test]
fn client_for_slot_builds_mock_for_mock_binding() {
    let client = client_for_slot(&binding("mock/echo", None)).expect("mock client");
    assert_eq!(client.model_id(), "mock/echo");
}

// ---------------------------------------------------------------------------
// OpenRouter client construction
// ---------------------------------------------------------------------------

/// The endpoint URL is the base with a single `/chat/completions`, regardless of a
/// trailing slash on the base.
#[test]
fn openrouter_endpoint_is_built_from_base() {
    let client = OpenRouterClient::new(
        "https://example.test/api/v1/",
        reqwest::Client::new(),
        "anthropic/claude-opus-4-8",
        "sk-test",
        RetryPolicy::default(),
    );
    assert_eq!(client.model_id(), "anthropic/claude-opus-4-8");
    assert_eq!(
        client.endpoint(),
        "https://example.test/api/v1/chat/completions"
    );
}

// ---------------------------------------------------------------------------
// Mock client
// ---------------------------------------------------------------------------

/// The mock replays its script one response per call, ignoring inputs, then returns a
/// terminal stop once exhausted.
#[tokio::test]
async fn mock_client_advances_through_script_then_terminates() {
    let script = vec![
        ModelResponse {
            text: Some("turn 1".to_string()),
            tool_calls: vec![ToolCall {
                id: "c1".to_string(),
                name: "write_file".to_string(),
                arguments: json!({ "path": "a" }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts::default(),
            cost: None,
        },
        ModelResponse {
            text: Some("turn 2".to_string()),
            tool_calls: Vec::new(),
            finish_reason: FinishReason::Stop,
            usage: TokenCounts::default(),
            cost: None,
        },
    ];
    let client = MockClient::new("mock/test", script);

    let first = client.complete(&[], &[]).await.expect("turn 1");
    assert_eq!(first.text.as_deref(), Some("turn 1"));
    assert_eq!(first.tool_calls.len(), 1);

    let second = client.complete(&[], &[]).await.expect("turn 2");
    assert_eq!(second.text.as_deref(), Some("turn 2"));
    assert!(second.tool_calls.is_empty());

    // Past the end: a terminal stop so any loop terminates.
    let exhausted = client.complete(&[], &[]).await.expect("exhausted");
    assert_eq!(exhausted.finish_reason, FinishReason::Stop);
    assert!(exhausted.tool_calls.is_empty());
    assert!(
        exhausted
            .text
            .as_deref()
            .is_some_and(|text| text.contains("exhausted"))
    );

    assert_eq!(client.model_id(), "mock/test");
}

/// The default script reads the getting-started skill, writes a minimal playable
/// `index.html`, then finishes.
#[tokio::test]
async fn default_mock_script_reads_a_skill_writes_index_html_then_finishes() {
    let client = MockClient::with_default_script("mock/game");

    // Turn 1 reads the skill the offline demo seeds.
    let first = client.complete(&[], &[]).await.expect("turn 1");
    assert_eq!(first.finish_reason, FinishReason::ToolCalls);
    assert_eq!(first.tool_calls.len(), 1);
    let read = &first.tool_calls[0];
    assert_eq!(read.name, "read_skill");
    assert_eq!(read.arguments["name"], json!(DEFAULT_MOCK_SKILL));

    // Turn 2 writes the game.
    let second = client.complete(&[], &[]).await.expect("turn 2");
    assert_eq!(second.finish_reason, FinishReason::ToolCalls);
    assert_eq!(second.tool_calls.len(), 1);
    let call = &second.tool_calls[0];
    assert_eq!(call.name, "write_file");
    assert_eq!(call.arguments["path"], json!("index.html"));
    let contents = call.arguments["contents"]
        .as_str()
        .expect("contents is a string");
    assert!(contents.contains("<canvas"));

    // Turn 3 stops.
    let third = client.complete(&[], &[]).await.expect("turn 3");
    assert_eq!(third.finish_reason, FinishReason::Stop);
    assert!(third.tool_calls.is_empty());
}
