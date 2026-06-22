//! Tests for building the live world from a scenario and rendering its snapshot.

use super::*;
use crate::scenario::Scenario;

fn scenario(json: &str) -> Scenario {
    Scenario::parse(json.as_bytes()).expect("test scenario is valid")
}

#[test]
fn the_world_registers_every_footprint_tile() {
    // An assembler covers its 3x3 footprint; a splitter both of its tiles.
    let s = scenario(
        r#"{
            "version": 1,
            "grid": { "width": 16, "height": 16 },
            "ticks": 10,
            "snapshots": [10],
            "entities": [
                { "type": "assembler", "x": 2, "y": 2, "recipe": "iron-gear" },
                { "type": "splitter", "x": 8, "y": 8, "dir": "E" }
            ]
        }"#,
    );
    let world = World::new(&s);
    // All nine assembler tiles resolve to index 0.
    for dy in 0..3 {
        for dx in 0..3 {
            assert_eq!(world.machine_at(2 + dx, 2 + dy), Some(0));
        }
    }
    // The splitter's anchor and its second tile (E-facing -> (x, y+1)) resolve.
    assert_eq!(world.machine_at(8, 8), Some(1));
    assert_eq!(world.machine_at(8, 9), Some(1));
}

#[test]
fn an_empty_world_snapshot_has_one_entry_per_entity_in_order() {
    let s = scenario(
        r#"{
            "version": 1,
            "grid": { "width": 8, "height": 4 },
            "ticks": 5,
            "snapshots": [5],
            "entities": [
                { "type": "belt", "x": 1, "y": 1, "dir": "E", "tier": "fast" },
                { "type": "sink", "x": 2, "y": 1, "dir": "W" }
            ]
        }"#,
    );
    let world = World::new(&s);
    let snapshot = world.snapshot();
    assert_eq!(snapshot.tick, 0);
    assert_eq!(snapshot.entities.len(), 2);
    assert!(matches!(snapshot.entities[0], EntityState::Belt(_)));
    assert!(matches!(snapshot.entities[1], EntityState::Sink(_)));
}
