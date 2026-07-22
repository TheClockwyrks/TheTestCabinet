//! Tests for the scenario generator: determinism, validity, and that a generated
//! scenario actually solves under the oracle.

use lattice_core::{Engine, Entity};

use super::{Layout, scenario, scenario_with_layout};

/// The entity-kind tag of an entity, for the coverage assertions below.
fn kind(entity: &Entity) -> &'static str {
    match entity {
        Entity::Belt { .. } => "belt",
        Entity::Splitter { .. } => "splitter",
        Entity::Inserter { .. } => "inserter",
        Entity::Assembler { .. } => "assembler",
        Entity::Source { .. } => "source",
        Entity::Sink { .. } => "sink",
    }
}

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
        assert!(
            kinds.contains(want),
            "no {want} in a 48x24 layout: {kinds:?}"
        );
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
        crafted
            .iter()
            .any(|c| consumed.get(*c).copied().unwrap_or(0) > 0),
        "no crafted item ({crafted:?}) reached a sink; consumed: {consumed:?}"
    );
}

// ---------------------------------------------------------------------------
// The Bus layout
// ---------------------------------------------------------------------------

/// Every tile an entity's footprint covers — a splitter's two tiles, an
/// assembler's 3×3, one tile for everything else. Mirrors the geometry the
/// `Placer` uses, so a test can re-derive occupancy from the emitted scenario
/// without trusting the generator's own (debug-only) collision assert.
fn footprint(entity: &Entity) -> Vec<(i32, i32)> {
    match entity {
        Entity::Assembler { x, y, .. } => {
            let mut tiles = Vec::with_capacity(9);
            for dy in 0..3 {
                for dx in 0..3 {
                    tiles.push((x + dx, y + dy));
                }
            }
            tiles
        }
        Entity::Splitter { x, y, dir } => {
            use lattice_core::Dir;
            let second = match dir {
                Dir::E | Dir::W => (*x, y + 1),
                Dir::N | Dir::S => (x + 1, *y),
            };
            vec![(*x, *y), second]
        }
        other => vec![other.anchor()],
    }
}

#[test]
fn the_same_seed_produces_the_identical_bus_scenario() {
    let a = scenario_with_layout(0x2A01, 48, 32, 120_000, Layout::Bus).expect("generates");
    let b = scenario_with_layout(0x2A01, 48, 32, 120_000, Layout::Bus).expect("generates");
    assert_eq!(a, b, "the bus generator is deterministic in the seed");
}

#[test]
fn different_seeds_diverge_under_the_bus_layout() {
    let a = scenario_with_layout(1, 48, 32, 120_000, Layout::Bus).expect("generates");
    let b = scenario_with_layout(2, 48, 32, 120_000, Layout::Bus).expect("generates");
    assert_ne!(a, b, "distinct seeds give distinct bus layouts");
}

#[test]
fn the_two_layouts_differ() {
    // The whole point of the flag: a bus scenario is not a lines scenario.
    let lines = scenario_with_layout(7, 48, 32, 120_000, Layout::Lines).expect("generates");
    let bus = scenario_with_layout(7, 48, 32, 120_000, Layout::Bus).expect("generates");
    assert_ne!(lines, bus, "the two layouts produce different scenarios");
}

#[test]
fn generated_bus_scenarios_validate() {
    for seed in [0u64, 1, 0x2A01, 0x7E44, u64::MAX] {
        for (w, h) in [(24, 16), (48, 32), (72, 40)] {
            let scenario =
                scenario_with_layout(seed, w, h, 50_000, Layout::Bus).expect("generates");
            scenario.validate().unwrap_or_else(|err| {
                panic!("bus seed {seed:#x} on {w}x{h} produced an invalid scenario: {err}")
            });
        }
    }
}

#[test]
fn bus_produces_no_footprint_overlaps() {
    // `Scenario::validate` only checks anchors, so a template arithmetic bug that
    // overlaps two multi-tile footprints (or runs one off the grid) would slip
    // through it. Re-derive full occupancy from the emitted entities and require
    // every footprint tile to be on-grid and claimed exactly once. Runs a range of
    // seeds and sizes so a size-dependent off-by-one cannot hide.
    for seed in [0u64, 1, 2, 0x2A01, 0x7E44, 0xDEAD_BEEF, u64::MAX] {
        for (w, h) in [(24, 16), (32, 24), (48, 32), (72, 40), (96, 48)] {
            let scenario =
                scenario_with_layout(seed, w, h, 50_000, Layout::Bus).expect("generates");
            let mut occupied: std::collections::HashSet<(i32, i32)> = Default::default();
            for entity in &scenario.entities {
                for (tx, ty) in footprint(entity) {
                    assert!(
                        tx >= 0 && ty >= 0 && tx < w && ty < h,
                        "bus seed {seed:#x} on {w}x{h}: footprint tile ({tx},{ty}) is off-grid"
                    );
                    assert!(
                        occupied.insert((tx, ty)),
                        "bus seed {seed:#x} on {w}x{h}: footprint tile ({tx},{ty}) is double-occupied"
                    );
                }
            }
        }
    }
}

#[test]
fn a_generated_bus_scenario_solves_under_the_oracle() {
    let scenario = scenario_with_layout(0x2A01, 48, 32, 5_000, Layout::Bus).expect("generates");
    let expected = scenario.snapshots.len();
    let snapshots = Engine::solve(&scenario);
    assert_eq!(snapshots.len(), expected);
    for (snap, tick) in snapshots.iter().zip(&scenario.snapshots) {
        assert_eq!(snap.tick, *tick);
        assert!(snap.checksum.starts_with("fnv1a64:"));
    }
}

#[test]
fn a_generous_bus_grid_exercises_every_entity_kind() {
    let scenario = scenario_with_layout(0x5EED, 48, 32, 10_000, Layout::Bus).expect("generates");
    let kinds: std::collections::BTreeSet<&str> = scenario.entities.iter().map(kind).collect();
    for want in [
        "belt",
        "splitter",
        "inserter",
        "assembler",
        "source",
        "sink",
    ] {
        assert!(
            kinds.contains(want),
            "no {want} in a 48x32 bus layout: {kinds:?}"
        );
    }
}

#[test]
fn a_generous_bus_grid_reaches_the_multi_input_recipe() {
    let scenario = scenario_with_layout(0x5EED, 48, 32, 10_000, Layout::Bus).expect("generates");
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
fn generated_bus_assemblers_actually_craft() {
    // The bus units are interconnected — if any one jams (an assembler starves or
    // back-pressure deadlocks), crafted items never reach a sink. Solve one and
    // require a crafted item (something no source emits directly) to arrive.
    let scenario = scenario_with_layout(0x5EED, 48, 32, 20_000, Layout::Bus).expect("generates");
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
    assert!(!crafted.is_empty(), "the bus layout places assemblers");

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
        crafted
            .iter()
            .any(|c| consumed.get(*c).copied().unwrap_or(0) > 0),
        "no crafted item ({crafted:?}) reached a sink; consumed: {consumed:?}"
    );
}

#[test]
fn a_small_bus_grid_still_generates_and_solves() {
    // The target spot-check size: a circuit unit still fits, the rest is farm/belt
    // units.
    let scenario = scenario_with_layout(0x1234, 24, 16, 5_000, Layout::Bus).expect("generates");
    scenario.validate().expect("valid");
    let snapshots = Engine::solve(&scenario);
    assert_eq!(snapshots.len(), scenario.snapshots.len());
}

/// Total per-item counts consumed across every sink in the final snapshot of a
/// solved scenario — the evidence that a given item actually *flowed* to a sink.
fn sink_consumption(scenario: &lattice_core::Scenario) -> std::collections::BTreeMap<String, u64> {
    let last = Engine::solve(scenario).pop().expect("a final snapshot");
    let mut consumed: std::collections::BTreeMap<String, u64> = Default::default();
    for entity in &last.entities {
        if let lattice_core::EntityState::Sink(sink) = entity {
            for (item, count) in &sink.consumed {
                *consumed.entry(item.clone()).or_default() += count;
            }
        }
    }
    consumed
}

#[test]
fn every_bus_source_emits_only_raw_ore() {
    // The realism rule the redesign enforces: a bus scenario spawns *only* raw ore.
    // Every plate, cable, gear, and circuit must be crafted on the grid, so a source
    // emitting any of them would be a fiction the case would grade as real. Checked
    // across seeds and sizes so no unit ever slips an intermediate onto a source.
    for seed in [0u64, 1, 0x2A01, 0x7E44, 0x5EED, u64::MAX] {
        for (w, h) in [(24, 16), (32, 20), (48, 32), (72, 40)] {
            let scenario =
                scenario_with_layout(seed, w, h, 20_000, Layout::Bus).expect("generates");
            for entity in &scenario.entities {
                if let Entity::Source { item, .. } = entity {
                    assert!(
                        item == "iron-ore" || item == "copper-ore",
                        "bus seed {seed:#x} on {w}x{h}: source emits {item:?}, not raw ore"
                    );
                }
            }
        }
    }
}

#[test]
fn a_generous_bus_grid_builds_the_whole_craft_tree() {
    // Every stage of the tree must be present as an on-grid assembler: the two
    // plates, the cable (the real copper chain), and both products. A scored set
    // that skipped, say, the copper chain could not tell an engine that faked cables
    // from one that crafted them.
    let scenario = scenario_with_layout(0x5EED, 48, 32, 10_000, Layout::Bus).expect("generates");
    let recipes: std::collections::BTreeSet<&str> = scenario
        .entities
        .iter()
        .filter_map(|e| match e {
            Entity::Assembler { recipe, .. } => Some(recipe.as_str()),
            _ => None,
        })
        .collect();
    for want in [
        "iron-plate",
        "copper-plate",
        "copper-cable",
        "iron-gear",
        "circuit",
    ] {
        assert!(
            recipes.contains(want),
            "no {want} assembler in a 48x32 bus layout: {recipes:?}"
        );
    }
}

#[test]
fn both_bus_products_reach_a_sink_from_raw_ore() {
    // The whole tree must actually *flow*, end to end, from ore-only sources: both
    // products — `iron-gear` (the iron chain) and `circuit` (the two-input chain fed
    // by the real copper chain) — have to arrive at a sink. A jammed factory that
    // merely cycles is not acceptable, and neither is one whose products never drain.
    let scenario = scenario_with_layout(0x2A01, 48, 32, 30_000, Layout::Bus).expect("generates");
    let consumed = sink_consumption(&scenario);
    for product in ["iron-gear", "circuit"] {
        assert!(
            consumed.get(product).copied().unwrap_or(0) > 0,
            "no {product} reached a sink; consumed: {consumed:?}"
        );
    }
}

#[test]
fn bus_belts_are_densely_packed_not_dead() {
    // The redesign's density goal: a viewer should see a busy factory, not a couple
    // of lonely items on long empty belts. At steady state well under a sixth of the
    // belt tiles may be empty (both lanes clear). Measured on a large grid, which is
    // where the old layout's dead collector/bus belts were worst.
    let scenario = scenario_with_layout(0x7E44, 72, 40, 30_000, Layout::Bus).expect("generates");
    let last = Engine::solve(&scenario).pop().expect("a final snapshot");
    let mut belts = 0usize;
    let mut empty = 0usize;
    for entity in &last.entities {
        if let lattice_core::EntityState::Belt(belt) = entity {
            belts += 1;
            if belt.left.is_empty() && belt.right.is_empty() {
                empty += 1;
            }
        }
    }
    assert!(belts > 0, "the bus layout places belts");
    // Well under 15% — the hard target the redesign is measured against.
    assert!(
        empty * 100 < belts * 15,
        "too many empty belt tiles at steady state: {empty}/{belts} = {:.1}%",
        100.0 * empty as f64 / belts as f64
    );
}

#[test]
fn a_generous_bus_grid_is_busy_with_many_assemblers() {
    // "Add MORE assembler instances": a big grid should read as a busy factory, not
    // a couple of lonely machines. The farm and smelt units spread rows of
    // assemblers across the width, so a 72x40 grid carries well into the dozens.
    let scenario = scenario_with_layout(0x7E44, 72, 40, 10_000, Layout::Bus).expect("generates");
    let assemblers = scenario
        .entities
        .iter()
        .filter(|e| matches!(e, Entity::Assembler { .. }))
        .count();
    assert!(
        assemblers >= 20,
        "expected a busy factory (many assemblers), got {assemblers}"
    );
}
