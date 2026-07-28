use super::*;

use std::collections::BTreeMap;

use test_cabinet_core::comparison::{ComparisonArm, ComparisonControls};
use test_cabinet_core::run_record::HarnessSlug;

/// A minimal Pi-vs-Kilo comparison config.
fn sample_config() -> ComparisonConfig {
    ComparisonConfig {
        controls: ComparisonControls {
            case_slug: "carom".into(),
            version: "v2.0.0".into(),
            variant: "base".into(),
            orchestrator_slug: "one-shot".into(),
            container_build: None,
        },
        arms: vec![ComparisonArm {
            id: "pi".into(),
            label: "Pi".into(),
            harness_slug: Some(HarnessSlug::Pi),
            model_id: Some("anthropic/claude-opus-4.8".into()),
            gg_config_id: None,
            gg_slot_models: BTreeMap::new(),
            run_ids: vec![],
        }],
        n: 3,
    }
}

/// A save body with the given name.
fn sample_input(name: &str) -> ComparisonInput {
    ComparisonInput {
        name: name.to_string(),
        description: "  Pi vs Kilo on Carom  ".to_string(),
        config: sample_config(),
    }
}

#[test]
fn stored_from_input_trims_and_starts_unpublished() {
    let input = ComparisonInput {
        name: "  carom-pi-vs-kilo  ".to_string(),
        ..sample_input("ignored")
    };
    let stored = stored_from_input(
        "c1".into(),
        "user-1",
        input,
        "2026-07-27T00:00:00Z",
        "2026-07-27T01:00:00Z",
    )
    .unwrap();
    assert_eq!(stored.id, "c1");
    assert_eq!(stored.user_id, "user-1");
    assert_eq!(stored.name, "carom-pi-vs-kilo");
    assert_eq!(stored.description, "Pi vs Kilo on Carom");
    assert_eq!(stored.created_at, "2026-07-27T00:00:00Z");
    assert_eq!(stored.updated_at, "2026-07-27T01:00:00Z");
    assert!(!stored.published);
    assert!(stored.published_at.is_none());
    // The config survives the round trip.
    assert_eq!(stored.config, sample_config());
}

#[test]
fn stored_from_input_rejects_a_blank_name() {
    let input = ComparisonInput {
        name: "   ".to_string(),
        ..sample_input("ignored")
    };
    let err = stored_from_input("c1".into(), "u", input, "t", "t").unwrap_err();
    assert_eq!(err.status, StatusCode::BAD_REQUEST);
}

#[test]
fn stored_from_input_rejects_an_overlong_name() {
    let input = ComparisonInput {
        name: "n".repeat(MAX_NAME_LEN + 1),
        ..sample_input("ignored")
    };
    let err = stored_from_input("c1".into(), "u", input, "t", "t").unwrap_err();
    assert_eq!(err.status, StatusCode::BAD_REQUEST);
}

#[test]
fn stored_from_input_rejects_an_overlong_description() {
    let input = ComparisonInput {
        description: "d".repeat(MAX_DESCRIPTION_LEN + 1),
        ..sample_input("carom")
    };
    let err = stored_from_input("c1".into(), "u", input, "t", "t").unwrap_err();
    assert_eq!(err.status, StatusCode::BAD_REQUEST);
}

/// The stored config serializes to JSON and parses back identically — the shape the
/// `config_json` column round-trips.
#[test]
fn config_json_round_trips() {
    let config = sample_config();
    let json = serde_json::to_string(&config).unwrap();
    let parsed: ComparisonConfig = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed, config);
}
