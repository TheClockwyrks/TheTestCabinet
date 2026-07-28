//! Tests for the gg capability set and telemetry v1 contract types.

use serde_json::json;

use super::*;
use crate::metrics::TokenCounts;

/// A single-agent capability set whose [Root](ROOT_AGENT) profile carries `capabilities` — the
/// common shape these tests need now that capabilities are per-agent.
fn root_set(capabilities: Vec<GgCapabilityConfig>) -> GgCapabilitySet {
    GgCapabilitySet {
        preset: None,
        agents: vec![GgAgentConfig {
            capabilities,
            ..GgAgentConfig::root()
        }],
        model_slots: Vec::new(),
        limits: GgRunLimits::default(),
    }
}

#[test]
fn minimal_capability_set_binds_the_root_model_and_phase0_capabilities() {
    let set = GgCapabilitySet::minimal("anthropic/claude-opus-4.8");
    assert_eq!(set.preset.as_deref(), Some("minimal"));
    assert!(set.is_enabled(CAPABILITY_SHELL));
    // Each filesystem primitive is its own capability, so each carries its own config.
    for capability in FILESYSTEM_TOOL_CAPABILITIES {
        assert!(set.is_enabled(capability), "expected `{capability}` on");
    }
    // Context visibility is not a capability, so the context-window override is the only
    // context knob — and it is opt-in, so a minimal set carries none of it. (Context
    // visibility itself is always on, exercised by the gg-crate emission tests.)
    assert!(!set.is_enabled(CAPABILITY_CONTEXT_WINDOW_OVERRIDE));
    assert!(set.capability(CAPABILITY_CONTEXT_WINDOW_OVERRIDE).is_none());
    // An absent capability is distinguishable from a present one. Both Phase 2 backstops are
    // opt-in, so neither is in the minimal set.
    assert!(!set.is_enabled("compaction"));
    assert!(set.capability("compaction").is_none());
    assert!(!set.is_enabled(CAPABILITY_AGENT_MANAGED_CONTEXT));
    assert!(set.capability(CAPABILITY_AGENT_MANAGED_CONTEXT).is_none());
    // The Root agent is bound to the given model.
    assert_eq!(set.root().name, ROOT_AGENT);
    assert_eq!(
        set.root().resolved_model_id(),
        Some("anthropic/claude-opus-4.8")
    );
}

#[test]
fn default_capability_set_needs_no_model_and_binds_no_agent_model() {
    let set = GgCapabilitySet::default();
    // Exactly one agent — the Root — with no model bound.
    assert_eq!(set.agents.len(), 1);
    assert_eq!(set.root().name, ROOT_AGENT);
    assert!(set.root().resolved_model_id().is_none());
    assert!(set.preset.is_none());
    // The default capabilities are still present, just unbound to any model.
    assert!(set.is_enabled(CAPABILITY_SHELL));
    assert!(set.is_enabled(CAPABILITY_READ_FILE));
    assert!(set.is_enabled(CAPABILITY_SKILLS));
}

/// A capability set written before the filesystem split names only the umbrella id. It
/// keeps working: each per-tool capability reads as enabled through the alias, without any
/// stored data being migrated.
#[test]
fn the_legacy_filesystem_capability_stands_in_for_the_per_tool_ones() {
    let set = root_set(vec![GgCapabilityConfig::enabled(CAPABILITY_FILESYSTEM)]);
    let root = set.root();
    for capability in FILESYSTEM_TOOL_CAPABILITIES {
        assert!(root.is_enabled(capability), "expected `{capability}` on");
        // The alias supplies enabledness only: the per-tool capability is still absent, so
        // nothing reads another capability's params as if they were its own.
        assert!(root.capability(capability).is_none());
        assert_eq!(
            root.effective_capability(capability).map(|c| c.id.as_str()),
            Some(CAPABILITY_FILESYSTEM)
        );
    }

    // Turning the umbrella off turns all four off.
    let off = root_set(vec![GgCapabilityConfig::disabled(CAPABILITY_FILESYSTEM)]);
    for capability in FILESYSTEM_TOOL_CAPABILITIES {
        assert!(!off.root().is_enabled(capability));
    }

    // An explicit per-tool capability wins over the umbrella beside it, in both directions.
    let mixed = root_set(vec![
        GgCapabilityConfig::enabled(CAPABILITY_FILESYSTEM),
        GgCapabilityConfig::disabled(CAPABILITY_EDIT_FILE),
    ]);
    assert!(!mixed.root().is_enabled(CAPABILITY_EDIT_FILE));
    assert!(mixed.root().is_enabled(CAPABILITY_READ_FILE));

    // The alias is one-way: a modern set does not answer to the legacy id.
    assert!(!GgCapabilitySet::default().is_enabled(CAPABILITY_FILESYSTEM));
}

/// A capability set stored in the legacy **flat** shape (top-level `capabilities`/`slots`) still
/// deserializes: the migration folds it into a single [Root](ROOT_AGENT) agent.
#[test]
fn a_legacy_flat_capability_set_migrates_to_a_root_agent() {
    let flat = json!({
        "capabilities": [{ "id": CAPABILITY_SHELL, "enabled": true, "params": {} }],
        "slots": [{ "slot": PRIMARY_SLOT, "modelId": "anthropic/claude-opus-4.8" }],
    });
    let set: GgCapabilitySet = serde_json::from_value(flat).expect("migrate legacy shape");
    assert_eq!(set.agents.len(), 1);
    assert_eq!(set.root().name, ROOT_AGENT);
    assert!(set.root().is_enabled(CAPABILITY_SHELL));
    assert_eq!(
        set.root().resolved_model_id(),
        Some("anthropic/claude-opus-4.8")
    );
}

#[test]
fn disabled_capability_is_present_but_off() {
    let set = root_set(vec![GgCapabilityConfig::disabled(CAPABILITY_SHELL)]);
    // Present-but-disabled reports not-enabled but is still findable.
    assert!(!set.root().is_enabled(CAPABILITY_SHELL));
    assert!(set.root().capability(CAPABILITY_SHELL).is_some());
}

#[test]
fn capability_set_round_trips_through_json() {
    let set = GgCapabilitySet {
        preset: Some("planning-A".to_string()),
        agents: vec![
            GgAgentConfig {
                name: ROOT_AGENT.to_string(),
                capabilities: vec![
                    GgCapabilityConfig::enabled(CAPABILITY_SHELL),
                    GgCapabilityConfig {
                        id: "compaction".to_string(),
                        enabled: true,
                        implementation: Some("summarize-v2".to_string()),
                        params: json!({ "threshold": 0.8 }),
                    },
                ],
                model_id: "anthropic/claude-opus-4.8".to_string(),
                disabled_tools: vec!["edit_file".to_string()],
                ..GgAgentConfig::root()
            },
            GgAgentConfig {
                name: "reviewer".to_string(),
                capabilities: vec![GgCapabilityConfig::enabled(CAPABILITY_SHELL)],
                model_id: "openai/gpt-5.5".to_string(),
                ..GgAgentConfig::root()
            },
        ],
        model_slots: Vec::new(),
        limits: GgRunLimits::default(),
    };
    let value = serde_json::to_value(&set).expect("serialize");
    let back: GgCapabilitySet = serde_json::from_value(value).expect("deserialize");
    assert_eq!(set, back);
}

/// The ceilings are camelCase like the rest of the contract, and a ceiling that is off is
/// **absent** rather than `null` — so a configuration that arms two of the six says so in two
/// keys, and "unset" and "set to nothing" can never be confused on the wire.
#[test]
fn run_limits_round_trip_camel_case_and_omit_every_unset_ceiling() {
    let limits = GgRunLimits {
        max_turns: Some(60),
        max_runtime_secs: Some(5_400),
        max_consecutive_errors: Some(5),
        max_error_rate: Some(0.5),
        error_rate_window: Some(10),
        max_cost: Some(25.0),
    };
    let value = serde_json::to_value(limits).expect("serialize");
    assert_eq!(
        value,
        json!({
            "maxTurns": 60,
            "maxRuntimeSecs": 5_400,
            "maxConsecutiveErrors": 5,
            "maxErrorRate": 0.5,
            "errorRateWindow": 10,
            "maxCost": 25.0,
        })
    );
    let back: GgRunLimits = serde_json::from_value(value).expect("deserialize");
    assert_eq!(limits, back);

    // A partially armed set carries only the ceilings it arms.
    let cost_only = GgRunLimits {
        max_cost: Some(2.0),
        ..GgRunLimits::default()
    };
    assert_eq!(
        serde_json::to_value(cost_only).unwrap(),
        json!({ "maxCost": 2.0 })
    );
    assert!(!cost_only.is_empty());
    assert!(GgRunLimits::default().is_empty());
}

/// The backward-compatibility guarantee for every capability set stored before ceilings existed:
/// it deserializes to a set that declares none, and serializing it back writes no `limits` key —
/// so a stored configuration round-trips byte for byte through a gg that now understands ceilings.
#[test]
fn a_capability_set_without_limits_deserializes_to_none_and_re_serializes_without_the_key() {
    let set: GgCapabilitySet = serde_json::from_value(json!({
        "capabilities": [{ "id": "shell", "enabled": true }],
        "slots": [{ "slot": "primary", "modelId": "anthropic/claude-opus-4.8" }],
    }))
    .expect("deserialize");
    assert_eq!(set.limits, GgRunLimits::default());
    assert!(set.limits.is_empty());

    let value = serde_json::to_value(&set).expect("serialize");
    assert!(value.get("limits").is_none());

    // A set that *does* arm a ceiling carries it, so the omission above is the absence of
    // configuration rather than a field that never serializes.
    let armed = GgCapabilitySet {
        limits: GgRunLimits {
            max_consecutive_errors: Some(4),
            ..GgRunLimits::default()
        },
        ..set
    };
    assert_eq!(
        serde_json::to_value(&armed).unwrap()["limits"],
        json!({ "maxConsecutiveErrors": 4 })
    );
}

/// The facet that buckets runs by which ceiling stopped them renders the kind through
/// [`GgLimitKind::as_str`], while the run record renders it through serde. Pinning the two against
/// each other over every variant is what keeps a query's bucket name and a run's recorded value
/// the same string.
#[test]
fn limit_kind_wire_values_match_the_strings_the_facet_buckets_by() {
    for kind in GgLimitKind::ALL {
        assert_eq!(
            serde_json::to_value(kind).unwrap(),
            json!(kind.as_str()),
            "wire value and `as_str` disagree for {kind:?}"
        );
    }
    // The vocabulary itself, spelled out — a rename would be a contract break, not a refactor.
    assert_eq!(
        GgLimitKind::ALL.map(GgLimitKind::as_str),
        [
            "turns",
            "runtime",
            "consecutive_errors",
            "error_rate",
            "cost"
        ]
    );
}

/// A breach is self-contained — which ceiling, its value, what was observed, where — and carries
/// its lookback window only for the one ceiling measured over one.
#[test]
fn a_limit_breach_round_trips_with_and_without_its_window() {
    let rate = GgLimitBreach {
        limit: GgLimitKind::ErrorRate,
        threshold: 0.5,
        observed: 0.6,
        turns: 10,
        agent_id: "root".to_string(),
        window: Some(10),
    };
    let value = serde_json::to_value(&rate).expect("serialize");
    assert_eq!(
        value,
        json!({
            "limit": "error_rate",
            "threshold": 0.5,
            "observed": 0.6,
            "turns": 10,
            "agentId": "root",
            "window": 10,
        })
    );
    assert_eq!(
        serde_json::from_value::<GgLimitBreach>(value).expect("deserialize"),
        rate
    );

    // A cost breach has no window, and reports the spend already accumulated — above the
    // threshold, because the ceiling bounds starting new work rather than capping spend.
    let cost = GgLimitBreach {
        limit: GgLimitKind::Cost,
        threshold: 25.0,
        observed: 25.4,
        turns: 31,
        agent_id: "agent-2".to_string(),
        window: None,
    };
    let value = serde_json::to_value(&cost).expect("serialize");
    assert!(value.get("window").is_none());
    assert_eq!(
        serde_json::from_value::<GgLimitBreach>(value).expect("deserialize"),
        cost
    );
}

#[test]
fn a_deferred_agent_is_unresolved_until_a_launch_fills_its_model_slot() {
    // The shape a saved configuration carries: the Root agent deferred to a declared model
    // slot, and a `judge` agent pinned inside the configuration.
    let mut set = GgCapabilitySet {
        preset: None,
        agents: vec![
            GgAgentConfig {
                model_id: String::new(),
                model_slot: Some("critic".to_string()),
                ..GgAgentConfig::root()
            },
            GgAgentConfig {
                name: "judge".to_string(),
                model_id: "openai/o-fixed".to_string(),
                ..GgAgentConfig::root()
            },
        ],
        model_slots: vec![GgModelSlot {
            name: "critic".to_string(),
            default_model_id: Some("anthropic/claude-haiku-4.5".to_string()),
        }],
        limits: GgRunLimits::default(),
    };
    // A deferred agent names no model, so it binds nothing yet — and it is exactly what a
    // launch must fill in.
    assert_eq!(set.unresolved_agents(), vec![ROOT_AGENT]);
    assert_eq!(set.root().resolved_model_id(), None);
    assert_eq!(
        set.agent("judge").and_then(|a| a.resolved_model_id()),
        Some("openai/o-fixed")
    );
    assert_eq!(
        set.model_slot("critic")
            .and_then(|s| s.default_model_id.as_deref()),
        Some("anthropic/claude-haiku-4.5")
    );

    // Launching resolves it, and the set is then runnable.
    set.agents[0].model_id = "anthropic/claude-opus-4.8".to_string();
    set.agents[0].model_slot = None;
    assert!(set.unresolved_agents().is_empty());
    assert_eq!(
        set.root().resolved_model_id(),
        Some("anthropic/claude-opus-4.8")
    );
}

/// The models a launch resolves per-model facts for: every distinct model an agent can
/// run on, deduplicated, with a still-deferred agent (which names no model) skipped.
#[test]
fn bound_model_ids_lists_each_resolved_model_once() {
    let set = GgCapabilitySet {
        preset: None,
        agents: vec![
            GgAgentConfig {
                model_id: "anthropic/claude-opus-4.8".to_string(),
                ..GgAgentConfig::root()
            },
            GgAgentConfig {
                name: "subagent".to_string(),
                model_id: "openai/gpt-5.4-mini".to_string(),
                ..GgAgentConfig::root()
            },
            // Two agents sharing one model contribute one entry.
            GgAgentConfig {
                name: "judge".to_string(),
                model_id: "openai/gpt-5.4-mini".to_string(),
                ..GgAgentConfig::root()
            },
            GgAgentConfig {
                name: "reviewer".to_string(),
                model_id: String::new(),
                model_slot: Some("critic".to_string()),
                ..GgAgentConfig::root()
            },
        ],
        model_slots: Vec::new(),
        limits: GgRunLimits::default(),
    };
    assert_eq!(
        set.bound_model_ids(),
        vec!["anthropic/claude-opus-4.8", "openai/gpt-5.4-mini"]
    );

    assert!(GgCapabilitySet::default().bound_model_ids().is_empty());
}

#[test]
fn a_set_without_model_slots_deserializes_unchanged() {
    // Every configuration saved before model slots existed omits the field; a legacy flat set
    // migrates to a single Root agent.
    let set: GgCapabilitySet = serde_json::from_value(json!({
        "capabilities": [{ "id": "shell", "enabled": true }],
        "slots": [{ "slot": "primary", "modelId": "anthropic/claude-opus-4.8" }],
    }))
    .expect("deserialize");
    assert!(set.model_slots.is_empty());
    assert!(set.root().model_slot.is_none());
    assert!(set.root().is_resolved());
    // And a fully pinned set serializes without a `modelSlots` field, so a recorded run's
    // configuration reads exactly as it did before.
    let value = serde_json::to_value(&set).expect("serialize");
    assert!(value.get("modelSlots").is_none());
    assert!(value["agents"][0].get("modelSlot").is_none());
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
        strategy: "markdown".to_string(),
        memories: vec![GgMemoryEntry {
            name: "game-plan".to_string(),
            description: "the plan".to_string(),
            len: 42,
            lines: 3,
        }],
        count: 1,
        total_len: 42,
        total_lines: 3,
        // The set was curated down: it once held three memories and 120 characters.
        peak: GgMemoryPeak {
            count: 3,
            total_len: 120,
            total_lines: 9,
        },
        // A markdown run: bounded by its index and its per-memory length, and by nothing else.
        caps: GgMemoryCaps {
            max_count: None,
            max_len_per_memory: Some(8_192),
            max_total_len: None,
            max_len_index: Some(16_384),
            max_len_description: Some(120),
            max_results: None,
        },
    };
    let value = serde_json::to_value(&kind).expect("serialize");
    assert_eq!(
        value,
        json!({
            "type": "memory_state",
            "strategy": "markdown",
            "memories": [
                { "name": "game-plan", "description": "the plan", "len": 42, "lines": 3 }
            ],
            "count": 1,
            "totalLen": 42,
            "totalLines": 3,
            "peak": { "count": 3, "totalLen": 120, "totalLines": 9 },
            // A limit a strategy does not use serializes as `null`, which is a different
            // fact from a large number and is what a console needs to skip its meter.
            "caps": {
                "maxCount": null,
                "maxLenPerMemory": 8_192,
                "maxTotalLen": null,
                "maxLenIndex": 16_384,
                "maxLenDescription": 120,
                "maxResults": null,
            },
        })
    );
    let back: GgTelemetryKind = serde_json::from_value(value).expect("deserialize");
    assert_eq!(kind, back);
}

#[test]
fn memory_state_reads_a_record_written_before_lines_and_peaks() {
    // The three fields added after the event shipped are all `#[serde(default)]`, so an
    // older record still loads — reporting no line counts and no peaks rather than
    // failing to parse, which is what keeps an archived run readable.
    let value = json!({
        "type": "memory_state",
        "strategy": "scratchpad",
        "memories": [{ "name": "controls", "description": "the scheme", "len": 42 }],
        "count": 1,
        "totalLen": 42,
        "caps": {
            "maxCount": 8,
            "maxLenPerMemory": 2_000,
            "maxTotalLen": 8_000,
        },
    });
    let kind: GgTelemetryKind = serde_json::from_value(value).expect("deserialize");
    let GgTelemetryKind::MemoryState {
        memories,
        total_lines,
        peak,
        caps,
        ..
    } = kind
    else {
        panic!("expected a MemoryState");
    };
    assert_eq!(memories[0].lines, 0);
    assert_eq!(total_lines, 0);
    assert_eq!(peak, GgMemoryPeak::default());
    assert_eq!(caps.max_len_description, None);
}

#[test]
fn memory_revision_serializes_one_entry_of_the_record() {
    let kind = GgTelemetryKind::MemoryRevision {
        name: "game-plan".to_string(),
        revision: 2,
        change: GgMemoryChange::Updated,
        description: "the plan".to_string(),
        body: "Ship the maze first.\nThen the enemies.".to_string(),
        len: 38,
        lines: 2,
    };
    let value = serde_json::to_value(&kind).expect("serialize");
    assert_eq!(
        value,
        json!({
            "type": "memory_revision",
            "name": "game-plan",
            "revision": 2,
            "change": "updated",
            "description": "the plan",
            "body": "Ship the maze first.\nThen the enemies.",
            "len": 38,
            "lines": 2,
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
                in_scope: None,
                out_of_scope: None,
                completion_criteria: None,
                status: GgTaskStatus::Done,
                blocked_by: Vec::new(),
            },
            GgTaskEntry {
                id: "movement".to_string(),
                title: "Player movement".to_string(),
                description: None,
                in_scope: None,
                out_of_scope: None,
                completion_criteria: None,
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

/// The common code turn: a reply that needed nothing and did not end the run. Both new members are
/// absent from the wire, so the presence of `healing` *is* "something was unusual about this
/// response" and the presence of `finished` *is* "this turn ended the run".
#[test]
fn a_code_execution_omits_finished_and_healing_when_the_turn_was_clean() {
    let kind = GgTelemetryKind::CodeExecution {
        ok: true,
        tool_calls: 3,
        duration_ms: Some(24_000),
        error: None,
        finished: None,
        compile_wait_ms: None,
        healing: GgResponseHealing::default(),
    };
    let value = serde_json::to_value(&kind).expect("serialize");
    assert_eq!(
        value,
        json!({
            "type": "code_execution",
            "ok": true,
            "toolCalls": 3,
            "durationMs": 24_000,
        })
    );
    let back: GgTelemetryKind = serde_json::from_value(value).expect("deserialize");
    assert_eq!(kind, back);
}

/// The two turns the new members exist for: the one that ended the run, and the one whose reply
/// was not a program at all (no duration figure, because nothing ran).
#[test]
fn a_code_execution_carries_the_completion_and_the_healing_record() {
    let finished = GgTelemetryKind::CodeExecution {
        ok: true,
        tool_calls: 1,
        duration_ms: Some(9_100),
        error: None,
        finished: Some("Built the game and wrote MANIFEST.md.".to_string()),
        compile_wait_ms: None,
        healing: GgResponseHealing {
            strategies: vec![
                GgHealingStrategy::StripFences,
                GgHealingStrategy::DropImports,
            ],
            ..GgResponseHealing::default()
        },
    };
    let value = serde_json::to_value(&finished).expect("serialize");
    assert_eq!(
        value,
        json!({
            "type": "code_execution",
            "ok": true,
            "toolCalls": 1,
            "durationMs": 9_100,
            "finished": "Built the game and wrote MANIFEST.md.",
            "healing": { "strategies": ["strip-fences", "drop-imports"] },
        })
    );
    assert_eq!(
        serde_json::from_value::<GgTelemetryKind>(value).expect("deserialize"),
        finished
    );

    // A reply that was several candidate programs: `durationMs` is absent (there is nothing to
    // average into the run's efficiency), and the candidate count rides along with the shape it was
    // counted in, as the instruction-following signal itself.
    let not_a_program = GgTelemetryKind::CodeExecution {
        ok: false,
        tool_calls: 0,
        duration_ms: None,
        error: Some("Your reply contained 7 separate code blocks.".to_string()),
        finished: None,
        compile_wait_ms: None,
        healing: GgResponseHealing {
            not_a_program: Some(GgNotAProgram::SeveralBlocks),
            blocks: Some(7),
            candidate_shape: Some(GgCandidateShape::Fenced),
            ..GgResponseHealing::default()
        },
    };
    let value = serde_json::to_value(&not_a_program).expect("serialize");
    assert_eq!(
        value,
        json!({
            "type": "code_execution",
            "ok": false,
            "toolCalls": 0,
            "error": "Your reply contained 7 separate code blocks.",
            "healing": {
                "notAProgram": "several_blocks",
                "blocks": 7,
                "candidateShape": "fenced",
            },
        })
    );
    assert_eq!(
        serde_json::from_value::<GgTelemetryKind>(value).expect("deserialize"),
        not_a_program
    );
}

/// **The two shapes are two different failures, and the record says which.** The same count, the
/// same reason and two shapes: a model that fenced seven programs was told not to format its reply
/// and formatted it anyway, while a model that pasted two programs together obeyed that rule and
/// sent two answers. Without the shape on the wire an aggregate adds them into one number that
/// describes neither, which is the signal responses-as-code exists to collect.
#[test]
fn a_several_programs_record_names_the_shape_it_counted() {
    let bare = GgResponseHealing {
        strategies: vec![GgHealingStrategy::DropDuplicateProgram],
        not_a_program: Some(GgNotAProgram::SeveralBlocks),
        blocks: Some(2),
        candidate_shape: Some(GgCandidateShape::Bare),
        did_not_converge: false,
    };
    assert_eq!(
        serde_json::to_value(&bare).expect("serialize"),
        json!({
            "strategies": ["drop-duplicate-program"],
            "notAProgram": "several_blocks",
            "blocks": 2,
            "candidateShape": "bare",
        })
    );
    assert_eq!(
        serde_json::from_value::<GgResponseHealing>(
            serde_json::to_value(&bare).expect("serialize")
        )
        .expect("deserialize"),
        bare
    );

    // The shape is a closed taxonomy of two, spelled snake_case like every other one here.
    assert_eq!(
        serde_json::to_value(GgCandidateShape::Fenced).unwrap(),
        json!("fenced")
    );
    assert_eq!(
        serde_json::to_value(GgCandidateShape::Bare).unwrap(),
        json!("bare")
    );

    // A reply that ran carries neither fact, so the shape never claims a reply had candidates.
    let ran = GgResponseHealing {
        strategies: vec![GgHealingStrategy::StripFences],
        ..GgResponseHealing::default()
    };
    let value = serde_json::to_value(&ran).expect("serialize");
    assert!(value.get("candidateShape").is_none(), "{value}");
    assert!(value.get("blocks").is_none(), "{value}");
}

/// A response that defeated the pipeline is byte-identical to a clean one on every other fact, so
/// `did_not_converge` alone must be enough to make the record worth carrying — otherwise the one
/// pathological response is reported as "nothing was unusual".
#[test]
fn response_healing_is_clean_only_when_every_fact_is_at_its_default() {
    assert!(GgResponseHealing::default().is_clean());

    let stubborn = GgResponseHealing {
        did_not_converge: true,
        ..GgResponseHealing::default()
    };
    assert!(!stubborn.is_clean());
    assert_eq!(
        serde_json::to_value(&stubborn).unwrap(),
        json!({ "didNotConverge": true })
    );

    assert!(
        !GgResponseHealing {
            not_a_program: Some(GgNotAProgram::Prose),
            ..GgResponseHealing::default()
        }
        .is_clean()
    );
    assert!(
        !GgResponseHealing {
            strategies: vec![GgHealingStrategy::StripProse],
            ..GgResponseHealing::default()
        }
        .is_clean()
    );
}

/// A strategy id is one string doing three jobs — the `healing` param key, the telemetry value,
/// and the metric name — so the kebab-case spelling is pinned here rather than left to the derive.
#[test]
fn healing_strategy_ids_are_the_kebab_case_config_keys() {
    for (strategy, id) in [
        (GgHealingStrategy::StripFences, "strip-fences"),
        (GgHealingStrategy::StripProse, "strip-prose"),
        (GgHealingStrategy::DropImports, "drop-imports"),
        (GgHealingStrategy::UnwrapAsync, "unwrap-async"),
        (GgHealingStrategy::StripCommentOnly, "strip-comment-only"),
    ] {
        assert_eq!(serde_json::to_value(strategy).unwrap(), json!(id));
    }
    // The not-a-program reasons stay snake_case, like every other closed taxonomy here.
    assert_eq!(
        serde_json::to_value(GgNotAProgram::ToolCallsOnly).unwrap(),
        json!("tool_calls_only")
    );
    assert_eq!(
        serde_json::to_value(GgNotAProgram::NoProgramBlock).unwrap(),
        json!("no_program_block")
    );
}

/// The breach the console groups thousands of runs by is a structured event, not a log line.
#[test]
fn the_limit_exceeded_event_tags_as_limit_exceeded() {
    let kind = GgTelemetryKind::LimitExceeded {
        breach: GgLimitBreach {
            limit: GgLimitKind::ConsecutiveErrors,
            threshold: 5.0,
            observed: 5.0,
            turns: 12,
            agent_id: "root".to_string(),
            window: None,
        },
    };
    let value = serde_json::to_value(&kind).expect("serialize");
    assert_eq!(
        value,
        json!({
            "type": "limit_exceeded",
            "breach": {
                "limit": "consecutive_errors",
                "threshold": 5.0,
                "observed": 5.0,
                "turns": 12,
                "agentId": "root",
            },
        })
    );
    let back: GgTelemetryKind = serde_json::from_value(value).expect("deserialize");
    assert_eq!(kind, back);
}

/// **The backward-compatibility proof.** A session summary recorded before healing and execution
/// ceilings existed — the exact JSON gg wrote onto a run record — must still deserialize, with the
/// three new members at their defaults. Every gg run ever recorded is one of these, and a query
/// that could not read them would take the historical record with it.
#[test]
fn a_session_summary_recorded_before_healing_and_limits_still_deserializes() {
    let recorded = json!({
        "terminalStatus": "completed",
        "agentsSpawned": 3,
        "subagentCount": 2,
        "maxSubagentDepth": 1,
        "compactions": 1,
        "ranOutOfContext": false,
        "contextOverflowCount": 0,
        "finalFullness": 0.61,
        "codeReviews": 1,
        "reviewCycles": 2,
        "issuesReopened": 1,
        "speculations": 0,
        "executionMode": "responses_as_code",
        "codeExecutions": 7,
        "issuesCreated": 2,
        "issuesCompleted": 2,
        "slotCosts": [{
            "slot": "primary",
            "modelId": "mock/echo",
            "tokens": { "uncachedInput": 2600, "output": 240 },
            "cost": { "comparable": 0.0063, "actual": 0.0063 },
        }],
        "effectiveTools": ["shell", "read_file", "write_file"],
    });
    let summary: GgSessionSummary = serde_json::from_value(recorded).expect("deserialize");

    // The pre-change fields still read exactly as they did — including the review count, which
    // was recorded under its old `codeReviews` name and reads through the alias rather than
    // silently defaulting to zero.
    assert_eq!(summary.terminal_status, "completed");
    assert_eq!(summary.code_executions, 7);
    assert_eq!(summary.effective_tools.len(), 3);
    assert_eq!(summary.issue_reviews, 1);
    // The three new members default rather than failing the parse: a run recorded before healing
    // existed healed nothing, was bounded by no *recorded* ceiling, and breached none.
    assert_eq!(summary.healing, GgHealingSummary::default());
    assert_eq!(summary.limits, GgRunLimits::default());
    assert_eq!(summary.limit_hit, None);

    // Re-serializing keeps `limitHit` off the wire, while the two rollups are always present so a
    // query never has to distinguish "zero" from "absent".
    let value = serde_json::to_value(&summary).expect("serialize");
    assert!(value.get("limitHit").is_none());
    assert_eq!(value["healing"]["healed"], json!(0));
    assert_eq!(value["limits"], json!({}));
}

/// The rollups a study slices on, on the wire: every healing counter and the resolved ceilings the
/// run was actually bounded by, beside the breach that stopped it.
#[test]
fn a_session_summary_carries_the_healing_rollup_and_the_ceiling_that_stopped_the_run() {
    let mut summary: GgSessionSummary = serde_json::from_value(json!({
        "terminalStatus": "limit_exceeded",
        "agentsSpawned": 1,
        "subagentCount": 0,
        "maxSubagentDepth": 0,
        "compactions": 0,
        "ranOutOfContext": false,
        "contextOverflowCount": 0,
        "issueReviews": 0,
        "reviewCycles": 0,
        "issuesReopened": 0,
        "speculations": 0,
        "executionMode": "responses_as_code",
        "codeExecutions": 4,
        "issuesCreated": 0,
        "issuesCompleted": 0,
    }))
    .expect("deserialize");
    summary.healing = GgHealingSummary {
        healed: 3,
        applications: 4,
        strip_fences: 3,
        strip_prose: 1,
        not_a_program: 2,
        several_blocks: 2,
        several_blocks_fenced: 1,
        several_blocks_bare: 1,
        enabled: vec![
            GgHealingStrategy::StripFences,
            GgHealingStrategy::StripProse,
        ],
        ..GgHealingSummary::default()
    };
    summary.limits = GgRunLimits {
        max_turns: Some(12),
        max_consecutive_errors: Some(4),
        ..GgRunLimits::default()
    };
    summary.limit_hit = Some(GgLimitBreach {
        limit: GgLimitKind::ConsecutiveErrors,
        threshold: 4.0,
        observed: 4.0,
        turns: 9,
        agent_id: "root".to_string(),
        window: None,
    });

    let value = serde_json::to_value(&summary).expect("serialize");
    assert_eq!(
        value["healing"],
        json!({
            "healed": 3,
            "applications": 4,
            "stripFences": 3,
            "stripProse": 1,
            "dropDuplicateProgram": 0,
            "dropImports": 0,
            "unwrapAsync": 0,
            "stripCommentOnly": 0,
            "notAProgram": 2,
            "severalBlocks": 2,
            "severalBlocksFenced": 1,
            "severalBlocksBare": 1,
            "enabled": ["strip-fences", "strip-prose"],
        })
    );
    assert_eq!(
        value["limits"],
        json!({ "maxTurns": 12, "maxConsecutiveErrors": 4 })
    );
    assert_eq!(value["limitHit"]["limit"], json!("consecutive_errors"));

    let back: GgSessionSummary = serde_json::from_value(value).expect("deserialize");
    assert_eq!(back, summary);
}

/// **The healing-off arm has to be visible on the wire**, and the assertion has to be made *on the
/// wire* to prove it.
///
/// [`enabled`](GgHealingSummary::enabled) exists to tell an ablation's two arms apart, and the arm
/// it exists for is the empty one: every counter reads `0` whether the strategies were all armed and
/// never needed or all switched off. A `skip_serializing_if` here therefore deleted the field in
/// exactly the case it was added for, and — because a struct-level `enabled.is_empty()` passes
/// against a build that never wrote the key at all — the suite said so while a real healing-off run
/// emitted a summary byte-identical to one from a build with no such field. So this asserts on
/// [`serde_json::to_value`]: the key is **present**, and it is `[]`.
#[test]
fn the_disabled_healing_arm_serializes_as_a_present_empty_armed_set() {
    let summary: GgSessionSummary = serde_json::from_value(json!({
        "terminalStatus": "completed",
        "agentsSpawned": 1,
        "subagentCount": 0,
        "maxSubagentDepth": 0,
        "compactions": 0,
        "ranOutOfContext": false,
        "contextOverflowCount": 0,
        "issueReviews": 0,
        "reviewCycles": 0,
        "issuesReopened": 0,
        "speculations": 0,
        "executionMode": "responses_as_code",
        "codeExecutions": 3,
        "issuesCreated": 0,
        "issuesCompleted": 0,
    }))
    .expect("deserialize");

    let value = serde_json::to_value(&summary).expect("serialize");
    let healing = &value["healing"];
    assert!(
        healing.get("enabled").is_some(),
        "the healing-off arm must be readable from the record alone: {healing}"
    );
    assert_eq!(healing["enabled"], json!([]));

    // And the armed arm still names its set, so the two arms differ on the wire rather than only in
    // the invocation files that produced them.
    let mut armed = summary.clone();
    armed.healing.enabled = vec![GgHealingStrategy::StripFences];
    assert_eq!(
        serde_json::to_value(&armed).expect("serialize")["healing"]["enabled"],
        json!(["strip-fences"])
    );
}

/// **The additive proof.** Every fact this record gained is optional to read: a `code_execution`
/// written before the candidate shape was carried, and a healing rollup written before the shape
/// counters and the armed set existed, both still deserialize — with the new members at their
/// defaults rather than at a guess, because a count that was never taken is not one a re-read may
/// invent.
#[test]
fn healing_records_written_before_the_shape_split_still_deserialize() {
    let event: GgTelemetryKind = serde_json::from_value(json!({
        "type": "code_execution",
        "ok": false,
        "toolCalls": 0,
        "healing": { "notAProgram": "several_blocks", "blocks": 7 },
    }))
    .expect("deserialize");
    let GgTelemetryKind::CodeExecution { healing, .. } = &event else {
        panic!("a code_execution deserialized as something else: {event:?}");
    };
    assert_eq!(healing.blocks, Some(7));
    assert_eq!(healing.not_a_program, Some(GgNotAProgram::SeveralBlocks));
    assert_eq!(healing.candidate_shape, None);
    assert!(!healing.is_clean(), "the record still reads as unusual");

    let summary: GgSessionSummary = serde_json::from_value(json!({
        "terminalStatus": "completed",
        "agentsSpawned": 1,
        "subagentCount": 0,
        "maxSubagentDepth": 0,
        "compactions": 0,
        "ranOutOfContext": false,
        "contextOverflowCount": 0,
        "issueReviews": 0,
        "reviewCycles": 0,
        "issuesReopened": 0,
        "speculations": 0,
        "executionMode": "responses_as_code",
        "codeExecutions": 4,
        "issuesCreated": 0,
        "issuesCompleted": 0,
        "healing": {
            "healed": 1,
            "applications": 3,
            "stripFences": 1,
            "stripProse": 1,
            "dropDuplicateProgram": 1,
            "dropImports": 0,
            "unwrapAsync": 0,
            "stripCommentOnly": 0,
            "notAProgram": 1,
            "severalBlocks": 1,
        },
    }))
    .expect("deserialize");
    assert_eq!(summary.healing.healed, 1);
    assert_eq!(summary.healing.several_blocks, 1);
    assert_eq!(summary.healing.several_blocks_fenced, 0);
    assert_eq!(summary.healing.several_blocks_bare, 0);
    assert!(summary.healing.enabled.is_empty());

    // Re-serializing writes the new members out rather than dropping them again, so a record read
    // and re-written by this build is one this build could have produced.
    let value = serde_json::to_value(&summary).expect("serialize");
    assert_eq!(value["healing"]["severalBlocksFenced"], json!(0));
    assert_eq!(value["healing"]["severalBlocksBare"], json!(0));
    assert_eq!(value["healing"]["enabled"], json!([]));
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

/// The message-log events (`context_message` / `prompt`) round-trip through the wire in
/// camelCase, with the tagged discriminant, image descriptors (never bytes), and an
/// omitted `responseId`/`cost` when absent.
#[test]
fn message_log_events_round_trip() {
    let message = GgTelemetryKind::ContextMessage {
        id: "mdeadbeef".to_string(),
        role: "tool".to_string(),
        content: Some("wrote index.html".to_string()),
        tool_calls: Vec::new(),
        tool_call_id: Some("call_1".to_string()),
        images: vec![GgLoggedImage {
            media_type: "image/png".to_string(),
            bytes: 4096,
        }],
        tokens: 128,
    };
    let value = serde_json::to_value(&message).expect("serialize");
    assert_eq!(value["type"], json!("context_message"));
    assert_eq!(value["toolCallId"], json!("call_1"));
    assert_eq!(value["images"][0]["mediaType"], json!("image/png"));
    // The descriptor never carries the base64 bytes.
    assert!(value["images"][0].get("dataBase64").is_none());
    let back: GgTelemetryKind = serde_json::from_value(value).expect("deserialize");
    assert_eq!(back, message);

    let prompt = GgTelemetryKind::Prompt {
        request: vec![
            GgPromptRef {
                id: "msystem".to_string(),
                source: GgContextSource::System,
            },
            GgPromptRef {
                id: "muser".to_string(),
                source: GgContextSource::UserPrompt,
            },
        ],
        total_tokens: 30,
        response_id: None,
        finish_reason: "stop".to_string(),
        tokens: TokenCounts::default(),
        cost: None,
        duration_ms: None,
    };
    let value = serde_json::to_value(&prompt).expect("serialize");
    assert_eq!(value["type"], json!("prompt"));
    assert_eq!(value["totalTokens"], json!(30));
    assert_eq!(value["request"][0]["source"], json!("system"));
    // An absent response, cost, and duration are omitted from the wire, not serialized as null.
    assert!(value.get("responseId").is_none());
    assert!(value.get("cost").is_none());
    assert!(value.get("durationMs").is_none());
    let back: GgTelemetryKind = serde_json::from_value(value).expect("deserialize");
    assert_eq!(back, prompt);
}
