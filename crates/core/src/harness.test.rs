//! Tests for harness slug round-trips and usage normalization shape.

use serde_json::json;

use super::*;
use crate::run_record::HarnessSlug;

#[test]
fn every_slug_round_trips_through_its_wire_form() {
    for slug in HarnessSlug::ALL {
        let value = serde_json::to_value(slug).expect("serialize slug");
        assert_eq!(value, json!(slug.as_str()));

        let parsed: HarnessSlug = serde_json::from_value(value).expect("deserialize slug");
        assert_eq!(parsed, slug);
    }
}

#[test]
fn slugs_match_the_documented_catalog() {
    let wire: Vec<&str> = HarnessSlug::ALL.iter().map(|s| s.as_str()).collect();
    assert_eq!(
        wire,
        vec![
            "claude",
            "codex",
            "cline",
            "antigravity",
            "goose",
            "kilo",
            "opencode",
            "pi",
        ]
    );
}

#[test]
fn invocation_serializes_camel_case() {
    let invocation = HarnessInvocation {
        slug: HarnessSlug::Codex,
        model_id: "openai/gpt-x".to_string(),
        prompt: "build the game".to_string(),
    };
    let value = serde_json::to_value(&invocation).expect("serialize");
    assert_eq!(
        value,
        json!({
            "slug": "codex",
            "modelId": "openai/gpt-x",
            "prompt": "build the game"
        })
    );
}

#[test]
fn usage_carries_normalized_token_classes() {
    let usage = Usage {
        tokens: crate::metrics::TokenCounts {
            uncached_input: 10,
            cached_input: 5,
            output: 3,
            reasoning: 2,
        },
    };
    let value = serde_json::to_value(usage).expect("serialize");
    assert_eq!(
        value,
        json!({
            "tokens": {
                "uncachedInput": 10,
                "cachedInput": 5,
                "output": 3,
                "reasoning": 2
            }
        })
    );
}
