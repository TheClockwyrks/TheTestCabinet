//! Unit tests for the [message log](super): the [`fingerprint`] content-addressing, the
//! [`MessagePool`] de-duplication, and the event/token conversions.

use super::*;
use serde_json::json;

use crate::model::{ImageContent, ToolCall};

/// An assistant message calling one tool with the given id/name/args.
fn assistant_call(id: &str, name: &str, args: serde_json::Value) -> Message {
    Message::assistant(
        Some("thinking".to_string()),
        vec![ToolCall {
            id: id.to_string(),
            name: name.to_string(),
            arguments: args,
        }],
    )
}

#[test]
fn fingerprint_is_stable_for_identical_messages() {
    let a = Message::system("you are gg");
    let b = Message::system("you are gg");
    assert_eq!(fingerprint(&a), fingerprint(&b));
}

#[test]
fn fingerprint_distinguishes_content() {
    let a = Message::user("build a game");
    let b = Message::user("build a different game");
    assert_ne!(fingerprint(&a), fingerprint(&b));
}

#[test]
fn fingerprint_distinguishes_role() {
    // Same text, different role — a system prompt and a user echo of it are distinct
    // messages and must not collide.
    let system = Message::system("hello");
    let user = Message::user("hello");
    assert_ne!(fingerprint(&system), fingerprint(&user));
}

#[test]
fn fingerprint_covers_tool_calls_and_ids() {
    let a = assistant_call("call_1", "write_file", json!({ "path": "index.html" }));
    let b = assistant_call("call_1", "write_file", json!({ "path": "main.js" }));
    // Differing arguments change the fingerprint.
    assert_ne!(fingerprint(&a), fingerprint(&b));

    let c = Message::tool_result("call_1", "ok");
    let d = Message::tool_result("call_2", "ok");
    // Differing tool_call_id changes the fingerprint (the answer is to a different call).
    assert_ne!(fingerprint(&c), fingerprint(&d));
}

#[test]
fn fingerprint_covers_image_descriptors() {
    let text = Message::user("look");
    let with_image =
        Message::user("look").with_images(vec![ImageContent::new("image/png", "AAAA", 4096)]);
    assert_ne!(fingerprint(&text), fingerprint(&with_image));
}

#[test]
fn pool_reports_first_sight_then_repeats() {
    let pool = MessagePool::new();
    let id = "m0123456789abcdef";
    assert!(pool.register(id), "first registration is new");
    assert!(!pool.register(id), "a repeat is not new");
    assert!(!pool.register(id), "still not new");
}

#[test]
fn context_message_event_carries_body_and_image_descriptors() {
    let message = Message::tool_result("call_7", "file contents")
        .with_images(vec![ImageContent::new("image/jpeg", "ZZZZ", 8192)]);
    let id = fingerprint(&message);
    let event = context_message_event(id.clone(), &message, 123, Some("specs/spec.md"));
    match event {
        GgTelemetryKind::ContextMessage {
            id: got_id,
            role,
            content,
            tool_calls,
            tool_call_id,
            images,
            tokens,
            label,
        } => {
            assert_eq!(got_id, id);
            assert_eq!(role, "tool");
            assert_eq!(content.as_deref(), Some("file contents"));
            assert!(tool_calls.is_empty());
            assert_eq!(tool_call_id.as_deref(), Some("call_7"));
            assert_eq!(images.len(), 1);
            assert_eq!(images[0].media_type, "image/jpeg");
            assert_eq!(images[0].bytes, 8192);
            // The base64 bytes are deliberately NOT carried — only the descriptor.
            assert_eq!(tokens, 123);
            // The window item's selector tag rides on the definition, so the view's tokens
            // stay attributable to the file that filled the window.
            assert_eq!(label.as_deref(), Some("specs/spec.md"));
        }
        other => panic!("expected ContextMessage, got {other:?}"),
    }
}

#[test]
fn context_message_event_maps_assistant_tool_calls() {
    let message = assistant_call("call_9", "read_file", json!({ "path": "level.json" }));
    let event = context_message_event(fingerprint(&message), &message, 40, None);
    match event {
        GgTelemetryKind::ContextMessage {
            role,
            tool_calls,
            content,
            ..
        } => {
            assert_eq!(role, "assistant");
            assert_eq!(content.as_deref(), Some("thinking"));
            assert_eq!(tool_calls.len(), 1);
            assert_eq!(tool_calls[0].id, "call_9");
            assert_eq!(tool_calls[0].name, "read_file");
            assert_eq!(tool_calls[0].args, json!({ "path": "level.json" }));
        }
        other => panic!("expected ContextMessage, got {other:?}"),
    }
}

#[test]
fn finish_reason_token_maps_each_variant() {
    assert_eq!(finish_reason_token(&FinishReason::Stop), "stop");
    assert_eq!(finish_reason_token(&FinishReason::ToolCalls), "tool_calls");
    assert_eq!(finish_reason_token(&FinishReason::Length), "length");
    assert_eq!(
        finish_reason_token(&FinishReason::ContentFilter),
        "content_filter"
    );
    assert_eq!(
        finish_reason_token(&FinishReason::Other("weird".to_string())),
        "weird"
    );
}
