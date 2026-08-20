use super::*;

/// The internal id an authored fixture mints for the profile whose slug is `slug` — deliberately
/// not the slug itself, so a test can tell the two halves of a profile's identity apart.
fn key_of(slug: &str) -> String {
    format!("k-{slug}")
}

/// `set` as an operator's console **authors** it: every profile carrying the internal id that
/// every reference in a stored configuration points at.
///
/// A stored configuration is always in this shape — it is the shape references can be rewritten
/// *from* — so a set without the ids is one [`config_from_input`] refuses. A profile that already
/// carries an id keeps it, so a fixture about a colliding id can write its own.
fn authored(mut set: GgCapabilitySet) -> GgCapabilitySet {
    for agent in &mut set.agents {
        if agent.id.is_none() {
            agent.id = Some(key_of(&agent.slug));
        }
    }
    set
}

/// A second profile beside the root, carrying `slug` and bound to the same model.
fn profile(slug: &str) -> test_cabinet_core::gg::GgAgentConfig {
    test_cabinet_core::gg::GgAgentConfig {
        slug: slug.to_string(),
        name: slug.to_string(),
        model_id: "mock/echo".to_string(),
        ..test_cabinet_core::gg::GgAgentConfig::root()
    }
}

/// A save body: a named configuration carrying the minimal capability set.
fn sample_input(name: &str) -> GgConfigInput {
    GgConfigInput {
        name: name.to_string(),
        description: "  the default arm  ".to_string(),
        capability_set: authored(GgCapabilitySet::minimal("mock/echo")),
        agent_sources: Vec::new(),
    }
}

#[test]
fn config_from_input_keeps_its_agent_sources() {
    // Where an imported agent came from is stored beside the resolved set: gg reads the
    // set, the console reads these to know which fields still follow the saved agent.
    let input = GgConfigInput {
        agent_sources: vec![GgAgentSource {
            profile_id: "reviewer".to_string(),
            agent_id: "a1".to_string(),
            overrides: vec!["customInstructions".to_string()],
        }],
        ..sample_input("review arm")
    };
    let config = config_from_input("c1".to_string(), input, "2026-07-24T00:00:00Z").unwrap();
    assert_eq!(config.agent_sources.len(), 1);
    // Both ends of the reference survive the save: which profile in the set was imported,
    // and which library entry it follows.
    assert_eq!(config.agent_sources[0].profile_id, "reviewer");
    assert_eq!(config.agent_sources[0].agent_id, "a1");
    assert_eq!(config.agent_sources[0].overrides, ["customInstructions"]);
}

#[test]
fn config_from_input_trims_the_name_and_description() {
    let input = GgConfigInput {
        name: "  minimal  ".to_string(),
        ..sample_input("ignored")
    };
    let config = config_from_input("c1".to_string(), input, "2026-07-24T00:00:00Z").unwrap();
    assert_eq!(config.id, "c1");
    assert_eq!(config.name, "minimal");
    assert_eq!(config.description, "the default arm");
    assert_eq!(config.updated_at, "2026-07-24T00:00:00Z");
}

#[test]
fn config_from_input_rejects_a_blank_name() {
    let input = GgConfigInput {
        name: "   ".to_string(),
        ..sample_input("ignored")
    };
    let err = config_from_input("c1".to_string(), input, "2026-07-24T00:00:00Z").unwrap_err();
    assert_eq!(err.status, StatusCode::BAD_REQUEST);
}

#[test]
fn config_from_input_rejects_an_overlong_name() {
    let input = GgConfigInput {
        name: "n".repeat(MAX_NAME_LEN + 1),
        ..sample_input("ignored")
    };
    let err = config_from_input("c1".to_string(), input, "2026-07-24T00:00:00Z").unwrap_err();
    assert_eq!(err.status, StatusCode::BAD_REQUEST);
}

#[test]
fn config_from_input_rejects_an_overlong_description() {
    let input = GgConfigInput {
        description: "d".repeat(MAX_DESCRIPTION_LEN + 1),
        ..sample_input("minimal")
    };
    let err = config_from_input("c1".to_string(), input, "2026-07-24T00:00:00Z").unwrap_err();
    assert_eq!(err.status, StatusCode::BAD_REQUEST);
}

#[test]
fn config_from_input_keeps_an_unbound_capability_set() {
    // A saved configuration is reusable across models, so — unlike a launch — it may
    // leave the primary slot unbound; the new-run form binds it per run.
    let input = GgConfigInput {
        capability_set: authored(GgCapabilitySet::default()),
        ..sample_input("skeleton")
    };
    let config = config_from_input("c1".to_string(), input, "2026-07-24T00:00:00Z").unwrap();
    assert!(config.capability_set.root().resolved_model_id().is_none());
}

// ---------------------------------------------------------------------------
// The authored shape a configuration is stored in
// ---------------------------------------------------------------------------

/// **A stored configuration is the authored shape, and it is checked as one.** Every reference
/// inside it — a roster entry, the merge agent, a machine's state, a slot target — points at a
/// profile's internal id, which is what makes renaming a profile free and importing one safe. So a
/// profile arriving without an id is a document whose references have nothing to point at, and two
/// profiles sharing one is a document in which every reference to it names both.
///
/// Neither is something to mint or de-duplicate on the operator's behalf: an id is minted once when
/// the profile is created and never rewritten, so a set short of one — or carrying one twice — was
/// assembled by something that got the contract wrong, and storing it would bake a reference
/// resolving to the wrong profile into a configuration a whole sweep shares.
#[test]
fn an_authored_set_is_refused_unless_every_profile_carries_its_own_internal_id() {
    let mut missing = GgCapabilitySet::minimal("mock/echo");
    missing.agents.push(profile("reviewer"));
    missing.agents[0].id = Some(key_of("root"));
    // …and the second profile carries none.
    let defect = authored_capability_set_defect(&missing).expect("an id-less profile is refused");
    assert!(
        defect.contains("no internal id"),
        "unexpected defect: {defect}"
    );
    assert!(defect.contains("reviewer"), "unexpected defect: {defect}");

    // A blank id is the same defect wearing a nicer hat: it is text nothing can resolve by.
    let mut blank = authored(GgCapabilitySet::minimal("mock/echo"));
    blank.agents[0].id = Some("   ".to_string());
    let defect = authored_capability_set_defect(&blank).expect("a blank id is refused");
    assert!(
        defect.contains("no internal id"),
        "unexpected defect: {defect}"
    );

    let mut twinned = GgCapabilitySet::minimal("mock/echo");
    twinned.agents.push(profile("reviewer"));
    for agent in &mut twinned.agents {
        agent.id = Some("k-twin".to_string());
    }
    let defect = authored_capability_set_defect(&twinned).expect("a repeated id is refused");
    assert!(defect.contains("k-twin"), "unexpected defect: {defect}");
    // Named as the ambiguity it is — a reference to it names both profiles — rather than as
    // untidiness.
    assert!(
        defect.contains("would name both"),
        "unexpected defect: {defect}"
    );
}

/// The other half of the identity is checked in the same pass, because a configuration stored
/// under rules the launch does not apply is one that saves cleanly and then cannot be run.
///
/// The slug is what the **model** is shown and passes back, and what every telemetry event,
/// accounting row and analysis query names a profile by afterwards. A malformed one is a name the
/// model would have to decide how to spell; a repeated one makes every one of those references
/// ambiguous. Both are the operator's to fix — which is why the message names the profile by
/// something they can find it under.
#[test]
fn an_authored_set_is_refused_for_a_malformed_or_repeated_slug() {
    let mut malformed = authored(GgCapabilitySet::minimal("mock/echo"));
    malformed.agents[0].slug = "The Root".to_string();
    let defect = authored_capability_set_defect(&malformed).expect("a malformed slug is refused");
    assert!(
        defect.contains("not lowercase letters and digits"),
        "unexpected defect: {defect}"
    );
    // By display name, because the slug is the very value that cannot be trusted to identify it.
    assert!(
        defect.contains(test_cabinet_core::gg::ROOT_AGENT),
        "unexpected defect: {defect}"
    );

    let mut repeated = GgCapabilitySet::minimal("mock/echo");
    repeated.agents.push(test_cabinet_core::gg::GgAgentConfig {
        // A distinct internal id: two genuinely separate profiles that came to spell one slug,
        // which is what an import following a renamed saved agent leaves behind.
        id: Some("k-imported".to_string()),
        ..profile(test_cabinet_core::gg::ROOT_PROFILE_ID)
    });
    let defect =
        authored_capability_set_defect(&authored(repeated)).expect("a repeated slug is refused");
    assert!(
        defect.contains("carry the slug"),
        "unexpected defect: {defect}"
    );
    assert!(
        defect.contains(test_cabinet_core::gg::ROOT_PROFILE_ID),
        "unexpected defect: {defect}"
    );
}

/// …and a sound authored set is stored without complaint — including one that binds no model at
/// all, which is the ordinary shape of a configuration meant to be reused across models. The
/// refusals above are about identity, and a set that has its identity right owes the save nothing
/// else: a launch, not a save, is where a binding has to be there.
#[test]
fn a_sound_authored_set_is_accepted() {
    let mut set = GgCapabilitySet::minimal("mock/echo");
    set.agents.push(profile("careful-reviewer"));
    set.agents.push(profile("merge-agent"));
    set.agents[0].subagents = vec![test_cabinet_core::gg::GgSubagentRef::new(
        key_of("careful-reviewer"),
        &[test_cabinet_core::gg::GgSubagentScope::Subagent],
    )];
    assert_eq!(authored_capability_set_defect(&authored(set)), None);

    // The unbound skeleton the console saves before anybody has picked a model for it.
    assert_eq!(
        authored_capability_set_defect(&authored(GgCapabilitySet::default())),
        None
    );
}
