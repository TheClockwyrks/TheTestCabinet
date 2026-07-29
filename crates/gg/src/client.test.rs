use super::*;
use crate::model::{
    FinishReason, ImageContent, Message, ModelClient, ModelError, ToolCall, ToolDefinition,
};
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

    let body = build_request_body("anthropic/claude-opus-4-8", &messages, &tools, None);

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

    let body = build_request_body("m", &messages, &[], None);

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
    let body = build_request_body("m", &[Message::user("hi")], &[], None);
    assert!(body.get("tools").is_none());
    assert!(body.get("tool_choice").is_none());
}

/// A supplied cache key rides the request as `prompt_cache_key` — the hint that keeps a run's
/// requests on one backend so each turn (and each sibling agent) reuses a warmed prefix.
#[test]
fn build_request_body_sends_prompt_cache_key_when_supplied() {
    let body = build_request_body("m", &[Message::user("hi")], &[], Some("session-42"));
    assert_eq!(body["prompt_cache_key"], json!("session-42"));
}

/// No key (or an empty one) leaves `prompt_cache_key` off the wire entirely, so a caller that
/// has no key to offer sends exactly what gg always did.
#[test]
fn build_request_body_omits_prompt_cache_key_without_one() {
    let none = build_request_body("m", &[Message::user("hi")], &[], None);
    assert!(none.get("prompt_cache_key").is_none());
    let empty = build_request_body("m", &[Message::user("hi")], &[], Some(""));
    assert!(empty.get("prompt_cache_key").is_none());
}

// ---------------------------------------------------------------------------
// Images on the wire
// ---------------------------------------------------------------------------

/// A tool result carrying an image becomes a multi-part content array: the text part
/// first, then one `image_url` part per image as a base64 `data:` URL. This is the shape
/// OpenRouter routes to every provider's own image encoding.
#[test]
fn build_request_body_sends_an_attached_image_as_a_content_part() {
    let read = Message::tool_result("call_1", "`ref.png` — PNG image, 12 bytes.")
        .with_images(vec![ImageContent::new("image/png", "QUJD", 3)]);
    let body = build_request_body("m", &[Message::user("look at ref.png"), read], &[], None);

    let tool_msg = &body["messages"][1];
    assert_eq!(tool_msg["role"], json!("tool"));
    // The pairing back to the assistant's call survives — an image-bearing result is
    // still a tool result, not a loose user message.
    assert_eq!(tool_msg["tool_call_id"], json!("call_1"));

    let parts = tool_msg["content"]
        .as_array()
        .expect("an image-bearing message sends multi-part content");
    assert_eq!(parts.len(), 2);
    assert_eq!(parts[0]["type"], json!("text"));
    assert_eq!(parts[0]["text"], json!("`ref.png` — PNG image, 12 bytes."));
    assert_eq!(parts[1]["type"], json!("image_url"));
    assert_eq!(
        parts[1]["image_url"]["url"],
        json!("data:image/png;base64,QUJD")
    );
}

/// A message with no images keeps the plain-string content shape, so the overwhelmingly
/// common text-only turn is byte-identical to what gg has always sent.
#[test]
fn build_request_body_keeps_plain_content_without_images() {
    let body = build_request_body("m", &[Message::user("hi")], &[], None);
    assert_eq!(body["messages"][0]["content"], json!("hi"));
}

/// OpenRouter's own refusal — a `404` whose body says no endpoint supports image input —
/// is recognized, along with the wordings upstream providers use.
#[test]
fn is_image_unsupported_recognizes_provider_refusals() {
    // Recorded verbatim from OpenRouter for a text-only model.
    assert!(is_image_unsupported(
        404,
        r#"{"error":{"message":"No endpoints found that support image input","code":404}}"#
    ));
    assert!(is_image_unsupported(
        400,
        r#"{"error":{"message":"Invalid content type. tool messages support text only"}}"#
    ));
    assert!(is_image_unsupported(
        400,
        r#"{"error":{"message":"This model does not support image input."}}"#
    ));
}

/// A `404` that is merely an unknown or deprecated model is **not** an image refusal:
/// dropping the pictures would not help, and retrying identically would spin. The match
/// is on the wording, not the status.
#[test]
fn is_image_unsupported_ignores_unrelated_failures() {
    assert!(!is_image_unsupported(
        404,
        r#"{"error":{"message":"Grok 4.1 Fast is deprecated. xAI recommends switching to Grok 4.3","code":404}}"#
    ));
    assert!(!is_image_unsupported(
        404,
        r#"{"error":{"message":"No allowed providers are available for the selected model."}}"#
    ));
    // A retryable/5xx status never routes here at all.
    assert!(!is_image_unsupported(
        500,
        "No endpoints found that support image input"
    ));
    assert!(!is_image_unsupported(
        401,
        "No endpoints found that support image input"
    ));
}

/// A `ModelError::VisionUnsupported` is the one error the loop can recover from, and it
/// names the model to deny. Every other variant answers `None`.
#[test]
fn vision_unsupported_is_distinguishable_from_other_failures() {
    let vision = ModelError::VisionUnsupported {
        model_id: "z-ai/glm-5.2".to_string(),
        message: "No endpoints found that support image input".to_string(),
    };
    assert_eq!(vision.vision_unsupported_model(), Some("z-ai/glm-5.2"));
    // It is not an auth failure, so it must not be scored as the credential being
    // refused, and it is not "retry the whole turn later" either.
    assert!(!vision.is_auth_failure());
    assert!(!vision.is_retryable_exhausted());

    let fatal = ModelError::Fatal {
        status: 404,
        message: "unknown model".to_string(),
    };
    assert_eq!(fatal.vision_unsupported_model(), None);
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

fn binding(model_id: &str) -> GgSlotBinding {
    GgSlotBinding {
        slot: PRIMARY_SLOT.to_string(),
        model_id: model_id.to_string(),
        model_slot: None,
    }
}

/// The `mock/…` model prefix and the fake-model override each select the mock; a real
/// model does not. gg always routes live models through OpenRouter, inferring the
/// provider from the id, so there is no explicit provider to select on.
#[test]
fn resolve_provider_kind_selects_mock_by_model_prefix_or_override() {
    // Model-id prefix, either separator.
    assert_eq!(
        resolve_provider_kind(&binding("mock/echo"), false),
        ProviderKind::Mock
    );
    assert_eq!(
        resolve_provider_kind(&binding("mock:echo"), false),
        ProviderKind::Mock
    );
    // A real binding resolves to OpenRouter…
    assert_eq!(
        resolve_provider_kind(&binding("anthropic/claude-opus-4-8"), false),
        ProviderKind::OpenRouter
    );
    // …unless the offline override forces the mock.
    assert_eq!(
        resolve_provider_kind(&binding("anthropic/claude-opus-4-8"), true),
        ProviderKind::Mock
    );
    assert!(ProviderKind::Mock.is_offline());
    assert!(!ProviderKind::OpenRouter.is_offline());
}

/// `client_for_slot` builds a working mock client for a mock binding.
#[test]
fn client_for_slot_builds_mock_for_mock_binding() {
    let client = client_for_slot(&binding("mock/echo"), None).expect("mock client");
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
        None,
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

/// The default script reads the getting-started skill, writes a memory, builds a small task
/// DAG (with a blocked-by edge and a cycle-inducing edge), writes a minimal playable
/// `index.html`, then finishes.
#[tokio::test]
async fn default_mock_script_exercises_every_capability_then_finishes() {
    let client = MockClient::with_default_script("mock/game");

    // Turn 1 reads the skill the offline demo seeds.
    let first = client.complete(&[], &[]).await.expect("turn 1");
    assert_eq!(first.finish_reason, FinishReason::ToolCalls);
    let read = &first.tool_calls[0];
    assert_eq!(read.name, "read_skill");
    assert_eq!(read.arguments["name"], json!(DEFAULT_MOCK_SKILL));

    // Turn 2 records a memory (the game plan).
    let second = client.complete(&[], &[]).await.expect("turn 2");
    let memory = &second.tool_calls[0];
    assert_eq!(memory.name, "write_memory");
    assert_eq!(memory.arguments["name"], json!(DEFAULT_MOCK_MEMORY));
    assert!(memory.arguments["body"].is_string());

    // Turn 3 adds the scaffold task.
    let third = client.complete(&[], &[]).await.expect("turn 3");
    let add_scaffold = &third.tool_calls[0];
    assert_eq!(add_scaffold.name, "add_task");
    assert_eq!(
        add_scaffold.arguments["id"],
        json!(DEFAULT_MOCK_TASK_SCAFFOLD)
    );

    // Turn 4 adds the movement task, blocked by the scaffold task.
    let fourth = client.complete(&[], &[]).await.expect("turn 4");
    let add_movement = &fourth.tool_calls[0];
    assert_eq!(add_movement.name, "add_task");
    assert_eq!(
        add_movement.arguments["id"],
        json!(DEFAULT_MOCK_TASK_MOVEMENT)
    );
    assert_eq!(
        add_movement.arguments["blockedBy"],
        json!([DEFAULT_MOCK_TASK_SCAFFOLD])
    );

    // Turn 5 attempts the cyclic edge (scaffold blocked by movement).
    let fifth = client.complete(&[], &[]).await.expect("turn 5");
    let cyclic = &fifth.tool_calls[0];
    assert_eq!(cyclic.name, "set_blocked_by");
    assert_eq!(cyclic.arguments["id"], json!(DEFAULT_MOCK_TASK_SCAFFOLD));
    assert_eq!(
        cyclic.arguments["blockedBy"],
        json!([DEFAULT_MOCK_TASK_MOVEMENT])
    );

    // Turn 6 completes the scaffold task.
    let sixth = client.complete(&[], &[]).await.expect("turn 6");
    let complete = &sixth.tool_calls[0];
    assert_eq!(complete.name, "complete_task");
    assert_eq!(complete.arguments["id"], json!(DEFAULT_MOCK_TASK_SCAFFOLD));

    // Turn 7 opens the epic, named by its prefix — which is the id the board gives it.
    let seventh = client.complete(&[], &[]).await.expect("turn 7");
    let create_epic = &seventh.tool_calls[0];
    assert_eq!(create_epic.name, "create_epic");
    assert_eq!(create_epic.arguments["prefix"], json!(DEFAULT_MOCK_EPIC));

    // Turn 8 creates the render issue (grouped under the epic, with structured scope). It names no
    // id: the board numbers it [`DEFAULT_MOCK_ISSUE_RENDER`] under the epic's prefix.
    let eighth = client.complete(&[], &[]).await.expect("turn 8");
    let create_render = &eighth.tool_calls[0];
    assert_eq!(create_render.name, "create_issue");
    assert_eq!(create_render.arguments.get("id"), None);
    assert_eq!(create_render.arguments["epicId"], json!(DEFAULT_MOCK_EPIC));
    assert!(create_render.arguments["inScope"].is_string());
    assert!(create_render.arguments["outOfScope"].is_string());
    assert!(create_render.arguments["completionCriteria"].is_string());

    // Turn 9 creates the input issue, blocked by the render issue.
    let ninth = client.complete(&[], &[]).await.expect("turn 9");
    let create_input = &ninth.tool_calls[0];
    assert_eq!(create_input.name, "create_issue");
    assert_eq!(create_input.arguments.get("id"), None);
    assert_eq!(
        create_input.arguments["blockedBy"],
        json!([DEFAULT_MOCK_ISSUE_RENDER])
    );

    // Turn 10 attempts the cyclic board edge (render blocked by input).
    let tenth = client.complete(&[], &[]).await.expect("turn 10");
    let cyclic_issue = &tenth.tool_calls[0];
    assert_eq!(cyclic_issue.name, "set_issue_blocked_by");
    assert_eq!(
        cyclic_issue.arguments["id"],
        json!(DEFAULT_MOCK_ISSUE_RENDER)
    );
    assert_eq!(
        cyclic_issue.arguments["blockedBy"],
        json!([DEFAULT_MOCK_ISSUE_INPUT])
    );

    // Turn 11 writes the game.
    let eleventh = client.complete(&[], &[]).await.expect("turn 11");
    let write = &eleventh.tool_calls[0];
    assert_eq!(write.name, "write_file");
    assert_eq!(write.arguments["path"], json!("index.html"));
    let contents = write.arguments["contents"]
        .as_str()
        .expect("contents is a string");
    assert!(contents.contains("<canvas"));

    // Turn 12 stops.
    let last = client.complete(&[], &[]).await.expect("turn 12");
    assert_eq!(last.finish_reason, FinishReason::Stop);
    assert!(last.tool_calls.is_empty());
}

// ---------------------------------------------------------------------------
// Offline mock script selection by model_id
// ---------------------------------------------------------------------------

/// `mock_client_for` routes the two `subagent-*` model ids to the paired delegation scripts and
/// everything else to the default script, so the spawn → wait → return path is drivable offline
/// through the real binary (via `client_for_slot`) and not only the in-crate tests.
#[tokio::test]
async fn mock_client_for_selects_the_named_subagent_scripts() {
    // The parent id → a script whose first turn spawns a subagent.
    let parent = mock_client_for("mock/demo-subagent-parent");
    let first = parent.complete(&[], &[]).await.expect("parent turn 1");
    assert_eq!(first.tool_calls[0].name, "spawn_subagent");

    // The child id → a script whose first turn writes the greeting file (no spawn).
    let child = mock_client_for("mock/demo-subagent-child");
    let first = child.complete(&[], &[]).await.expect("child turn 1");
    assert_eq!(first.tool_calls[0].name, "write_file");
    assert_eq!(
        first.tool_calls[0].arguments["path"],
        json!(MOCK_SUBAGENT_FILE)
    );

    // Any other mock id → the default script (first turn reads a skill).
    let other = mock_client_for("mock/primary");
    let first = other.complete(&[], &[]).await.expect("default turn 1");
    assert_eq!(first.tool_calls[0].name, "read_skill");
}
