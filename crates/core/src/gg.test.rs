//! Tests for the gg capability set and telemetry v1 contract types.

use serde_json::json;

use super::*;
use crate::metrics::TokenCounts;

/// A single-agent capability set whose [Root](ROOT_AGENT) profile carries `capabilities` — the
/// common shape these tests need now that capabilities are per-agent.
fn root_set(capabilities: Vec<GgCapabilityConfig>) -> GgCapabilitySet {
    GgCapabilitySet {
        preset: None,
        preset_id: None,
        agents: vec![GgAgentConfig {
            capabilities,
            ..GgAgentConfig::root()
        }],
        model_slots: Vec::new(),
        limits: GgRunLimits::default(),
        hooks: Vec::new(),
    }
}

/// A set whose two non-root profiles carry **one display name** and are told apart only by their
/// [slugs](GgAgentConfig::slug) — the shape every slug-versus-name rule is asserted against. The
/// root may spawn one of them and have the other review, so one roster serves both scope reads.
fn two_reviewers() -> GgCapabilitySet {
    GgCapabilitySet {
        agents: vec![
            GgAgentConfig {
                subagents: vec![
                    GgSubagentRef {
                        agent_id: "reviewer".to_string(),
                        description: "for a second opinion".to_string(),
                        scopes: vec![GgSubagentScope::Subagent],
                    },
                    GgSubagentRef::new("reviewer-2", &[GgSubagentScope::Reviewer]),
                ],
                ..GgAgentConfig::root()
            },
            GgAgentConfig {
                slug: "reviewer".to_string(),
                name: "Careful Reviewer".to_string(),
                model_id: "anthropic/claude-haiku-4.5".to_string(),
                ..GgAgentConfig::root()
            },
            GgAgentConfig {
                slug: "reviewer-2".to_string(),
                name: "Careful Reviewer".to_string(),
                model_id: "openai/gpt-5.5".to_string(),
                ..GgAgentConfig::root()
            },
        ],
        ..GgCapabilitySet::default()
    }
}

/// The zeroed [error rollup](GgErrorSummary) every session summary carries, for a fixture whose
/// subject is something else.
fn no_errors() -> serde_json::Value {
    serde_json::to_value(GgErrorSummary::default()).expect("serialize")
}

#[test]
fn minimal_capability_set_binds_the_root_model_and_phase0_capabilities() {
    let set = GgCapabilitySet::minimal("anthropic/claude-opus-4.8");
    assert_eq!(set.preset.as_deref(), Some("minimal"));
    assert!(set.is_enabled(CAPABILITY_SHELL));
    // Each filesystem primitive is its own capability, so each carries its own config.
    for capability in [
        CAPABILITY_READ_FILE,
        CAPABILITY_WRITE_FILE,
        CAPABILITY_EDIT_FILE,
        CAPABILITY_LIST_DIR,
        CAPABILITY_SEARCH,
    ] {
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

/// [`any_agent_enabled`](GgCapabilitySet::any_agent_enabled) answers about the whole set,
/// where [`is_enabled`](GgCapabilitySet::is_enabled) answers only about the root. The two are
/// not interchangeable: a run-wide fact must be read with
/// [`any_agent_enabled`](GgCapabilitySet::any_agent_enabled).
#[test]
fn a_run_wide_read_asks_every_agent_where_the_root_read_asks_one() {
    let mut set = root_set(vec![]);
    set.agents.push(GgAgentConfig {
        slug: "reviewer".to_string(),
        name: "Reviewer".to_string(),
        capabilities: vec![GgCapabilityConfig::enabled(CAPABILITY_FSM)],
        ..GgAgentConfig::root()
    });

    assert!(
        !set.is_enabled(CAPABILITY_FSM),
        "the root itself does not declare it"
    );
    assert!(
        set.any_agent_enabled(CAPABILITY_FSM),
        "but an agent in the set does, and that is what a run-wide read must see"
    );

    // Present-but-disabled is not enabled, here as everywhere else.
    set.agents[1].capabilities = vec![GgCapabilityConfig::disabled(CAPABILITY_FSM)];
    assert!(!set.any_agent_enabled(CAPABILITY_FSM));
}

/// A capability set that names no profiles at all reads as a single [Root](ROOT_AGENT) agent with
/// the default capabilities, so the smallest configuration anyone can write is still launchable.
#[test]
fn a_capability_set_without_agents_reads_as_a_root_agent() {
    let set: GgCapabilitySet = serde_json::from_value(json!({})).expect("deserialize");
    assert_eq!(set.agents.len(), 1);
    assert_eq!(set.root().name, ROOT_AGENT);
    assert!(set.root().is_enabled(CAPABILITY_SHELL));
}

/// **Two profiles may carry one name, and only the slug tells them apart.**
///
/// There is no uniqueness rule on a display name anywhere, and nothing resolves a reference by
/// reading one — so a launched set is addressed entirely by [slug](GgAgentConfig::slug), and the
/// name survives only where a person or a model reads prose.
#[test]
fn two_profiles_may_share_a_name_and_are_still_addressed_apart_by_slug() {
    let set = two_reviewers();

    // The premise: one display name, two profiles.
    assert_eq!(set.agents[1].name, set.agents[2].name);

    // Lookup is by slug, and it resolves each of them to itself.
    assert_eq!(
        set.agent("reviewer").map(|a| a.model_id.as_str()),
        Some("anthropic/claude-haiku-4.5")
    );
    assert_eq!(
        set.agent("reviewer-2").map(|a| a.model_id.as_str()),
        Some("openai/gpt-5.5")
    );
    assert!(
        set.agent("Careful Reviewer").is_none(),
        "a display name resolves nothing, because it could not say which profile is meant"
    );
    assert_eq!(set.root_id(), ROOT_PROFILE_ID);
    assert_eq!(set.root_name(), ROOT_AGENT);

    // The name is prose, and a reference that resolves to no profile at all reads back as the slug
    // it failed to resolve rather than as nothing.
    assert_eq!(set.agent_name("reviewer"), "Careful Reviewer");
    assert_eq!(set.agent_name("reviewer-2"), "Careful Reviewer");
    assert_eq!(set.agent_name("ghost"), "ghost");
}

/// **The vocabulary a model-facing menu offers is ids**, and a call is admitted by the id the
/// model passed back — never by the name the menu rendered beside it.
#[test]
fn a_roster_offers_ids_scoped_to_what_the_target_may_be_used_for() {
    let set = two_reviewers();

    let spawnable = set.roster(set.root(), GgSubagentScope::Subagent);
    assert_eq!(GgRosterEntry::ids(&spawnable), vec!["reviewer"]);
    assert_eq!(
        spawnable[0].name, "Careful Reviewer",
        "the name rides along so the menu reads as prose"
    );
    assert_eq!(spawnable[0].description, "for a second opinion");

    // Scoping is what each surface asks by, so the reviewer list and the spawn list differ even
    // though both targets carry the same name.
    let reviewers = set.roster(set.root(), GgSubagentScope::Reviewer);
    assert_eq!(GgRosterEntry::ids(&reviewers), vec!["reviewer-2"]);

    assert!(GgRosterEntry::offers(&spawnable, "reviewer"));
    assert!(
        GgRosterEntry::offers(&spawnable, "  reviewer  "),
        "the argument arrives as the model wrote it, so it is trimmed"
    );
    assert!(
        !GgRosterEntry::offers(&spawnable, "Careful Reviewer"),
        "a display name admits nothing: it names two profiles"
    );
    assert!(
        !GgRosterEntry::offers(&spawnable, "reviewer-2"),
        "and an id this scope does not offer is refused"
    );

    // An entry pointing at a profile the set does not declare is dropped rather than offered:
    // a launch refuses such a set, so a menu built from one must not name it.
    let mut dangling = set.clone();
    dangling.agents[0]
        .subagents
        .push(GgSubagentRef::any("ghost"));
    assert_eq!(
        GgRosterEntry::ids(&dangling.roster(dangling.root(), GgSubagentScope::Subagent)),
        vec!["reviewer"]
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
        preset_id: None,
        agents: vec![
            GgAgentConfig {
                slug: ROOT_PROFILE_ID.to_string(),
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
                tools: vec!["shell".to_string()],
                ..GgAgentConfig::root()
            },
            GgAgentConfig {
                slug: "reviewer".to_string(),
                name: "reviewer".to_string(),
                capabilities: vec![GgCapabilityConfig::enabled(CAPABILITY_SHELL)],
                model_id: "openai/gpt-5.5".to_string(),
                ..GgAgentConfig::root()
            },
        ],
        model_slots: Vec::new(),
        limits: GgRunLimits::default(),
        hooks: Vec::new(),
    };
    let value = serde_json::to_value(&set).expect("serialize");
    let back: GgCapabilitySet = serde_json::from_value(value).expect("deserialize");
    assert_eq!(set, back);
}

/// The prompt-cache lifetime is a **per-agent** knob: one profile can buy the extended lifetime
/// while its siblings stay on the provider default, which is the whole point — the extended one is
/// billed a higher write premium, so a run pays it only for the agents whose turns are slow or far
/// enough apart to outlive five minutes.
///
/// A profile that never touched the knob writes **no key at all**, so a configuration round-trips
/// byte for byte and never silently starts paying the premium.
#[test]
fn the_prompt_cache_lifetime_is_per_agent_and_omitted_at_its_default() {
    let set = GgCapabilitySet {
        agents: vec![
            GgAgentConfig {
                model_id: "anthropic/claude-opus-4.8".to_string(),
                prompt_cache_ttl: GgPromptCacheTtl::Extended,
                ..GgAgentConfig::root()
            },
            GgAgentConfig {
                slug: "scout".to_string(),
                name: "scout".to_string(),
                model_id: "anthropic/claude-haiku-4.5".to_string(),
                ..GgAgentConfig::root()
            },
        ],
        ..GgCapabilitySet::default()
    };

    let value = serde_json::to_value(&set).expect("serialize");
    assert_eq!(value["agents"][0]["promptCacheTtl"], json!("extended"));
    assert!(
        value["agents"][1].get("promptCacheTtl").is_none(),
        "an agent at the standard lifetime writes no key: {}",
        value["agents"][1]
    );

    let back: GgCapabilitySet = serde_json::from_value(value).expect("deserialize");
    assert_eq!(set, back);
    assert_eq!(back.agents[0].prompt_cache_ttl, GgPromptCacheTtl::Extended);
    assert_eq!(back.agents[1].prompt_cache_ttl, GgPromptCacheTtl::Standard);
    assert!(back.agents[1].prompt_cache_ttl.is_standard());
}

/// A configuration that asks for no lifetime reads as the **standard** one, so a run only pays the
/// extended lifetime's higher write premium when an operator asked for it by name.
#[test]
fn a_capability_set_without_a_prompt_cache_lifetime_reads_as_standard() {
    let stored = json!({
        "agents": [{
            "slug": ROOT_PROFILE_ID,
            "name": ROOT_AGENT,
            "capabilities": [{ "id": CAPABILITY_SHELL, "enabled": true, "params": {} }],
            "openingTurn": opening_turn_json(),
            "modelId": "anthropic/claude-opus-4.8",
        }],
    });
    let set: GgCapabilitySet = serde_json::from_value(stored).expect("deserialize");
    assert_eq!(set.root().prompt_cache_ttl, GgPromptCacheTtl::Standard);
}

/// The lifetime reaches the client through the [binding](GgSlotBinding) a profile is resolved into,
/// because the binding is what a client is built from. A binding that was never told otherwise —
/// the compaction handoff's, for one — keeps the standard lifetime and writes no key.
#[test]
fn a_slot_binding_carries_the_prompt_cache_lifetime_it_was_given() {
    let binding = GgSlotBinding::new(PRIMARY_SLOT, "anthropic/claude-opus-4.8")
        .with_prompt_cache_ttl(GgPromptCacheTtl::Extended);
    assert_eq!(binding.prompt_cache_ttl, GgPromptCacheTtl::Extended);

    let plain = GgSlotBinding::new(PRIMARY_SLOT, "anthropic/claude-opus-4.8");
    assert_eq!(plain.prompt_cache_ttl, GgPromptCacheTtl::Standard);
    let value = serde_json::to_value(&plain).expect("serialize");
    assert!(value.get("promptCacheTtl").is_none(), "{value}");
}

/// Loop detection is **off** until an operator arms it, and every knob under it is optional — an
/// absent one takes gg's own default rather than zero, which is why the default value of the whole
/// object has to be "nothing declared" rather than "a detector configured with zeroes".
#[test]
fn loop_detection_defaults_to_disarmed_with_every_knob_unset() {
    let default = GgLoopDetection::default();
    assert!(!default.enabled);
    assert!(!default.is_armed());
    assert!(default.is_default());
    assert_eq!(default.window_words, None);
    assert_eq!(default.repeat_threshold, None);
    assert_eq!(default.min_offenders, None);
    assert_eq!(default.min_saturated_run, None);
    assert_eq!(default.max_response_chars, None);

    // Arming it without tuning anything is the ordinary case: one key, and gg's defaults for the
    // rest.
    let armed = GgLoopDetection {
        enabled: true,
        ..GgLoopDetection::default()
    };
    assert!(armed.is_armed());
    assert!(!armed.is_default());
    assert_eq!(
        serde_json::to_value(armed).expect("serialize"),
        json!({ "enabled": true })
    );
}

/// The knobs are camelCase like the rest of the contract, and one that is not set is **absent**
/// rather than `null` — so "take gg's default" and "set to zero" can never be confused, which
/// matters because `0` is a meaningful declaration for two of them.
#[test]
fn loop_detection_round_trips_camel_case_and_omits_every_unset_knob() {
    let tuned = GgLoopDetection {
        enabled: true,
        window_words: Some(512),
        repeat_threshold: Some(24),
        min_offenders: Some(3),
        min_saturated_run: Some(0),
        max_response_chars: Some(0),
    };
    let value = serde_json::to_value(tuned).expect("serialize");
    assert_eq!(
        value,
        json!({
            "enabled": true,
            "windowWords": 512,
            "repeatThreshold": 24,
            "minOffenders": 3,
            "minSaturatedRun": 0,
            "maxResponseChars": 0,
        })
    );
    let back: GgLoopDetection = serde_json::from_value(value).expect("deserialize");
    assert_eq!(tuned, back);
    assert_eq!(
        back.min_saturated_run,
        Some(0),
        "an explicit zero is the unmodified frequency rule, not an absent knob"
    );

    // A partially tuned policy carries only what it declared.
    let one_knob = GgLoopDetection {
        enabled: true,
        window_words: Some(128),
        ..GgLoopDetection::default()
    };
    assert_eq!(
        serde_json::to_value(one_knob).expect("serialize"),
        json!({ "enabled": true, "windowWords": 128 })
    );
}

/// The per-agent lever, on the wire: an agent that arms it says so, an agent that did not writes
/// **no key at all**, so a configuration that never touched it round-trips byte for byte and is
/// never silently moved onto the streaming transport.
#[test]
fn loop_detection_is_per_agent_and_omitted_when_nothing_was_declared() {
    let set = GgCapabilitySet {
        agents: vec![
            GgAgentConfig {
                model_id: "openai/gpt-5.6".to_string(),
                loop_detection: GgLoopDetection {
                    enabled: true,
                    min_saturated_run: Some(1_500),
                    ..GgLoopDetection::default()
                },
                ..GgAgentConfig::root()
            },
            GgAgentConfig {
                slug: "scout".to_string(),
                name: "scout".to_string(),
                model_id: "anthropic/claude-haiku-4.5".to_string(),
                ..GgAgentConfig::root()
            },
        ],
        ..GgCapabilitySet::default()
    };

    let value = serde_json::to_value(&set).expect("serialize");
    assert_eq!(
        value["agents"][0]["loopDetection"],
        json!({ "enabled": true, "minSaturatedRun": 1_500 })
    );
    assert!(
        value["agents"][1].get("loopDetection").is_none(),
        "an agent that declared nothing writes no key: {}",
        value["agents"][1]
    );

    let back: GgCapabilitySet = serde_json::from_value(value).expect("deserialize");
    assert_eq!(set, back);
    assert!(back.agents[0].loop_detection.is_armed());
    assert!(back.agents[1].loop_detection.is_default());

    // And a profile that says nothing about the lever reads as disarmed rather than failing to
    // parse, so arming it is always something an operator did on purpose.
    let stored: GgCapabilitySet = serde_json::from_value(json!({
        "agents": [{
            "slug": ROOT_PROFILE_ID,
            "name": ROOT_AGENT,
            "capabilities": [{ "id": CAPABILITY_SHELL, "enabled": true, "params": {} }],
            "openingTurn": opening_turn_json(),
            "modelId": "openai/gpt-5.6",
        }],
    }))
    .expect("deserialize");
    assert!(stored.root().loop_detection.is_default());
}

/// The policy reaches the client through the [binding](GgSlotBinding) a profile is resolved into,
/// exactly as the prompt-cache lifetime does — because the binding is what a client is built from,
/// and this is what decides which *transport* that client uses.
#[test]
fn a_slot_binding_carries_the_loop_detection_it_was_given() {
    let armed = GgLoopDetection {
        enabled: true,
        repeat_threshold: Some(16),
        ..GgLoopDetection::default()
    };
    let binding = GgSlotBinding::new(PRIMARY_SLOT, "openai/gpt-5.6").with_loop_detection(armed);
    assert_eq!(binding.loop_detection, armed);
    assert!(binding.loop_detection.is_armed());
    assert_eq!(
        serde_json::to_value(&binding).expect("serialize")["loopDetection"],
        json!({ "enabled": true, "repeatThreshold": 16 })
    );

    let plain = GgSlotBinding::new(PRIMARY_SLOT, "openai/gpt-5.6");
    assert!(plain.loop_detection.is_default());
    let value = serde_json::to_value(&plain).expect("serialize");
    assert!(value.get("loopDetection").is_none(), "{value}");
    assert_eq!(
        serde_json::from_value::<GgSlotBinding>(value).expect("deserialize"),
        plain
    );
}

/// The guardrails are camelCase like the rest of the contract, and one that is off is **absent**
/// rather than `null` — so a configuration that arms two of them says so in two keys, and "unset" and
/// "set to nothing" can never be confused on the wire.
#[test]
fn run_limits_round_trip_camel_case_and_omit_every_unset_ceiling() {
    let limits = GgRunLimits {
        max_parallel: Some(16),
        max_turns: Some(60),
        max_runtime_secs: Some(5_400),
        model_call_timeout_secs: Some(900),
        model_stream_idle_secs: Some(60),
        max_model_retries: Some(10),
        model_retry_max_delay_secs: Some(60),
        max_consecutive_errors: Some(5),
        max_error_rate: Some(0.5),
        error_rate_window: Some(10),
        max_cost: Some(25.0),
        replay_max_bytes: Some(268_435_456),
    };
    let value = serde_json::to_value(limits).expect("serialize");
    assert_eq!(
        value,
        json!({
            "maxParallel": 16,
            "maxTurns": 60,
            "maxRuntimeSecs": 5_400,
            "modelCallTimeoutSecs": 900,
            "modelStreamIdleSecs": 60,
            "maxModelRetries": 10,
            "modelRetryMaxDelaySecs": 60,
            "maxConsecutiveErrors": 5,
            "maxErrorRate": 0.5,
            "errorRateWindow": 10,
            "maxCost": 25.0,
            "replayMaxBytes": 268_435_456,
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
    // The stream-idle bound is optional on the wire like every other limits key, even though a
    // run always resolves one — so a stored set that predates it still parses and a set that
    // leaves it out is a set asking for the default, not a set that cannot be read.
    let no_idle = serde_json::to_value(GgRunLimits::default()).unwrap();
    assert!(no_idle.get("modelStreamIdleSecs").is_none(), "{no_idle}");
    let parsed: GgRunLimits =
        serde_json::from_value(json!({ "modelStreamIdleSecs": 45 })).expect("deserialize");
    assert_eq!(parsed.model_stream_idle_secs, Some(45));
}

/// **A count is a count however JSON spells it.** JSON has no integer type, so a sweep generated
/// from JavaScript writes `60.0` and `6e1` as readily as `60` — and all three name the same ceiling.
/// A number that names no count at all is a different matter, and is refused where it is written
/// rather than rounded to one gg made up.
#[test]
fn an_integral_ceiling_reads_the_same_however_it_is_spelled() {
    for spelling in [json!(60), json!(60.0), json!(6e1)] {
        let limits: GgRunLimits =
            serde_json::from_value(json!({ "maxTurns": spelling })).expect("deserialize");
        assert_eq!(limits.max_turns, Some(60), "{spelling}");
    }
    // `null` is the documented spelling of "take the default", not a value gg cannot read.
    let absent: GgRunLimits =
        serde_json::from_value(json!({ "maxTurns": null })).expect("deserialize");
    assert_eq!(absent.max_turns, None);

    for refused in [json!(60.5), json!(-1), json!("60"), json!(true)] {
        assert!(
            serde_json::from_value::<GgRunLimits>(json!({ "maxTurns": refused })).is_err(),
            "{refused} names no count"
        );
    }
    // The detector's knobs are read under the same rule, in the same way.
    let detector: GgLoopDetection =
        serde_json::from_value(json!({ "enabled": true, "windowWords": 256.0 }))
            .expect("deserialize");
    assert_eq!(detector.window_words, Some(256));
}

/// A set that arms no ceiling deserializes to one that declares none, and serializing it back
/// writes no `limits` key — so an unbounded configuration round-trips byte for byte rather than
/// growing an object full of nulls.
#[test]
fn a_capability_set_without_limits_deserializes_to_none_and_re_serializes_without_the_key() {
    let set: GgCapabilitySet = serde_json::from_value(json!({
        "agents": [{
            "slug": ROOT_PROFILE_ID,
            "name": ROOT_AGENT,
            "capabilities": [{ "id": "shell", "enabled": true }],
            "openingTurn": opening_turn_json(),
            "modelId": "anthropic/claude-opus-4.8",
        }],
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
        preset_id: None,
        agents: vec![
            GgAgentConfig {
                model_id: String::new(),
                model_slot: Some("critic".to_string()),
                model_slots: vec![GgModelSlot {
                    name: "critic".to_string(),
                    default_model_id: None,
                    passthrough: false,
                }],
                ..GgAgentConfig::root()
            },
            GgAgentConfig {
                slug: "judge".to_string(),
                name: "judge".to_string(),
                model_id: "openai/o-fixed".to_string(),
                ..GgAgentConfig::root()
            },
        ],
        model_slots: vec![GgConfigSlot {
            name: "critic".to_string(),
            default_model_id: Some("anthropic/claude-haiku-4.5".to_string()),
            targets: vec![GgSlotTarget {
                agent: ROOT_PROFILE_ID.to_string(),
                slot: "critic".to_string(),
            }],
        }],
        limits: GgRunLimits::default(),
        hooks: Vec::new(),
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

/// An FSM shell has no model and is not waiting for one: a machine takes no turns, so a
/// launch has nothing to bind to it, and the model a dispatch onto it resolves is the one
/// its **entry state** runs.
#[test]
fn a_machine_is_neither_bound_to_a_model_nor_waiting_for_one() {
    let set = GgCapabilitySet {
        preset: None,
        preset_id: None,
        agents: vec![
            GgAgentConfig {
                capabilities: vec![GgCapabilityConfig {
                    params: json!({
                        FSM_PARAM_STATES: [
                            { "name": "explore", "agentId": "judge" },
                            { "name": "build", "agentId": "builder" },
                        ],
                    }),
                    ..GgCapabilityConfig::enabled(CAPABILITY_FSM)
                }],
                model_id: String::new(),
                ..GgAgentConfig::root()
            },
            GgAgentConfig {
                slug: "judge".to_string(),
                name: "Judge".to_string(),
                model_id: "openai/o-fixed".to_string(),
                ..GgAgentConfig::root()
            },
            // The same display name as the entry state's profile: only the id says which of the
            // two a state binds.
            GgAgentConfig {
                slug: "builder".to_string(),
                name: "Judge".to_string(),
                model_id: "openai/o-fixed".to_string(),
                ..GgAgentConfig::root()
            },
        ],
        model_slots: Vec::new(),
        limits: GgRunLimits::default(),
        hooks: Vec::new(),
    };
    assert!(set.root().is_fsm_shell());
    // Nothing is outstanding, and the machine contributes no model to price or to size a
    // context window for.
    assert!(set.unresolved_agents().is_empty());
    assert_eq!(set.bound_model_ids(), vec!["openai/o-fixed"]);
    // The entry state is `states[0]`, so it is the `judge` profile that a dispatch onto
    // this machine runs — and an ordinary profile resolves as itself.
    assert_eq!(set.root().fsm_entry_agent(), Some("judge"));
    assert_eq!(
        set.dispatched_agent(ROOT_PROFILE_ID)
            .map(|a| a.slug.as_str()),
        Ok("judge")
    );
    assert_eq!(
        set.dispatched_agent("judge").map(|a| a.slug.as_str()),
        Ok("judge")
    );
}

/// A dispatch that cannot be resolved names **the profile that is missing**, and never answers
/// with another one.
///
/// Answering with the shell is the expensive way to be wrong here: a machine carries no model on
/// purpose, so it hands every caller the one agent whose empty binding is correct to report — and a
/// shell left holding a stray `modelId` resolves clean, launching a run whose every recorded turn
/// is attributed to a model nothing asked that agent to run.
#[test]
fn an_unresolvable_dispatch_names_the_missing_profile() {
    let machine = |entry: &str| GgAgentConfig {
        capabilities: vec![GgCapabilityConfig {
            params: json!({ FSM_PARAM_STATES: [{ "name": "explore", "agentId": entry }] }),
            ..GgCapabilityConfig::enabled(CAPABILITY_FSM)
        }],
        model_id: String::new(),
        ..GgAgentConfig::root()
    };
    let set_of = |root: GgAgentConfig| GgCapabilitySet {
        preset: None,
        preset_id: None,
        agents: vec![root],
        model_slots: Vec::new(),
        limits: GgRunLimits::default(),
        hooks: Vec::new(),
    };

    // An id nothing declares is reported as itself, not as the root.
    let plain = GgCapabilitySet::minimal("mock/echo");
    assert_eq!(
        plain.dispatched_agent("ghost"),
        Err(GgDispatchError::UndeclaredProfile("ghost"))
    );

    // A machine entering an agent the set does not declare names *that* agent, with the machine
    // it came from for context — not the machine as the thing missing a model.
    let dangling = set_of(machine("judge"));
    assert_eq!(
        dangling.dispatched_agent(ROOT_PROFILE_ID),
        Err(GgDispatchError::UndeclaredEntryAgent {
            shell: ROOT_PROFILE_ID,
            entry: "judge",
        })
    );
    assert!(
        dangling
            .dispatched_agent(ROOT_PROFILE_ID)
            .unwrap_err()
            .to_string()
            .contains("`judge`")
    );

    // A stray model on the shell buys it no clean resolution: that is the arm that would launch a
    // run and record every turn of it against the wrong model, with nothing said anywhere.
    let mut stray = machine("judge");
    stray.model_id = "mock/echo".to_string();
    assert!(set_of(stray).dispatched_agent(ROOT_PROFILE_ID).is_err());

    // A machine with no readable entry state at all is a different fact from one naming an agent
    // that is missing, and reads as one.
    let empty = set_of(machine(""));
    assert_eq!(
        empty.dispatched_agent(ROOT_PROFILE_ID),
        Err(GgDispatchError::UnreadableMachine {
            shell: ROOT_PROFILE_ID
        })
    );
}

/// The models a launch resolves per-model facts for: every distinct model an agent can
/// run on, deduplicated, with a still-deferred agent (which names no model) skipped.
#[test]
fn bound_model_ids_lists_each_resolved_model_once() {
    let set = GgCapabilitySet {
        preset: None,
        preset_id: None,
        agents: vec![
            GgAgentConfig {
                model_id: "anthropic/claude-opus-4.8".to_string(),
                ..GgAgentConfig::root()
            },
            GgAgentConfig {
                slug: "subagent".to_string(),
                name: "subagent".to_string(),
                model_id: "openai/gpt-5.4-mini".to_string(),
                ..GgAgentConfig::root()
            },
            // Two agents sharing one model contribute one entry.
            GgAgentConfig {
                slug: "judge".to_string(),
                name: "judge".to_string(),
                model_id: "openai/gpt-5.4-mini".to_string(),
                ..GgAgentConfig::root()
            },
            GgAgentConfig {
                slug: "reviewer".to_string(),
                name: "reviewer".to_string(),
                model_id: String::new(),
                model_slot: Some("critic".to_string()),
                ..GgAgentConfig::root()
            },
        ],
        model_slots: Vec::new(),
        limits: GgRunLimits::default(),
        hooks: Vec::new(),
    };
    assert_eq!(
        set.bound_model_ids(),
        vec!["anthropic/claude-opus-4.8", "openai/gpt-5.4-mini"]
    );

    assert!(GgCapabilitySet::default().bound_model_ids().is_empty());
}

/// **A compaction handoff's model is a bound model.**
///
/// It is a second model the run really does send requests to, on the one event that rewrites an
/// agent's entire window, so everything a launch does per bound model — price it, resolve its
/// context window, prove the catalog knows it — has to be done for it. Left off this list, a handoff
/// naming a model that does not exist launched happily and failed on the first compaction, where gg
/// used to fall back to the working model while every record of the run named the handoff arm.
#[test]
fn a_handoff_compaction_model_is_a_bound_model() {
    let handoff = |strategy: &str, model: serde_json::Value| GgCapabilitySet {
        preset: None,
        preset_id: None,
        agents: vec![GgAgentConfig {
            model_id: "anthropic/claude-opus-4.8".to_string(),
            capabilities: vec![GgCapabilityConfig {
                id: CAPABILITY_COMPACTION.to_string(),
                enabled: true,
                implementation: Some(strategy.to_string()),
                params: json!({ COMPACTION_PARAM_MODEL: model }),
            }],
            ..GgAgentConfig::root()
        }],
        model_slots: Vec::new(),
        limits: GgRunLimits::default(),
        hooks: Vec::new(),
    };

    assert_eq!(
        handoff(
            COMPACTION_STRATEGY_HANDOFF_SUMMARIZATION,
            json!("openai/gpt-5.4-mini"),
        )
        .bound_model_ids(),
        vec!["anthropic/claude-opus-4.8", "openai/gpt-5.4-mini"],
    );
    assert_eq!(
        handoff(
            COMPACTION_STRATEGY_HANDOFF_COMPACTION,
            json!("  openai/gpt-5.4-mini  "),
        )
        .bound_model_ids(),
        vec!["anthropic/claude-opus-4.8", "openai/gpt-5.4-mini"],
        "the id is read as written, trimmed",
    );

    // A `model` the **selected arm does not use** is not a bound model: it is a key the capability
    // knows and this strategy ignores, which is the deliberate one-params-block-per-sweep case.
    // Demanding a catalog entry for it would break exactly the sweep it exists to serve.
    assert_eq!(
        handoff(
            COMPACTION_STRATEGY_SELF_SUMMARIZATION,
            json!("openai/gpt-5.4-mini"),
        )
        .bound_model_ids(),
        vec!["anthropic/claude-opus-4.8"],
    );
    // …nor is a value that names no model at all. gg's launch pass refuses that in its own words.
    assert_eq!(
        handoff(COMPACTION_STRATEGY_HANDOFF_SUMMARIZATION, json!("   ")).bound_model_ids(),
        vec!["anthropic/claude-opus-4.8"],
    );
}

#[test]
fn a_set_without_model_slots_deserializes_unchanged() {
    // A fully pinned configuration defers nothing to a launch, so it declares no slots at all.
    let set: GgCapabilitySet = serde_json::from_value(json!({
        "agents": [{
            "slug": ROOT_PROFILE_ID,
            "name": ROOT_AGENT,
            "capabilities": [{ "id": "shell", "enabled": true }],
            "openingTurn": opening_turn_json(),
            "modelId": "anthropic/claude-opus-4.8",
        }],
    }))
    .expect("deserialize");
    assert!(set.model_slots.is_empty());
    assert!(set.root().model_slot.is_none());
    assert!(set.root().is_resolved());
    // And it serializes without a `modelSlots` field, so a recorded run's configuration carries
    // only the bindings it actually ran on.
    let value = serde_json::to_value(&set).expect("serialize");
    assert!(value.get("modelSlots").is_none());
    assert!(value["agents"][0].get("modelSlot").is_none());
}

/// The [opening turn](GgOpeningTurn) a fresh profile is seeded with, as a document writes it — for
/// the fixtures here that spell an agent out by hand, since the key is required.
fn opening_turn_json() -> serde_json::Value {
    serde_json::to_value(GgOpeningTurn::seeded()).expect("serialize")
}

/// **`openingTurn` is required and always written.** A fresh profile carries the seeded default,
/// it round-trips, and a document that omits the key does not read — there is no runtime default
/// for the lists an agent's window opens on.
#[test]
fn an_agents_opening_turn_is_required_and_seeded_on_a_fresh_profile() {
    let root = GgAgentConfig::root();
    assert_eq!(root.opening_turn, GgOpeningTurn::seeded());
    assert_eq!(
        root.opening_turn.modules,
        DEFAULT_OPENING_MODULES
            .iter()
            .map(|id| id.to_string())
            .collect::<Vec<_>>()
    );
    assert_eq!(
        root.opening_turn.functions,
        DEFAULT_OPENING_FUNCTIONS
            .iter()
            .map(|id| id.to_string())
            .collect::<Vec<_>>()
    );

    let value = serde_json::to_value(&root).expect("serialize");
    assert_eq!(
        value["openingTurn"],
        json!({
            "modules": ["files", "shell"],
            "functions": [
                "docs.search",
                "views.open_docs_view",
                "views.open_text",
                "views.open_file",
                "files.search",
            ],
            "tree": { "include": true, "depth": DEFAULT_OPENING_TREE_DEPTH },
        }),
        "the key is always written, in camelCase, with both lists and the tree"
    );
    let back: GgAgentConfig = serde_json::from_value(value).expect("deserialize");
    assert_eq!(back, root);

    // An empty pair is a valid document: a window that opens on the build prompt alone.
    let empty: GgAgentConfig = serde_json::from_value(json!({
        "slug": ROOT_PROFILE_ID,
        "name": ROOT_AGENT,
        "openingTurn": { "modules": [], "functions": [] },
    }))
    .expect("an empty opening turn reads");
    assert!(empty.opening_turn.is_empty());
    let value = serde_json::to_value(&empty).expect("serialize");
    assert_eq!(
        value["openingTurn"],
        json!({ "modules": [], "functions": [] }),
        "and it is still written out, empty — a document with no tree is written back without one"
    );

    // A depth kept while the tree is off is not the default, so it survives a round trip: an
    // operator who switches the tree back on gets the depth they chose.
    let kept = GgOpeningTurn {
        modules: Vec::new(),
        functions: Vec::new(),
        tree: GgOpeningTree {
            include: false,
            depth: 5,
        },
    };
    assert_eq!(
        serde_json::to_value(&kept).expect("serialize")["tree"],
        json!({ "include": false, "depth": 5 })
    );

    // The tree alone is not an empty opening turn: a window may open on the shape of the workspace
    // and nothing else.
    let tree_only: GgAgentConfig = serde_json::from_value(json!({
        "slug": ROOT_PROFILE_ID,
        "name": ROOT_AGENT,
        "openingTurn": { "modules": [], "functions": [], "tree": { "include": true } },
    }))
    .expect("a tree with no depth of its own reads");
    assert!(!tree_only.opening_turn.is_empty());
    assert_eq!(
        tree_only.opening_turn.tree.depth,
        DEFAULT_OPENING_TREE_DEPTH
    );

    // A document without the key does not read.
    let error = serde_json::from_value::<GgAgentConfig>(json!({
        "slug": ROOT_PROFILE_ID,
        "name": ROOT_AGENT,
    }))
    .expect_err("a profile without an opening turn is not a profile gg reads");
    assert!(
        error.to_string().contains("openingTurn"),
        "the error names the missing key: {error}"
    );
    // And neither does one missing half of it, or carrying a key gg does not know.
    for (what, opening) in [
        ("half an opening turn", json!({ "modules": [] })),
        (
            "an unknown key",
            json!({ "modules": [], "functions": [], "tools": [] }),
        ),
        (
            "an unknown key inside the tree",
            json!({ "modules": [], "functions": [], "tree": { "root": "src" } }),
        ),
    ] {
        serde_json::from_value::<GgAgentConfig>(json!({
            "slug": ROOT_PROFILE_ID,
            "name": ROOT_AGENT,
            "openingTurn": opening,
        }))
        .expect_err(what);
    }
}

/// A capability that writes neither an `implementation` nor `params` still **deserializes**, and
/// deserializes to exactly what it says: no arm and no params.
///
/// The requirement that an enabled capability be fully specified is a *launch* refusal, not a parse
/// error, and the difference is load-bearing. A configuration already stored in the database has to
/// keep reading back so it can open in the editor and be finished there; a document that could not
/// be parsed could not be repaired either.
#[test]
fn a_capability_that_writes_no_arm_and_no_params_still_deserializes_as_written() {
    let config: GgCapabilityConfig =
        serde_json::from_value(json!({ "id": "shell", "enabled": true })).expect("deserialize");
    assert_eq!(config.id, CAPABILITY_SHELL);
    assert!(config.enabled);
    assert_eq!(config.implementation, None);
    assert_eq!(config.params, json!({}));

    // And it is *not* what this crate authors, which is the whole distinction: authoring writes the
    // catalog's arm and params, and reading writes nothing at all.
    assert_ne!(config, GgCapabilityConfig::enabled(CAPABILITY_SHELL));
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
            profile_id: ROOT_PROFILE_ID.to_string(),
            model_id: "anthropic/claude-opus-5".to_string(),
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
            provider: Some("anthropic".to_string()),
        },
    };
    let value = serde_json::to_value(&event).expect("serialize");
    assert_eq!(value["profileId"], json!(ROOT_PROFILE_ID));
    assert_eq!(value["provider"], json!("anthropic"));
    assert_eq!(value["modelId"], json!("anthropic/claude-opus-5"));
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

/// The [module](GgModuleKind) vocabulary is a closed taxonomy on the wire: a transfer list is
/// read back from a recorded configuration, so its spellings are part of the contract rather than
/// an implementation detail.
#[test]
fn the_module_vocabulary_serializes_in_its_documented_spelling() {
    assert_eq!(GgModuleKind::ALL.len(), 6);
    assert_eq!(GgModuleKind::ALL[0], GgModuleKind::History);
    for kind in GgModuleKind::ALL {
        assert_eq!(
            serde_json::to_value(kind).unwrap(),
            json!(kind.as_str()),
            "the wire form and `as_str` must never disagree"
        );
        assert_eq!(kind.to_string(), kind.as_str());
    }
    assert_eq!(
        serde_json::to_value(GgModuleKind::Board).unwrap(),
        json!("board")
    );
}

#[test]
fn context_source_all_covers_every_variant_in_stable_order() {
    // `ALL` constructs every variant (so none is dead) and fixes the band order.
    assert_eq!(GgContextSource::ALL.len(), 14);
    assert_eq!(GgContextSource::ALL[0], GgContextSource::System);
    // The two responses-as-code failure bands sit together, immediately after the tool output
    // they replaced on that path — a code turn produces one of these where a tool-calling turn
    // produces a tool result.
    assert_eq!(
        &GgContextSource::ALL[3..6],
        &[
            GgContextSource::ToolOutput,
            GgContextSource::CompilerError,
            GgContextSource::RuntimeError,
        ]
    );
    // The four view bands are adjacent, and every band after them keeps its relative order
    // (the console's palette is keyed by index, so this order is the contract).
    assert_eq!(
        &GgContextSource::ALL[6..11],
        &[
            GgContextSource::FileView,
            GgContextSource::TextView,
            GgContextSource::DocsView,
            GgContextSource::SearchResults,
            GgContextSource::Skill,
        ]
    );
    assert_eq!(
        serde_json::to_value(GgContextSource::DocsView).unwrap(),
        json!("docs_view")
    );
    assert_eq!(
        serde_json::to_value(GgContextSource::SearchResults).unwrap(),
        json!("search_results")
    );
    assert_eq!(
        serde_json::to_value(GgContextSource::CompilerError).unwrap(),
        json!("compiler_error")
    );
    assert_eq!(
        serde_json::to_value(GgContextSource::RuntimeError).unwrap(),
        json!("runtime_error")
    );
    assert_eq!(
        serde_json::to_value(GgContextSource::TextView).unwrap(),
        json!("text_view")
    );
    assert_eq!(
        serde_json::to_value(GgContextSource::TaskList).unwrap(),
        json!("task_list")
    );
    // The plan band went away with the planning capability; nothing replaced it.
    assert!(
        !GgContextSource::ALL
            .iter()
            .any(|source| serde_json::to_value(source).unwrap() == json!("plan"))
    );
    // So did the board band with the owned board: the board is reachable through its tools
    // alone, so no context item ever carries it.
    assert!(
        !GgContextSource::ALL
            .iter()
            .any(|source| serde_json::to_value(source).unwrap() == json!("board"))
    );
}

#[test]
fn memory_state_serializes_entries_caps_and_totals() {
    let kind = GgTelemetryKind::MemoryState {
        module_id: "memories-0".to_string(),
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
        // A holder that shares this instance with the other instances of its own profile, and may
        // write it.
        scope: "shared".to_string(),
        writable: true,
    };
    let value = serde_json::to_value(&kind).expect("serialize");
    assert_eq!(
        value,
        json!({
            "type": "memory_state",
            "moduleId": "memories-0",
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
            "scope": "shared",
            "writable": true,
        })
    );
    let back: GgTelemetryKind = serde_json::from_value(value).expect("deserialize");
    assert_eq!(kind, back);
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
        module_id: "tasks-0".to_string(),
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
            "moduleId": "tasks-0",
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
        earliest_removed: None,
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

    // A documentation close carries where it cut as well as what it reclaimed, and is the only
    // action that does — so the field is present exactly when it is a fact and absent otherwise,
    // rather than serialized as a `null` every other action would have to be read past.
    let closed = GgTelemetryKind::ContextManaged {
        action: GgContextAction::CloseDocsViews,
        reclaimed_tokens: 640,
        items: 3,
        detail: "Closed 3 documentation view(s) (all of them), reclaiming ~640 tokens.".to_string(),
        earliest_removed: Some(12),
    };
    let value = serde_json::to_value(&closed).expect("serialize");
    assert_eq!(value["earliestRemoved"], json!(12));
    assert_eq!(
        serde_json::from_value::<GgTelemetryKind>(value).expect("deserialize"),
        closed
    );

    // The other action variants tag snake_case too.
    assert_eq!(
        serde_json::to_value(GgContextAction::ArchiveThread).unwrap(),
        json!("archive_thread")
    );
    assert_eq!(
        serde_json::to_value(GgContextAction::CloseTextViews).unwrap(),
        json!("close_text_views")
    );
    assert_eq!(
        serde_json::to_value(GgContextAction::CloseDocsViews).unwrap(),
        json!("close_docs_views")
    );
}

#[test]
fn empty_telemetry_variants_serialize_as_just_a_type() {
    assert_eq!(
        serde_json::to_value(GgTelemetryKind::TurnStarted {}).unwrap(),
        json!({ "type": "turn_started" })
    );
    assert_eq!(
        serde_json::to_value(GgTelemetryKind::SessionEnded {
            status: "completed".to_string(),
        })
        .unwrap(),
        json!({ "type": "session_ended", "status": "completed" })
    );
}

/// The common code turn: a program that ran and did not end the run. `finished` is absent from
/// the wire on it, so the presence of `finished` *is* "this turn ended the run".
#[test]
fn a_code_execution_omits_finished_when_the_turn_did_not_end_the_run() {
    let kind = GgTelemetryKind::CodeExecution {
        undocumented_calls: GgUndocumentedCalls::default(),
        ok: true,
        tool_calls: 3,
        api_calls: 3,
        duration_ms: Some(24_000),
        error: None,
        finished: None,
        logs: Vec::new(),
        logs_suppressed: 0,
        compile_wait_ms: None,
        compile_ms: None,
    };
    let value = serde_json::to_value(&kind).expect("serialize");
    assert_eq!(
        value,
        json!({
            "type": "code_execution",
            "ok": true,
            "toolCalls": 3,
            "apiCalls": 3,
            "durationMs": 24_000,
        })
    );
    let back: GgTelemetryKind = serde_json::from_value(value).expect("deserialize");
    assert_eq!(kind, back);
}

/// The turn that ended the run, and the one whose submitted program was not a program at all (no
/// duration figure, because nothing ran).
#[test]
fn a_code_execution_carries_the_completion() {
    let finished = GgTelemetryKind::CodeExecution {
        undocumented_calls: GgUndocumentedCalls::default(),
        ok: true,
        tool_calls: 1,
        api_calls: 1,
        duration_ms: Some(9_100),
        error: None,
        finished: Some("Built the game and wrote MANIFEST.md.".to_string()),
        logs: Vec::new(),
        logs_suppressed: 0,
        compile_wait_ms: None,
        compile_ms: None,
    };
    let value = serde_json::to_value(&finished).expect("serialize");
    assert_eq!(
        value,
        json!({
            "type": "code_execution",
            "ok": true,
            "toolCalls": 1,
            "apiCalls": 1,
            "durationMs": 9_100,
            "finished": "Built the game and wrote MANIFEST.md.",
        })
    );
    assert_eq!(
        serde_json::from_value::<GgTelemetryKind>(value).expect("deserialize"),
        finished
    );

    // A reply that did not compile: `durationMs` is `0` because it reached the transpile and no
    // further, and the error is the compiler's own.
    let uncompiled = GgTelemetryKind::CodeExecution {
        undocumented_calls: GgUndocumentedCalls::default(),
        ok: false,
        tool_calls: 0,
        api_calls: 0,
        duration_ms: Some(0),
        error: Some("SyntaxError: redeclaration of const files".to_string()),
        finished: None,
        logs: Vec::new(),
        logs_suppressed: 0,
        compile_wait_ms: None,
        compile_ms: None,
    };
    let value = serde_json::to_value(&uncompiled).expect("serialize");
    assert_eq!(
        value,
        json!({
            "type": "code_execution",
            "ok": false,
            "toolCalls": 0,
            "durationMs": 0,
            "error": "SyntaxError: redeclaration of const files",
        })
    );
    assert_eq!(
        serde_json::from_value::<GgTelemetryKind>(value).expect("deserialize"),
        uncompiled
    );
}

/// A program-language id is one string doing three jobs — the `language` param's value, the
/// telemetry value, and the stem of the language's committed guest artifacts — so the lower-case
/// spelling is pinned here rather than left to the derive. `typeScript`, which is what this
/// module's usual camelCase would produce, is not a spelling anybody would write in a config file.
#[test]
fn program_language_ids_are_the_lowercase_config_keys() {
    assert_eq!(
        serde_json::to_value(GgProgramLanguage::TypeScript).unwrap(),
        json!("typescript")
    );
    assert_eq!(
        serde_json::from_value::<GgProgramLanguage>(json!("typescript")).unwrap(),
        GgProgramLanguage::TypeScript,
        "a stored telemetry value must read back as the language that wrote it"
    );
}

/// `id` and `from_id` are one bijection over [`GgProgramLanguage::ALL`], which is what lets gg's
/// language registry be *derived* from the enum rather than kept as a second list. Asserted over
/// `ALL` rather than over a written-out table so a language added to the enum is covered here the
/// moment it exists.
#[test]
fn every_program_language_round_trips_through_its_id() {
    for &language in GgProgramLanguage::ALL {
        assert_eq!(GgProgramLanguage::from_id(language.id()), Some(language));
        assert_eq!(language.to_string(), language.id());
        assert!(
            !language.display_name().is_empty(),
            "a language the model is told it writes in has to have a name to be told"
        );
    }
    assert_eq!(GgProgramLanguage::from_id("brainfuck"), None);
}

/// The ordinary turn: the event is emitted for **every** turn, not only failing ones, because it is
/// the denominator as much as the numerator — so a clean turn writes the outcome, a zeroed
/// consecutive-error run and the agent's turn number, and nothing else.
#[test]
fn a_turn_outcome_event_reports_a_clean_turn_without_an_error_kind() {
    let kind = GgTelemetryKind::TurnOutcome {
        outcome: GgTurnOutcome::Progressed,
        error: None,
        error_type: None,
        consecutive_errors: 0,
        turns: 7,
        loop_aborts: 0,
        loop_abort_words: 0,
        loop_abort_chars: 0,
        response_chars: 0,
        response_output_tokens: 0,
    };
    let value = serde_json::to_value(&kind).expect("serialize");
    assert_eq!(
        value,
        json!({
            "type": "turn_outcome",
            "outcome": "progressed",
            "consecutiveErrors": 0,
            "turns": 7,
        }),
        "a clean turn carries no error kind and no abort count"
    );
    let back: GgTelemetryKind = serde_json::from_value(value).expect("deserialize");
    assert_eq!(kind, back);
}

/// The turn this event exists for: an error, its kind, and the agent's running streak — the same
/// streak [`GgRunLimits::max_consecutive_errors`] is enforced on, carried per turn because the
/// streak is per agent and the stream is run-wide.
#[test]
fn a_turn_outcome_event_carries_the_error_kind_and_the_agents_own_streak() {
    let kind = GgTelemetryKind::TurnOutcome {
        outcome: GgTurnOutcome::Error,
        error: Some(GgTurnErrorKind::ProgramFault),
        error_type: Some(GgTurnErrorType::ProgramApiError),
        consecutive_errors: 3,
        turns: 21,
        loop_aborts: 0,
        loop_abort_words: 0,
        loop_abort_chars: 0,
        response_chars: 0,
        response_output_tokens: 0,
    };
    let value = serde_json::to_value(&kind).expect("serialize");
    assert_eq!(
        value,
        json!({
            "type": "turn_outcome",
            "outcome": "error",
            "error": "program_fault",
            "errorType": "program_api_error",
            "consecutiveErrors": 3,
            "turns": 21,
        })
    );
    assert_eq!(
        serde_json::from_value::<GgTelemetryKind>(value).expect("deserialize"),
        kind
    );

    // gg's own machinery failing is recorded — so the turn count never drifts from the number of
    // model calls the run made — but is deliberately not an error, so it carries no kind.
    let fatal = GgTelemetryKind::TurnOutcome {
        outcome: GgTurnOutcome::Fatal,
        error: None,
        error_type: None,
        consecutive_errors: 0,
        turns: 22,
        loop_aborts: 0,
        loop_abort_words: 0,
        loop_abort_chars: 0,
        response_chars: 0,
        response_output_tokens: 0,
    };
    assert_eq!(
        serde_json::to_value(&fatal).expect("serialize")["outcome"],
        json!("fatal")
    );
}

/// The one place a discarded looping attempt is published, with **how much** it threw away beside
/// how often. It is not an error turn — the retry produced the reply this event judges — so it
/// rides on the turn that eventually succeeded, and all three figures are absent from every turn
/// (and every run) that discarded nothing, which is the default.
#[test]
fn a_turn_outcome_event_counts_the_looping_replies_it_discarded_and_what_they_generated() {
    let kind = GgTelemetryKind::TurnOutcome {
        outcome: GgTurnOutcome::Progressed,
        error: None,
        error_type: None,
        consecutive_errors: 0,
        turns: 4,
        loop_aborts: 2,
        loop_abort_words: 9_100,
        loop_abort_chars: 58_400,
        response_chars: 0,
        response_output_tokens: 0,
    };
    let value = serde_json::to_value(&kind).expect("serialize");
    assert_eq!(
        value,
        json!({
            "type": "turn_outcome",
            "outcome": "progressed",
            "consecutiveErrors": 0,
            "turns": 4,
            "loopAborts": 2,
            "loopAbortWords": 9_100,
            "loopAbortChars": 58_400,
        })
    );
    assert_eq!(
        serde_json::from_value::<GgTelemetryKind>(value).expect("deserialize"),
        kind
    );
}

/// Both taxonomies are closed and the console labels every value, so the snake_case spellings are
/// pinned here rather than left to the derive.
#[test]
fn turn_outcome_and_error_kind_wire_values_are_snake_case() {
    for (outcome, id) in [
        (GgTurnOutcome::Progressed, "progressed"),
        (GgTurnOutcome::Finished, "finished"),
        (GgTurnOutcome::Error, "error"),
        (GgTurnOutcome::Fatal, "fatal"),
    ] {
        assert_eq!(serde_json::to_value(outcome).unwrap(), json!(id));
        assert_eq!(
            serde_json::from_value::<GgTurnOutcome>(json!(id)).unwrap(),
            outcome
        );
    }
    for (kind, id) in [
        (GgTurnErrorKind::ModelApi, "model_api"),
        (GgTurnErrorKind::Transpile, "transpile"),
        (GgTurnErrorKind::ProgramFault, "program_fault"),
        (GgTurnErrorKind::SandboxLimit, "sandbox_limit"),
        (GgTurnErrorKind::MissingCompletion, "missing_completion"),
    ] {
        assert_eq!(serde_json::to_value(kind).unwrap(), json!(id));
        assert_eq!(
            serde_json::from_value::<GgTurnErrorKind>(json!(id)).unwrap(),
            kind
        );
    }
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

/// The resolved ceilings the run was actually bounded by, on the wire, beside the breach that
/// stopped it.
#[test]
fn a_session_summary_carries_the_ceiling_that_stopped_the_run() {
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
        "executionMode": "responses_as_code",
        "codeExecutions": 4,
        "compileMs": 0,
        "errors": no_errors(),
        "undocumentedCalls": { "calls": 0 },
        "issuesCreated": 0,
        "issuesCompleted": 0,
        "slotCosts": [],
        "effectiveTools": [],
        "limits": {},
    }))
    .expect("deserialize");
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
        value["limits"],
        json!({ "maxTurns": 12, "maxConsecutiveErrors": 4 })
    );
    assert_eq!(value["limitHit"]["limit"], json!("consecutive_errors"));

    let back: GgSessionSummary = serde_json::from_value(value).expect("deserialize");
    assert_eq!(back, summary);
}

/// The rollup a study slices on: the denominator, the numerator, the worst streak any one agent
/// reached, and the per-kind split — with **no stored percentage**, because a rate recorded beside
/// its own inputs is a figure that can disagree with them.
#[test]
fn the_error_rollup_carries_its_own_denominator_and_no_percentage() {
    let errors = GgErrorSummary {
        turns: 40,
        errors: 9,
        max_consecutive: 4,
        model_api: 2,
        transpile: 3,
        program_fault: 3,
        sandbox_limit: 1,
        missing_completion: 0,
        loop_aborts: 6,
        loop_abort_words: 41_200,
        loop_abort_chars: 268_000,
        by_type: BTreeMap::from([
            ("model_auth".to_string(), 1),
            ("model_retry_exhausted".to_string(), 1),
            ("transpile_syntax".to_string(), 3),
            ("program_api_error".to_string(), 2),
            ("program_throw".to_string(), 1),
            ("sandbox_timeout".to_string(), 1),
        ]),
        tool_failures: BTreeMap::from([("not-found".to_string(), 12)]),
    };
    assert_eq!(
        errors.model_api
            + errors.transpile
            + errors.program_fault
            + errors.sandbox_limit
            + errors.missing_completion,
        errors.errors,
        "the per-kind counters must account for every error turn"
    );

    let value = serde_json::to_value(&errors).expect("serialize");
    assert!(
        value.get("errorRate").is_none() && value.get("rate").is_none(),
        "the rate is `errors / turns`, computed by the reader, never stored: {value}"
    );
    assert_eq!(value["loopAborts"], json!(6));
    // How often the model looped and how much generation it cost to find out are published
    // together. Both sizes are gg's own measurements; neither is a token count or a price, and
    // neither is folded into the run's cost.
    assert_eq!(value["loopAbortWords"], json!(41_200));
    assert_eq!(value["loopAbortChars"], json!(268_000));
    assert_eq!(
        errors.by_type.values().sum::<u64>(),
        errors.errors,
        "the per-type breakdown must account for every error turn too"
    );
    assert_eq!(
        serde_json::from_value::<GgErrorSummary>(value).expect("deserialize"),
        errors
    );
}

/// The two levels agree by arithmetic, not by assertion: regrouping the per-**type** breakdown by
/// each type's base reproduces the six named per-**kind** counters exactly, and both readings sum
/// to `errors`.
///
/// This is the property a *"top error types"* widget rests on. Without it a console could rank types
/// that add up to a different number from the split beside them, and the reader would have no way to
/// tell which one was lying.
#[test]
fn regrouping_the_per_type_breakdown_by_base_reproduces_the_per_kind_counters() {
    // One of every type, so the regrouping is exercised over the whole taxonomy rather than over
    // the handful a hand-written fixture would name.
    let by_type: BTreeMap<String, u64> = GgTurnErrorType::ALL
        .iter()
        .map(|error| (error.wire_id().to_string(), 1))
        .collect();
    let errors = GgErrorSummary {
        turns: 40,
        errors: GgTurnErrorType::ALL.len() as u64,
        max_consecutive: 3,
        model_api: 9,
        transpile: 3,
        program_fault: 3,
        sandbox_limit: 3,
        missing_completion: 3,
        loop_aborts: 0,
        loop_abort_words: 0,
        loop_abort_chars: 0,
        by_type,
        tool_failures: BTreeMap::new(),
    };

    assert_eq!(
        errors.by_type.values().sum::<u64>(),
        errors.errors,
        "the breakdown sums to the total error count"
    );

    let mut regrouped: BTreeMap<&str, u64> = BTreeMap::new();
    for (id, count) in &errors.by_type {
        let error = GgTurnErrorType::ALL
            .iter()
            .find(|error| error.wire_id() == id)
            .unwrap_or_else(|| panic!("`{id}` is not a published type"));
        *regrouped.entry(error.kind().wire_id()).or_default() += count;
    }
    assert_eq!(
        regrouped,
        BTreeMap::from([
            ("model_api", errors.model_api),
            ("transpile", errors.transpile),
            ("program_fault", errors.program_fault),
            ("sandbox_limit", errors.sandbox_limit),
            ("missing_completion", errors.missing_completion),
        ])
    );
}

/// Both open breakdowns are omitted from the wire when empty, and both read back a key this build
/// has never heard of — the whole reason they are maps keyed by a stable id rather than by an enum,
/// since an unknown enum key would fail the *whole* summary rather than one row.
#[test]
fn the_open_breakdowns_are_omitted_when_empty_and_tolerate_an_unknown_key() {
    let empty = GgErrorSummary::default();
    let value = serde_json::to_value(&empty).expect("serialize");
    assert!(
        value.get("byType").is_none() && value.get("toolFailures").is_none(),
        "an empty breakdown costs nothing on the wire: {value}"
    );

    // A run recorded by a *newer* gg, carrying a type this build has never heard of. It must read,
    // and the unknown row must survive — degrading to one unlabelled row in a ranking is the point.
    let newer = json!({
        "turns": 3,
        "errors": 1,
        "maxConsecutive": 1,
        "modelApi": 0,
        "transpile": 0,
        "programFault": 0,
        "sandboxLimit": 0,
        "missingCompletion": 1,
        "loopAborts": 0,
        "loopAbortWords": 0,
        "loopAbortChars": 0,
        "byType": { "missing_completion_something_new": 1 },
        "toolFailures": { "brand-new-class": 2 },
    });
    let decoded: GgErrorSummary = serde_json::from_value(newer).expect("deserialize");
    assert_eq!(
        decoded.by_type.get("missing_completion_something_new"),
        Some(&1)
    );
    assert_eq!(decoded.tool_failures.get("brand-new-class"), Some(&2));
}

/// Every published type is stable, labelled, and lands under exactly one base kind — and every base
/// kind has at least one type under it, so no console shows a bucket nothing can fall into.
#[test]
fn every_error_type_has_a_stable_id_a_label_and_exactly_one_base() {
    let mut ids = std::collections::BTreeSet::new();
    let mut labels = std::collections::BTreeSet::new();
    for error in GgTurnErrorType::ALL {
        assert!(
            ids.insert(error.wire_id()),
            "{error:?}: duplicate id `{}`",
            error.wire_id()
        );
        assert!(
            labels.insert(error.label()),
            "{error:?}: duplicate label `{}` — a ranking would show two identical rows",
            error.label()
        );
        // The id is what a persisted record carries, so it has to be the serde spelling rather
        // than a second string that merely looks like it.
        assert_eq!(
            serde_json::to_value(error).expect("serialize"),
            json!(error.wire_id()),
            "{error:?}: the id and the serde spelling must be one value"
        );
        assert!(
            error.wire_id().starts_with(match error.kind() {
                GgTurnErrorKind::ModelApi => "model_",
                GgTurnErrorKind::Transpile => "transpile_",
                GgTurnErrorKind::ProgramFault => "program_",
                GgTurnErrorKind::SandboxLimit => "sandbox_",
                GgTurnErrorKind::MissingCompletion => "missing_completion_",
            }),
            "{error:?}: a type's id names its base, because a ranking shows it without one"
        );
    }

    for kind in GgTurnErrorKind::ALL {
        assert_eq!(
            serde_json::to_value(kind).expect("serialize"),
            json!(kind.wire_id())
        );
        assert!(
            GgTurnErrorType::ALL
                .iter()
                .any(|error| error.kind() == kind),
            "{kind:?} has no type under it"
        );
    }

    // The five wire values persisted run data already depends on are unchanged by the split.
    assert_eq!(GgTurnErrorKind::Transpile.wire_id(), "transpile");
    assert_eq!(GgTurnErrorKind::ModelApi.wire_id(), "model_api");
}

/// The failure class every failed call is recorded with: kebab-case on purpose, so one class is
/// spelled one way in the telemetry, in the membrane's WIT and in the `ApiError` a program catches.
#[test]
fn every_tool_failure_class_keeps_its_kebab_case_spelling() {
    for failure in GgCallFailure::ALL {
        assert_eq!(
            serde_json::to_value(failure).expect("serialize"),
            json!(failure.wire_id())
        );
        assert!(!failure.label().is_empty());
    }
    assert_eq!(
        GgCallFailure::InvalidArgument.wire_id(),
        "invalid-argument",
        "the class a program branches on is spelled the same on the wire"
    );
    assert_eq!(
        GgCallFailure::ALL.len(),
        8,
        "seven raised classes plus `other` for a failure raised outside a tool"
    );
}

/// A failed call says **why** on both of its records — the tool's and the model's — and a successful
/// one says nothing.
#[test]
fn a_failed_call_carries_its_class_on_both_of_its_records() {
    let failed = GgTelemetryKind::ToolResult {
        name: "read_file".to_string(),
        ok: false,
        summary: Some("no such file".to_string()),
        failure: Some(GgCallFailure::NotFound),
    };
    let value = serde_json::to_value(&failed).expect("serialize");
    assert_eq!(value["failure"], json!("not-found"));
    assert_eq!(
        serde_json::from_value::<GgTelemetryKind>(value).expect("deserialize"),
        failed
    );

    let ok = GgTelemetryKind::ToolResult {
        name: "read_file".to_string(),
        ok: true,
        summary: None,
        failure: None,
    };
    assert!(
        serde_json::to_value(&ok)
            .expect("serialize")
            .get("failure")
            .is_none(),
        "a success carries no class"
    );

    // The model-facing half — the only record a responses-as-code agent's calls have, including the
    // call the membrane refused before dispatch, which is why the class rides here too. The
    // operation rides beside it because *how often did this operation fail* is a question about
    // results, and it must not require pairing each result back to its own call.
    let refused = GgTelemetryKind::ApiResult {
        operation: "files.read_file".to_string(),
        ok: false,
        failure: Some(GgCallFailure::LimitExceeded),
    };
    let value = serde_json::to_value(&refused).expect("serialize");
    assert_eq!(value["failure"], json!("limit-exceeded"));
    assert_eq!(value["operation"], json!("files.read_file"));
    assert_eq!(
        serde_json::from_value::<GgTelemetryKind>(value).expect("deserialize"),
        refused
    );
}

/// **A call names gg's own operation, not one arm's spelling of it** — the join a cross-language
/// study is made of, and the one thing about a call that means the same in all eleven arms.
///
/// It is the *only* thing the event carries, which is the point of the assertion: the operation id
/// is the whole identity of a model-facing call, and there is no second vocabulary beside it for a
/// consumer to key on by mistake. Every call has one — the documentation family included — because
/// the operations table is the API surface's single vocabulary, so a call with no row in it is a
/// call the surface could not have offered.
#[test]
fn an_api_call_carries_the_operation_it_resolved_to() {
    let call = GgTelemetryKind::ApiCall {
        operation: "files.read_file".to_string(),
    };
    let value = serde_json::to_value(&call).expect("serialize");
    assert_eq!(value["type"], json!("api_call"));
    assert_eq!(value["operation"], json!("files.read_file"));
    assert!(
        value.get("object").is_none() && value.get("function").is_none(),
        "a call is identified by its operation and by nothing else: {value}"
    );
    assert_eq!(
        serde_json::from_value::<GgTelemetryKind>(value).expect("deserialize"),
        call
    );

    let docs = GgTelemetryKind::ApiCall {
        operation: "docs.search".to_string(),
    };
    let value = serde_json::to_value(&docs).expect("serialize");
    assert_eq!(value["operation"], json!("docs.search"));
    assert_eq!(
        serde_json::from_value::<GgTelemetryKind>(value).expect("deserialize"),
        docs
    );
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
        label: Some("index.html".to_string()),
    };
    let value = serde_json::to_value(&message).expect("serialize");
    assert_eq!(value["type"], json!("context_message"));
    assert_eq!(value["toolCallId"], json!("call_1"));
    assert_eq!(value["images"][0]["mediaType"], json!("image/png"));
    // A file view's selector tag rides on the definition, so its tokens stay attributable
    // to the path that filled the window.
    assert_eq!(value["label"], json!("index.html"));
    // The descriptor never carries the base64 bytes.
    assert!(value["images"][0].get("dataBase64").is_none());
    let back: GgTelemetryKind = serde_json::from_value(value).expect("deserialize");
    assert_eq!(back, message);

    // An untagged message omits the label from the wire rather than serializing a null.
    let untagged = GgTelemetryKind::ContextMessage {
        id: "mcafe".to_string(),
        role: "user".to_string(),
        content: Some("build a game".to_string()),
        tool_calls: Vec::new(),
        tool_call_id: None,
        images: Vec::new(),
        tokens: 12,
        label: None,
    };
    let value = serde_json::to_value(&untagged).expect("serialize");
    assert!(value.get("label").is_none());
    let back: GgTelemetryKind = serde_json::from_value(value).expect("deserialize");
    assert_eq!(back, untagged);

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
        provider: None,
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

// --- Module instance identity ------------------------------------------------

/// A roster is the only event that reports a module an agent holds but has not touched, so every
/// field on it has to survive the wire: the id that says *which* store, the origin that says how
/// the holder came by it, and — for the one kind that has one — the declared scope beside it.
#[test]
fn agent_modules_serializes_a_roster_with_ids_and_origin() {
    let kind = GgTelemetryKind::AgentModules {
        modules: vec![
            GgAgentModule {
                kind: GgModuleKind::History,
                module_id: "history-3".to_string(),
                enabled: true,
                origin: GgModuleOrigin::Transferred,
                scope: None,
                writable: true,
            },
            // A read-only inherited handle: the holder reads a store somebody else created and may
            // not write it, which is the case that emits no snapshot of its own at all.
            GgAgentModule {
                kind: GgModuleKind::Memories,
                module_id: "memories-0".to_string(),
                enabled: true,
                origin: GgModuleOrigin::Inherited,
                scope: Some(GgMemoryScope::ReadOnly),
                writable: false,
            },
            // A capability switched off still occupies its row, with no store to identify.
            GgAgentModule {
                kind: GgModuleKind::Tasks,
                module_id: String::new(),
                enabled: false,
                origin: GgModuleOrigin::Created,
                scope: None,
                writable: true,
            },
        ],
    };
    let value = serde_json::to_value(&kind).expect("serialize");
    assert_eq!(value["type"], json!("agent_modules"));
    assert_eq!(value["modules"][0]["moduleId"], json!("history-3"));
    assert_eq!(value["modules"][0]["origin"], json!("transferred"));
    assert_eq!(value["modules"][1]["scope"], json!("read-only"));
    assert_eq!(value["modules"][1]["writable"], json!(false));
    // A kind with no scope omits it rather than sending null.
    assert!(value["modules"][0].get("scope").is_none());
    let back: GgTelemetryKind = serde_json::from_value(value).expect("deserialize");
    assert_eq!(back, kind);
}

/// The surface is what makes *"never offered"* and *"offered and never called"* different findings,
/// so what has to survive the wire is exactly the join a consumer draws that distinction with: each
/// bound function beside its own [`operation`](GgAgentApiFunction::operation), gg's identity for
/// what it does and the string its calls are recorded under. The join is that one string, which is
/// why a function no tool backs — the ending call asserted below — carries a figure on exactly the
/// terms a tool-backed read does.
///
/// The three per-agent settings ride here too, and the [mode](GgTelemetryKind::AgentSurface) is the
/// one this asserts by name: it is the arm of a within-run comparison, and a run that recorded it
/// nowhere would leave every measurement of it unattributable.
///
/// **Exactly one of the two surfaces is populated**, and that is the load-bearing assertion here: an
/// agent has one execution mode, so a responses-as-code instance is offered no tools at all and a
/// tool-calling one binds no modules. No gg tool name appears anywhere on the API surface — the two
/// vocabularies are scoped, and under the tool-keyed join this replaced, the one `read_file` behind
/// three functions counted three calls where the model had written one.
#[test]
fn agent_surface_populates_exactly_the_one_surface_its_mode_uses() {
    let kind = GgTelemetryKind::AgentSurface {
        execution_mode: "responses_as_code".to_string(),
        program_language: Some(GgProgramLanguage::TypeScript),
        doc_view_types: Some("return+parameters+errors".to_string()),
        // Offered no tools: this agent answers with programs, and the tool vocabulary is not one it
        // can reach.
        tools: Vec::new(),
        apis: vec![
            GgAgentApi {
                module: "files".to_string(),
                path: "gg.files".to_string(),
                description: "read, write, and edit workspace files".to_string(),
                functions: vec![GgAgentApiFunction {
                    name: "readFile".to_string(),
                    operation: "files.read_file".to_string(),
                }],
            },
            // The ending call: bound by the agent's dispatched role rather than by a capability, and
            // counted exactly as any other function is — its own operation, its own figure.
            GgAgentApi {
                module: "session".to_string(),
                path: "gg.session".to_string(),
                description: "end your session".to_string(),
                functions: vec![GgAgentApiFunction {
                    name: "finish".to_string(),
                    operation: "session.finish".to_string(),
                }],
            },
        ],
    };
    let value = serde_json::to_value(&kind).expect("serialize");
    assert_eq!(value["type"], json!("agent_surface"));
    assert_eq!(value["executionMode"], json!("responses_as_code"));
    assert_eq!(value["programLanguage"], json!("typescript"));
    assert_eq!(value["docViewTypes"], json!("return+parameters+errors"));
    assert_eq!(value["tools"], json!([]));
    // A module is named twice: once as gg knows it, and once as this arm spells it. A study
    // grouping eleven arms reads the first; a reader quoting the model reads the second.
    assert_eq!(value["apis"][0]["module"], json!("files"));
    assert_eq!(value["apis"][0]["path"], json!("gg.files"));
    // Every function carries its own operation — the ending call as much as the read — and no gg
    // tool name appears anywhere on the surface.
    assert_eq!(
        value["apis"][0]["functions"][0]["operation"],
        json!("files.read_file")
    );
    assert_eq!(
        value["apis"][1]["functions"][0]["operation"],
        json!("session.finish")
    );
    assert!(value["apis"][0]["functions"][0].get("tool").is_none());
    let back: GgTelemetryKind = serde_json::from_value(value).expect("deserialize");
    assert_eq!(back, kind);

    // A tool-calling agent's surface omits `apis` entirely rather than sending an empty list a
    // consumer would have to interpret, because it has no such surface. Its `programLanguage` and
    // `docViewTypes` are absent on the same terms: it writes no programs and opens no documentation,
    // so naming either would be reporting a fact about a surface it does not have.
    let tool_calling = GgTelemetryKind::AgentSurface {
        execution_mode: "tool_calling".to_string(),
        program_language: None,
        doc_view_types: None,
        tools: vec!["shell".to_string()],
        apis: Vec::new(),
    };
    let value = serde_json::to_value(&tool_calling).expect("serialize");
    assert_eq!(value["tools"], json!(["shell"]));
    assert!(value.get("apis").is_none());
    assert!(value.get("programLanguage").is_none());
    assert!(value.get("docViewTypes").is_none());
    let back: GgTelemetryKind = serde_json::from_value(value).expect("deserialize");
    assert_eq!(back, tool_calling);
}

/// The archive streams metadata and a bounded preview, never bodies — and it streams them at all,
/// which is new: before module identity the archive emitted nothing whatsoever.
#[test]
fn archive_state_serializes_entries_with_previews() {
    let kind = GgTelemetryKind::ArchiveState {
        module_id: "archive-1".to_string(),
        entries: vec![GgArchiveEntry {
            seq: 4,
            source: GgContextSource::ToolOutput,
            role: "tool".to_string(),
            len: 1200,
            preview: "read_file src/main.rs".to_string(),
        }],
        count: 1,
        total_len: 1200,
    };
    let value = serde_json::to_value(&kind).expect("serialize");
    assert_eq!(value["type"], json!("archive_state"));
    assert_eq!(value["moduleId"], json!("archive-1"));
    assert_eq!(value["entries"][0]["seq"], json!(4));
    assert_eq!(value["entries"][0]["source"], json!("tool_output"));
    assert_eq!(value["totalLen"], json!(1200));
    let back: GgTelemetryKind = serde_json::from_value(value).expect("deserialize");
    assert_eq!(back, kind);
}

/// A transition reports the module instance on **both** sides of the boundary, which is what makes
/// a store swap visible: a carried module reports one id twice, and a successor re-bound to its own
/// profile's registry entry reports two.
#[test]
fn agent_transition_serializes_per_module_dispositions_with_both_ids() {
    let kind = GgTelemetryKind::AgentTransition {
        kind: GgAgentTransitionKind::Exec,
        to_agent_id: "agent-4".to_string(),
        profile_id: "reviewer".to_string(),
        state: None,
        modules: vec![
            GgTransitionModule {
                kind: GgModuleKind::History,
                disposition: GgModuleDisposition::Carried,
                from_module_id: Some("history-0".to_string()),
                to_module_id: Some("history-0".to_string()),
            },
            GgTransitionModule {
                kind: GgModuleKind::Memories,
                disposition: GgModuleDisposition::Carried,
                from_module_id: Some("memories-0".to_string()),
                to_module_id: Some("memories-2".to_string()),
            },
            GgTransitionModule {
                kind: GgModuleKind::Board,
                disposition: GgModuleDisposition::Linked,
                from_module_id: Some("board-0".to_string()),
                to_module_id: Some("board-0".to_string()),
            },
            GgTransitionModule {
                kind: GgModuleKind::Skills,
                disposition: GgModuleDisposition::Absent,
                from_module_id: None,
                to_module_id: None,
            },
        ],
    };
    let value = serde_json::to_value(&kind).expect("serialize");
    assert_eq!(value["modules"][0]["disposition"], json!("carried"));
    assert_eq!(value["modules"][0]["fromModuleId"], json!("history-0"));
    assert_eq!(
        value["modules"][1]["toModuleId"],
        json!("memories-2"),
        "a `shared`-scoped successor re-binds, and the two ids are what say so"
    );
    assert_eq!(value["modules"][2]["disposition"], json!("linked"));
    // A kind neither side holds carries no ids at all rather than nulls.
    assert!(value["modules"][3].get("fromModuleId").is_none());
    let back: GgTelemetryKind = serde_json::from_value(value).expect("deserialize");
    assert_eq!(back, kind);
}

/// Every disposition and every origin spells itself in kebab-case on the wire, because the console
/// switches on those strings and a rename would be a silently-unmatched arm.
#[test]
fn module_dispositions_and_origins_serialize_kebab_case() {
    for (disposition, wire) in [
        (GgModuleDisposition::Carried, "carried"),
        (GgModuleDisposition::Copied, "copied"),
        (GgModuleDisposition::Linked, "linked"),
        (GgModuleDisposition::Dropped, "dropped"),
        (GgModuleDisposition::Initialized, "initialized"),
        (GgModuleDisposition::Absent, "absent"),
    ] {
        assert_eq!(serde_json::to_value(disposition).unwrap(), json!(wire));
        assert_eq!(disposition.as_str(), wire);
    }
    for (origin, wire) in [
        (GgModuleOrigin::Created, "created"),
        (GgModuleOrigin::Inherited, "inherited"),
        (GgModuleOrigin::Profile, "profile"),
        (GgModuleOrigin::Run, "run"),
        (GgModuleOrigin::Transferred, "transferred"),
        (GgModuleOrigin::Forked, "forked"),
    ] {
        assert_eq!(serde_json::to_value(origin).unwrap(), json!(wire));
        assert_eq!(origin.as_str(), wire);
    }
}

// --- Where a hook is declared -------------------------------------------------

/// Every event belongs to exactly one of the two declaration sites — the invariant the whole split
/// rests on, asserted over the catalogue rather than over a sample so a new event cannot be added
/// to neither list.
#[test]
fn every_event_belongs_to_exactly_one_declaration_site() {
    for event in ALL_HOOK_EVENTS {
        assert_eq!(
            event.is_session(),
            SESSION_HOOK_EVENTS.contains(&event),
            "`{}` disagrees with SESSION_HOOK_EVENTS",
            event.as_str(),
        );
        assert_eq!(
            !event.is_session(),
            AGENT_HOOK_EVENTS.contains(&event),
            "`{}` disagrees with AGENT_HOOK_EVENTS",
            event.as_str(),
        );
    }
    assert_eq!(
        SESSION_HOOK_EVENTS.len() + AGENT_HOOK_EVENTS.len(),
        ALL_HOOK_EVENTS.len()
    );
}

// --- The capability-id vocabulary ---------------------------------------------

/// [`GG_CAPABILITY_CATALOG`] is the **single** authority on what a capability may be called: the
/// launch reads it to refuse an id gg does not ship, and the query-document builder reads it to
/// make the `cap.*` namespace total. Both jobs are wrong if the list has a duplicate or is missing
/// an id that exists.
///
/// The coverage half is asserted against the module's own source rather than against a second list
/// written here, because a second list is exactly the drift the catalog exists to prevent: adding
/// `pub const CAPABILITY_X` without adding it to the catalog must fail this test, and it can only
/// do that if the test finds the constant itself.
#[test]
fn the_capability_catalog_has_no_duplicates_and_covers_every_shipped_id() {
    let mut seen = std::collections::BTreeSet::new();
    for id in GG_CAPABILITY_CATALOG {
        assert!(seen.insert(*id), "`{id}` appears in the catalog twice");
        assert!(
            !id.is_empty() && id.trim() == *id,
            "`{id}` is not a usable capability id"
        );
    }

    let declared = declared_capability_ids();
    assert!(
        !declared.is_empty(),
        "the source scan found no CAPABILITY_* constants at all — it has stopped working"
    );
    for id in &declared {
        assert!(
            seen.contains(id.as_str()),
            "`pub const CAPABILITY_… = {id:?}` is declared but missing from GG_CAPABILITY_CATALOG, \
             so a set naming it would be refused at launch"
        );
    }
    assert_eq!(
        seen.len(),
        declared.len(),
        "the catalog carries an id no CAPABILITY_* constant declares"
    );
}

/// Every `pub const CAPABILITY_… : &str = "…";` declared in `gg.rs`, read out of the source.
fn declared_capability_ids() -> std::collections::BTreeSet<String> {
    include_str!("gg.rs")
        .lines()
        .filter_map(|line| {
            let rest = line.strip_prefix("pub const CAPABILITY_")?;
            let (_, value) = rest.split_once('=')?;
            let value = value.trim().trim_end_matches(';').trim();
            Some(value.trim_matches('"').to_string())
        })
        .collect()
}

// --- The authoring catalog ----------------------------------------------------

/// The five capabilities that offer arms to choose between — the only ones an
/// [`implementation`](GgCapabilityConfig::implementation) may name at all.
const CAPABILITIES_WITH_ARMS: [&str; 5] = [
    CAPABILITY_SHELL,
    CAPABILITY_READ_FILE,
    CAPABILITY_MEMORIES,
    CAPABILITY_COMPACTION,
    CAPABILITY_AUTOLOAD_SPECS,
];

/// Every key an authored params object carries. A JSON object has no order of its own, so this is
/// the set of keys rather than a sequence of them.
fn authored_keys(id: &str) -> std::collections::BTreeSet<&'static str> {
    let entry = authored_capability(id).unwrap_or_else(|| panic!("`{id}` has no catalog entry"));
    entry
        .params
        .as_object()
        .unwrap_or_else(|| panic!("`{id}` authors params that are not an object"))
        .keys()
        .map(|key| {
            GG_AUTHORED_PARAM_KEYS
                .iter()
                .find(|known| *known == key)
                .copied()
                .unwrap_or_else(|| panic!("`{key}` is not a param constant this crate declares"))
        })
        .collect()
}

/// Every param key the [authoring catalog](gg_authoring_catalog) can write, so
/// [`authored_keys`](authored_keys) reports a key by the constant that names it rather than by a
/// string spelled a second time.
const GG_AUTHORED_PARAM_KEYS: [&str; 24] = [
    PARAM_MAX_LINES,
    PARAM_MAX_CHARS,
    PARAM_LINE_CAP,
    PARAM_WINDOW_LIMIT,
    AUTOLOAD_PARAM_IMAGES,
    PARAM_SKILLS_DIR,
    PARAM_BUILT_INS,
    MEMORY_PARAM_SCOPE,
    PARAM_MAX_COUNT,
    PARAM_MAX_LEN_PER_MEMORY,
    PARAM_MAX_TOTAL_LEN,
    PARAM_MAX_LEN_INDEX,
    PARAM_MAX_LEN_DESCRIPTION,
    PARAM_MAX_RESULTS,
    PARAM_MAX_TASKS,
    PARAM_MODE,
    PARAM_SUMMARY_HEADROOM,
    PARAM_TOP_FILE_VIEWS,
    PARAM_SIGNAL_THRESHOLD_PERCENT,
    PROJECT_MANAGEMENT_PARAM_MERGE_AGENT,
    PARAM_MAX_EPICS,
    PARAM_MAX_ISSUES,
    PARAM_MAX_RETRIES,
    PARAM_MAX_DEPTH,
];

/// The catalog answers for **every** capability gg ships and for nothing else.
///
/// A capability added to [`GG_CAPABILITY_CATALOG`] without an entry here is one the console would
/// pre-fill with nothing and every constructor in this crate would author incomplete — a capability
/// that cannot be switched on without the launch refusing it. Failing here is how that is found,
/// rather than on the first launch that enables it.
#[test]
fn the_authoring_catalog_covers_the_capability_catalog_exactly_and_in_order() {
    let authored: Vec<&str> = gg_authoring_catalog()
        .iter()
        .map(|entry| entry.id)
        .collect();
    assert_eq!(authored, GG_CAPABILITY_CATALOG.to_vec());

    let mut seen = std::collections::BTreeSet::new();
    for id in &authored {
        assert!(seen.insert(*id), "`{id}` is authored twice");
    }
    for id in GG_CAPABILITY_CATALOG {
        assert!(
            authored_capability(id).is_some(),
            "`{id}` ships but the authoring catalog says nothing about it"
        );
    }
    assert!(authored_capability("no-such-capability").is_none());
}

/// The catalog names an arm only where a capability has arms to name, and it names one for four of
/// the five.
///
/// [Autoload specifications](CAPABILITY_AUTOLOAD_SPECS) is the exception, and deliberately: its one
/// arm is [`locked`](AUTOLOAD_LOCKED_IMPL), and an implementation written nowhere is itself the
/// declaration that the seeded specifications are ordinary file views. Writing `locked` into every
/// new document would pin the specifications of every run nobody asked to pin. The other sixteen
/// capabilities offer no arm at all, so a name on one of them refuses the launch — a catalog that
/// wrote one would author a document that cannot start.
#[test]
fn the_authoring_catalog_names_an_arm_only_where_a_capability_offers_arms() {
    for entry in gg_authoring_catalog() {
        if entry.implementation.is_some() {
            assert!(
                CAPABILITIES_WITH_ARMS.contains(&entry.id),
                "`{}` offers no arms, so an authored implementation would refuse the launch",
                entry.id
            );
        }
    }

    let named: Vec<&str> = gg_authoring_catalog()
        .iter()
        .filter(|entry| entry.implementation.is_some())
        .map(|entry| entry.id)
        .collect();
    assert_eq!(
        named,
        vec![
            CAPABILITY_SHELL,
            CAPABILITY_READ_FILE,
            CAPABILITY_MEMORIES,
            CAPABILITY_COMPACTION,
        ]
    );
    assert_eq!(
        authored_capability(CAPABILITY_AUTOLOAD_SPECS)
            .expect("autoload is in the catalog")
            .implementation,
        None
    );

    // Each named arm is one its capability actually offers.
    let arm = |id| {
        authored_capability(id)
            .expect("in the catalog")
            .implementation
    };
    assert_eq!(arm(CAPABILITY_SHELL), Some(SHELL_OUTPUT_OFFLOAD));
    assert!(SHELL_OUTPUT_MODES.contains(&SHELL_OUTPUT_OFFLOAD));
    assert_eq!(arm(CAPABILITY_READ_FILE), Some(READ_MODE_UNLIMITED));
    assert!(READ_MODES.contains(&READ_MODE_UNLIMITED));
    assert_eq!(arm(CAPABILITY_MEMORIES), Some(MEMORY_STRATEGY_SCRATCHPAD));
    assert_eq!(
        arm(CAPABILITY_COMPACTION),
        Some(COMPACTION_STRATEGY_SELF_SUMMARIZATION)
    );
}

/// The catalog never writes [responses-as-code](CAPABILITY_RESPONSES_AS_CODE)'s
/// [`language`](PARAM_LANGUAGE), and no other entry writes it either.
///
/// It is the one required value nobody may choose for the operator: the language is the axis a
/// cross-language study slices its arms by, so a form that pre-filled it would hand back a run
/// recorded under a language nobody picked. Every other required param has a figure that can be put
/// in front of an operator to keep or change; this one has only their answer.
#[test]
fn the_authoring_catalog_never_names_a_program_language() {
    for entry in gg_authoring_catalog() {
        let params = entry.params.as_object().expect("params are an object");
        assert!(
            !params.contains_key(PARAM_LANGUAGE),
            "`{}` authors a `{PARAM_LANGUAGE}`, which is the one value nobody may choose",
            entry.id
        );
    }
    let rac = authored_capability(CAPABILITY_RESPONSES_AS_CODE).expect("in the catalog");
    let written: std::collections::BTreeSet<&str> = rac
        .params
        .as_object()
        .expect("params are an object")
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(
        written,
        std::collections::BTreeSet::from([
            PARAM_TIMEOUT_SECS,
            PARAM_MAX_MEMORY_BYTES,
            PARAM_DOC_VIEW_TYPES,
        ])
    );
}

/// A param that is **off when it is absent** is left out of the catalog.
///
/// Writing one in would make every new document ask for the thing its absence turns off: a
/// summarizer model on an arm that summarizes on its own model, or a reviewer on every issue an
/// agent files. The absence is the setting, and the catalog states settings by writing them.
#[test]
fn the_authoring_catalog_leaves_out_every_param_that_is_off_when_absent() {
    assert_eq!(
        authored_keys(CAPABILITY_COMPACTION),
        std::collections::BTreeSet::from([PARAM_SUMMARY_HEADROOM])
    );
    assert_eq!(
        authored_keys(CAPABILITY_PROJECT_MANAGEMENT),
        std::collections::BTreeSet::from([
            PROJECT_MANAGEMENT_PARAM_MERGE_AGENT,
            PARAM_MAX_EPICS,
            PARAM_MAX_ISSUES,
            PARAM_MAX_RETRIES,
        ])
    );
}

/// The [memories](CAPABILITY_MEMORIES) entry writes the [scratchpad](MEMORY_STRATEGY_SCRATCHPAD)'s
/// own limits, since the scratchpad is the arm it selects — all six of them, whichever the strategy
/// applies, which is what lets one sweep hand every arm the same params block. The three the
/// scratchpad does not apply are written `0`, the spelling a params object uses for "no limit".
#[test]
fn the_memories_entry_writes_the_scratchpads_limits() {
    let entry = authored_capability(CAPABILITY_MEMORIES).expect("in the catalog");
    assert_eq!(entry.implementation, Some(MEMORY_STRATEGY_SCRATCHPAD));
    assert_eq!(
        entry.params,
        json!({
            "scope": "isolated",
            "maxCount": 64,
            "maxLenPerMemory": 4096,
            "maxTotalLen": 0,
            "maxLenIndex": 0,
            "maxLenDescription": 256,
            "maxResults": 0,
        })
    );
}

/// A capability this crate constructs is **fully specified**: the catalog's arm, and every one of
/// the catalog's params.
#[test]
fn an_enabled_capability_is_authored_from_the_catalog() {
    for entry in gg_authoring_catalog() {
        let config = GgCapabilityConfig::enabled(entry.id);
        assert_eq!(config.id, entry.id);
        assert!(config.enabled);
        assert_eq!(config.implementation.as_deref(), entry.implementation);
        assert_eq!(config.params, entry.params);
    }
}

/// A **disabled** capability records the configuration the arm would have used, so the on and off
/// arms of one comparison are the same document with one switch moved.
#[test]
fn a_disabled_capability_records_the_configuration_it_would_have_used() {
    let off = GgCapabilityConfig::disabled(CAPABILITY_MEMORIES);
    assert!(!off.enabled);
    assert_eq!(
        GgCapabilityConfig {
            enabled: true,
            ..off
        },
        GgCapabilityConfig::enabled(CAPABILITY_MEMORIES)
    );
}

/// An id outside [`GG_CAPABILITY_CATALOG`] is authored with nothing at all — there is no capability
/// to specify, and a set naming one is refused at launch by name.
#[test]
fn an_id_gg_does_not_ship_is_authored_with_nothing() {
    let config = GgCapabilityConfig::enabled("no-such-capability");
    assert_eq!(config.implementation, None);
    assert_eq!(config.params, json!({}));
}

/// [`with_param`](GgCapabilityConfig::with_param) **merges**. A caller changing one figure asked for
/// one figure changed, and a replacement would hand back a capability short of the params it
/// requires — a document that refuses its own launch, naming params the caller never touched.
#[test]
fn with_param_overrides_one_key_and_keeps_every_other() {
    let tuned = GgCapabilityConfig::enabled(CAPABILITY_SHELL).with_param(PARAM_MAX_LINES, 40);
    assert_eq!(tuned.params[PARAM_MAX_LINES], json!(40));
    assert_eq!(
        tuned.params[PARAM_MAX_CHARS],
        authored_capability(CAPABILITY_SHELL)
            .expect("in the catalog")
            .params[PARAM_MAX_CHARS]
    );
    assert_eq!(
        authored_keys(CAPABILITY_SHELL),
        std::collections::BTreeSet::from([PARAM_MAX_LINES, PARAM_MAX_CHARS])
    );

    // A key the catalog did not write is added rather than refused here: what a params key must be
    // is the launch's question, not the builder's.
    let extra =
        GgCapabilityConfig::enabled(CAPABILITY_TASKS).with_param(PARAM_MODE, TASK_MODE_ISSUES);
    assert_eq!(extra.params[PARAM_MODE], json!(TASK_MODE_ISSUES));
    assert_eq!(extra.params[PARAM_MAX_TASKS], json!(100));
}

/// The root profile a new configuration starts from is **fully specified**: every capability it
/// enables carries the arm the catalog names and exactly the params the catalog writes.
///
/// This is the property that makes `GgAgentConfig::root()` a launchable starting point rather than
/// a sketch. A capability whose catalog entry grew a param would fail here until the profile was
/// re-authored, which is the same failure a stored configuration meets at its next launch.
#[test]
fn the_root_agent_is_fully_specified() {
    let root = GgAgentConfig::root();
    assert!(!root.capabilities.is_empty());
    for capability in &root.capabilities {
        let entry = authored_capability(&capability.id)
            .unwrap_or_else(|| panic!("`{}` is not a capability gg ships", capability.id));
        assert_eq!(
            capability.implementation.as_deref(),
            entry.implementation,
            "`{}` does not carry the arm a new document is written with",
            capability.id
        );
        assert_eq!(
            capability.params, entry.params,
            "`{}` does not carry the params a new document is written with",
            capability.id
        );
    }
}

/// Both set constructors carry the two **required** run-level ceilings and arm nothing else.
///
/// gg conducts every run under the parallelism cap and the journal ceiling and neither has an off,
/// so a set without them is refused at launch — while the five ceilings are armed only by being
/// written, and a starting configuration writes none of them.
#[test]
fn a_new_capability_set_carries_the_two_required_ceilings_and_arms_no_other() {
    for set in [
        GgCapabilitySet::default(),
        GgCapabilitySet::minimal("anthropic/claude-opus-4.8"),
    ] {
        assert_eq!(set.limits.max_parallel, Some(AUTHORED_MAX_PARALLEL));
        assert_eq!(set.limits.replay_max_bytes, Some(AUTHORED_REPLAY_MAX_BYTES));
        assert_eq!(set.limits.max_turns, None);
        assert_eq!(set.limits.max_runtime_secs, None);
        assert_eq!(set.limits.max_cost, None);
        assert_eq!(set.limits.max_consecutive_errors, None);
        assert_eq!(set.limits.max_error_rate, None);
        assert_eq!(set.limits.error_rate_window, None);
        assert!(!set.limits.is_empty());
    }

    assert_eq!(
        serde_json::to_value(GgRunLimits::authored()).expect("serialize"),
        json!({ "maxParallel": 16, "replayMaxBytes": 268_435_456 })
    );
}

// --- The configuration contract is strict -------------------------------------

/// Every container of the gg **configuration** contract refuses a key it does not know.
///
/// A misspelled key is the one misconfiguration nothing downstream can see: `implementaton` parses
/// as an absent implementation, `maxTurnss` as an unbounded run, `transtions` as a terminal state —
/// each of them a run that is recorded as the configuration the operator wrote and is not the run
/// they asked for. gg has no back-compat, so a newer console writing a field an older gg has never
/// heard of is the same defect wearing a nicer hat, and fails the same way.
#[test]
fn an_unknown_key_is_refused_by_every_configuration_container() {
    fn refuses<T: serde::de::DeserializeOwned>(what: &str, mut value: serde_json::Value) {
        let object = value.as_object_mut().expect("a JSON object fixture");
        object.insert("nosuchkey".to_string(), json!(1));
        let error = serde_json::from_value::<T>(value)
            .err()
            .unwrap_or_else(|| panic!("{what} accepted an unknown key"));
        assert!(
            error.to_string().contains("unknown field"),
            "{what} failed for the wrong reason: {error}"
        );
    }

    refuses::<GgCapabilitySet>("GgCapabilitySet", json!({ "agents": [] }));
    refuses::<GgAgentConfig>(
        "GgAgentConfig",
        json!({ "slug": ROOT_PROFILE_ID, "name": ROOT_AGENT }),
    );
    refuses::<GgCapabilityConfig>(
        "GgCapabilityConfig",
        json!({ "id": CAPABILITY_SHELL, "enabled": true }),
    );
    refuses::<GgLoopDetection>("GgLoopDetection", json!({ "enabled": true }));
    refuses::<GgFsmState>(
        "GgFsmState",
        json!({ "name": "build", "agentId": "builder" }),
    );
    refuses::<GgFsmTransition>("GgFsmTransition", json!({ "to": "review" }));
    refuses::<GgRunLimits>("GgRunLimits", json!({ "maxTurns": 40 }));
    refuses::<GgSubagentRef>("GgSubagentRef", json!({ "agentId": "reviewer" }));
    refuses::<GgModelSlot>("GgModelSlot", json!({ "name": PRIMARY_SLOT }));
    refuses::<GgSlotBinding>(
        "GgSlotBinding",
        json!({ "slot": PRIMARY_SLOT, "modelId": "anthropic/claude-opus-4.8" }),
    );
    refuses::<GgHook>(
        "GgHook",
        json!({ "event": "pre-write", "action": { "type": "built-in", "script": "trace" } }),
    );
    refuses::<GgHookAction>(
        "GgHookAction",
        json!({ "type": "command", "command": "npm test" }),
    );
    refuses::<GgInvocation>(
        "GgInvocation",
        json!({ "sessionId": "s1", "workspaceDir": "/work", "prompt": "build it" }),
    );
}

/// The strictness reaches **inside** the envelope, which is where it earns its keep: a typo on a
/// capability's `implementation` key is nested three levels down in the one document a sweep shares
/// across every arm.
#[test]
fn an_unknown_key_nested_in_the_invocation_is_refused() {
    let error = serde_json::from_value::<GgInvocation>(json!({
        "sessionId": "s1",
        "workspaceDir": "/work",
        "prompt": "build it",
        "capabilitySet": {
            "agents": [{
                "slug": ROOT_PROFILE_ID,
                "name": ROOT_AGENT,
                "modelId": "anthropic/claude-opus-4.8",
                "capabilities": [{
                    "id": CAPABILITY_COMPACTION,
                    "enabled": true,
                    "implementaton": COMPACTION_STRATEGY_MEMORY,
                }],
            }],
        },
    }))
    .expect_err("a misspelled `implementation` must not read as an absent one");
    assert!(error.to_string().contains("implementaton"), "{error}");
}

/// A [`params`](GgCapabilityConfig::params) object stays free-form: its keys are the capability's
/// own vocabulary, checked at launch by the capability that reads them, not by serde. Refusing them
/// here would make one capability's params a field of every other capability's type.
#[test]
fn capability_params_stay_free_form() {
    let config: GgCapabilityConfig = serde_json::from_value(json!({
        "id": CAPABILITY_COMPACTION,
        "enabled": true,
        "params": { "summaryHeadroom": 0.3, "anything": ["at", "all"] },
    }))
    .expect("params are a free-form object");
    assert_eq!(config.params["summaryHeadroom"], json!(0.3));
}

/// A [transfer list](GgFsmTransition::transfer) entry that is not a module kind gg knows is
/// **refused**, not dropped.
///
/// Both shapes matter and only one of them was ever visible: a mistyped *string* could at least be
/// scanned for, while an entry that is not a string at all could not be seen by any scan over
/// `Value::as_str`. Neither reaches a machine now.
#[test]
fn an_unknown_transfer_kind_is_refused() {
    let good: GgFsmTransition =
        serde_json::from_value(json!({ "to": "review", "transfer": ["history", "tasks"] }))
            .expect("a list of real module kinds");
    assert_eq!(
        good.transfer,
        vec![GgModuleKind::History, GgModuleKind::Tasks]
    );

    for bad in [json!(["histry"]), json!(["history", 7]), json!([null])] {
        serde_json::from_value::<GgFsmTransition>(json!({ "to": "review", "transfer": bad }))
            .expect_err("an entry that is not a module kind must fail the machine");
    }

    // Absent is still the documented default — a hard reset that transfers nothing.
    let none: GgFsmTransition =
        serde_json::from_value(json!({ "to": "review" })).expect("deserialize");
    assert!(none.transfer.is_empty());
}

// ---------------------------------------------------------------------------
// Slugs, agent slots and configuration slots
// ---------------------------------------------------------------------------

/// The shape a profile slug has to take, and the shapes it must not: the slug is what the
/// model is shown and passes back, so a name it would have to decide how to spell is one
/// the launch refuses rather than one gg guesses at.
#[test]
fn a_profile_slug_is_lowercase_words_joined_by_single_hyphens() {
    for good in ["root", "reviewer", "merge-agent", "gpt5", "a", "a-1-b"] {
        assert!(is_valid_agent_slug(good), "`{good}` is a well-formed slug");
    }
    for bad in [
        "",
        "Root",
        "merge agent",
        "merge_agent",
        "-lead",
        "lead-",
        "a--b",
        "réviseur",
        "a.b",
    ] {
        assert!(!is_valid_agent_slug(bad), "`{bad}` is not a slug");
    }
}

/// Two profiles at one address is not a cosmetic clash: every reference resolves to the
/// first, so the second is a profile nothing could ever name.
#[test]
fn a_repeated_slug_is_reported_once_however_many_profiles_carry_it() {
    let set = GgCapabilitySet {
        agents: vec![
            GgAgentConfig::root(),
            GgAgentConfig {
                slug: "reviewer".to_string(),
                ..GgAgentConfig::root()
            },
            GgAgentConfig {
                slug: "reviewer".to_string(),
                ..GgAgentConfig::root()
            },
            GgAgentConfig {
                slug: "reviewer".to_string(),
                ..GgAgentConfig::root()
            },
        ],
        ..GgCapabilitySet::default()
    };
    assert_eq!(set.duplicate_agent_slugs(), vec!["reviewer"]);
    assert!(
        GgCapabilitySet::default()
            .duplicate_agent_slugs()
            .is_empty()
    );
}

/// **The whole reason a profile's identity is in two halves.** Two profiles sharing a slug is
/// a defect the operator has to clear, and clearing it means opening the *second* one and
/// renaming it — so both have to stay separately addressable while the collision stands. The
/// internal ids underneath are what keeps them apart: the slug lookup can only ever answer with
/// the first, while each id still names exactly one.
///
/// This is not a hypothetical shape. A configuration that imports a saved agent follows that
/// agent's slug, and the saved agent may be renamed afterwards onto a slug the configuration
/// already uses — the collision arrives without either document being edited.
#[test]
fn two_profiles_at_one_slug_stay_separately_addressable_by_their_internal_ids() {
    let set = GgCapabilitySet {
        agents: vec![
            GgAgentConfig {
                id: Some("k-root".to_string()),
                ..GgAgentConfig::root()
            },
            GgAgentConfig {
                id: Some("k-mine".to_string()),
                slug: "reviewer".to_string(),
                name: "My Reviewer".to_string(),
                ..GgAgentConfig::root()
            },
            GgAgentConfig {
                id: Some("k-imported".to_string()),
                slug: "reviewer".to_string(),
                name: "Imported Reviewer".to_string(),
                ..GgAgentConfig::root()
            },
        ],
        ..GgCapabilitySet::default()
    };

    assert_eq!(set.duplicate_agent_slugs(), vec!["reviewer"]);
    // The slug resolves to the first of the two, which is precisely why the collision is a
    // refusal: the second is a profile nothing could name by slug.
    assert_eq!(
        set.agent("reviewer").map(|a| a.name.as_str()),
        Some("My Reviewer")
    );
    // …and yet the console can still open, rename or delete either one, because each id is
    // unambiguous however the slugs collide.
    assert_eq!(
        set.agent_by_key("k-mine").map(|a| a.name.as_str()),
        Some("My Reviewer")
    );
    assert_eq!(
        set.agent_by_key("k-imported").map(|a| a.name.as_str()),
        Some("Imported Reviewer")
    );
    // The ids themselves are distinct, so this set's only defect is the one an operator wrote.
    assert!(set.duplicate_agent_keys().is_empty());
}

/// An internal id is minted rather than written, so a repeat is a document that was assembled
/// wrongly — but it is the one thing that makes a reference in an authored configuration
/// ambiguous, which is why it is reported at all rather than shrugged off as untidy.
#[test]
fn two_profiles_at_one_internal_id_are_reported_however_they_are_named() {
    let set = GgCapabilitySet {
        agents: vec![
            GgAgentConfig {
                id: Some("k-root".to_string()),
                ..GgAgentConfig::root()
            },
            GgAgentConfig {
                id: Some("k-twin".to_string()),
                slug: "reviewer".to_string(),
                ..GgAgentConfig::root()
            },
            GgAgentConfig {
                id: Some("k-twin".to_string()),
                slug: "merge-agent".to_string(),
                ..GgAgentConfig::root()
            },
        ],
        ..GgCapabilitySet::default()
    };

    // Distinct slugs throughout: the two halves of the identity are checked independently, so
    // a document that is sound by every name the operator wrote can still be one gg refuses.
    assert!(set.duplicate_agent_slugs().is_empty());
    assert_eq!(set.duplicate_agent_keys(), vec!["k-twin"]);
    // A launched set carries no ids at all, so it can never earn this defect.
    assert!(set.resolve_agent_keys().duplicate_agent_keys().is_empty());
}

/// The two lookups read the two halves of the identity and **nothing else**: a set in which one
/// profile's slug happens to spell another's internal id resolves each name to the profile that
/// actually carries it.
///
/// The ids are opaque, so nothing stops one from colliding with somebody's slug, and the two
/// resolvers are used at different moments — `agent_by_key` while the configuration is authored,
/// `agent` everywhere afterwards. A lookup that fell back from one to the other would silently
/// hand a launch the wrong profile's model, prompt and capabilities.
#[test]
fn a_slug_and_an_internal_id_that_spell_the_same_text_resolve_to_their_own_profiles() {
    let set = GgCapabilitySet {
        agents: vec![
            GgAgentConfig {
                id: Some("k-root".to_string()),
                ..GgAgentConfig::root()
            },
            GgAgentConfig {
                // Its *slug* is the text that the next profile carries as its *id*.
                id: Some("k-scout".to_string()),
                slug: "reviewer".to_string(),
                name: "The Scout".to_string(),
                ..GgAgentConfig::root()
            },
            GgAgentConfig {
                id: Some("reviewer".to_string()),
                slug: "merge-agent".to_string(),
                name: "The Merger".to_string(),
                ..GgAgentConfig::root()
            },
        ],
        ..GgCapabilitySet::default()
    };

    assert_eq!(
        set.agent("reviewer").map(|a| a.name.as_str()),
        Some("The Scout")
    );
    assert_eq!(
        set.agent_by_key("reviewer").map(|a| a.name.as_str()),
        Some("The Merger")
    );
    // And neither resolver falls back to the other: a slug nothing declares stays unresolved
    // even though a profile carries it as an id, and the reverse.
    assert!(set.agent("k-scout").is_none());
    assert!(set.agent_by_key("merge-agent").is_none());
}

/// **The launch resolution**, which is the moment a profile's two names become one. Every
/// reference an authored configuration points at an internal id — a roster entry, the merge
/// agent, a machine's state — is rewritten to the target's slug, and the ids are dropped, so the
/// set gg reads, the container runs and the run records names profiles by the one name the
/// operator wrote and the model was shown.
///
/// A reference naming an id the set does not declare is left **exactly as written**. It is the
/// one thing resolution must not tidy up: the launch check reports it as the dangling reference
/// it is, and a resolution that dropped it or guessed at it would leave nothing to report and a
/// run strictly smaller than the one written down.
#[test]
fn resolving_a_launch_rewrites_every_reference_to_a_slug_and_drops_the_ids() {
    let authored = GgCapabilitySet {
        agents: vec![
            GgAgentConfig {
                id: Some("k-root".to_string()),
                subagents: vec![
                    GgSubagentRef::new("k-reviewer", &[GgSubagentScope::Subagent]),
                    // Points at nothing this set declares, and must survive verbatim.
                    GgSubagentRef::new("k-ghost", &[GgSubagentScope::Reviewer]),
                ],
                capabilities: vec![
                    GgCapabilityConfig::enabled(CAPABILITY_PROJECT_MANAGEMENT)
                        .with_param(PROJECT_MANAGEMENT_PARAM_MERGE_AGENT, "k-reviewer"),
                    GgCapabilityConfig::enabled(CAPABILITY_FSM).with_param(
                        FSM_PARAM_STATES,
                        json!([
                            { "name": "review", "agentId": "k-reviewer" },
                            { "name": "haunt", "agentId": "k-ghost" },
                        ]),
                    ),
                ],
                ..GgAgentConfig::root()
            },
            GgAgentConfig {
                id: Some("k-reviewer".to_string()),
                slug: "careful-reviewer".to_string(),
                name: "Careful Reviewer".to_string(),
                model_id: "anthropic/claude-haiku-4.5".to_string(),
                ..GgAgentConfig::root()
            },
        ],
        model_slots: vec![GgConfigSlot {
            name: "cheap".to_string(),
            default_model_id: None,
            targets: Vec::new(),
        }],
        ..GgCapabilitySet::default()
    };

    let launched = authored.resolve_agent_keys();

    // Not one profile still carries an id, which is what gg checks for before it resolves
    // anything by slug.
    assert!(launched.agents.iter().all(|agent| agent.id.is_none()));
    assert!(launched.unresolved_agent_keys().is_empty());
    // The three references, each now naming the slug the model is shown.
    let root = launched.root();
    assert_eq!(root.subagents[0].agent_id, "careful-reviewer");
    let merge = root
        .capability(CAPABILITY_PROJECT_MANAGEMENT)
        .expect("the merge agent's capability survives resolution")
        .params[PROJECT_MANAGEMENT_PARAM_MERGE_AGENT]
        .clone();
    assert_eq!(merge, json!("careful-reviewer"));
    let states = root
        .capability(CAPABILITY_FSM)
        .expect("the machine survives resolution")
        .params[FSM_PARAM_STATES]
        .clone();
    assert_eq!(states[0]["agentId"], json!("careful-reviewer"));
    // The reference to an id nothing declares is untouched in all three places…
    assert_eq!(root.subagents[1].agent_id, "k-ghost");
    assert_eq!(states[1]["agentId"], json!("k-ghost"));
    // …and the launch check has something to report it by.
    assert!(launched.agent("k-ghost").is_none());

    // Resolving also spends the slot table: a launch fills every input in, so a launched set
    // has no mapping left to resolve anything by.
    assert!(launched.model_slots.is_empty());
    // Everything the resolution has no business touching is carried through untouched.
    assert_eq!(launched.limits, authored.limits);
    assert_eq!(launched.agents[1].model_id, "anthropic/claude-haiku-4.5");
    assert_eq!(launched.agents[1].slug, "careful-reviewer");
}

/// The one set of models a run is launched with: the configuration's own slots first, in
/// declaration order, then every passthrough agent slot under the name that keeps it
/// distinct from every other input.
#[test]
fn a_launch_asks_for_the_configuration_slots_and_then_the_passthrough_ones() {
    let set = GgCapabilitySet {
        agents: vec![
            GgAgentConfig {
                id: Some("k-root".to_string()),
                model_slot: Some("brain".to_string()),
                model_slots: vec![GgModelSlot {
                    name: "brain".to_string(),
                    default_model_id: Some("anthropic/opus".to_string()),
                    passthrough: true,
                }],
                ..GgAgentConfig::root()
            },
            GgAgentConfig {
                id: Some("k-reviewer".to_string()),
                slug: "reviewer".to_string(),
                model_slot: Some("critic".to_string()),
                model_slots: vec![GgModelSlot {
                    name: "critic".to_string(),
                    default_model_id: Some("anthropic/haiku".to_string()),
                    passthrough: false,
                }],
                ..GgAgentConfig::root()
            },
        ],
        // Slots live only in an authored configuration, so a target names the profile's
        // internal id rather than the slug the launch will rewrite everything else to.
        model_slots: vec![GgConfigSlot {
            name: "cheap".to_string(),
            default_model_id: None,
            targets: vec![GgSlotTarget {
                agent: "k-reviewer".to_string(),
                slot: "critic".to_string(),
            }],
        }],
        ..GgCapabilitySet::default()
    };

    let inputs = set.launch_slots();
    assert_eq!(
        inputs.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(),
        vec!["cheap", "root.brain"],
    );
    // A configuration slot with no default of its own takes the default of the first agent
    // slot it fills, so importing an agent that defaulted its slot keeps that default.
    assert_eq!(
        inputs[0].default_model_id.as_deref(),
        Some("anthropic/haiku")
    );
    assert_eq!(
        inputs[1].default_model_id.as_deref(),
        Some("anthropic/opus")
    );
    // A passthrough input is *labelled* by the slug, because that is the name an operator
    // reads on the launch form, and *targeted* by the internal id, because that is what a
    // target names everywhere else. The two are spelled differently here so a resolution
    // that confused them could not pass.
    assert_eq!(inputs[1].name, "root.brain");
    assert_eq!(inputs[1].targets[0].agent, "k-root");
    assert_eq!(inputs[1].targets[0].slot, "brain");
    assert!(set.slot_defects().is_empty(), "{:?}", set.slot_defects());
}

/// An agent slot reaches the launch form exactly one way. Each of the four ways that can
/// go wrong is reported, and a sound mapping reports nothing.
#[test]
fn an_agent_slot_reaches_exactly_one_launch_input() {
    let with = |passthrough: bool, targets: Vec<GgSlotTarget>| GgCapabilitySet {
        agents: vec![GgAgentConfig {
            id: Some("k-root".to_string()),
            model_slot: Some("brain".to_string()),
            model_slots: vec![GgModelSlot {
                name: "brain".to_string(),
                default_model_id: None,
                passthrough,
            }],
            ..GgAgentConfig::root()
        }],
        model_slots: targets
            .into_iter()
            .enumerate()
            .map(|(i, target)| GgConfigSlot {
                name: format!("input-{i}"),
                default_model_id: None,
                targets: vec![target],
            })
            .collect(),
        ..GgCapabilitySet::default()
    };
    // A slot target names the profile's internal id, never its slug: slots exist only while
    // the configuration is authored, which is the one form that still carries the ids.
    let brain = || GgSlotTarget {
        agent: "k-root".to_string(),
        slot: "brain".to_string(),
    };

    // Neither passthrough nor mapped: the binding has no model to take.
    let orphan = with(false, Vec::new()).slot_defects();
    assert_eq!(orphan.len(), 1, "{orphan:?}");
    assert!(orphan[0].contains("reaches no launch input"), "{orphan:?}");

    // Both: a launch would ask for one binding twice.
    let doubled = with(true, vec![brain()]).slot_defects();
    assert!(
        doubled.iter().any(|d| d.contains("passthrough")),
        "{doubled:?}"
    );

    // Two configuration slots onto one agent slot: which one supplies it is unanswerable.
    let twice = with(false, vec![brain(), brain()]).slot_defects();
    assert!(
        twice.iter().any(|d| d.contains("2 configuration slots")),
        "{twice:?}"
    );

    // Mapped exactly once, and passthrough exactly once, are both sound.
    assert!(with(false, vec![brain()]).slot_defects().is_empty());
    assert!(with(true, Vec::new()).slot_defects().is_empty());
}

/// A configuration slot naming a profile or a slot the set does not declare, and a binding
/// deferring to a slot its own agent does not declare, are both refusals rather than
/// bindings gg would quietly leave empty.
#[test]
fn a_slot_reference_that_names_nothing_is_refused() {
    let dangling = GgCapabilitySet {
        agents: vec![GgAgentConfig::root()],
        model_slots: vec![GgConfigSlot {
            name: "cheap".to_string(),
            default_model_id: None,
            targets: vec![GgSlotTarget {
                agent: "reviewer".to_string(),
                slot: "critic".to_string(),
            }],
        }],
        ..GgCapabilitySet::default()
    };
    assert!(
        dangling
            .slot_defects()
            .iter()
            .any(|d| d.contains("which this configuration does not declare")),
        "{:?}",
        dangling.slot_defects()
    );

    let undeclared = GgCapabilitySet {
        agents: vec![GgAgentConfig {
            model_slot: Some("brain".to_string()),
            ..GgAgentConfig::root()
        }],
        ..GgCapabilitySet::default()
    };
    assert!(
        undeclared
            .slot_defects()
            .iter()
            .any(|d| d.contains("does not declare as a model slot")),
        "{:?}",
        undeclared.slot_defects()
    );
}

/// A launch asks for one model per input, so two inputs at one name is one model where the
/// operator meant two.
#[test]
fn two_launch_inputs_at_one_name_are_refused() {
    let set = GgCapabilitySet {
        agents: vec![GgAgentConfig {
            id: Some("k-root".to_string()),
            model_slot: Some("brain".to_string()),
            model_slots: vec![GgModelSlot {
                name: "brain".to_string(),
                default_model_id: None,
                passthrough: true,
            }],
            ..GgAgentConfig::root()
        }],
        // Named exactly as the passthrough slot is exposed — after the profile's **slug**,
        // which is what the launch form labels a passthrough input by however the authored
        // document refers to that profile internally. That is the only way the two halves of
        // the launch form can collide.
        model_slots: vec![GgConfigSlot {
            name: passthrough_slot_name(ROOT_PROFILE_ID, "brain"),
            default_model_id: None,
            targets: Vec::new(),
        }],
        ..GgCapabilitySet::default()
    };
    let defects = set.slot_defects();
    assert!(
        defects
            .iter()
            .any(|d| d.contains("two launch inputs are named `root.brain`")),
        "{defects:?}"
    );
}

/// A configuration held for authoring: a root whose own binding is deferred to a passthrough
/// slot, a reviewer whose turns *and* whose compaction handoff are both filled by one
/// configuration slot, and a judge the configuration pinned itself.
///
/// The three shapes a launch has to bind differently, in one document, so a binder that
/// confused any two of them could not pass.
fn deferred_configuration() -> GgCapabilitySet {
    GgCapabilitySet {
        preset: Some("critic-sweep".to_string()),
        preset_id: Some("cfg-critic-sweep".to_string()),
        agents: vec![
            GgAgentConfig {
                id: Some("k-root".to_string()),
                model_slot: Some("brain".to_string()),
                model_slots: vec![GgModelSlot {
                    name: "brain".to_string(),
                    default_model_id: None,
                    passthrough: true,
                }],
                ..GgAgentConfig::root()
            },
            GgAgentConfig {
                id: Some("k-reviewer".to_string()),
                slug: "reviewer".to_string(),
                name: "Reviewer".to_string(),
                model_slot: Some("primary".to_string()),
                capabilities: vec![
                    GgCapabilityConfig {
                        implementation: Some(COMPACTION_STRATEGY_HANDOFF_SUMMARIZATION.to_string()),
                        ..GgCapabilityConfig::enabled(CAPABILITY_COMPACTION)
                    }
                    .with_param(COMPACTION_PARAM_MODEL_SLOT, "summarizer"),
                ],
                model_slots: vec![
                    GgModelSlot {
                        name: "primary".to_string(),
                        default_model_id: None,
                        passthrough: false,
                    },
                    GgModelSlot {
                        name: "summarizer".to_string(),
                        default_model_id: None,
                        passthrough: false,
                    },
                ],
                ..GgAgentConfig::root()
            },
            GgAgentConfig {
                id: Some("k-judge".to_string()),
                slug: "judge".to_string(),
                name: "Judge".to_string(),
                model_id: "openai/o-fixed".to_string(),
                ..GgAgentConfig::root()
            },
        ],
        // One input for both of the reviewer's slots — the mapping only a configuration slot
        // can express, and the reason a binder cannot simply read each agent's own slot.
        model_slots: vec![GgConfigSlot {
            name: "critic".to_string(),
            default_model_id: None,
            targets: vec![
                GgSlotTarget {
                    agent: "k-reviewer".to_string(),
                    slot: "primary".to_string(),
                },
                GgSlotTarget {
                    agent: "k-reviewer".to_string(),
                    slot: "summarizer".to_string(),
                },
            ],
        }],
        ..GgCapabilitySet::default()
    }
}

/// One agent's compaction params out of a set, or an empty object when it declares none.
fn compaction_params(set: &GgCapabilitySet, slug: &str) -> Value {
    set.agent(slug)
        .and_then(|agent| agent.capability(CAPABILITY_COMPACTION))
        .map(|capability| capability.params.clone())
        .unwrap_or_else(|| json!({}))
}

/// Every deferred binding resolves through the launch input that fills its slot — the agent's
/// own, and the compaction param the run actually reads — and what comes back is fully pinned.
#[test]
fn a_launch_binds_every_deferred_binding_through_its_input() {
    let configured = deferred_configuration();
    assert!(
        configured.slot_defects().is_empty(),
        "{:?}",
        configured.slot_defects()
    );

    let launched = configured.bind_launch_slots(&BTreeMap::from([
        ("root.brain".to_string(), "openai/gpt-5.6-sol".to_string()),
        (
            "critic".to_string(),
            "anthropic/claude-haiku-4.5".to_string(),
        ),
    ]));

    assert_eq!(
        launched
            .agents
            .iter()
            .map(|agent| (agent.slug.as_str(), agent.model_id.as_str()))
            .collect::<Vec<_>>(),
        vec![
            // Filled by the passthrough input, which is labelled by the slug and targeted by
            // the internal id — so a binder that resolved it by either name alone would miss.
            ("root", "openai/gpt-5.6-sol"),
            ("reviewer", "anthropic/claude-haiku-4.5"),
            // A binding the configuration pinned itself was decided when the configuration was
            // written and is never asked about again.
            ("judge", "openai/o-fixed"),
        ],
    );
    // The handoff, resolved through the same input as the agent's own turns and rewritten to
    // the `model` key gg reads. The catalog's other compaction params are still standing.
    let params = compaction_params(&launched, "reviewer");
    assert_eq!(
        params[COMPACTION_PARAM_MODEL],
        json!("anthropic/claude-haiku-4.5")
    );
    assert_eq!(params.get(COMPACTION_PARAM_MODEL_SLOT), None);
    assert!(
        params.as_object().is_some_and(|params| params.len() > 1),
        "{params:?}"
    );
    // What runs is fully pinned: neither level declares a slot any more, so nothing downstream
    // of the launch has a deferral left to resolve…
    assert!(launched.model_slots.is_empty());
    assert!(
        launched
            .agents
            .iter()
            .all(|agent| agent.model_slot.is_none() && agent.model_slots.is_empty())
    );
    assert!(launched.unresolved_agents().is_empty());
    // …and everything the binding has no business touching is carried through untouched —
    // the configuration's id included, which is what the run is attributed to.
    assert_eq!(launched.preset.as_deref(), Some("critic-sweep"));
    assert_eq!(launched.preset_id.as_deref(), Some("cfg-critic-sweep"));
    assert_eq!(launched.limits, configured.limits);
    assert_eq!(launched.agents[1].name, "Reviewer");
}

/// An input the launcher left blank binds *nothing* rather than a model id of `""`.
///
/// The agent stays unresolved, which is the launch refusal it should be, and the handoff param
/// goes back to being absent, which is the documented arm where the agent condenses on its own
/// model. Both are settings a caller can read; a model called `""` is neither.
#[test]
fn an_unfilled_launch_input_leaves_its_bindings_unresolved() {
    let launched = deferred_configuration().bind_launch_slots(&BTreeMap::from([(
        "root.brain".to_string(),
        "openai/gpt-5.6-sol".to_string(),
    )]));

    assert_eq!(launched.root().model_id, "openai/gpt-5.6-sol");
    assert_eq!(
        launched.agent("reviewer").map(|a| a.model_id.as_str()),
        Some("")
    );
    assert_eq!(launched.unresolved_agents(), vec!["Reviewer"]);
    // The unfilled handoff is absent rather than empty, and the rest of the params object is
    // untouched — the arm it names is "condense on the agent's own model".
    let params = compaction_params(&launched, "reviewer");
    assert_eq!(params.get(COMPACTION_PARAM_MODEL), None);
    assert_eq!(params.get(COMPACTION_PARAM_MODEL_SLOT), None);
    // The set the run would record is still fully pinned in shape; it is the *bindings* that
    // are outstanding, and `unresolved_agents` is what says so.
    assert!(launched.model_slots.is_empty());
    assert!(
        launched
            .agents
            .iter()
            .all(|agent| agent.model_slot.is_none())
    );
}

/// A model the configuration pinned itself is never overwritten by a launch input, at either
/// level: the agent's own binding, and a handoff naming a model rather than a slot.
#[test]
fn a_launch_leaves_a_pinned_binding_alone() {
    let pinned = GgCapabilitySet {
        agents: vec![GgAgentConfig {
            id: Some("k-root".to_string()),
            model_id: "openai/o-fixed".to_string(),
            capabilities: vec![
                GgCapabilityConfig {
                    implementation: Some(COMPACTION_STRATEGY_HANDOFF_SUMMARIZATION.to_string()),
                    ..GgCapabilityConfig::enabled(CAPABILITY_COMPACTION)
                }
                .with_param(COMPACTION_PARAM_MODEL, "vendor/pinned"),
            ],
            ..GgAgentConfig::root()
        }],
        ..GgCapabilitySet::default()
    };

    // A set that declares no slot asks for no input, so a launcher offering one is answering a
    // question this configuration never posed.
    assert!(pinned.launch_slots().is_empty());
    let launched = pinned.bind_launch_slots(&BTreeMap::from([
        ("root.brain".to_string(), "vendor/ignored".to_string()),
        ("critic".to_string(), "vendor/ignored".to_string()),
    ]));

    assert_eq!(launched.root().model_id, "openai/o-fixed");
    assert_eq!(
        compaction_params(&launched, ROOT_PROFILE_ID)[COMPACTION_PARAM_MODEL],
        json!("vendor/pinned")
    );
}

/// The gg half of a coverage cell's identity: which agent runs which model, sorted and
/// de-duplicated, so a set recorded by a run and the same set lifted onto a queued job compare
/// equal whatever order their agents are declared in.
#[test]
fn the_bound_model_key_is_order_free_and_counts_the_handoff() {
    let launched = deferred_configuration().bind_launch_slots(&BTreeMap::from([
        ("root.brain".to_string(), "openai/gpt-5.6-sol".to_string()),
        (
            "critic".to_string(),
            "anthropic/claude-haiku-4.5".to_string(),
        ),
    ]));

    // Agent order is root, reviewer, judge; the key is alphabetical, and the reviewer's handoff
    // model is the same id its turns run on, so it is named once rather than twice.
    assert_eq!(
        launched.bound_model_ids(),
        vec![
            "openai/gpt-5.6-sol",
            "anthropic/claude-haiku-4.5",
            "openai/o-fixed",
        ]
    );
    assert_eq!(
        launched.bound_model_key(),
        "judge=openai/o-fixed,\
         reviewer:compaction=anthropic/claude-haiku-4.5,\
         reviewer=anthropic/claude-haiku-4.5,\
         root=openai/gpt-5.6-sol"
    );

    // Two members of one configuration differing only on the reviewer's model are two arms, and
    // the key is what keeps their cells apart.
    let other = deferred_configuration().bind_launch_slots(&BTreeMap::from([
        ("root.brain".to_string(), "openai/gpt-5.6-sol".to_string()),
        ("critic".to_string(), "vendor/second-opinion".to_string()),
    ]));
    assert_ne!(other.bound_model_key(), launched.bound_model_key());

    // A set with nothing bound at all names nothing, rather than a key of one empty segment.
    assert_eq!(GgCapabilitySet::default().bound_model_key(), "");
}

/// Two members that swap one configuration's models between its two launch slots bind the same
/// models to different agents. They are the two arms of a study, so their keys — and therefore
/// their coverage cells — have to differ.
#[test]
fn the_bound_model_key_separates_two_arms_that_swap_their_models() {
    let bind = |first: &str, second: &str| {
        two_slot_configuration()
            .bind_launch_slots(&BTreeMap::from([
                ("reviewer".to_string(), first.to_string()),
                ("tester".to_string(), second.to_string()),
            ]))
            .bound_model_key()
    };

    assert_eq!(
        bind("anthropic/opus", "anthropic/haiku"),
        "reviewer=anthropic/opus,root=openai/o-fixed,tester=anthropic/haiku"
    );
    assert_ne!(
        bind("anthropic/opus", "anthropic/haiku"),
        bind("anthropic/haiku", "anthropic/opus"),
        "swapping the two models between the two slots is the other arm, not the same cell",
    );
}

/// A configuration whose root pins its own model and whose two subagents each take one launch
/// slot — the shape a two-arm study is written in.
fn two_slot_configuration() -> GgCapabilitySet {
    let subagent = |slug: &str| GgAgentConfig {
        id: Some(format!("k-{slug}")),
        slug: slug.to_string(),
        name: slug.to_string(),
        model_id: String::new(),
        model_slot: Some("primary".to_string()),
        model_slots: vec![GgModelSlot {
            name: "primary".to_string(),
            default_model_id: None,
            passthrough: false,
        }],
        ..GgAgentConfig::root()
    };
    GgCapabilitySet {
        preset: Some("panel".to_string()),
        agents: vec![
            GgAgentConfig {
                id: Some("k-root".to_string()),
                model_id: "openai/o-fixed".to_string(),
                ..GgAgentConfig::root()
            },
            subagent("reviewer"),
            subagent("tester"),
        ],
        model_slots: vec![
            GgConfigSlot {
                name: "reviewer".to_string(),
                default_model_id: None,
                targets: vec![GgSlotTarget {
                    agent: "k-reviewer".to_string(),
                    slot: "primary".to_string(),
                }],
            },
            GgConfigSlot {
                name: "tester".to_string(),
                default_model_id: None,
                targets: vec![GgSlotTarget {
                    agent: "k-tester".to_string(),
                    slot: "primary".to_string(),
                }],
            },
        ],
        ..GgCapabilitySet::default()
    }
}
