use super::*;

/// A save body: one named agent profile, with the model slot its binding defers to.
fn sample_input(name: &str) -> GgSavedAgentInput {
    GgSavedAgentInput {
        description: "  reviews what the implementer wrote  ".to_string(),
        agent: GgAgentConfig {
            name: name.to_string(),
            model_slot: Some("critic".to_string()),
            ..GgAgentConfig::root()
        },
        model_slots: vec![GgModelSlot {
            name: "critic".to_string(),
            default_model_id: Some("mock/echo".to_string()),
        }],
    }
}

#[test]
fn agent_from_input_trims_the_name_and_description() {
    let agent = agent_from_input(
        "a1".to_string(),
        GgSavedAgentInput {
            agent: GgAgentConfig {
                name: "  reviewer  ".to_string(),
                ..sample_input("ignored").agent
            },
            ..sample_input("ignored")
        },
        "2026-08-18T00:00:00Z",
    )
    .unwrap();
    assert_eq!(agent.id, "a1");
    assert_eq!(agent.name, "reviewer");
    // The library's name is the agent's own, so the trim reaches both.
    assert_eq!(agent.agent.name, "reviewer");
    assert_eq!(agent.description, "reviews what the implementer wrote");
    assert_eq!(agent.updated_at, "2026-08-18T00:00:00Z");
}

#[test]
fn agent_from_input_rejects_a_blank_name() {
    let input = GgSavedAgentInput {
        agent: GgAgentConfig {
            name: "   ".to_string(),
            ..sample_input("ignored").agent
        },
        ..sample_input("ignored")
    };
    let err = agent_from_input("a1".to_string(), input, "2026-08-18T00:00:00Z").unwrap_err();
    assert_eq!(err.status, StatusCode::BAD_REQUEST);
}

#[test]
fn agent_from_input_rejects_an_overlong_name() {
    let input = GgSavedAgentInput {
        agent: GgAgentConfig {
            name: "n".repeat(MAX_NAME_LEN + 1),
            ..sample_input("ignored").agent
        },
        ..sample_input("ignored")
    };
    let err = agent_from_input("a1".to_string(), input, "2026-08-18T00:00:00Z").unwrap_err();
    assert_eq!(err.status, StatusCode::BAD_REQUEST);
}

#[test]
fn agent_from_input_rejects_an_overlong_description() {
    let input = GgSavedAgentInput {
        description: "d".repeat(MAX_DESCRIPTION_LEN + 1),
        ..sample_input("reviewer")
    };
    let err = agent_from_input("a1".to_string(), input, "2026-08-18T00:00:00Z").unwrap_err();
    assert_eq!(err.status, StatusCode::BAD_REQUEST);
}

#[test]
fn agent_from_input_keeps_a_deferred_model_binding() {
    // A saved agent is reusable across configurations, so its model binding may name a
    // slot the importing configuration declares rather than pinning a model here.
    let agent = agent_from_input(
        "a1".to_string(),
        sample_input("reviewer"),
        "2026-08-18T00:00:00Z",
    )
    .unwrap();
    assert_eq!(agent.agent.model_slot.as_deref(), Some("critic"));
    assert_eq!(agent.model_slots.len(), 1);
    assert_eq!(agent.model_slots[0].name, "critic");
}

#[test]
fn agent_from_input_keeps_the_profile_as_it_was_given() {
    // The saved agent is stored verbatim, so a configuration importing it and pinning
    // nothing is byte-identical to it — which is what the console's override derivation
    // depends on.
    let input = sample_input("reviewer");
    let expected = input.agent.clone();
    let agent = agent_from_input("a1".to_string(), input, "2026-08-18T00:00:00Z").unwrap();
    assert_eq!(agent.agent, expected);
}
