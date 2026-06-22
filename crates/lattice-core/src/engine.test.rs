//! Tests for the oracle driver: snapshot scheduling and determinism.

use super::*;
use crate::scenario::Scenario;
use crate::state::EntityState;

fn scenario(json: &str) -> Scenario {
    Scenario::parse(json.as_bytes()).expect("test scenario is valid")
}

/// A source feeding a belt into a sink — enough to produce non-trivial state.
fn pipe_scenario() -> Scenario {
    scenario(
        r#"{
            "version": 1,
            "grid": { "width": 8, "height": 4 },
            "ticks": 200,
            "snapshots": [50, 100, 200],
            "entities": [
                { "type": "source", "x": 0, "y": 1, "dir": "E", "item": "iron-ore", "lane": "both", "period": 8 },
                { "type": "belt", "x": 1, "y": 1, "dir": "E", "tier": "fast" },
                { "type": "belt", "x": 2, "y": 1, "dir": "E", "tier": "fast" },
                { "type": "sink", "x": 3, "y": 1, "dir": "W" }
            ]
        }"#,
    )
}

#[test]
fn run_emits_one_snapshot_per_scheduled_tick_in_order() {
    let s = pipe_scenario();
    let snapshots = Engine::solve(&s);
    assert_eq!(snapshots.len(), 3);
    assert_eq!(snapshots[0].tick, 50);
    assert_eq!(snapshots[1].tick, 100);
    assert_eq!(snapshots[2].tick, 200);
}

#[test]
fn solving_the_same_scenario_twice_is_bit_identical() {
    let s = pipe_scenario();
    let a = Engine::solve(&s);
    let b = Engine::solve(&s);
    let checks_a: Vec<&str> = a.iter().map(|s| s.checksum.as_str()).collect();
    let checks_b: Vec<&str> = b.iter().map(|s| s.checksum.as_str()).collect();
    assert_eq!(checks_a, checks_b, "the oracle is deterministic");
}

#[test]
fn items_flow_through_the_pipe_and_reach_the_sink() {
    let s = pipe_scenario();
    let snapshots = Engine::solve(&s);
    // By tick 200 the sink has consumed iron-ore the source emitted.
    let last = snapshots.last().unwrap();
    let EntityState::Sink(sink) = last.entities.last().unwrap() else {
        panic!("the last entity is the sink");
    };
    let consumed: u64 = sink.consumed.values().copied().sum();
    assert!(consumed > 0, "the sink consumed items over 200 ticks");
}
