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
fn every_belt_tier_resolves_to_the_one_uniform_speed() {
    // All transport belts move at one speed: the three tier names are retained for
    // scenario compatibility but every one resolves to BELT_SPEED (the tier is
    // cosmetic). An unknown tier is still a validation error.
    assert_eq!(belt_speed("slow"), Some(BELT_SPEED));
    assert_eq!(belt_speed("fast"), Some(BELT_SPEED));
    assert_eq!(belt_speed("express"), Some(BELT_SPEED));
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
