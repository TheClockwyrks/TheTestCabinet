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
fn belt_and_inserter_tiers_match_the_pinned_table() {
    assert_eq!(belt_speed("slow"), Some(32));
    assert_eq!(belt_speed("fast"), Some(64));
    assert_eq!(belt_speed("express"), Some(128));
    assert_eq!(belt_speed("nope"), None);

    assert_eq!(inserter_swing("base"), Some(12));
    assert_eq!(inserter_swing("fast"), Some(6));
    assert_eq!(inserter_swing("nope"), None);
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
