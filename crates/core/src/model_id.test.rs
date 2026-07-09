use super::*;
use crate::harness::HarnessRegistry;
use crate::harness_registry::DefaultHarnessRegistry;

#[test]
fn strips_openrouter_prefix_for_every_harness() {
    for harness in HarnessSlug::ALL {
        assert_eq!(
            canonical_model_id("openrouter/anthropic/claude-opus-4.8", harness),
            "anthropic/claude-opus-4.8",
            "{harness:?} should strip the openrouter/ routing prefix",
        );
    }
}

#[test]
fn strips_free_tag_only_for_openrouter_harnesses() {
    // OpenRouter-accessed harnesses: the `:free` variant tag is a pricing route,
    // not a distinct model, so it collapses onto the base id.
    assert_eq!(
        canonical_model_id("deepseek/deepseek-v4:free", HarnessSlug::Kilo),
        "deepseek/deepseek-v4",
    );
    assert_eq!(
        canonical_model_id("openrouter/deepseek/deepseek-v4:free", HarnessSlug::Opencode),
        "deepseek/deepseek-v4",
    );
    // Provider-native harnesses never carry an OpenRouter variant tag; leave any
    // trailing colon segment alone.
    assert_eq!(
        canonical_model_id("deepseek/deepseek-v4:free", HarnessSlug::Codex),
        "deepseek/deepseek-v4:free",
    );
    assert_eq!(
        canonical_model_id("some-model:tag", HarnessSlug::Claude),
        "some-model:tag",
    );
}

#[test]
fn leaves_untagged_ids_unchanged() {
    assert_eq!(
        canonical_model_id("anthropic/claude-opus-4.8", HarnessSlug::Kilo),
        "anthropic/claude-opus-4.8",
    );
    assert_eq!(
        canonical_model_id("claude-opus-4-8", HarnessSlug::Claude),
        "claude-opus-4-8",
    );
}

#[test]
fn price_id_adds_openai_prefix_for_codex() {
    assert_eq!(openrouter_price_id("gpt-5.5", HarnessSlug::Codex), "openai/gpt-5.5");
    // Already prefixed: don't double up.
    assert_eq!(
        openrouter_price_id("openai/gpt-5.5", HarnessSlug::Codex),
        "openai/gpt-5.5",
    );
}

#[test]
fn price_id_uses_canonical_for_openrouter_harnesses() {
    assert_eq!(
        openrouter_price_id("openrouter/anthropic/claude-opus-4.8", HarnessSlug::Kilo),
        "anthropic/claude-opus-4.8",
    );
    assert_eq!(
        openrouter_price_id("deepseek/deepseek-v4:free", HarnessSlug::Opencode),
        "deepseek/deepseek-v4",
    );
}

/// The OpenRouter classification must track the harness's actual API-key
/// environment: a harness routes through OpenRouter exactly when it authenticates
/// with `OPENROUTER_API_KEY`. Asserting it here keeps the two from drifting.
#[test]
fn routes_through_openrouter_matches_api_key_env() {
    let registry = DefaultHarnessRegistry::new();
    for harness in HarnessSlug::ALL {
        let uses_openrouter_key = registry
            .get(harness)
            .and_then(|h| h.api_key_env())
            == Some("OPENROUTER_API_KEY");
        assert_eq!(
            harness.routes_through_openrouter(),
            uses_openrouter_key,
            "{harness:?}: routes_through_openrouter disagrees with api_key_env",
        );
    }
}
