use super::*;
use serde_json::json;

/// The role constructors populate the fields their role expects and leave the rest
/// empty.
#[test]
fn message_constructors_shape_each_role() {
    let system = Message::system("be helpful");
    assert_eq!(system.role, Role::System);
    assert_eq!(system.content.as_deref(), Some("be helpful"));
    assert!(system.tool_calls.is_empty());
    assert!(system.tool_call_id.is_none());

    let user = Message::user("build a game");
    assert_eq!(user.role, Role::User);
    assert_eq!(user.content.as_deref(), Some("build a game"));

    let call = ToolCall {
        id: "call_1".to_string(),
        name: "write_file".to_string(),
        arguments: json!({ "path": "index.html" }),
    };
    let assistant = Message::assistant(Some("working".to_string()), vec![call.clone()]);
    assert_eq!(assistant.role, Role::Assistant);
    assert_eq!(assistant.content.as_deref(), Some("working"));
    assert_eq!(assistant.tool_calls, vec![call]);
    assert!(assistant.tool_call_id.is_none());

    // An assistant turn that only called tools carries no text.
    let tool_only = Message::assistant(None, Vec::new());
    assert!(tool_only.content.is_none());

    let result = Message::tool_result("call_1", "wrote 512 bytes");
    assert_eq!(result.role, Role::Tool);
    assert_eq!(result.content.as_deref(), Some("wrote 512 bytes"));
    assert_eq!(result.tool_call_id.as_deref(), Some("call_1"));
    assert!(result.tool_calls.is_empty());
}

/// A `ModelResponse` round-trips through JSON, so a mock script can be authored as
/// data. Absent optional fields stay absent.
#[test]
fn model_response_round_trips_through_json() {
    let response = ModelResponse {
        text: Some("done".to_string()),
        tool_calls: vec![ToolCall {
            id: "c1".to_string(),
            name: "write_file".to_string(),
            arguments: json!({ "path": "a.txt", "contents": "hi" }),
        }],
        finish_reason: FinishReason::ToolCalls,
        usage: TokenCounts {
            uncached_input: Some(10),
            cached_input: None,
            output: Some(5),
            reasoning: None,
        },
        cost: Some(Cost {
            comparable: Some(0.01),
            actual: Some(0.01),
        }),
        loop_aborts: 0,
    };

    let encoded = serde_json::to_string(&response).expect("serialize");
    let decoded: ModelResponse = serde_json::from_str(&encoded).expect("deserialize");
    assert_eq!(decoded, response);

    // FinishReason serializes as its snake_case tag.
    let value = serde_json::to_value(&response).expect("to_value");
    assert_eq!(value["finishReason"], json!("tool_calls"));
}

/// A minimal response deserializes with defaulted usage and no cost/tool calls.
#[test]
fn model_response_deserializes_minimal_form() {
    let decoded: ModelResponse =
        serde_json::from_str(r#"{ "finishReason": "stop" }"#).expect("deserialize");
    assert_eq!(decoded.finish_reason, FinishReason::Stop);
    assert!(decoded.text.is_none());
    assert!(decoded.tool_calls.is_empty());
    assert_eq!(decoded.usage, TokenCounts::default());
    assert!(decoded.cost.is_none());
    // A response recorded before loop detection existed reads as one that discarded nothing,
    // rather than failing to read at all.
    assert_eq!(decoded.loop_aborts, 0);
}

/// The two errors where the *request* was fine are retryable: the provider never served it
/// (`RetryExhausted`), or it served it and every answer was a generation loop (`ResponseLoop`).
/// Every other variant is fatal.
#[test]
fn model_error_classifies_retryable_versus_fatal() {
    assert!(
        ModelError::RetryExhausted {
            attempts: 4,
            last: "HTTP 503".to_string()
        }
        .is_retryable_exhausted()
    );
    assert!(
        ModelError::ResponseLoop {
            attempts: 4,
            detail: "2 words repeated across 3000 consecutive words".to_string(),
        }
        .is_retryable_exhausted(),
        "a reply that looped on every attempt ends the run the way retry exhaustion does"
    );

    for fatal in [
        ModelError::MissingApiKey,
        ModelError::Fatal {
            status: 401,
            message: "unauthorized".to_string(),
        },
        ModelError::Parse("bad json".to_string()),
    ] {
        assert!(!fatal.is_retryable_exhausted(), "{fatal:?} should be fatal");
    }
}

/// A `ResponseLoop` says both halves of what happened — what the detector saw and how many replies
/// were thrown away — and is not an auth failure or a recoverable vision refusal.
///
/// The wording is the point. `RetryExhausted` means the provider would not serve the request; this
/// means it served the request repeatedly and gg discarded every answer. Only one of those is worth
/// changing a model binding over, so the two must not read alike.
#[test]
fn a_response_loop_reports_what_looped_and_how_much_was_discarded() {
    let error = ModelError::ResponseLoop {
        attempts: 3,
        detail: "the reply passed 250001 characters without finishing".to_string(),
    };

    let message = error.to_string();
    assert!(
        message.contains("the reply passed 250001 characters without finishing"),
        "{message}"
    );
    assert!(message.contains("discarded 3 response(s)"), "{message}");
    assert!(!error.is_auth_failure());
    assert!(error.vision_unsupported_model().is_none());
}

/// A refused credential — absent, `401`, or `403` — is an auth failure; every other
/// error, fatal or not, is about the request rather than the key.
#[test]
fn model_error_classifies_auth_failures() {
    for auth in [
        ModelError::MissingApiKey,
        ModelError::Fatal {
            status: 401,
            message: r#"{"error":{"message":"User not found.","code":401}}"#.to_string(),
        },
        ModelError::Fatal {
            status: 403,
            message: "forbidden".to_string(),
        },
    ] {
        assert!(auth.is_auth_failure(), "{auth:?} should be an auth failure");
    }

    for other in [
        ModelError::Fatal {
            status: 400,
            message: "not a valid model id".to_string(),
        },
        ModelError::Fatal {
            status: 404,
            message: "no endpoints found".to_string(),
        },
        ModelError::RetryExhausted {
            attempts: 4,
            last: "HTTP 503".to_string(),
        },
        ModelError::Parse("bad json".to_string()),
    ] {
        assert!(
            !other.is_auth_failure(),
            "{other:?} should not be an auth failure"
        );
    }
}
