//! Tests for the gg capability set and telemetry v1 contract types.

use serde_json::json;

use super::*;
use crate::metrics::TokenCounts;

#[test]
fn minimal_capability_set_binds_the_primary_slot_and_phase0_capabilities() {
    let set = GgCapabilitySet::minimal("anthropic/claude-opus-4.8");
    assert_eq!(set.preset.as_deref(), Some("minimal"));
    assert!(set.is_enabled(CAPABILITY_SHELL));
    assert!(set.is_enabled(CAPABILITY_FILESYSTEM));
    // An absent capability is distinguishable from a present one.
    assert!(!set.is_enabled("compaction"));
    assert!(set.capability("compaction").is_none());
    assert_eq!(
        set.model_for_slot(PRIMARY_SLOT),
        Some("anthropic/claude-opus-4.8")
    );
}

#[test]
fn default_capability_set_needs_no_model_and_binds_no_slot() {
    let set = GgCapabilitySet::default();
    assert!(set.slots.is_empty());
    assert!(set.preset.is_none());
    // The Phase 0 capabilities are still present, just unbound to any model.
    assert!(set.is_enabled(CAPABILITY_SHELL));
    assert!(set.is_enabled(CAPABILITY_FILESYSTEM));
}

#[test]
fn disabled_capability_is_present_but_off() {
    let set = GgCapabilitySet {
        preset: None,
        capabilities: vec![GgCapabilityConfig::disabled(CAPABILITY_SHELL)],
        slots: Vec::new(),
    };
    // Present-but-disabled reports not-enabled but is still findable.
    assert!(!set.is_enabled(CAPABILITY_SHELL));
    assert!(set.capability(CAPABILITY_SHELL).is_some());
}

#[test]
fn capability_set_round_trips_through_json() {
    let set = GgCapabilitySet {
        preset: Some("planning-A".to_string()),
        capabilities: vec![
            GgCapabilityConfig::enabled(CAPABILITY_SHELL),
            GgCapabilityConfig {
                id: "compaction".to_string(),
                enabled: true,
                implementation: Some("summarize-v2".to_string()),
                params: json!({ "threshold": 0.8 }),
            },
        ],
        slots: vec![
            GgSlotBinding::new(PRIMARY_SLOT, "anthropic/claude-opus-4.8"),
            GgSlotBinding {
                slot: "reviewer".to_string(),
                model_id: "openai/gpt-5.5".to_string(),
                provider: Some("openrouter".to_string()),
            },
        ],
    };
    let value = serde_json::to_value(&set).expect("serialize");
    let back: GgCapabilitySet = serde_json::from_value(value).expect("deserialize");
    assert_eq!(set, back);
}

#[test]
fn capability_config_defaults_params_to_an_empty_object_when_absent() {
    // A stored config that omits `params` (and `implementation`) still deserializes,
    // with `params` defaulting to an empty object.
    let config: GgCapabilityConfig =
        serde_json::from_value(json!({ "id": "shell", "enabled": true })).expect("deserialize");
    assert_eq!(config, GgCapabilityConfig::enabled(CAPABILITY_SHELL));
    assert_eq!(config.params, json!({}));
}

#[test]
fn telemetry_kind_is_tagged_by_type_with_camelcase_fields() {
    let value = serde_json::to_value(GgTelemetryKind::ToolCall {
        name: "shell".to_string(),
        args: json!({ "command": "npm test" }),
    })
    .expect("serialize");
    assert_eq!(
        value,
        json!({
            "type": "tool_call",
            "name": "shell",
            "args": { "command": "npm test" }
        })
    );
}

#[test]
fn telemetry_event_flattens_its_kind_and_omits_unset_reserved_fields() {
    let event = GgTelemetryEvent::new(
        "2026-07-23T00:00:00Z",
        GgTelemetryKind::AssistantMessage {
            text: "building the game".to_string(),
        },
    );
    let value = serde_json::to_value(&event).expect("serialize");
    // The reserved Phase 3/4 fields and the session id are omitted when unset.
    assert_eq!(
        value,
        json!({
            "timestamp": "2026-07-23T00:00:00Z",
            "type": "assistant_message",
            "text": "building the game"
        })
    );
}

#[test]
fn usage_telemetry_reuses_the_shared_token_and_cost_types() {
    let event = GgTelemetryEvent {
        timestamp: "2026-07-23T00:00:00Z".to_string(),
        session_id: Some("sess-1".to_string()),
        agent_id: None,
        parent_agent_id: None,
        issue_id: None,
        kind: GgTelemetryKind::Usage {
            tokens: TokenCounts {
                uncached_input: Some(1200),
                cached_input: Some(300),
                output: Some(450),
                reasoning: None,
            },
            cost: Some(Cost {
                comparable: Some(0.021),
                actual: Some(0.021),
            }),
        },
    };
    let value = serde_json::to_value(&event).expect("serialize");
    let back: GgTelemetryEvent = serde_json::from_value(value).expect("deserialize");
    assert_eq!(event, back);
}

#[test]
fn empty_telemetry_variants_serialize_as_just_a_type() {
    assert_eq!(
        serde_json::to_value(GgTelemetryKind::SessionStarted {}).unwrap(),
        json!({ "type": "session_started" })
    );
    assert_eq!(
        serde_json::to_value(GgTelemetryKind::SessionEnded {
            status: "completed".to_string(),
        })
        .unwrap(),
        json!({ "type": "session_ended", "status": "completed" })
    );
}
