//! Tests for the scenario generator: determinism, validity, and that a generated
//! scenario actually solves under the oracle.

use lattice_core::{Engine, Entity};

use super::scenario;

#[test]
fn the_same_seed_produces_the_identical_scenario() {
    let a = scenario(0xFAC7, 64, 64, 100_000).expect("generates");
    let b = scenario(0xFAC7, 64, 64, 100_000).expect("generates");
    assert_eq!(a, b, "the generator is deterministic in the seed");
}

#[test]
fn different_seeds_diverge() {
    let a = scenario(1, 64, 64, 100_000).expect("generates");
    let b = scenario(2, 64, 64, 100_000).expect("generates");
    assert_ne!(a, b, "distinct seeds give distinct layouts");
}

#[test]
fn generated_scenarios_validate() {
    for seed in [0u64, 1, 0xFAC7, 0xDEAD_BEEF, u64::MAX] {
        let scenario = scenario(seed, 48, 24, 50_000).expect("generates");
        scenario
            .validate()
            .unwrap_or_else(|err| panic!("seed {seed:#x} produced an invalid scenario: {err}"));
    }
}

#[test]
fn a_generated_scenario_solves_under_the_oracle() {
    // The whole point: whatever the generator emits, the oracle has an answer for —
    // one snapshot per scheduled tick.
    let scenario = scenario(0xFAC7, 32, 8, 2_000).expect("generates");
    let expected = scenario.snapshots.len();
    let snapshots = Engine::solve(&scenario);
    assert_eq!(snapshots.len(), expected);
    // Every snapshot carries a checksum (the comparison key) and is at a scheduled
    // tick.
    for (snap, tick) in snapshots.iter().zip(&scenario.snapshots) {
        assert_eq!(snap.tick, *tick);
        assert!(snap.checksum.starts_with("fnv1a64:"));
    }
}

#[test]
fn a_tiny_grid_is_rejected_rather_than_producing_an_invalid_layout() {
    assert!(
        scenario(0, 2, 1, 100).is_err(),
        "width 2 is too small for a line"
    );
    assert!(scenario(0, 8, 0, 100).is_err(), "height 0 has no rows");
}

#[test]
fn a_generous_grid_exercises_every_entity_kind() {
    // The gap this closes: a generator that emits only belts and splitters grades
    // only belts and splitters, however much the specs describe inserters,
    // assemblers, and recipes. A scored scenario has to be able to catch an engine
    // that skipped them.
    let scenario = scenario(0x5EED, 48, 24, 10_000).expect("generates");
    let kinds: std::collections::BTreeSet<&str> = scenario
        .entities
        .iter()
        .map(|e| match e {
            Entity::Belt { .. } => "belt",
            Entity::Splitter { .. } => "splitter",
            Entity::Inserter { .. } => "inserter",
            Entity::Assembler { .. } => "assembler",
            Entity::Source { .. } => "source",
            Entity::Sink { .. } => "sink",
        })
        .collect();
    for want in [
        "belt",
        "splitter",
        "inserter",
        "assembler",
        "source",
        "sink",
    ] {
        assert!(kinds.contains(want), "no {want} in a 48x24 layout: {kinds:?}");
    }
}

#[test]
fn a_generous_grid_reaches_the_multi_input_recipe() {
    // The two-input chain is the only shape proving an engine tracks per-item input
    // buffers rather than one count, so a scored set that never reaches it cannot
    // tell those engines apart.
    let scenario = scenario(0x5EED, 48, 24, 10_000).expect("generates");
    let multi: Vec<&str> = lattice_core::prototypes::RECIPES
        .iter()
        .filter(|r| r.inputs.len() > 1)
        .map(|r| r.name)
        .collect();
    let built: Vec<&String> = scenario
        .entities
        .iter()
        .filter_map(|e| match e {
            Entity::Assembler { recipe, .. } => Some(recipe),
            _ => None,
        })
        .collect();
    assert!(
        built.iter().any(|r| multi.contains(&r.as_str())),
        "no multi-input recipe among {built:?} (multi-input recipes: {multi:?})"
    );
}

#[test]
fn generated_assemblers_actually_craft() {
    // Placing an assembler is not enough — if the feed does not reach it, the
    // scenario looks like it exercises crafting while grading nothing. Solve one
    // and require a crafted item (something no source emits directly) to arrive.
    let scenario = scenario(0x5EED, 48, 24, 20_000).expect("generates");
    let crafted: std::collections::BTreeSet<&str> = scenario
        .entities
        .iter()
        .filter_map(|e| match e {
            Entity::Assembler { recipe, .. } => {
                lattice_core::prototypes::recipe(recipe).map(|r| r.outputs[0].item)
            }
            _ => None,
        })
        .collect();
    assert!(!crafted.is_empty(), "the layout places assemblers");

    let last = Engine::solve(&scenario).pop().expect("a final snapshot");
    let mut consumed: std::collections::BTreeMap<String, u64> = Default::default();
    for entity in &last.entities {
        if let lattice_core::EntityState::Sink(sink) = entity {
            for (item, count) in &sink.consumed {
                *consumed.entry(item.clone()).or_default() += count;
            }
        }
    }
    assert!(
        crafted.iter().any(|c| consumed.get(*c).copied().unwrap_or(0) > 0),
        "no crafted item ({crafted:?}) reached a sink; consumed: {consumed:?}"
    );
}
