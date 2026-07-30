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

    let body = build_request_body(
        "anthropic/claude-opus-4-8",
        &messages,
        &tools,
        None,
        CacheTtl::Standard,
    );

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

    let body = build_request_body("m", &messages, &[], None, CacheTtl::Standard);

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
    // `m` is not a model gg marks (see `requires_cache_markers`), so every message keeps the
    // bare-string content shape and only the tool-call encoding above is under test here.
    assert_eq!(tool_msg["content"], json!("wrote 13 bytes"));
}

/// With no tools offered, neither `tools` nor `tool_choice` is present.
#[test]
fn build_request_body_omits_tools_when_none() {
    let body = build_request_body("m", &[Message::user("hi")], &[], None, CacheTtl::Standard);
    assert!(body.get("tools").is_none());
    assert!(body.get("tool_choice").is_none());
}

/// A supplied session key rides the request as **`session_id`** — OpenRouter's sticky-routing
/// field, which is what actually keeps a run's requests on one provider *endpoint* so each turn
/// (and each sibling agent) reuses a warmed prefix. It also rides as `prompt_cache_key` for the
/// providers that read the OpenAI-style field instead. Sending only the latter — which gg did —
/// left routing on a fallback path and cost whole runs their cache.
#[test]
fn build_request_body_sends_the_session_key_as_both_fields() {
    let body = build_request_body(
        "m",
        &[Message::user("hi")],
        &[],
        Some("session-42"),
        CacheTtl::Standard,
    );
    assert_eq!(body["session_id"], json!("session-42"));
    assert_eq!(body["prompt_cache_key"], json!("session-42"));
}

/// No key (or an empty one) leaves both fields off the wire entirely, so a caller that
/// has no key to offer sends exactly what gg always did.
#[test]
fn build_request_body_omits_the_session_key_without_one() {
    for body in [
        build_request_body("m", &[Message::user("hi")], &[], None, CacheTtl::Standard),
        build_request_body(
            "m",
            &[Message::user("hi")],
            &[],
            Some(""),
            CacheTtl::Standard,
        ),
    ] {
        assert!(body.get("session_id").is_none());
        assert!(body.get("prompt_cache_key").is_none());
    }
}

/// An over-long key is truncated to the documented cap rather than dropped: the leading characters
/// are still a *stable* key, which is all sticky routing needs, whereas omitting the field would
/// cost the run its cache — the very failure the key exists to prevent.
#[test]
fn build_request_body_truncates_an_over_long_session_key() {
    // A multi-byte character straddling the cap would panic a naive byte slice.
    let key = "sesh-".to_string() + &"é".repeat(MAX_SESSION_KEY_CHARS);
    let body = build_request_body(
        "m",
        &[Message::user("hi")],
        &[],
        Some(&key),
        CacheTtl::Standard,
    );

    let sent = body["session_id"].as_str().expect("a session id");
    assert_eq!(sent.chars().count(), MAX_SESSION_KEY_CHARS);
    assert!(key.starts_with(sent));
    assert_eq!(body["prompt_cache_key"], body["session_id"]);
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
    let body = build_request_body(
        "m",
        &[Message::user("look at ref.png"), read],
        &[],
        None,
        CacheTtl::Standard,
    );

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

/// A text-only message that is **not** a cache breakpoint keeps the plain-string content shape,
/// so the overwhelmingly common turn is byte-identical to what gg has always sent.
#[test]
fn build_request_body_keeps_plain_content_without_images() {
    let messages = [
        Message::system("sys"),
        Message::user("build it"),
        Message::assistant(Some("on it".to_string()), vec![]),
        Message::user("carry on"),
    ];
    let body = build_request_body(
        "anthropic/claude-haiku-4.5",
        &messages,
        &[],
        None,
        CacheTtl::Standard,
    );

    // The anchor (index 1) and the tail (index 3) are breakpoints; the untouched middle keeps
    // the bare-string shape.
    assert_eq!(body["messages"][0]["content"], json!("sys"));
    assert_eq!(body["messages"][2]["content"], json!("on it"));
}

/// A model that caches **implicitly** is sent no markers at all — and therefore the same bytes for
/// the same message on every turn.
///
/// This is the property implicit caching runs on, and marking is what broke it: `cache_control`
/// needs a content block, so a marked text-only message is promoted from a bare string to a
/// one-element array, and the rolling markers move every turn. The same message would go out as a
/// string on one turn and an array on the next, changing the prefix underneath a provider that was
/// matching it — measured as a 0% read on a turn that read 98% unmarked.
#[test]
fn build_request_body_sends_no_markers_to_an_implicitly_caching_model() {
    let mut messages = vec![
        Message::system("a long system prompt"),
        Message::user("build it"),
    ];
    let mut shapes: Vec<Vec<serde_json::Value>> = Vec::new();
    for turn in 0..24 {
        messages.push(Message::assistant(Some(format!("turn {turn}")), vec![]));
        let body = build_request_body(
            "deepseek/deepseek-chat",
            &messages,
            &[],
            None,
            CacheTtl::Standard,
        );
        assert!(
            markers(&body).is_empty(),
            "turn {turn} marked an implicitly-caching model: {:?}",
            markers(&body)
        );
        shapes.push(body["messages"].as_array().expect("messages").clone());
    }

    // Every turn's prompt extends the last one rather than rewriting any part of it: each earlier
    // turn's messages are a byte-identical prefix of the next turn's.
    for pair in shapes.windows(2) {
        assert_eq!(
            pair[0].as_slice(),
            &pair[1][..pair[0].len()],
            "a turn rewrote an already-sent message instead of appending"
        );
    }
}

/// Which models are marked: the Anthropic family (which caches nothing without markers), whatever
/// vendor prefix routes them, and nothing else.
#[test]
fn requires_cache_markers_matches_the_anthropic_family_only() {
    for marked in [
        "anthropic/claude-sonnet-4.5",
        "anthropic/claude-opus-4.1:thinking",
        "ANTHROPIC/Claude-Haiku-4.5",
        "bedrock/anthropic.claude-sonnet-4.5-v1:0",
    ] {
        assert!(requires_cache_markers(marked), "{marked} must be marked");
    }
    for unmarked in [
        "openai/gpt-5",
        "google/gemini-2.5-pro",
        "deepseek/deepseek-chat",
        "moonshotai/kimi-k2",
        "mock/primary",
    ] {
        assert!(
            !requires_cache_markers(unmarked),
            "{unmarked} must not be marked"
        );
    }
}

// ---------------------------------------------------------------------------
// Prompt-cache breakpoints
// ---------------------------------------------------------------------------

/// The indices `cache_breakpoints` marked, read back off a built body — the wire-level truth,
/// so these tests assert what a provider actually receives rather than the helper's return value.
fn marked_indices(body: &serde_json::Value) -> Vec<usize> {
    body["messages"]
        .as_array()
        .expect("messages array")
        .iter()
        .enumerate()
        .filter(|(_, message)| {
            message["content"]
                .as_array()
                .is_some_and(|parts| parts.iter().any(|part| part.get("cache_control").is_some()))
        })
        .map(|(index, _)| index)
        .collect()
}

/// A marked message carries `cache_control: {type: "ephemeral"}` on a content part. Without it
/// Anthropic caches **nothing** — the bug this policy exists to fix — however identical two
/// consecutive requests are.
#[test]
fn build_request_body_marks_the_opening_context_and_the_tail() {
    let messages = [
        Message::system("a long system prompt"),
        Message::user("build it"),
        Message::assistant(Some("starting".to_string()), vec![]),
        Message::user("keep going"),
    ];
    let body = build_request_body(
        "anthropic/claude-haiku-4.5",
        &messages,
        &[],
        None,
        CacheTtl::Standard,
    );

    // The anchor is the last message before the first assistant turn (the fixed preamble), and
    // the tail writes this turn's prefix for the next turn to read.
    assert_eq!(marked_indices(&body), vec![1, 3]);
    // An agent on the standard lifetime qualifies neither marker, so both are the bare form gg
    // sent before the lifetime was configurable. Which markers ask for an hour is the
    // per-agent choice asserted below.
    assert_eq!(
        body["messages"][1]["content"][0]["cache_control"],
        json!({ "type": "ephemeral" })
    );
    assert_eq!(body["messages"][1]["content"][0]["text"], json!("build it"));
    assert_eq!(
        body["messages"][3]["content"][0]["cache_control"],
        json!({ "type": "ephemeral" })
    );
}

/// With no assistant turn yet the whole request is still preamble, so the anchor and the tail are
/// the same message and collapse to a single marker rather than being sent twice.
#[test]
fn cache_breakpoints_collapse_when_the_thread_has_not_started() {
    let messages = [Message::system("sys"), Message::user("build it")];
    assert_eq!(cache_breakpoints(&messages), vec![1]);
}

/// An assistant turn that only called tools has no content block to hang a marker on, so a
/// candidate landing there walks back to the nearest message that does. Marking it would be a
/// request-rejecting error, not a silent no-op.
#[test]
fn cache_breakpoints_skip_a_message_with_no_content_block() {
    let call = ToolCall {
        id: "call_1".to_string(),
        name: "write_file".to_string(),
        arguments: json!({ "path": "index.html" }),
    };
    let messages = [
        Message::system("sys"),
        Message::user("build it"),
        Message::assistant(None, vec![call]),
    ];

    // The tail (index 2) is content-free, so it falls back to index 1 — which is also the
    // anchor, leaving one marker.
    assert_eq!(cache_breakpoints(&messages), vec![1]);
}

/// The rolling breakpoints snap to a fixed grid so they name the same prefix from one turn to the
/// next. A marker at a shifting offset would describe a prefix no earlier turn ever wrote, and
/// would therefore never be a cache read.
#[test]
fn cache_breakpoints_snap_the_rolling_markers_to_a_stable_grid() {
    let mut messages = vec![Message::system("sys"), Message::user("build it")];
    for turn in 0..24 {
        messages.push(Message::assistant(Some(format!("turn {turn}")), vec![]));
    }

    // Anchor at 1, grid points at 24 and 16 (the two multiples of the stride below the tail),
    // tail at 25 — never more than Anthropic's cap of 4.
    let breakpoints = cache_breakpoints(&messages);
    assert_eq!(breakpoints, vec![1, 16, 24, 25]);
    assert!(breakpoints.len() <= MAX_CACHE_BREAKPOINTS);

    // Appending more turns moves the tail but leaves the grid points exactly where they were, so
    // the next request still reads a prefix an earlier one wrote.
    messages.push(Message::user("another"));
    assert_eq!(cache_breakpoints(&messages), vec![1, 16, 24, 26]);
    messages.push(Message::user("and another"));
    assert_eq!(cache_breakpoints(&messages), vec![1, 16, 24, 27]);
}

/// A long thread never exceeds Anthropic's four-breakpoint cap, whatever its shape — exceeding it
/// is a hard request error, so this is a bound and not a preference.
#[test]
fn cache_breakpoints_never_exceed_the_provider_cap() {
    for length in 0..200usize {
        let messages: Vec<Message> = (0..length)
            .map(|i| Message::user(format!("m{i}")))
            .collect();
        let breakpoints = cache_breakpoints(&messages);
        assert!(
            breakpoints.len() <= MAX_CACHE_BREAKPOINTS,
            "{length} messages produced {} breakpoints",
            breakpoints.len()
        );
        assert!(
            breakpoints.windows(2).all(|pair| pair[0] < pair[1]),
            "{length} messages produced unsorted/duplicated breakpoints: {breakpoints:?}"
        );
        assert!(breakpoints.iter().all(|&index| index < length));
    }
}

/// On a marked message that carries a picture the marker goes on the **last** part, so the image
/// falls inside the cached prefix. Marking the leading text part would leave the expensive half of
/// the message re-billed every turn.
#[test]
fn build_request_body_marks_the_last_part_of_an_image_message() {
    let read = Message::tool_result("call_1", "`ref.png` — PNG image, 12 bytes.")
        .with_images(vec![ImageContent::new("image/png", "QUJD", 3)]);
    let body = build_request_body(
        "anthropic/claude-haiku-4.5",
        &[Message::user("look at ref.png"), read],
        &[],
        None,
        CacheTtl::Extended,
    );

    let parts = body["messages"][1]["content"]
        .as_array()
        .expect("multi-part content");
    assert_eq!(parts.len(), 2);
    assert!(parts[0].get("cache_control").is_none());
    assert_eq!(parts[1]["type"], json!("image_url"));
    // With no assistant turn yet this is the lone anchor, which takes the extended lifetime.
    assert_eq!(
        parts[1]["cache_control"],
        json!({ "type": "ephemeral", "ttl": "1h" })
    );
}

/// An empty request produces no breakpoints rather than panicking on the tail index.
#[test]
fn cache_breakpoints_handle_an_empty_request() {
    assert!(cache_breakpoints(&[]).is_empty());
}

/// The `cache_control` marker on each message of a built body, by index — the wire-level view of
/// the [lifetimes](CacheTtl) a request asks for.
fn markers(body: &serde_json::Value) -> Vec<(usize, serde_json::Value)> {
    body["messages"]
        .as_array()
        .expect("messages array")
        .iter()
        .enumerate()
        .filter_map(|(index, message)| {
            message["content"]
                .as_array()?
                .iter()
                .find_map(|part| part.get("cache_control"))
                .map(|marker| (index, marker.clone()))
        })
        .collect()
}

/// The stable breakpoints — the anchor and the grid points — ask for the **extended** cache
/// lifetime, and only the rolling tail takes the provider default.
///
/// The five-minute default is the one gg was silently losing its cache to: an agent's turn runs a
/// build or a test suite and every agent shares one runtime thread, so the gap between two of its
/// requests is routinely longer than the entry lives. The entries a later turn *reads* have to
/// outlive that gap; the tail, rewritten every turn, has nothing to gain from it.
#[test]
fn build_request_body_extends_the_ttl_of_the_stable_breakpoints() {
    let mut messages = vec![
        Message::system("a long system prompt"),
        Message::user("build it"),
    ];
    for turn in 0..24 {
        messages.push(Message::assistant(Some(format!("turn {turn}")), vec![]));
    }
    let body = build_request_body(
        "anthropic/claude-haiku-4.5",
        &messages,
        &[],
        None,
        CacheTtl::Extended,
    );

    let extended = json!({ "type": "ephemeral", "ttl": "1h" });
    let rolling = json!({ "type": "ephemeral" });
    // Anchor at 1 and grid points at 16 and 24 are read by later turns; the tail at 25 is not.
    assert_eq!(
        markers(&body),
        vec![
            (1, extended.clone()),
            (16, extended.clone()),
            (24, extended),
            (25, rolling),
        ]
    );
}

/// An agent left at the **standard** lifetime qualifies nothing: every marker is the bare
/// `{type: "ephemeral"}` form, so its requests are byte-identical to the ones gg sent before the
/// lifetime became configurable.
///
/// This is the property that makes the knob safe to ship. The extended lifetime is billed a higher
/// write premium on every entry it applies to, so a run that never asked for it — which is every
/// stored configuration — must not quietly start paying it.
#[test]
fn build_request_body_qualifies_no_marker_at_the_standard_lifetime() {
    let mut messages = vec![
        Message::system("a long system prompt"),
        Message::user("build it"),
    ];
    for turn in 0..24 {
        messages.push(Message::assistant(Some(format!("turn {turn}")), vec![]));
    }
    let body = build_request_body(
        "anthropic/claude-haiku-4.5",
        &messages,
        &[],
        None,
        CacheTtl::Standard,
    );

    let standard = json!({ "type": "ephemeral" });
    // The same four breakpoints as the extended arm — the placement policy is unchanged; only what
    // each marker asks for differs.
    assert_eq!(
        markers(&body),
        vec![
            (1, standard.clone()),
            (16, standard.clone()),
            (24, standard.clone()),
            (25, standard),
        ]
    );
}

/// A request whose only breakpoint is the anchor — the first turn, before the thread starts —
/// extends it rather than treating it as a rolling tail. It is the opening context, the run's
/// single most valuable entry, and a long first turn is exactly when the default lifetime would
/// let it expire unread.
#[test]
fn build_request_body_extends_a_lone_anchor() {
    let messages = [
        Message::system("a long system prompt"),
        Message::user("build it"),
    ];
    let body = build_request_body(
        "anthropic/claude-haiku-4.5",
        &messages,
        &[],
        None,
        CacheTtl::Extended,
    );

    assert_eq!(
        markers(&body),
        vec![(1, json!({ "type": "ephemeral", "ttl": "1h" }))]
    );
}

/// The stable markers all precede the rolling one, which is the order a provider that supports
/// mixed lifetimes requires — a property of the [breakpoint policy](cache_breakpoints), asserted
/// here across thread lengths rather than left to the two shapes above.
#[test]
fn build_request_body_orders_extended_markers_before_the_rolling_one() {
    for length in 2..64usize {
        let mut messages = vec![Message::system("sys"), Message::user("build it")];
        for turn in 2..length {
            messages.push(Message::assistant(Some(format!("turn {turn}")), vec![]));
        }
        let body = build_request_body(
            "anthropic/claude-haiku-4.5",
            &messages,
            &[],
            None,
            CacheTtl::Extended,
        );
        let sent = markers(&body);
        let rolling = sent
            .iter()
            .position(|(_, marker)| marker.get("ttl").is_none());
        assert!(
            rolling.is_none_or(|at| at == sent.len() - 1),
            "{length} messages put a default-lifetime marker before an extended one: {sent:?}"
        );
    }
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
    GgSlotBinding::new(PRIMARY_SLOT, model_id)
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

/// A client takes the standard prompt-cache lifetime unless the agent profile it was built for
/// asked for the extended one — the per-agent choice, carried in on the binding, that decides what
/// this client's stable markers ask for on every request it sends.
#[test]
fn a_client_takes_the_prompt_cache_lifetime_of_the_agent_it_serves() {
    let client = OpenRouterClient::new(
        "https://example.test/api/v1",
        reqwest::Client::new(),
        "anthropic/claude-opus-4-8",
        "sk-test",
        RetryPolicy::default(),
        None,
    );
    assert_eq!(client.stable_ttl, CacheTtl::Standard);

    let extended = client.with_prompt_cache_ttl(GgPromptCacheTtl::Extended);
    assert_eq!(extended.stable_ttl, CacheTtl::Extended);
    // The configuration's two lifetimes map onto the two wire lifetimes and nothing else.
    assert_eq!(
        CacheTtl::from(GgPromptCacheTtl::Standard),
        CacheTtl::Standard
    );
    assert_eq!(
        CacheTtl::from(GgPromptCacheTtl::Extended),
        CacheTtl::Extended
    );
}

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

    // Past the end: an ending call, so any loop terminates. A text-only reply would not — under
    // this contract it is an error turn — so a mock that answered that way would run a test's loop
    // to its ceiling rather than ending it.
    let exhausted = client.complete(&[], &[]).await.expect("exhausted");
    assert_eq!(exhausted.finish_reason, FinishReason::ToolCalls);
    assert_eq!(exhausted.tool_calls[0].name, "finish");
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

    // Turn 12 ends the session, the one way a session ends.
    let last = client.complete(&[], &[]).await.expect("turn 12");
    assert_eq!(last.finish_reason, FinishReason::ToolCalls);
    assert_eq!(last.tool_calls[0].name, "finish");
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
