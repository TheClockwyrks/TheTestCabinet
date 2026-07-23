//! Tests for the prototype table — the index contract and the lookups.

use super::*;

#[test]
fn the_item_index_table_is_the_pinned_contract() {
    // The canonical byte stream encodes items by these exact indices; reordering
    // would change every checksum, so this is asserted explicitly.
    assert_eq!(item_index("iron-ore"), Some(0));
    assert_eq!(item_index("iron-plate"), Some(1));
    assert_eq!(item_index("iron-gear"), Some(2));
    assert_eq!(item_index("copper-ore"), Some(3));
    assert_eq!(item_index("copper-plate"), Some(4));
    assert_eq!(item_index("copper-cable"), Some(5));
    assert_eq!(item_index("circuit"), Some(6));
    // The craftable machines, appended after the seven intermediates. These indices
    // are the same ones the renderer's item sheet (`lattice-items`, frames 7-15)
    // pins, so they are asserted explicitly too.
    assert_eq!(item_index("transport-belt"), Some(7));
    assert_eq!(item_index("fast-transport-belt"), Some(8));
    assert_eq!(item_index("express-transport-belt"), Some(9));
    assert_eq!(item_index("assembler"), Some(10));
    assert_eq!(item_index("fast-assembler"), Some(11));
    assert_eq!(item_index("express-assembler"), Some(12));
    assert_eq!(item_index("inserter"), Some(13));
    assert_eq!(item_index("fast-inserter"), Some(14));
    assert_eq!(item_index("express-inserter"), Some(15));
    assert_eq!(ITEMS.len(), 16);
    assert_eq!(item_index("not-an-item"), None);
}

#[test]
fn item_index_and_item_name_are_inverses() {
    for (i, id) in ITEMS.iter().enumerate() {
        assert_eq!(item_index(id), Some(i as u16));
        assert_eq!(item_name(i as u16), Some(*id));
    }
}

#[test]
fn each_belt_tier_has_its_own_speed() {
    // The three tiers move at distinct speeds (1×/2×/3×): a higher tier carries items
    // faster. `fast` is the reference BELT_SPEED the inserter is tuned to. An unknown
    // tier is still a validation error.
    assert_eq!(belt_speed("slow"), Some(32));
    assert_eq!(belt_speed("fast"), Some(64));
    assert_eq!(belt_speed("express"), Some(96));
    assert_eq!(BELT_SPEED, 64);
    assert_eq!(belt_speed("nope"), None);
}

#[test]
fn every_inserter_swings_at_the_one_pinned_rate() {
    // There is a single kind of inserter: no tier table, no per-entity speed. Its
    // swing is tied to BELT_SPEED so an item moves at the same linear speed in a
    // claw as on a belt: 2 * TILE / BELT_SPEED = 512 / 64 = 8.
    assert_eq!(INSERTER_SWING, 8);
    assert_eq!(INSERTER_SWING as u32, 2 * TILE / BELT_SPEED);
}

#[test]
fn recipes_resolve_with_their_inputs_outputs_and_craft_costs() {
    let gear = recipe("iron-gear").expect("iron-gear is a recipe");
    assert_eq!(gear.inputs.len(), 1);
    assert_eq!(gear.inputs[0].item, "iron-plate");
    assert_eq!(gear.inputs[0].count, 2);
    assert_eq!(gear.outputs[0].item, "iron-gear");
    assert_eq!(gear.outputs[0].count, 1);
    assert_eq!(gear.craft, 64);

    let circuit = recipe("circuit").expect("circuit is a recipe");
    assert_eq!(circuit.inputs.len(), 2);
    assert_eq!(circuit.craft, 96);

    // The machine recipes: each a distinct two- or three-input combination, and each
    // producing its own machine item. Craft times divide LCM(32,64,96)=192.
    let belt = recipe("transport-belt").expect("transport-belt is a recipe");
    assert_eq!(belt.inputs.len(), 2);
    assert_eq!(belt.outputs[0].item, "transport-belt");
    assert_eq!(belt.outputs[0].count, 2);
    assert_eq!(belt.craft, 48);
    assert_eq!(192 % belt.craft, 0);

    let inserter = recipe("inserter").expect("inserter is a recipe");
    assert_eq!(inserter.inputs.len(), 2);
    assert_eq!(inserter.outputs[0].item, "inserter");
    assert_eq!(inserter.craft, 64);

    let assembler = recipe("assembler").expect("assembler is a recipe");
    assert_eq!(assembler.inputs.len(), 2);
    // The apex machine consumes a machine (a belt) plus a circuit.
    assert!(assembler.inputs.iter().any(|t| t.item == "transport-belt"));
    assert!(assembler.inputs.iter().any(|t| t.item == "circuit"));
    assert_eq!(assembler.outputs[0].item, "assembler");
    assert_eq!(assembler.craft, 96);
    // Every machine recipe's craft time divides the steady-state cycle.
    for name in ["transport-belt", "inserter", "assembler"] {
        assert_eq!(192 % recipe(name).unwrap().craft, 0);
    }

    assert!(recipe("nope").is_none());
}

#[test]
fn geometry_constants_are_the_pinned_values() {
    assert_eq!(TILE, 256);
    assert_eq!(SPACING, 64);
    assert_eq!(SPACING, TILE / 4);
    assert_eq!(INPUT_CAP, 8);
    assert_eq!(OUTPUT_CAP, 8);
}
