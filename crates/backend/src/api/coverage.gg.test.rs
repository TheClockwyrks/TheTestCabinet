//! Unit tests for the **gg** half of a coverage member: resolving a saved configuration,
//! binding its launch slots, what that does to a cell's identity and to the plan's order,
//! and what happens to a member nothing can launch.
//!
//! Split from `coverage.test.rs` — which covers the harness half and the scheduling walk —
//! rather than folded into it, because these need a fixture configuration that nothing else
//! in that file has any use for. The shared fixtures come from there.

use super::*;

use test_cabinet_core::gg::{
    GgAgentConfig, GgCapabilitySet, GgConfigSlot, GgModelSlot, GgSlotTarget,
};

use super::tests::{case, combo, combo_group, empty_ctx, member, order};

/// The internal id a fixture profile carries.
///
/// Deliberately not the slug: the two halves of a profile's identity are separate values,
/// and a fixture that spelled them the same could not tell a reference resolved from one
/// left alone.
fn key_of(slug: &str) -> String {
    format!("k-{slug}")
}

/// A saved configuration exposing **two** launch inputs: a configuration slot (`primary`)
/// filling the root agent's binding, and a passthrough slot on a second profile
/// (`reviewer.critic`).
///
/// Two, because one is not enough to show the properties that matter: a cell keyed on the
/// root model alone would merge two members that differ only on the reviewer's model, and a
/// launch that consulted only the configuration slot would leave the reviewer deferred.
fn gg_config(id: &str, name: &str) -> GgConfig {
    let mut set = GgCapabilitySet::minimal("");
    let root_key = key_of(&set.agents[0].slug);
    set.agents[0].id = Some(root_key.clone());
    set.agents[0].model_slot = Some("main".to_string());
    set.agents[0].model_slots = vec![GgModelSlot {
        name: "main".to_string(),
        default_model_id: None,
        passthrough: false,
    }];
    set.model_slots = vec![GgConfigSlot {
        name: "primary".to_string(),
        default_model_id: None,
        targets: vec![GgSlotTarget {
            agent: root_key,
            slot: "main".to_string(),
        }],
    }];
    set.agents.push(GgAgentConfig {
        id: Some(key_of("reviewer")),
        slug: "reviewer".to_string(),
        name: "reviewer".to_string(),
        model_slot: Some("critic".to_string()),
        model_slots: vec![GgModelSlot {
            name: "critic".to_string(),
            default_model_id: None,
            passthrough: true,
        }],
        ..GgAgentConfig::root()
    });
    GgConfig {
        id: id.to_string(),
        name: name.to_string(),
        description: String::new(),
        capability_set: set,
        agent_sources: Vec::new(),
        updated_at: "2026-08-15T00:00:00Z".to_string(),
    }
}

/// The account's gg library: the configurations it has saved, and no saved agents.
fn configs(list: Vec<GgConfig>) -> GgLibrary {
    GgLibrary::from_parts(list, Vec::new())
}

/// One saved configuration, `cfg-1` / "Critic sweep".
fn one_config() -> GgLibrary {
    configs(vec![gg_config("cfg-1", "Critic sweep")])
}

/// A gg member of `cfg-1` binding `root` to its primary slot and `critic` to the reviewer's,
/// named the way the console's picker values a configuration.
fn gg_combo(root: &str, critic: &str) -> ReviewPlanCombo {
    ReviewPlanCombo {
        harness: HarnessSlug::Gg,
        model: String::new(),
        provider: None,
        gg_config_id: Some("saved:cfg-1".to_string()),
        gg_slot_models: BTreeMap::from([
            ("primary".to_string(), root.to_string()),
            ("reviewer.critic".to_string(), critic.to_string()),
        ]),
        gg_config_name: None,
    }
}

/// The same member, resolved against the one saved configuration.
fn gg_member(root: &str, critic: &str) -> PlanMember {
    resolve_member(&gg_combo(root, critic), &one_config())
}

#[test]
fn a_gg_member_resolves_its_configuration_and_binds_every_launch_slot() {
    let resolved = gg_member("opus", "haiku");

    assert!(resolved.unlaunchable.is_none());
    // The read fills in what a client cannot derive: the configuration's current name, and
    // the model the run is actually attributed to — its root agent's.
    assert_eq!(
        resolved.combo.gg_config_name.as_deref(),
        Some("Critic sweep")
    );
    assert_eq!(resolved.combo.model, "opus");
    assert_eq!(resolved.launch_model, "opus");

    let gg = resolved.gg.expect("a resolved gg member carries its set");
    assert_eq!(gg.preset, "Critic sweep");
    // Which agent runs which model, sorted and de-duplicated — the identity a cell counts by.
    assert_eq!(gg.models, "reviewer=haiku,root=opus");
    // The set is the launched one: every binding pinned, no slot declarations left, and the
    // configuration's name recorded on it so the run files into the cell the matrix labelled.
    assert_eq!(gg.capability_set.preset.as_deref(), Some("Critic sweep"));
    assert!(gg.capability_set.model_slots.is_empty());
    assert!(gg.capability_set.unresolved_agents().is_empty());
    assert_eq!(gg.capability_set.agents[0].model_id, "opus");
    assert_eq!(gg.capability_set.agents[1].model_id, "haiku");
}

#[test]
fn a_bare_configuration_id_resolves_exactly_as_the_pickers_saved_prefix_does() {
    let bare = ReviewPlanCombo {
        gg_config_id: Some("cfg-1".to_string()),
        ..gg_combo("opus", "haiku")
    };
    let bare = resolve_member(&bare, &one_config());
    // Two spellings of one configuration must be one member, or a plan written through the
    // API and the same plan written in the console would be two arms of nothing.
    assert_eq!(bare.launch_model, gg_member("opus", "haiku").launch_model);
    assert_eq!(
        cell_key(&case("pong"), &bare),
        cell_key(&case("pong"), &gg_member("opus", "haiku"))
    );
}

#[test]
fn a_member_whose_configuration_is_gone_keeps_its_place_and_says_why() {
    let orphan = resolve_member(&gg_combo("opus", "haiku"), &GgLibrary::default());
    let reason = orphan
        .unlaunchable
        .as_deref()
        .expect("a member naming nothing cannot be launched");
    assert!(reason.contains("cfg-1"), "unexpected reason: {reason}");
    // No identity at all: a member nothing resolved must not borrow another cell's counts.
    assert!(orphan.launch_model.is_empty());
    assert!(orphan.gg.is_none());

    // And it is still a cell — in its declared place, carrying the reason.
    let cases = vec![case("pong")];
    let combos = vec![member(combo("opus")), orphan];
    let matrix = empty_ctx().matrix(3, CoverageAxis::Case, 10, &combos, &cases);
    assert_eq!(matrix.cells_total, 2);
    assert!(matrix.cells[0].unlaunchable.is_none());
    assert!(matrix.cells[1].unlaunchable.is_some());
    assert_eq!(matrix.cells[1].harness, HarnessSlug::Gg);
}

#[test]
fn an_unbound_launch_slot_is_refused_by_the_slot_that_is_empty() {
    let mut combo = gg_combo("opus", "haiku");
    combo.gg_slot_models.remove("reviewer.critic");
    let defect = gg_member_defect(&combo, &one_config()).expect("an unbound slot is a defect");
    // Both halves are what the reviewer has to go and change.
    assert!(defect.contains("reviewer.critic"), "unexpected: {defect}");
    assert!(defect.contains("Critic sweep"), "unexpected: {defect}");
    // A blank binding is an unbound one, not a model whose id happens to be empty.
    combo
        .gg_slot_models
        .insert("reviewer.critic".to_string(), "   ".to_string());
    assert!(gg_member_defect(&combo, &one_config()).is_some());
    // The resolver reaches the same verdict, so a member a plan refuses to store is exactly
    // a member the matrix would have refused to launch.
    assert!(resolve_member(&combo, &one_config()).unlaunchable.is_some());
}

#[test]
fn a_configuration_the_account_does_not_own_is_refused_by_id() {
    let defect = gg_member_defect(&gg_combo("opus", "haiku"), &GgLibrary::default())
        .expect("a configuration nobody owns is a defect");
    assert!(defect.contains("cfg-1"), "unexpected: {defect}");
    // A harness member has nothing to check.
    assert!(gg_member_defect(&combo("opus"), &GgLibrary::default()).is_none());
}

/// A saved agent, as the library holds it.
fn saved_agent(id: &str, name: &str, updated_at: &str) -> crate::api::GgSavedAgent {
    crate::api::GgSavedAgent {
        id: id.to_string(),
        name: name.to_string(),
        description: String::new(),
        agent: GgAgentConfig::root(),
        updated_at: updated_at.to_string(),
    }
}

/// `cfg-1`, but importing the saved agent `a-1` for its reviewer profile.
fn importing_config() -> GgConfig {
    let mut config = gg_config("cfg-1", "Critic sweep");
    config.agent_sources = vec![crate::api::GgAgentSource {
        profile_id: key_of("reviewer"),
        agent_id: "a-1".to_string(),
        overrides: Vec::new(),
    }];
    config
}

#[test]
fn a_configuration_whose_imported_agent_moved_on_is_not_launched_until_it_is_re_saved() {
    // The library's agent was edited after the configuration that imports it was last
    // saved. The stored capability set is therefore the *older* resolution — and the launch
    // form, which re-resolves the import on every read, would send the newer one. Launching
    // the stored one anyway would put a scheduled run in a different cell from the run the
    // very same member's "trigger" button produces, and neither would ever reach its target.
    let stale = GgLibrary::from_parts(
        vec![importing_config()],
        vec![saved_agent("a-1", "Reviewer", "2026-08-20T00:00:00Z")],
    );
    let member = resolve_member(&gg_combo("opus", "haiku"), &stale);
    let reason = member
        .unlaunchable
        .as_deref()
        .expect("a configuration behind its library is not launchable");
    assert!(reason.contains("Critic sweep"), "unexpected: {reason}");
    assert!(reason.contains("Reviewer"), "unexpected: {reason}");
    // The name still resolves: the member is reported, not orphaned.
    assert_eq!(member.combo.gg_config_name.as_deref(), Some("Critic sweep"));

    // Saved since — the stored set is the resolution the form would send, so it launches.
    let fresh = GgLibrary::from_parts(
        vec![importing_config()],
        vec![saved_agent("a-1", "Reviewer", "2026-08-01T00:00:00Z")],
    );
    assert!(
        resolve_member(&gg_combo("opus", "haiku"), &fresh)
            .unlaunchable
            .is_none()
    );

    // An import whose saved agent is gone is not drift: the console resolves such a profile
    // to the configuration's own copy, which is exactly what is stored.
    let deleted = GgLibrary::from_parts(vec![importing_config()], Vec::new());
    assert!(
        resolve_member(&gg_combo("opus", "haiku"), &deleted)
            .unlaunchable
            .is_none()
    );

    // And it is never a *storage* refusal: the fault appears long after the member was
    // written, so refusing the save would make an unrelated edit impossible.
    assert!(gg_member_defect(&gg_combo("opus", "haiku"), &stale).is_none());
}

#[test]
fn a_member_that_resolves_onto_another_members_cell_is_reported_rather_than_run_twice() {
    // Two configurations an account happens to have given one name, binding the same models
    // to the same agents. Nothing stops that — configuration names are not unique — and the
    // two produce one cell, because a cell is keyed by the name a run records.
    let twins = GgLibrary::from_parts(
        vec![
            gg_config("cfg-1", "Critic sweep"),
            gg_config("cfg-2", "Critic sweep"),
        ],
        Vec::new(),
    );
    let second = ReviewPlanCombo {
        gg_config_id: Some("saved:cfg-2".to_string()),
        ..gg_combo("opus", "haiku")
    };
    let resolved = resolve_combos(
        &[],
        &[gg_combo("opus", "haiku"), second],
        &HashMap::new(),
        &twins,
    );

    // Both keep their place — a member that vanished from the matrix would be a plan that
    // silently got smaller — and both label themselves.
    assert_eq!(resolved.len(), 2);
    let c = case("pong");
    assert_eq!(cell_key(&c, &resolved[0]), cell_key(&c, &resolved[1]));
    // Only the first asks for runs. Left alone, each would read the same global counts, find
    // its own target unmet, and enqueue the cell's whole shortfall a second time.
    assert!(resolved[0].unlaunchable.is_none());
    assert!(resolved[1].unlaunchable.is_some());
    assert_eq!(
        launchable_demand(empty_ctx().demand(5, &c, &resolved[1]), &resolved[1]).missing(),
        0
    );
}

#[test]
fn surrounding_space_in_a_binding_is_the_same_member_and_the_same_cell() {
    let padded = ReviewPlanCombo {
        gg_slot_models: BTreeMap::from([
            ("primary".to_string(), " opus ".to_string()),
            ("reviewer.critic".to_string(), "haiku".to_string()),
        ]),
        ..gg_combo("opus", "haiku")
    };
    // One member, not two: the de-dupe key is the canonical form of the bindings, so a model
    // id pasted with a trailing space cannot buy a second cell's worth of runs.
    let resolved = resolve_combos(
        &[],
        &[gg_combo("opus", "haiku"), padded.clone()],
        &HashMap::new(),
        &one_config(),
    );
    assert_eq!(resolved.len(), 1);
    // And what is stored is the canonical form, so the row itself never carries the space.
    assert_eq!(
        padded.for_storage().gg_slot_models,
        gg_combo("opus", "haiku").gg_slot_models
    );
}

#[test]
fn a_member_that_was_already_stored_survives_its_configuration_growing_a_slot() {
    // The member was written when the configuration had two launch slots. It has since
    // gained a third, which leaves every member that predates it unbound.
    let mut grown = gg_config("cfg-1", "Critic sweep");
    grown.capability_set.model_slots.push(GgConfigSlot {
        name: "auditor".to_string(),
        default_model_id: None,
        targets: vec![GgSlotTarget {
            agent: key_of("reviewer"),
            slot: "critic".to_string(),
        }],
    });
    let library = GgLibrary::from_parts(vec![grown], Vec::new());
    let stored = vec![gg_combo("opus", "haiku")];

    // Saving the object again — bumping its runs-per-cell, renaming it, dropping some other
    // member — must not be refused because of a member that was valid when it was written.
    assert!(unstorable_member(&stored, &stored, &library).is_none());
    // A member being written *now* is judged as always: this is the moment to catch a typo.
    assert!(unstorable_member(&stored, &[], &library).is_some());
}

#[test]
fn storing_a_gg_member_clears_every_value_a_read_derives() {
    // What a console echoes back after a read: the name and the root model filled in, and
    // (on a hand-written request) a harness that is not gg.
    let echoed = ReviewPlanCombo {
        harness: HarnessSlug::Claude,
        model: "opus".to_string(),
        provider: Some("openrouter".to_string()),
        gg_config_name: Some("Critic sweep".to_string()),
        ..gg_combo("opus", "haiku")
    };
    let stored = echoed.for_storage();
    assert_eq!(stored.harness, HarnessSlug::Gg);
    assert!(stored.model.is_empty());
    assert!(stored.provider.is_none());
    assert!(stored.gg_config_name.is_none());
    // What the member *is* survives untouched.
    assert_eq!(stored.gg_config_id.as_deref(), Some("saved:cfg-1"));
    assert_eq!(stored.gg_slot_models, echoed.gg_slot_models);
    // A harness member is stored exactly as it arrived.
    let harness = combo("opus");
    assert_eq!(harness.for_storage(), harness);
}

#[test]
fn two_gg_members_of_one_configuration_differ_by_the_models_they_bind() {
    let groups: HashMap<String, CoverageGroup> = [combo_group(
        "g1",
        vec![gg_combo("opus", "haiku"), gg_combo("opus", "sonnet")],
    )]
    .into_iter()
    .map(|g| (g.id.clone(), g))
    .collect();
    let resolved = resolve_combos(
        &["g1".to_string()],
        // The first is a repeat of a group member and drops out; the second is the same
        // configuration and the same models bound to *swapped* slots, which is a third arm.
        &[gg_combo("opus", "haiku"), gg_combo("haiku", "opus")],
        &groups,
        &one_config(),
    );
    assert_eq!(resolved.len(), 3);
    assert_eq!(
        resolved
            .iter()
            .map(|m| m.launch_model.as_str())
            .collect::<Vec<_>>(),
        vec!["opus", "opus", "haiku"]
    );
    // The two that bind the same pair to different slots run different models at the root, so
    // they are different cells even though their model *sets* are identical.
    let c = case("pong");
    assert_ne!(cell_key(&c, &resolved[0]), cell_key(&c, &resolved[2]));
}

#[test]
fn a_gg_cell_is_keyed_by_the_configuration_name_and_the_models_it_binds() {
    let c = case("pong");
    let key = cell_key(&c, &gg_member("opus", "haiku"));
    assert_eq!(
        key,
        (
            "pong".to_string(),
            "v1.0.0".to_string(),
            "base".to_string(),
            "gg".to_string(),
            "opus".to_string(),
            // The configuration's name, because counts are global and a run records the name
            // it was launched from — never the account-scoped id behind it.
            "Critic sweep".to_string(),
            "reviewer=haiku,root=opus".to_string(),
        )
    );
    // Same configuration, one subagent model changed: a different arm, so a different cell.
    assert_ne!(key, cell_key(&c, &gg_member("opus", "sonnet")));
    // And a gg cell never collides with the harness cell of the same model, whose two gg
    // segments are empty.
    let harness = cell_key(&c, &member(combo("opus")));
    assert_eq!((harness.5.as_str(), harness.6.as_str()), ("", ""));
    assert_ne!(key, harness);
}

#[test]
fn a_gg_member_and_a_harness_member_hold_their_declared_order() {
    let cases = vec![case("pong"), case("carom")];
    let combos = vec![
        member(combo("opus")),
        gg_member("opus", "haiku"),
        member(combo("sonnet")),
    ];
    // Two shapes in one list and one axis over both: a gg member is a member, not a second
    // axis, so it takes its declared place among the harness ones.
    assert_eq!(
        order(&cells_in_order(CoverageAxis::Case, &combos, &cases)),
        vec![
            "pong/opus",
            "pong/Critic sweep",
            "pong/sonnet",
            "carom/opus",
            "carom/Critic sweep",
            "carom/sonnet",
        ]
    );
    assert_eq!(
        order(&cells_in_order(CoverageAxis::Combination, &combos, &cases)),
        vec![
            "pong/opus",
            "carom/opus",
            "pong/Critic sweep",
            "carom/Critic sweep",
            "pong/sonnet",
            "carom/sonnet",
        ]
    );
}

#[test]
fn an_unlaunchable_member_spends_no_buffer_and_stops_no_walk() {
    let cases = vec![case("pong")];
    let orphan = resolve_member(&gg_combo("opus", "haiku"), &GgLibrary::default());
    let combos = vec![orphan, member(combo("sonnet"))];
    let mut ctx = empty_ctx();
    // The broken member's cell has runs in flight from before it broke: they still occupy the
    // reviewer's buffer, because nothing un-launched them.
    ctx.in_flight.insert(cell_key(&cases[0], &combos[0]), 2);

    let ordered = cells_in_order(CoverageAxis::Case, &combos, &cases);
    let demands: Vec<_> = ordered
        .iter()
        .map(|(case, member)| launchable_demand(ctx.demand(5, case, member), member))
        .collect();
    // It wants nothing…
    assert_eq!(demands[0].missing(), 0);
    // …but its outstanding runs are still counted against the buffer.
    assert_eq!(demands[0].outstanding(), 2);
    let launches = top_up(&demands, ctx.harness_capacity(), 10, 2);
    // The walk carries straight on to the member that can still run.
    assert_eq!(launches.len(), 1);
    assert_eq!(order(&[ordered[launches[0].cell]]), vec!["pong/sonnet"]);
}

#[test]
fn gg_runs_are_throttled_by_their_own_capacity_lane() {
    let cases = vec![case("pong"), case("carom")];
    let combos = vec![gg_member("opus", "haiku"), member(combo("sonnet"))];
    let mut ctx = empty_ctx();
    // gg is a lane like any other harness, so its cap defers its cells behind the ones that
    // can start now — the whole reason gg is in `HarnessSlug::RUNNABLE`.
    assert_eq!(
        ctx.demand(1, &cases[0], &combos[0]).harness,
        harness_lane(HarnessSlug::Gg)
    );
    ctx.harness_capacity[harness_lane(HarnessSlug::Gg)] = HarnessCapacity {
        in_flight: 3,
        max_parallel: Some(2),
    };

    let ordered = cells_in_order(CoverageAxis::Combination, &combos, &cases);
    let demands: Vec<_> = ordered
        .iter()
        .map(|(case, member)| ctx.demand(1, case, member))
        .collect();
    let launches = top_up(&demands, ctx.harness_capacity(), 2, 0);
    assert_eq!(
        launches
            .iter()
            .map(|launch| order(&[ordered[launch.cell]]).remove(0))
            .collect::<Vec<_>>(),
        vec!["pong/sonnet", "carom/sonnet"]
    );
}
