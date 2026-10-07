//! Tests for the scenario generator: determinism, validity, and that a generated
//! scenario actually solves under the oracle.

use lattice_core::{Engine, Entity};

use super::{Layout, scenario, scenario_with_layout};

/// The entity-kind tag of an entity, for the coverage assertions below.
fn kind(entity: &Entity) -> &'static str {
    match entity {
        Entity::Belt { .. } => "belt",
        Entity::Splitter { .. } => "splitter",
        Entity::LaneSplitter { .. } => "lane-splitter",
        Entity::Inserter { .. } => "inserter",
        Entity::Assembler { .. } => "assembler",
        Entity::Furnace { .. } => "furnace",
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
            Entity::LaneSplitter { .. } => "lane-splitter",
            Entity::Inserter { .. } => "inserter",
            Entity::Assembler { .. } => "assembler",
            Entity::Furnace { .. } => "furnace",
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
        Entity::Furnace { x, y, .. } => {
            let mut tiles = Vec::with_capacity(4);
            for dy in 0..2 {
                for dx in 0..2 {
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
fn every_bus_source_emits_only_raw_ore_or_coal() {
    // The realism rule the redesign enforces: a bus scenario spawns *only* raw materials
    // — the ores AND coal (a raw fuel, carried from the edge and smelted in the furnaces
    // like ore). Every plate, cable, gear, and circuit must still be crafted on the grid,
    // so a source emitting any of them would be a fiction the case would grade as real.
    // Checked across seeds and sizes so no unit ever slips an intermediate onto a source.
    for seed in [0u64, 1, 0x2A01, 0x7E44, 0x5EED, u64::MAX] {
        for (w, h) in [(24, 16), (32, 20), (48, 32), (72, 40)] {
            let scenario =
                scenario_with_layout(seed, w, h, 20_000, Layout::Bus).expect("generates");
            for entity in &scenario.entities {
                if let Entity::Source { item, .. } = entity {
                    assert!(
                        item == "iron-ore" || item == "copper-ore" || item == "coal",
                        "bus seed {seed:#x} on {w}x{h}: source emits {item:?}, not raw ore or coal"
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
    // The plates are smelted on FURNACES now; every other stage stays on an assembler.
    let recipes: std::collections::BTreeSet<&str> = scenario
        .entities
        .iter()
        .filter_map(|e| match e {
            Entity::Assembler { recipe, .. } | Entity::Furnace { recipe, .. } => {
                Some(recipe.as_str())
            }
            _ => None,
        })
        .collect();
    for want in [
        "iron-plate",
        "copper-plate",
        "copper-cable",
        "iron-gear",
        "circuit",
        // The machine works units craft the machines, so every bus factory carries
        // them: a belt (from the belt works), and — the deepest — an inserter (gear
        // + circuit) and an assembler (transport-belt + circuit).
        "transport-belt",
        "inserter",
        "assembler",
    ] {
        assert!(
            recipes.contains(want),
            "no {want} assembler in a 48x32 bus layout: {recipes:?}"
        );
    }
}

#[test]
fn both_bus_products_reach_a_sink_from_raw_ore() {
    // The whole tree must actually *flow*, end to end, from ore-only sources: every
    // product — `iron-gear` (the iron chain), `circuit` (the two-input chain fed by
    // the real copper chain), `transport-belt` (the machine the belt works builds
    // from a gear and a plate line), and the two deepest machines `inserter`
    // (gear + circuit) and `assembler` (transport-belt + circuit) — has to arrive at
    // a sink. A jammed factory that merely cycles is not acceptable, and neither is
    // one whose products never drain.
    let scenario = scenario_with_layout(0x2A01, 48, 32, 30_000, Layout::Bus).expect("generates");
    let consumed = sink_consumption(&scenario);
    // Every product that terminates the tree drains to a sink: `iron-gear` and
    // `copper-cable` (the two chains' first fruits), and the three machines. `circuit`
    // is not asserted here — it is consumed *forward* into the inserter and assembler
    // (which do reach sinks), which is the stronger evidence that the chain flows.
    for product in [
        "iron-gear",
        "copper-cable",
        "transport-belt",
        "inserter",
        "assembler",
    ] {
        assert!(
            consumed.get(product).copied().unwrap_or(0) > 0,
            "no {product} reached a sink; consumed: {consumed:?}"
        );
    }
}

#[test]
fn bus_belts_are_densely_packed_not_dead() {
    // The redesign's density goal: a viewer should see a busy factory, not a couple
    // of lonely items on long empty belts. Measured on a large grid, which is where the
    // old layout's dead collector/bus belts were worst.
    //
    // The threshold is "well under a QUARTER" rather than the old "well under a sixth".
    // The reason is the smelting switch to **furnaces**: unlike the old one-input plate
    // assembler, a furnace consumes ore *and* coal, fed by a single inserter at exactly
    // its craft rate — it has no spare input margin. A dead-ending plate lane (which the
    // assembler version relied on to pack the bus dense) would therefore back up into the
    // furnaces' output, stall their craft, shear their just-in-time feed, and push the
    // transport reference's fuel far past the case's ceiling. So the two plate sub-bus
    // lanes must **drain** to a sink and carry a *flowing* plate stream rather than a
    // packed one. Every other belt — the ore/coal backbones, the coal spine, the machine
    // works' plate risers and intermediate belts, and the config-bay gadgets — still packs
    // dense; only the two full-width plate lanes flow, which lands the whole-grid figure a
    // little above a sixth. The anti-boring intent holds: no long DEAD collector belts,
    // and the factory reads busy.
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
    // Under a quarter — a flowing (not dead) factory once the plate lanes drain.
    assert!(
        empty * 100 < belts * 25,
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
    // Count furnaces alongside assemblers — the smelters are furnaces now, and together
    // with the gear/cable/machine assemblers they make the grid read as a busy factory.
    let machines = scenario
        .entities
        .iter()
        .filter(|e| matches!(e, Entity::Assembler { .. } | Entity::Furnace { .. }))
        .count();
    assert!(
        machines >= 20,
        "expected a busy factory (many machines), got {machines}"
    );
}

// ---------------------------------------------------------------------------
// The main-bus redesign's rules (the acceptance criteria).
// ---------------------------------------------------------------------------

/// The seeds and scored sizes the redesign's rules are checked across.
const BUS_RULE_SEEDS: [u64; 7] = [0, 1, 0x2A01, 0x7E44, 0x5EED, 0xB0A7, 0x1A77];
const BUS_RULE_SIZES: [(i32, i32); 2] = [(48, 32), (72, 40)];

/// The distinct **machinery** anchor x-coordinates in a bus scenario, sorted ascending
/// — assemblers AND furnaces, since the smelters are now 2×2 furnaces (they hold the
/// left region the plate-assemblers used to). Both are product-crafting machinery the
/// spread rules are about.
fn assembler_anchor_xs(scenario: &lattice_core::Scenario) -> Vec<i32> {
    let mut xs: Vec<i32> = scenario
        .entities
        .iter()
        .filter_map(|e| match e {
            Entity::Assembler { x, .. } | Entity::Furnace { x, .. } => Some(*x),
            _ => None,
        })
        .collect();
    xs.sort_unstable();
    xs.dedup();
    xs
}

#[test]
fn bus_machinery_spans_the_whole_width() {
    // Rule (spread): the product-crafting machinery reaches the east edge and lands in
    // every third of the width — never clustered at one end with an empty far side.
    for seed in BUS_RULE_SEEDS {
        for (w, h) in BUS_RULE_SIZES {
            let scenario = scenario_with_layout(seed, w, h, 5_000, Layout::Bus).expect("generates");
            let xs = assembler_anchor_xs(&scenario);
            let max = *xs.iter().max().expect("assemblers");
            assert!(
                max >= w - 6,
                "bus seed {seed:#x} on {w}x{h}: east-most assembler anchor {max} does not reach the edge (w-6={})",
                w - 6
            );
            for (lo, hi) in [(0, w / 3), (w / 3, 2 * w / 3), (2 * w / 3, w)] {
                assert!(
                    xs.iter().any(|&x| x >= lo && x < hi),
                    "bus seed {seed:#x} on {w}x{h}: no assembler in third [{lo},{hi})"
                );
            }
        }
    }
}

#[test]
fn bus_has_no_large_machinery_gap() {
    // Rule (spread): east of the first third, the assembler anchors have no gap
    // wider than width/6 — the machinery is distributed, not bunched with an empty band.
    for seed in BUS_RULE_SEEDS {
        for (w, h) in BUS_RULE_SIZES {
            let scenario = scenario_with_layout(seed, w, h, 5_000, Layout::Bus).expect("generates");
            let xs: Vec<i32> = assembler_anchor_xs(&scenario)
                .into_iter()
                .filter(|&x| x >= w / 3)
                .collect();
            for pair in xs.windows(2) {
                let gap = pair[1] - pair[0];
                assert!(
                    gap <= w / 6,
                    "bus seed {seed:#x} on {w}x{h}: assembler-anchor gap {gap} at x={} exceeds width/6={}",
                    pair[0],
                    w / 6
                );
            }
        }
    }
}

#[test]
fn a_bus_scenario_carries_many_splitters() {
    // Rule (balancers): a scored bus factory grades many balancers, at least one per
    // eight rows of height, spread along the lanes.
    for seed in BUS_RULE_SEEDS {
        for (w, h) in BUS_RULE_SIZES {
            let scenario = scenario_with_layout(seed, w, h, 5_000, Layout::Bus).expect("generates");
            let splitters = scenario
                .entities
                .iter()
                .filter(|e| matches!(e, Entity::Splitter { .. }))
                .count() as i32;
            assert!(
                splitters >= h / 8,
                "bus seed {seed:#x} on {w}x{h}: only {splitters} splitters (want >= height/8 = {})",
                h / 8
            );
        }
    }
}

#[test]
fn bus_consumes_every_raw_ore_in_the_left_half() {
    // Rule 1 — the defining main-bus constraint: all raw ore is smelted in the left
    // half, so no belt at or past the half-way column ever carries `iron-ore` or
    // `copper-ore`. Everything east of there is a *crafted* intermediate. Solve each
    // scenario and inspect the final snapshot's belts (parallel to the entities).
    for seed in BUS_RULE_SEEDS {
        for (w, h) in BUS_RULE_SIZES {
            let scenario =
                scenario_with_layout(seed, w, h, 30_000, Layout::Bus).expect("generates");
            let last = Engine::solve(&scenario).pop().expect("a final snapshot");
            let mid = w / 2;
            for (entity, state) in scenario.entities.iter().zip(&last.entities) {
                let (Entity::Belt { x, .. }, lattice_core::EntityState::Belt(belt)) =
                    (entity, state)
                else {
                    continue;
                };
                if *x < mid {
                    continue;
                }
                for item in belt.left.iter().chain(&belt.right) {
                    assert!(
                        item.item != "iron-ore" && item.item != "copper-ore",
                        "bus seed {seed:#x} on {w}x{h}: raw ore {:?} on a belt at x={x} >= width/2={mid}",
                        item.item
                    );
                }
            }
        }
    }
}

#[test]
fn no_bus_source_is_adjacent_to_an_assembler_or_furnace() {
    // Rule 2 — a source must not sit orthogonally next to any assembler OR furnace tile:
    // raw ore and coal travel a belt run (and, for the smelters, through a merge) before
    // they reach a machine, never straight off the source into it.
    for seed in BUS_RULE_SEEDS {
        for (w, h) in BUS_RULE_SIZES {
            let scenario = scenario_with_layout(seed, w, h, 5_000, Layout::Bus).expect("generates");
            let machine_tiles: std::collections::HashSet<(i32, i32)> = scenario
                .entities
                .iter()
                .filter(|e| matches!(e, Entity::Assembler { .. } | Entity::Furnace { .. }))
                .flat_map(footprint)
                .collect();
            for entity in &scenario.entities {
                if let Entity::Source { x, y, .. } = entity {
                    for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                        assert!(
                            !machine_tiles.contains(&(x + dx, y + dy)),
                            "bus seed {seed:#x} on {w}x{h}: source at ({x},{y}) is orthogonally adjacent to an assembler or furnace"
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn a_medium_bus_scenario_carries_a_splitter() {
    // Rule 3 — every scored bus factory grades at least one balancer.
    for seed in BUS_RULE_SEEDS {
        for (w, h) in BUS_RULE_SIZES {
            let scenario = scenario_with_layout(seed, w, h, 5_000, Layout::Bus).expect("generates");
            let splitters = scenario
                .entities
                .iter()
                .filter(|e| matches!(e, Entity::Splitter { .. }))
                .count();
            assert!(
                splitters >= 1,
                "bus seed {seed:#x} on {w}x{h}: no splitter in a medium/large bus scenario"
            );
        }
    }
}

#[test]
fn no_bus_splitter_feeds_a_sink_directly() {
    // Rule 4 — a sink is never the immediate output of a splitter; all splitting and
    // rerouting happens upstream on the bus, with at least a belt between a splitter
    // and any sink it ultimately drains to.
    use lattice_core::Dir;
    for seed in BUS_RULE_SEEDS {
        for (w, h) in BUS_RULE_SIZES {
            let scenario = scenario_with_layout(seed, w, h, 5_000, Layout::Bus).expect("generates");
            let sink_tiles: std::collections::HashSet<(i32, i32)> = scenario
                .entities
                .iter()
                .filter_map(|e| match e {
                    Entity::Sink { x, y, .. } => Some((*x, *y)),
                    _ => None,
                })
                .collect();
            for entity in &scenario.entities {
                if let Entity::Splitter { x, y, dir } = entity {
                    let second = match dir {
                        Dir::E | Dir::W => (*x, y + 1),
                        Dir::N | Dir::S => (x + 1, *y),
                    };
                    for (tx, ty) in [(*x, *y), second] {
                        let out = dir.step(tx, ty);
                        assert!(
                            !sink_tiles.contains(&out),
                            "bus seed {seed:#x} on {w}x{h}: splitter output {out:?} is a sink (no belt between)"
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn every_bus_sink_consumes_a_single_item_type() {
    // Rule 5 — each sink drains exactly one item type: products and bled surpluses are
    // routed to their *own* sink, never mixed. The one sanctioned exception is the
    // configuration bay's deliberately-**mixed showcase sink** (config #8: a belt lane
    // carrying two item types at once), so at most ONE sink per scenario may be
    // multi-item. Solve and inspect the final snapshot.
    for seed in BUS_RULE_SEEDS {
        for (w, h) in BUS_RULE_SIZES {
            let scenario =
                scenario_with_layout(seed, w, h, 30_000, Layout::Bus).expect("generates");
            let last = Engine::solve(&scenario).pop().expect("a final snapshot");
            let mut mixed = 0;
            for state in &last.entities {
                if let lattice_core::EntityState::Sink(sink) = state
                    && sink.consumed.len() > 1
                {
                    mixed += 1;
                }
            }
            assert!(
                mixed <= 1,
                "bus seed {seed:#x} on {w}x{h}: {mixed} sinks consumed multiple item types (at most the one mixed showcase sink is allowed)"
            );
        }
    }
}

#[test]
fn all_three_bus_machines_build_and_reach_a_sink() {
    // Rule 6 — the three craftable machines are all built and all drain to a sink on
    // every seed at the medium scored size.
    for seed in BUS_RULE_SEEDS {
        let scenario = scenario_with_layout(seed, 48, 32, 30_000, Layout::Bus).expect("generates");
        let consumed = sink_consumption(&scenario);
        for machine in ["transport-belt", "inserter", "assembler"] {
            assert!(
                consumed.get(machine).copied().unwrap_or(0) > 0,
                "bus seed {seed:#x}: no {machine} reached a sink; consumed: {consumed:?}"
            );
        }
    }
}

// ---------------------------------------------------------------------------
// The configuration bay's rules (the 8 functional belt/splitter/inserter
// configurations). Each test proves a configuration is both *present* (structural,
// re-derived from the entities with the same geometry the engine uses) and, where a
// structural check cannot prove function, *functional* (behavioural, via a solve).
// The bay is emitted on every scored size; a large grid carries all eight, a medium
// grid at least #1 plus several more.
// ---------------------------------------------------------------------------

use lattice_core::Dir;

/// The direction of the belt at `(x, y)`, or `None` if there is no belt there.
fn belt_dir_at(scenario: &lattice_core::Scenario, x: i32, y: i32) -> Option<Dir> {
    scenario.entities.iter().find_map(|e| match e {
        Entity::Belt {
            x: bx, y: by, dir, ..
        } if *bx == x && *by == y => Some(*dir),
        _ => None,
    })
}

/// Whether a sink sits at `(x, y)`.
fn is_sink_at(scenario: &lattice_core::Scenario, x: i32, y: i32) -> bool {
    scenario
        .entities
        .iter()
        .any(|e| matches!(e, Entity::Sink { x: sx, y: sy, .. } if *sx == x && *sy == y))
}

/// The entity index of the sink at `(x, y)`, if any (so its solved state — which is
/// parallel to the entity list — can be read back).
fn sink_index_at(scenario: &lattice_core::Scenario, x: i32, y: i32) -> Option<usize> {
    scenario
        .entities
        .iter()
        .position(|e| matches!(e, Entity::Sink { x: sx, y: sy, .. } if *sx == x && *sy == y))
}

/// The direction opposite `dir`.
fn opp(dir: Dir) -> Dir {
    match dir {
        Dir::N => Dir::S,
        Dir::S => Dir::N,
        Dir::E => Dir::W,
        Dir::W => Dir::E,
    }
}

/// A pair of tiles (the two halves of a splitter's input or output side).
type TilePair = [(i32, i32); 2];

/// A splitter's two input tiles and two output tiles, using the engine's geometry
/// (the tiles behind / in front of each half of its two-tile footprint).
fn splitter_io(x: i32, y: i32, dir: Dir) -> (TilePair, TilePair) {
    let second = match dir {
        Dir::E | Dir::W => (x, y + 1),
        Dir::N | Dir::S => (x + 1, y),
    };
    let back = opp(dir);
    let inputs = [back.step(x, y), back.step(second.0, second.1)];
    let outputs = [dir.step(x, y), dir.step(second.0, second.1)];
    (inputs, outputs)
}

/// Follow the belt chain starting at `(x, y)` to the sink it drains into, returning
/// that sink's entity index. Stops (returning `None`) if it leaves the belt network
/// without hitting a sink.
fn follow_to_sink(scenario: &lattice_core::Scenario, mut x: i32, mut y: i32) -> Option<usize> {
    for _ in 0..256 {
        if let Some(idx) = sink_index_at(scenario, x, y) {
            return Some(idx);
        }
        let dir = belt_dir_at(scenario, x, y)?;
        (x, y) = dir.step(x, y);
    }
    None
}

/// A sink's per-item consumption, keyed by item id.
type SinkTally = std::collections::BTreeMap<String, u64>;

/// Total consumed per item across every sink, keyed by the sink's *entity index*, so
/// a specific sink's consumption can be read.
fn per_sink_consumed(
    scenario: &lattice_core::Scenario,
) -> std::collections::BTreeMap<usize, SinkTally> {
    let last = Engine::solve(scenario).pop().expect("a final snapshot");
    let mut out: std::collections::BTreeMap<usize, std::collections::BTreeMap<String, u64>> =
        Default::default();
    for (idx, state) in last.entities.iter().enumerate() {
        if let lattice_core::EntityState::Sink(sink) = state {
            out.insert(idx, sink.consumed.clone());
        }
    }
    out
}

#[test]
fn no_bus_splitter_is_trivial() {
    // Every splitter in a bus scenario must do real work: at least 2 input belts OR at
    // least 2 output belts. A trivial 1-in/1-out splitter (a pass-through that routes
    // nothing) is forbidden — the whole point of a splitter.
    for seed in BUS_RULE_SEEDS {
        for (w, h) in BUS_RULE_SIZES {
            let sc = scenario_with_layout(seed, w, h, 5_000, Layout::Bus).expect("generates");
            for e in &sc.entities {
                let Entity::Splitter { x, y, dir } = e else {
                    continue;
                };
                let (ins, outs) = splitter_io(*x, *y, *dir);
                let ni = ins
                    .iter()
                    .filter(|&&(tx, ty)| belt_dir_at(&sc, tx, ty) == Some(*dir))
                    .count();
                let no = outs
                    .iter()
                    .filter(|&&(tx, ty)| belt_dir_at(&sc, tx, ty) == Some(*dir))
                    .count();
                assert!(
                    !(ni == 1 && no == 1),
                    "bus seed {seed:#x} on {w}x{h}: trivial 1-in/1-out splitter at ({x},{y})"
                );
                assert!(
                    ni >= 1 && no >= 1,
                    "bus seed {seed:#x} on {w}x{h}: splitter at ({x},{y}) has {ni} inputs / {no} outputs"
                );
            }
        }
    }
}

#[test]
fn no_bus_sink_consumes_raw_ore() {
    // A factory never ships raw ore: every source's ore is smelted before anything
    // reaches a sink. So no sink may consume `iron-ore` or `copper-ore`.
    for seed in BUS_RULE_SEEDS {
        for (w, h) in BUS_RULE_SIZES {
            let sc = scenario_with_layout(seed, w, h, 30_000, Layout::Bus).expect("generates");
            let last = Engine::solve(&sc).pop().expect("a final snapshot");
            for state in &last.entities {
                if let lattice_core::EntityState::Sink(sink) = state {
                    for item in sink.consumed.keys() {
                        assert!(
                            item != "iron-ore" && item != "copper-ore",
                            "bus seed {seed:#x} on {w}x{h}: a sink consumed raw ore {item:?}"
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn config1_a_real_two_in_two_out_splitter_exists() {
    // #1 — a real balancer: a splitter with belts feeding BOTH input tiles and belts
    // continuing from BOTH output tiles (not the no-op 1-in/1-out lane splitters).
    for (w, h) in BUS_RULE_SIZES {
        let scenario = scenario_with_layout(0x2A01, w, h, 5_000, Layout::Bus).expect("generates");
        let found = scenario.entities.iter().any(|e| {
            let Entity::Splitter { x, y, dir } = e else {
                return false;
            };
            let (ins, outs) = splitter_io(*x, *y, *dir);
            ins.iter()
                .all(|&(tx, ty)| belt_dir_at(&scenario, tx, ty) == Some(*dir))
                && outs
                    .iter()
                    .all(|&(tx, ty)| belt_dir_at(&scenario, tx, ty) == Some(*dir))
        });
        assert!(found, "no 2-in/2-out splitter on {w}x{h}");
    }
}

#[test]
fn config2_a_two_in_one_out_merge_splitter_exists() {
    // #2 — a merge: a splitter with belts on BOTH inputs but exactly ONE output belt.
    for (w, h) in BUS_RULE_SIZES {
        let scenario = scenario_with_layout(0x2A01, w, h, 5_000, Layout::Bus).expect("generates");
        let found = scenario.entities.iter().any(|e| {
            let Entity::Splitter { x, y, dir } = e else {
                return false;
            };
            let (ins, outs) = splitter_io(*x, *y, *dir);
            let both_in = ins
                .iter()
                .all(|&(tx, ty)| belt_dir_at(&scenario, tx, ty) == Some(*dir));
            let out_belts = outs
                .iter()
                .filter(|&&(tx, ty)| belt_dir_at(&scenario, tx, ty) == Some(*dir))
                .count();
            both_in && out_belts == 1
        });
        assert!(found, "no 2-in/1-out merge splitter on {w}x{h}");
    }
}

#[test]
fn config3_a_belt_side_loads_onto_a_perpendicular_belt() {
    // #3 — a T-intersection: a belt whose downstream tile is a perpendicular belt.
    // Part of the "+" gadget, on the large grid (medium carries #1 plus several).
    let (w, h) = (72, 40);
    let scenario = scenario_with_layout(0x2A01, w, h, 5_000, Layout::Bus).expect("generates");
    let found = scenario.entities.iter().any(|e| {
        let Entity::Belt { x, y, dir, .. } = e else {
            return false;
        };
        let (nx, ny) = dir.step(*x, *y);
        matches!(belt_dir_at(&scenario, nx, ny), Some(d) if d != *dir && d != opp(*dir))
    });
    assert!(
        found,
        "no belt side-loading a perpendicular belt on {w}x{h}"
    );
}

/// A belt tile `(x, y, dir)` fed by two perpendicular feeders, one from each side —
/// the shared core of the #4 (double side-load) and #5 ("+") checks.
fn double_side_loaded_tile(scenario: &lattice_core::Scenario) -> Option<(i32, i32, Dir)> {
    scenario.entities.iter().find_map(|e| {
        let Entity::Belt { x, y, dir, .. } = e else {
            return None;
        };
        // Feeders are perpendicular to this belt's own direction, approaching from
        // the two opposite sides and stepping onto this tile.
        let vertical_pair = belt_dir_at(scenario, *x, *y - 1) == Some(Dir::S)
            && belt_dir_at(scenario, *x, *y + 1) == Some(Dir::N);
        let horizontal_pair = belt_dir_at(scenario, *x - 1, *y) == Some(Dir::E)
            && belt_dir_at(scenario, *x + 1, *y) == Some(Dir::W);
        let perp_vertical = matches!(dir, Dir::E | Dir::W) && vertical_pair;
        let perp_horizontal = matches!(dir, Dir::N | Dir::S) && horizontal_pair;
        (perp_vertical || perp_horizontal).then_some((*x, *y, *dir))
    })
}

#[test]
fn config4_a_belt_tile_has_two_perpendicular_feeders() {
    // #4 — a double side-load: a through belt tile fed by two perpendicular feeders,
    // one from each side. The "+" gadget is on the large grid (medium carries #1 plus
    // several others, per the size contract).
    let (w, h) = (72, 40);
    let scenario = scenario_with_layout(0x2A01, w, h, 5_000, Layout::Bus).expect("generates");
    assert!(
        double_side_loaded_tile(&scenario).is_some(),
        "no double-side-loaded belt tile on {w}x{h}"
    );
}

#[test]
fn config5_the_double_side_load_tile_also_continues_collinearly() {
    // #5 — the "+": the double-side-loaded tile ALSO has a collinear downstream (its
    // own through flow continues past the join). On the large grid (see #4).
    let (w, h) = (72, 40);
    let scenario = scenario_with_layout(0x2A01, w, h, 5_000, Layout::Bus).expect("generates");
    let (x, y, dir) = double_side_loaded_tile(&scenario).expect("a double-side-loaded tile exists");
    let (dx, dy) = dir.step(x, y);
    assert!(
        belt_dir_at(&scenario, dx, dy) == Some(dir),
        "the '+' tile ({x},{y}) has no collinear downstream on {w}x{h}"
    );
}

/// The pair of south-facing inserters that both pick from one contiguous east-running
/// belt line and each drops into its own sink (the #6 twin-belt gadget), returned as
/// their two drop-sink tiles.
fn twin_belt_pair(scenario: &lattice_core::Scenario) -> Option<((i32, i32), (i32, i32))> {
    // South-facing inserters whose pickup (the tile behind, to the north) is a belt
    // and whose drop (the tile in front, to the south) is a sink.
    let mut cands: Vec<(i32, i32)> = scenario
        .entities
        .iter()
        .filter_map(|e| match e {
            Entity::Inserter { x, y, dir: Dir::S }
                if belt_dir_at(scenario, *x, *y - 1).is_some()
                    && is_sink_at(scenario, *x, *y + 1) =>
            {
                Some((*x, *y))
            }
            _ => None,
        })
        .collect();
    cands.sort();
    // Two of them on the same row whose pickup belts lie in one contiguous run.
    for i in 0..cands.len() {
        for j in (i + 1)..cands.len() {
            let (ax, ay) = cands[i];
            let (bx, by) = cands[j];
            if ay != by {
                continue;
            }
            let row = ay - 1;
            let contiguous =
                (ax.min(bx)..=ax.max(bx)).all(|cx| belt_dir_at(scenario, cx, row).is_some());
            if contiguous {
                return Some(((ax, ay + 1), (bx, by + 1)));
            }
        }
    }
    None
}

#[test]
fn config6_two_inserters_share_one_belt_line_and_both_carry() {
    // #6 — two inserters drawing from the same belt line; in a solve, both carry (each
    // one's own sink receives items).
    for (w, h) in BUS_RULE_SIZES {
        let scenario = scenario_with_layout(0x2A01, w, h, 6_000, Layout::Bus).expect("generates");
        let ((s1x, s1y), (s2x, s2y)) = twin_belt_pair(&scenario)
            .unwrap_or_else(|| panic!("no twin-belt inserter pair on {w}x{h}"));
        let i1 = sink_index_at(&scenario, s1x, s1y).expect("sink 1");
        let i2 = sink_index_at(&scenario, s2x, s2y).expect("sink 2");
        let consumed = per_sink_consumed(&scenario);
        let c1: u64 = consumed.get(&i1).map(|m| m.values().sum()).unwrap_or(0);
        let c2: u64 = consumed.get(&i2).map(|m| m.values().sum()).unwrap_or(0);
        assert!(
            c1 > 0 && c2 > 0,
            "twin-belt inserters did not both carry on {w}x{h}: {c1}, {c2}"
        );
    }
}

/// An assembler with two or more inserters picking from its footprint, returned as
/// (product item, the sinks each unloader ultimately drains to). The #7 gadget.
fn shared_assembler_unload(scenario: &lattice_core::Scenario) -> Option<(String, Vec<usize>)> {
    for e in &scenario.entities {
        let Entity::Assembler { x, y, recipe } = e else {
            continue;
        };
        let footprint: std::collections::HashSet<(i32, i32)> = (0..3)
            .flat_map(|dy| (0..3).map(move |dx| (x + dx, y + dy)))
            .collect();
        // Inserters whose pickup tile (behind them) lies in this assembler's footprint.
        let mut sinks = Vec::new();
        for ie in &scenario.entities {
            let Entity::Inserter { x: ix, y: iy, dir } = ie else {
                continue;
            };
            let pickup = opp(*dir).step(*ix, *iy);
            if footprint.contains(&pickup) {
                let (dx, dy) = dir.step(*ix, *iy);
                if let Some(sink) = follow_to_sink(scenario, dx, dy) {
                    sinks.push(sink);
                }
            }
        }
        sinks.sort_unstable();
        sinks.dedup();
        if sinks.len() >= 2 {
            let product = lattice_core::prototypes::recipe(recipe)
                .map(|r| r.outputs[0].item.to_string())
                .expect("known recipe");
            return Some((product, sinks));
        }
    }
    None
}

#[test]
fn config7_two_inserters_unload_one_assembler_and_both_reach_a_sink() {
    // #7 — two inserters unloading one assembler (a 2-output recipe keeps both busy);
    // in a solve, both of their target sinks receive the assembler's product.
    let (w, h) = (72, 40); // the deep copper-cable gadget is on the large grid
    let scenario = scenario_with_layout(0x7E44, w, h, 8_000, Layout::Bus).expect("generates");
    let (product, sinks) =
        shared_assembler_unload(&scenario).expect("an assembler with two unloaders");
    let consumed = per_sink_consumed(&scenario);
    let reached = sinks
        .iter()
        .filter(|idx| {
            consumed
                .get(idx)
                .and_then(|m| m.get(&product))
                .copied()
                .unwrap_or(0)
                > 0
        })
        .count();
    assert!(
        reached >= 2,
        "fewer than two of the shared assembler's unloaders delivered {product}: {reached}"
    );
}

#[test]
fn config8_a_belt_lane_carries_two_distinct_item_types() {
    // #8 — a mixed-item belt: in a solve, some belt lane holds >= 2 distinct item
    // types in a snapshot. The mixed gadget (iron-plate + iron-gear -> transport-belt)
    // is on the large grid.
    let (w, h) = (72, 40);
    let scenario = scenario_with_layout(0x2A01, w, h, 8_000, Layout::Bus).expect("generates");
    let last = Engine::solve(&scenario).pop().expect("a final snapshot");
    let mixed = last.entities.iter().any(|state| {
        let lattice_core::EntityState::Belt(belt) = state else {
            return false;
        };
        [&belt.left, &belt.right].iter().any(|lane| {
            let kinds: std::collections::BTreeSet<&str> =
                lane.iter().map(|i| i.item.as_str()).collect();
            kinds.len() >= 2
        })
    });
    assert!(mixed, "no mixed-item belt lane on {w}x{h}");
}

#[test]
fn config_medium_has_the_mandatory_splitter_plus_several_more() {
    // The medium scored size must carry at least #1 (mandatory) plus several more.
    let (w, h) = (48, 32);
    let scenario = scenario_with_layout(0x2A01, w, h, 8_000, Layout::Bus).expect("generates");
    // #1 (mandatory).
    let real_balancer = scenario.entities.iter().any(|e| {
        let Entity::Splitter { x, y, dir } = e else {
            return false;
        };
        let (ins, outs) = splitter_io(*x, *y, *dir);
        ins.iter()
            .all(|&(tx, ty)| belt_dir_at(&scenario, tx, ty) == Some(*dir))
            && outs
                .iter()
                .all(|&(tx, ty)| belt_dir_at(&scenario, tx, ty) == Some(*dir))
    });
    assert!(
        real_balancer,
        "medium lacks the mandatory 2-in/2-out splitter"
    );
    // Several more, structurally.
    let merge = scenario.entities.iter().any(|e| {
        let Entity::Splitter { x, y, dir } = e else {
            return false;
        };
        let (ins, outs) = splitter_io(*x, *y, *dir);
        ins.iter()
            .all(|&(tx, ty)| belt_dir_at(&scenario, tx, ty) == Some(*dir))
            && outs
                .iter()
                .filter(|&&(tx, ty)| belt_dir_at(&scenario, tx, ty) == Some(*dir))
                .count()
                == 1
    });
    let plus = double_side_loaded_tile(&scenario).is_some();
    let twins = twin_belt_pair(&scenario).is_some();
    let extras = [merge, plus, twins].iter().filter(|b| **b).count();
    assert!(
        extras >= 2,
        "medium carries too few extra configurations besides #1 (merge={merge}, plus={plus}, twins={twins})"
    );
}

// ---------------------------------------------------------------------------
// Curves and splitter-output usefulness (a real factory routes flow through
// curves, and never places a splitter whose output just backs up unused).
// ---------------------------------------------------------------------------

/// The two directions perpendicular to `dir`.
fn perpendicular(dir: Dir) -> [Dir; 2] {
    match dir {
        Dir::E | Dir::W => [Dir::N, Dir::S],
        Dir::N | Dir::S => [Dir::E, Dir::W],
    }
}

/// Whether some inserter is positioned to lift an item off the belt tile `(tx, ty)`:
/// an inserter one step in direction `d`, facing `d`, picks from the tile *behind*
/// it — which is `(tx, ty)`.
fn inserter_picks_from(sc: &lattice_core::Scenario, tx: i32, ty: i32) -> bool {
    [Dir::N, Dir::S, Dir::E, Dir::W].into_iter().any(|d| {
        let (ix, iy) = d.step(tx, ty);
        sc.entities.iter().any(
            |e| matches!(e, Entity::Inserter { x, y, dir } if *x == ix && *y == iy && *dir == d),
        )
    })
}

/// Whether a splitter occupies `(x, y)` (either tile of its two-tile footprint).
fn is_splitter_at(sc: &lattice_core::Scenario, x: i32, y: i32) -> bool {
    sc.entities.iter().any(|e| match e {
        Entity::Splitter { x: sx, y: sy, dir } => {
            let (s2x, s2y) = match dir {
                Dir::E | Dir::W => (*sx, *sy + 1),
                Dir::N | Dir::S => (*sx + 1, *sy),
            };
            (*sx, *sy) == (x, y) || (s2x, s2y) == (x, y)
        }
        _ => false,
    })
}

/// Whether a splitter-output belt chain starting at `(x, y)` reaches a real consumer:
/// a sink it drains into, an inserter that lifts an item off some tile of the chain
/// (feeding an assembler/furnace), or another splitter it feeds (which routes the
/// stream onward — that splitter's own outputs are checked separately). A chain that
/// just dead-ends — its stream backs up and stalls — reaches nothing.
fn output_chain_reaches_consumer(sc: &lattice_core::Scenario, mut x: i32, mut y: i32) -> bool {
    for _ in 0..512 {
        if is_sink_at(sc, x, y) || is_splitter_at(sc, x, y) || inserter_picks_from(sc, x, y) {
            return true;
        }
        let Some(dir) = belt_dir_at(sc, x, y) else {
            return false;
        };
        (x, y) = dir.step(x, y);
    }
    false
}

#[test]
fn medium_and_large_route_flow_through_curves() {
    // A hard requirement: the scored factories must turn flow through CURVES — a belt
    // whose sole feeder is a perpendicular belt (the engine merges these by forcing,
    // and the renderer draws the curved sprite). A layout of only straight runs is
    // wrong; both scored sizes must carry several real curves.
    for (seed, w, h, min) in [(0x2A01u64, 48, 32, 4usize), (0x7E44, 72, 40, 6)] {
        let sc = scenario_with_layout(seed, w, h, 5_000, Layout::Bus).expect("generates");
        let mut curves = 0usize;
        for e in &sc.entities {
            let Entity::Belt { x, y, dir, .. } = e else {
                continue;
            };
            // A straight-through feeder means the flow does not turn here.
            let (bx, by) = opp(*dir).step(*x, *y);
            if belt_dir_at(&sc, bx, by) == Some(*dir) {
                continue;
            }
            for indir in perpendicular(*dir) {
                let (fx, fy) = opp(indir).step(*x, *y);
                if belt_dir_at(&sc, fx, fy) == Some(indir) {
                    curves += 1;
                    break;
                }
            }
        }
        assert!(
            curves >= min,
            "bus seed {seed:#x} on {w}x{h}: only {curves} curved belts (need >= {min}) — flow must turn corners"
        );
    }
}

#[test]
fn every_bus_splitter_output_is_used() {
    // Every splitter output must DO something: its belt chain must reach a sink or be
    // tapped by an inserter feeding a machine. A splitter whose output dead-ends —
    // a stream routed off the bus that just backs up unused — is forbidden.
    for (seed, w, h) in [(0x2A01u64, 48, 32), (0x7E44, 72, 40)] {
        let sc = scenario_with_layout(seed, w, h, 5_000, Layout::Bus).expect("generates");
        for e in &sc.entities {
            let Entity::Splitter { x, y, dir } = e else {
                continue;
            };
            let (_ins, outs) = splitter_io(*x, *y, *dir);
            for (ox, oy) in outs {
                if belt_dir_at(&sc, ox, oy) != Some(*dir) {
                    continue; // that side has no live output belt
                }
                assert!(
                    output_chain_reaches_consumer(&sc, ox, oy),
                    "bus seed {seed:#x} on {w}x{h}: splitter ({x},{y}) output at ({ox},{oy}) dead-ends unused"
                );
            }
        }
    }
}
