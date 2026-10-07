//! An agent's **reasoning setting** on the wire: the binding a client is built from decides
//! whether every request that client sends carries the unified `reasoning` object, read from the
//! request exactly as it would have gone out.

use test_cabinet_core::gg::{GgReasoning, GgReasoningEffort, GgSlotBinding, PRIMARY_SLOT};

use super::routing_tests::{ANSWER, recorded};
use super::*;
use crate::model::{Message, ModelClient, ToolDefinition};

/// A client for `binding`, built by the production constructor with a test credential.
///
/// Each nextest test runs in its own process, so setting the credential here is isolated.
fn client_for(binding: &GgSlotBinding) -> OpenRouterClient {
    let saved = std::env::var_os(API_KEY_ENV);
    // SAFETY: nextest isolates each test in its own process.
    unsafe {
        std::env::set_var(API_KEY_ENV, "sk-test");
    }
    let client = OpenRouterClient::from_binding(binding, &RoutingKey::mint());
    unsafe {
        match saved {
            Some(value) => std::env::set_var(API_KEY_ENV, value),
            None => std::env::remove_var(API_KEY_ENV),
        }
    }
    client.expect("a client")
}

fn compact_tool() -> ToolDefinition {
    ToolDefinition {
        name: "compact".to_string(),
        description: "Compact.".to_string(),
        parameters: json!({ "type": "object" }),
    }
}

/// A binding that names a setting sends it on a free turn and on a required call alike, in
/// OpenRouter's key spellings.
#[tokio::test]
async fn a_bound_setting_rides_every_request_of_the_client() {
    for (reasoning, wire) in [
        (
            GgReasoning {
                effort: Some(GgReasoningEffort::Low),
                max_tokens: None,
            },
            json!({ "effort": "low" }),
        ),
        (
            GgReasoning {
                effort: None,
                max_tokens: Some(4_096),
            },
            json!({ "max_tokens": 4096 }),
        ),
    ] {
        let binding = GgSlotBinding::new(PRIMARY_SLOT, "deepseek/deepseek-v4.1-flash")
            .with_reasoning(Some(reasoning));
        let (client, sent) = recorded(client_for(&binding), ANSWER);
        client
            .complete(&[Message::user("hi")], &[])
            .await
            .expect("a turn");
        client
            .complete_requiring(&[Message::user("summarize")], &compact_tool())
            .await
            .expect("a required call");

        let sent = sent.lock().expect("the log");
        assert_eq!(sent.len(), 2);
        for (_, body) in sent.iter() {
            assert_eq!(body["reasoning"], wire, "{body}");
        }
    }
}

/// A binding without a setting sends no `reasoning` key, so the model runs at its provider's
/// default.
#[tokio::test]
async fn an_unset_binding_sends_no_reasoning_key() {
    let binding = GgSlotBinding::new(PRIMARY_SLOT, "deepseek/deepseek-v4.1-flash");
    let (client, sent) = recorded(client_for(&binding), ANSWER);
    client
        .complete(&[Message::user("hi")], &[])
        .await
        .expect("a turn");
    client
        .complete_requiring(&[Message::user("summarize")], &compact_tool())
        .await
        .expect("a required call");

    let sent = sent.lock().expect("the log");
    assert_eq!(sent.len(), 2);
    for (_, body) in sent.iter() {
        assert!(body.get("reasoning").is_none(), "{body}");
    }
}
