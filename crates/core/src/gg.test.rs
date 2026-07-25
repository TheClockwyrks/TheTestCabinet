//! Tests for the gg capability set and telemetry v1 contract types.

use serde_json::json;

use super::*;
use crate::metrics::TokenCounts;

#[test]
fn minimal_capability_set_binds_the_primary_slot_and_phase0_capabilities() {
    let set = GgCapabilitySet::minimal("anthropic/claude-opus-4.8");
    assert_eq!(set.preset.as_deref(), Some("minimal"));
    assert!(set.is_enabled(CAPABILITY_SHELL));
    // Each filesystem primitive is its own capability, so each carries its own config.
    for capability in FILESYSTEM_TOOL_CAPABILITIES {
        assert!(set.is_enabled(capability), "expected `{capability}` on");
    }
    // Context visibility is a default-on capability (it adds no tools, only accounting).
    assert!(set.is_enabled(CAPABILITY_CONTEXT_VISIBILITY));
    // An absent capability is distinguishable from a present one. Both Phase 2 backstops are
    // opt-in, so neither is in the minimal set.
    assert!(!set.is_enabled("compaction"));
    assert!(set.capability("compaction").is_none());
    assert!(!set.is_enabled(CAPABILITY_AGENT_MANAGED_CONTEXT));
    assert!(set.capability(CAPABILITY_AGENT_MANAGED_CONTEXT).is_none());
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
    // The default capabilities are still present, just unbound to any model.
    assert!(set.is_enabled(CAPABILITY_SHELL));
    assert!(set.is_enabled(CAPABILITY_READ_FILE));
    assert!(set.is_enabled(CAPABILITY_CONTEXT_VISIBILITY));
}

/// A capability set written before the filesystem split names only the umbrella id. It
/// keeps working: each per-tool capability reads as enabled through the alias, without any
/// stored data being migrated.
#[test]
fn the_legacy_filesystem_capability_stands_in_for_the_per_tool_ones() {
    let set = GgCapabilitySet {
        model_slots: Vec::new(),
        preset: None,
        capabilities: vec![GgCapabilityConfig::enabled(CAPABILITY_FILESYSTEM)],
        slots: Vec::new(),
        disabled_tools: Vec::new(),
    };
    for capability in FILESYSTEM_TOOL_CAPABILITIES {
        assert!(set.is_enabled(capability), "expected `{capability}` on");
        // The alias supplies enabledness only: the per-tool capability is still absent, so
        // nothing reads another capability's params as if they were its own.
        assert!(set.capability(capability).is_none());
        assert_eq!(
            set.effective_capability(capability).map(|c| c.id.as_str()),
            Some(CAPABILITY_FILESYSTEM)
        );
    }

    // Turning the umbrella off turns all four off.
    let off = GgCapabilitySet {
        capabilities: vec![GgCapabilityConfig::disabled(CAPABILITY_FILESYSTEM)],
        ..set.clone()
    };
    for capability in FILESYSTEM_TOOL_CAPABILITIES {
        assert!(!off.is_enabled(capability));
    }

    // An explicit per-tool capability wins over the umbrella beside it, in both directions.
    let mixed = GgCapabilitySet {
        capabilities: vec![
            GgCapabilityConfig::enabled(CAPABILITY_FILESYSTEM),
            GgCapabilityConfig::disabled(CAPABILITY_EDIT_FILE),
        ],
        ..set.clone()
    };
    assert!(!mixed.is_enabled(CAPABILITY_EDIT_FILE));
    assert!(mixed.is_enabled(CAPABILITY_READ_FILE));

    // The alias is one-way: a modern set does not answer to the legacy id.
    assert!(!GgCapabilitySet::default().is_enabled(CAPABILITY_FILESYSTEM));
}

#[test]
fn disabled_capability_is_present_but_off() {
    let set = GgCapabilitySet {
        model_slots: Vec::new(),
        preset: None,
        capabilities: vec![GgCapabilityConfig::disabled(CAPABILITY_SHELL)],
        slots: Vec::new(),
        disabled_tools: Vec::new(),
    };
    // Present-but-disabled reports not-enabled but is still findable.
    assert!(!set.is_enabled(CAPABILITY_SHELL));
    assert!(set.capability(CAPABILITY_SHELL).is_some());
}

#[test]
fn capability_set_round_trips_through_json() {
    let set = GgCapabilitySet {
        model_slots: Vec::new(),
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
                model_slot: None,
            },
        ],
        disabled_tools: vec!["edit_file".to_string()],
    };
    let value = serde_json::to_value(&set).expect("serialize");
    let back: GgCapabilitySet = serde_json::from_value(value).expect("deserialize");
    assert_eq!(set, back);
}

#[test]
fn a_deferred_binding_is_unresolved_until_a_launch_fills_its_model_slot() {
    // The shape a saved configuration carries: the `primary` role deferred to a
    // declared model slot, and `judge` pinned inside the configuration.
    let mut set = GgCapabilitySet {
        model_slots: vec![GgModelSlot {
            name: "critic".to_string(),
            default_model_id: Some("anthropic/claude-haiku-4.5".to_string()),
            provider: None,
        }],
        preset: None,
        capabilities: Vec::new(),
        slots: vec![
            GgSlotBinding::deferred(PRIMARY_SLOT, "critic"),
            GgSlotBinding::new("judge", "openai/o-fixed"),
        ],
        disabled_tools: Vec::new(),
    };
    // A deferred binding names no model, so it binds nothing yet — and it is exactly
    // what a launch must fill in.
    assert_eq!(set.unresolved_slots(), vec![PRIMARY_SLOT]);
    assert_eq!(set.model_for_slot(PRIMARY_SLOT), None);
    assert_eq!(set.model_for_slot("judge"), Some("openai/o-fixed"));
    assert_eq!(
        set.model_slot("critic")
            .and_then(|s| s.default_model_id.as_deref()),
        Some("anthropic/claude-haiku-4.5")
    );

    // Launching resolves it, and the set is then runnable.
    set.slots[0] = GgSlotBinding::new(PRIMARY_SLOT, "anthropic/claude-opus-4.8");
    assert!(set.unresolved_slots().is_empty());
    assert_eq!(
        set.model_for_slot(PRIMARY_SLOT),
        Some("anthropic/claude-opus-4.8")
    );
}

/// The models a launch resolves per-model facts for: every distinct model an agent can
/// run on, deduplicated, with a still-deferred binding (which names no model) skipped.
#[test]
fn bound_model_ids_lists_each_resolved_model_once() {
    let set = GgCapabilitySet {
        model_slots: Vec::new(),
        preset: None,
        capabilities: Vec::new(),
        slots: vec![
            GgSlotBinding::new(PRIMARY_SLOT, "anthropic/claude-opus-4.8"),
            GgSlotBinding::new("subagent", "openai/gpt-5.4-mini"),
            // Two roles sharing one model contribute one entry.
            GgSlotBinding::new("judge", "openai/gpt-5.4-mini"),
            GgSlotBinding::deferred("reviewer", "critic"),
        ],
        disabled_tools: Vec::new(),
    };
    assert_eq!(
        set.bound_model_ids(),
        vec!["anthropic/claude-opus-4.8", "openai/gpt-5.4-mini"]
    );

    assert!(GgCapabilitySet::default().bound_model_ids().is_empty());
}

#[test]
fn a_set_without_model_slots_deserializes_unchanged() {
    // Every configuration saved before model slots existed omits both fields.
    let set: GgCapabilitySet = serde_json::from_value(json!({
        "capabilities": [{ "id": "shell", "enabled": true }],
        "slots": [{ "slot": "primary", "modelId": "anthropic/claude-opus-4.8" }],
    }))
    .expect("deserialize");
    assert!(set.model_slots.is_empty());
    assert!(set.slots[0].model_slot.is_none());
    assert!(set.slots[0].is_resolved());
    // And a fully pinned set serializes without either field, so a recorded run's
    // configuration reads exactly as it did before.
    let value = serde_json::to_value(&set).expect("serialize");
    assert!(value.get("modelSlots").is_none());
    assert!(value["slots"][0].get("modelSlot").is_none());
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
fn context_breakdown_serializes_source_bands_and_omits_unknown_limit() {
    let kind = GgTelemetryKind::ContextBreakdown {
        by_source: vec![
            GgContextSourceUsage {
                source: GgContextSource::System,
                tokens: 120,
            },
            GgContextSourceUsage {
                source: GgContextSource::ToolOutput,
                tokens: 40,
            },
        ],
        total_tokens: 160,
        window_limit: Some(128_000),
        fullness: Some(0.00125),
    };
    let value = serde_json::to_value(&kind).expect("serialize");
    assert_eq!(
        value,
        json!({
            "type": "context_breakdown",
            "bySource": [
                { "source": "system", "tokens": 120 },
                { "source": "tool_output", "tokens": 40 },
            ],
            "totalTokens": 160,
            "windowLimit": 128_000,
            "fullness": 0.00125,
        })
    );
    let back: GgTelemetryKind = serde_json::from_value(value).expect("deserialize");
    assert_eq!(kind, back);

    // An unknown window limit (and thus fullness) is omitted rather than serialized null.
    let unknown = GgTelemetryKind::ContextBreakdown {
        by_source: Vec::new(),
        total_tokens: 0,
        window_limit: None,
        fullness: None,
    };
    assert_eq!(
        serde_json::to_value(&unknown).unwrap(),
        json!({ "type": "context_breakdown", "bySource": [], "totalTokens": 0 })
    );
}

#[test]
fn context_source_all_covers_every_variant_in_stable_order() {
    // `ALL` constructs every variant (so none is dead) and fixes the band order.
    assert_eq!(GgContextSource::ALL.len(), 11);
    assert_eq!(GgContextSource::ALL[0], GgContextSource::System);
    assert_eq!(
        serde_json::to_value(GgContextSource::TaskList).unwrap(),
        json!("task_list")
    );
    assert_eq!(
        serde_json::to_value(GgContextSource::Board).unwrap(),
        json!("board")
    );
    assert_eq!(
        serde_json::to_value(GgContextSource::Plan).unwrap(),
        json!("plan")
    );
}

#[test]
fn memory_state_serializes_entries_caps_and_totals() {
    let kind = GgTelemetryKind::MemoryState {
        memories: vec![GgMemoryEntry {
            name: "game-plan".to_string(),
            description: "the plan".to_string(),
            len: 42,
        }],
        count: 1,
        total_len: 42,
        caps: GgMemoryCaps {
            max_count: 8,
            max_len_per_memory: 2_000,
            max_total_len: 8_000,
        },
    };
    let value = serde_json::to_value(&kind).expect("serialize");
    assert_eq!(
        value,
        json!({
            "type": "memory_state",
            "memories": [
                { "name": "game-plan", "description": "the plan", "len": 42 }
            ],
            "count": 1,
            "totalLen": 42,
            "caps": {
                "maxCount": 8,
                "maxLenPerMemory": 2_000,
                "maxTotalLen": 8_000,
            },
        })
    );
    let back: GgTelemetryKind = serde_json::from_value(value).expect("deserialize");
    assert_eq!(kind, back);
}

#[test]
fn tasks_state_serializes_the_dag_with_statuses_and_edges() {
    let kind = GgTelemetryKind::TasksState {
        tasks: vec![
            GgTaskEntry {
                id: "scaffold".to_string(),
                title: "Scaffold index.html".to_string(),
                description: Some("Create the canvas and game loop.".to_string()),
                status: GgTaskStatus::Done,
                blocked_by: Vec::new(),
            },
            GgTaskEntry {
                id: "movement".to_string(),
                title: "Player movement".to_string(),
                description: None,
                status: GgTaskStatus::InProgress,
                blocked_by: vec!["scaffold".to_string()],
            },
        ],
    };
    let value = serde_json::to_value(&kind).expect("serialize");
    assert_eq!(
        value,
        json!({
            "type": "tasks_state",
            "tasks": [
                {
                    "id": "scaffold",
                    "title": "Scaffold index.html",
                    "description": "Create the canvas and game loop.",
                    "status": "done",
                    "blockedBy": [],
                },
                {
                    "id": "movement",
                    "title": "Player movement",
                    "status": "in_progress",
                    "blockedBy": ["scaffold"],
                },
            ],
        })
    );
    let back: GgTelemetryKind = serde_json::from_value(value).expect("deserialize");
    assert_eq!(kind, back);
}

#[test]
fn context_managed_serializes_the_action_and_reclaim() {
    let kind = GgTelemetryKind::ContextManaged {
        action: GgContextAction::EvictFileViews,
        reclaimed_tokens: 1280,
        items: 2,
        detail: "Evicted 2 file view(s) (a.js, b.js), reclaiming ~1280 tokens.".to_string(),
    };
    let value = serde_json::to_value(&kind).expect("serialize");
    assert_eq!(
        value,
        json!({
            "type": "context_managed",
            "action": "evict_file_views",
            "reclaimedTokens": 1280,
            "items": 2,
            "detail": "Evicted 2 file view(s) (a.js, b.js), reclaiming ~1280 tokens.",
        })
    );
    let back: GgTelemetryKind = serde_json::from_value(value).expect("deserialize");
    assert_eq!(kind, back);

    // The other action variant tags snake_case too.
    assert_eq!(
        serde_json::to_value(GgContextAction::ArchiveThread).unwrap(),
        json!("archive_thread")
    );
}

#[test]
fn empty_telemetry_variants_serialize_as_just_a_type() {
    assert_eq!(
        serde_json::to_value(GgTelemetryKind::SessionStarted {
            capability_set: None
        })
        .unwrap(),
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

#[test]
fn replay_entry_flattens_its_kind_inline_with_the_agent_and_seq() {
    let entry = GgReplayEntry {
        agent_id: "root".to_string(),
        seq: 3,
        kind: GgReplayEntryKind::ToolResult {
            call: json!({ "id": "c1", "name": "shell", "arguments": { "command": "ls" } }),
            outcome: json!({ "ok": true, "output": "a.txt", "summary": "listed" }),
        },
    };
    // The discriminator and its fields sit inline with `agentId`/`seq`.
    assert_eq!(
        serde_json::to_value(&entry).unwrap(),
        json!({
            "agentId": "root",
            "seq": 3,
            "type": "tool_result",
            "call": { "id": "c1", "name": "shell", "arguments": { "command": "ls" } },
            "outcome": { "ok": true, "output": "a.txt", "summary": "listed" },
        })
    );
}

#[test]
fn replay_record_round_trips_through_json() {
    let record = GgReplayRecord {
        session_id: "run-xyz".to_string(),
        capability_set: GgCapabilitySet::minimal("mock/echo"),
        entries: vec![
            GgReplayEntry {
                agent_id: "root".to_string(),
                seq: 0,
                kind: GgReplayEntryKind::ModelIo {
                    request: json!({ "messages": [], "tools": [] }),
                    response: json!({ "finishReason": "stop" }),
                },
            },
            GgReplayEntry {
                agent_id: "agent-0".to_string(),
                seq: 1,
                kind: GgReplayEntryKind::ToolResult {
                    call: json!({ "id": "c1", "name": "list_dir", "arguments": {} }),
                    outcome: json!({ "ok": true, "output": "", "summary": "listed" }),
                },
            },
        ],
    };
    let json = serde_json::to_string(&record).unwrap();
    let back: GgReplayRecord = serde_json::from_str(&json).unwrap();
    assert_eq!(back, record);
}
