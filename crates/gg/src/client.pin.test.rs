//! The **provider pin** on the live client: a reply from any provider other than the pinned one
//! is refused as [`ModelError::ProviderMismatch`] on both transports, and one from the pinned
//! provider passes however OpenRouter spelled it.

use test_cabinet_core::gg::GgLoopDetection;

use super::*;
use crate::model::{Message, ModelClient, ModelError};

/// A buffered completion served by `provider`.
fn buffered_reply(provider: &str) -> String {
    json!({
        "provider": provider,
        "choices": [{ "message": { "role": "assistant", "content": "done" }, "finish_reason": "stop" }]
    })
    .to_string()
}

/// A streamed completion whose chunks name `provider`.
fn streamed_reply(provider: &str) -> String {
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
        "data: [DONE]\n\n".to_string(),
    ]
    .concat()
}

/// A client pinned to `pin` whose every attempt is answered with `body`.
fn pinned_client(pin: &str, body: String) -> OpenRouterClient {
    OpenRouterClient::new(
        "http://gateway.invalid/api/v1",
        reqwest::Client::new(),
        "openai/gpt-5.6",
        "sk-test",
        RetryPolicy::default(),
        None,
    )
    .with_provider(pin)
    .answered_by(move || {
        http::Response::builder()
            .status(200)
            .body(reqwest::Body::from(body.clone()))
            .expect("a well-formed response")
            .into()
    })
}

/// Loop detection switched on and fully declared, which is what makes a client stream.
fn streaming() -> GgLoopDetection {
    GgLoopDetection {
        enabled: true,
        window_words: Some(256),
        repeat_threshold: Some(32),
        min_offenders: Some(2),
        min_saturated_run: Some(3000),
        max_response_chars: Some(250_000),
    }
}

#[tokio::test]
async fn a_buffered_reply_from_another_provider_is_a_mismatch() {
    let client = pinned_client("OpenAI", buffered_reply("Azure"));
    let err = client
        .complete(&[Message::user("hi")], &[])
        .await
        .expect_err("Azure is not the pin");
    assert!(
        matches!(&err, ModelError::ProviderMismatch { pinned, served }
            if pinned == "OpenAI" && served == "Azure"),
        "{err}"
    );
}

#[tokio::test]
async fn a_streamed_reply_from_another_provider_is_a_mismatch() {
    let client = pinned_client("OpenAI", streamed_reply("Azure")).with_loop_detection(streaming());
    assert!(client.streams());
    let err = client
        .complete(&[Message::user("hi")], &[])
        .await
        .expect_err("Azure is not the pin");
    assert!(
        matches!(&err, ModelError::ProviderMismatch { served, .. } if served == "Azure"),
        "{err}"
    );
}

/// The pin passes however it is spelled: a hand-set tag spelling matches the name a response
/// carries.
#[tokio::test]
async fn a_reply_from_the_pinned_provider_passes() {
    for (pin, served) in [("OpenAI", "OpenAI"), ("z-ai", "Z.AI"), ("xai", "xAI")] {
        let response = pinned_client(pin, buffered_reply(served))
            .complete(&[Message::user("hi")], &[])
            .await
            .expect("the pinned provider served it");
        assert_eq!(response.provider.as_deref(), Some(served));

        let streamed = pinned_client(pin, streamed_reply(served))
            .with_loop_detection(streaming())
            .complete(&[Message::user("hi")], &[])
            .await
            .expect("the pinned provider streamed it");
        assert_eq!(streamed.provider.as_deref(), Some(served));
    }
}

/// The factory stamps each client with its own model's pin, so a run binding several models pins
/// each to its own developer, and a model the launch gave no pin gets none.
#[test]
fn the_factory_pins_each_model_to_its_own_provider() {
    let providers = BTreeMap::from([
        ("openai/gpt-5.6".to_string(), "OpenAI".to_string()),
        (
            "anthropic/claude-opus-4.8".to_string(),
            "Anthropic".to_string(),
        ),
    ]);
    let factory = DefaultClientFactory::new(
        None,
        DEFAULT_MODEL_CALL_TIMEOUT,
        RetryPolicy::default(),
        providers,
    );
    assert_eq!(factory.pin_for("openai/gpt-5.6"), Some("OpenAI"));
    assert_eq!(
        factory.pin_for("anthropic/claude-opus-4.8"),
        Some("Anthropic")
    );
    assert_eq!(factory.pin_for("x-ai/grok-4.7"), None);
}
