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
            uncached_input: Some(10),
            cached_input: Some(5),
            output: Some(3),
            reasoning: Some(2),
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

#[test]
fn image_defaults_to_published_namespace_on_latest() {
    // Nothing set: the published GHCR image for the test type, on the latest tag.
    // End-to-end runs resolve the base image; asset-generation runs resolve the
    // asset-generation image (the base plus the baked-in `draw` binary).
    assert_eq!(
        compose_run_image(BASE_IMAGE_NAME, None, None, None),
        "ghcr.io/theclockwyrks/test-cabinet-base:latest"
    );
    assert_eq!(
        compose_run_image(ASSET_GEN_IMAGE_NAME, None, None, None),
        "ghcr.io/theclockwyrks/test-cabinet-asset-gen:latest"
    );
}

#[test]
fn image_name_tracks_the_test_type() {
    // The image NAME is chosen by test type; the registry/tag environment applies
    // to both the same way.
    assert_eq!(image_name_for(TestType::EndToEnd), BASE_IMAGE_NAME);
    assert_eq!(
        image_name_for(TestType::AssetGeneration),
        ASSET_GEN_IMAGE_NAME
    );
}

#[test]
fn image_applies_registry_and_tag_overrides() {
    assert_eq!(
        compose_run_image(
            BASE_IMAGE_NAME,
            None,
            Some("registry.example.com/team".to_string()),
            Some("v2".to_string()),
        ),
        "registry.example.com/team/test-cabinet-base:v2"
    );
    // The same registry/tag carries the asset-generation image too.
    assert_eq!(
        compose_run_image(
            ASSET_GEN_IMAGE_NAME,
            None,
            Some("registry.example.com/team".to_string()),
            Some("v2".to_string()),
        ),
        "registry.example.com/team/test-cabinet-asset-gen:v2"
    );
    // A trailing slash on the registry is normalized away.
    assert_eq!(
        compose_run_image(
            BASE_IMAGE_NAME,
            None,
            Some("registry.example.com/team/".to_string()),
            None
        ),
        "registry.example.com/team/test-cabinet-base:latest"
    );
}

#[test]
fn image_empty_registry_names_a_local_image() {
    // An explicitly empty registry (distinct from unset) drops the prefix, naming
    // a local image for offline development — for either test type's image.
    assert_eq!(
        compose_run_image(BASE_IMAGE_NAME, None, Some(String::new()), None),
        "test-cabinet-base:latest"
    );
    assert_eq!(
        compose_run_image(ASSET_GEN_IMAGE_NAME, None, Some(String::new()), None),
        "test-cabinet-asset-gen:latest"
    );
}

#[test]
fn explicit_image_override_wins_verbatim() {
    // An explicit `TCAB_CONTAINER_IMAGE` takes precedence over registry/tag and is
    // used verbatim (e.g. a pinned digest), trimmed of surrounding whitespace. It
    // ignores the image name, so it applies regardless of test type.
    assert_eq!(
        compose_run_image(
            BASE_IMAGE_NAME,
            Some("  ghcr.io/me/custom-base@sha256:abc  ".to_string()),
            Some("registry.example.com".to_string()),
            Some("v9".to_string()),
        ),
        "ghcr.io/me/custom-base@sha256:abc"
    );
    // A blank explicit value is ignored, falling through to the defaults.
    assert_eq!(
        compose_run_image(ASSET_GEN_IMAGE_NAME, Some("   ".to_string()), None, None),
        "ghcr.io/theclockwyrks/test-cabinet-asset-gen:latest"
    );
}
