//! Tests for the browser-playback driver: that stepping reconstructs exactly the
//! factory the oracle grades, and that the static layout resolves the geometry a
//! renderer must not re-derive.

use super::*;
use crate::engine::Engine;
use crate::scenario::Scenario;

/// A source feeding a belt into a sink, plus a splitter and an assembler so the
/// board covers the multi-tile footprints.
const PIPE: &str = r#"{
    "version": 1,
    "grid": { "width": 10, "height": 6 },
    "ticks": 200,
    "snapshots": [50, 100, 200],
    "entities": [
        { "type": "source", "x": 0, "y": 1, "dir": "E", "item": "iron-ore", "lane": "both", "period": 8 },
        { "type": "belt", "x": 1, "y": 1, "dir": "E", "tier": "fast" },
        { "type": "splitter", "x": 2, "y": 1, "dir": "E" },
        { "type": "belt", "x": 3, "y": 1, "dir": "E", "tier": "fast" },
        { "type": "sink", "x": 4, "y": 1, "dir": "W" }
    ]
}"#;

fn playback() -> Playback {
    Playback::load(PIPE).expect("the test scenario loads")
}

fn board(playback: &Playback) -> serde_json::Value {
    serde_json::from_slice(playback.board()).expect("the board is valid JSON")
}

#[test]
fn load_rejects_json_that_is_not_a_scenario() {
    assert!(Playback::load("not json").is_err());
    // Parses as JSON but fails validation: version 0 is not the wire version.
    assert!(Playback::load(r#"{ "version": 0, "grid": { "width": 1, "height": 1 }, "ticks": 1, "snapshots": [1], "entities": [] }"#).is_err());
}

#[test]
fn a_freshly_loaded_playback_sits_at_tick_zero() {
    let playback = playback();
    assert_eq!(playback.tick(), 0, "no tick has been advanced yet");
    assert_eq!(playback.snapshot().tick, 0);
}

#[test]
fn the_board_carries_the_grid_run_length_and_snapshot_schedule() {
    let board = board(&playback());
    assert_eq!(board["grid"]["width"], 10);
    assert_eq!(board["grid"]["height"], 6);
    assert_eq!(board["ticks"], 200);
    assert_eq!(board["snapshots"], serde_json::json!([50, 100, 200]));
    assert_eq!(board["version"], 1);
}

#[test]
fn the_board_flattens_each_entity_and_resolves_its_footprint() {
    let board = board(&playback());
    let entities = board["entities"].as_array().expect("entities is an array");
    assert_eq!(entities.len(), 5, "one board entry per placed entity, in order");

    // Flattened: the entity's own internally-tagged fields sit alongside `tiles`.
    let belt = &entities[1];
    assert_eq!(belt["type"], "belt");
    assert_eq!(belt["x"], 1);
    assert_eq!(belt["tier"], "fast");
    assert_eq!(
        belt["tiles"],
        serde_json::json!([[1, 1]]),
        "a belt occupies its single anchor tile"
    );

    // The engine resolves the two-tile splitter so the renderer never applies the
    // perpendicular-clockwise rule itself. E-facing at (2,1) straddles the y axis.
    let splitter = &entities[2];
    assert_eq!(splitter["type"], "splitter");
    assert_eq!(
        splitter["tiles"],
        serde_json::json!([[2, 1], [2, 2]]),
        "a splitter occupies its anchor and its second tile"
    );
}

#[test]
fn stepping_reproduces_the_oracle_checksums_at_every_scheduled_snapshot() {
    // The load-bearing test. A submission is correct only when it reproduced these
    // checksums, so if stepped playback lands on them too, the frames a viewer
    // watches are the very states the run was graded on.
    let scenario = Scenario::parse(PIPE.as_bytes()).expect("valid scenario");
    let expected = Engine::solve(&scenario);
    let scheduled = &scenario.snapshots;

    let mut playback = playback();
    let mut seen: Vec<(u64, String)> = Vec::new();
    while let Some(state) = playback.step() {
        let snapshot: crate::state::Snapshot =
            serde_json::from_slice(state).expect("each step emits a valid snapshot");
        if scheduled.contains(&snapshot.tick) {
            seen.push((snapshot.tick, snapshot.checksum));
        }
    }

    let want: Vec<(u64, String)> = expected
        .iter()
        .map(|s| (s.tick, s.checksum.clone()))
        .collect();
    assert_eq!(seen, want, "stepped playback matches the oracle tick for tick");
}

#[test]
fn every_step_reports_its_own_tick_and_a_checksum() {
    let mut playback = playback();
    for tick in 1..=5u64 {
        let state = playback.step().expect("the scenario runs 200 ticks");
        let snapshot: crate::state::Snapshot =
            serde_json::from_slice(state).expect("valid snapshot");
        assert_eq!(snapshot.tick, tick, "one tick per step, in order");
        assert!(
            snapshot.checksum.starts_with("fnv1a64:"),
            "each frame carries the canonical checksum so a renderer can verify it"
        );
        assert_eq!(playback.tick(), tick);
    }
}

#[test]
fn stepping_stops_at_the_scenarios_tick_count() {
    let mut playback = playback();
    let mut steps = 0u64;
    while playback.step().is_some() {
        steps += 1;
        assert!(steps <= 200, "playback must not run past the scenario");
    }
    assert_eq!(steps, 200, "exactly `ticks` steps are produced");
    assert_eq!(playback.tick(), 200);
    assert!(
        playback.step().is_none(),
        "stepping past the end stays exhausted"
    );
}

#[test]
fn reset_rewinds_and_replays_identically() {
    let mut playback = playback();
    let first: Vec<String> = (0..20)
        .map(|_| {
            let state = playback.step().expect("within the run");
            let snapshot: crate::state::Snapshot = serde_json::from_slice(state).unwrap();
            snapshot.checksum
        })
        .collect();

    playback.reset();
    assert_eq!(playback.tick(), 0, "reset rewinds to before the first tick");

    let second: Vec<String> = (0..20)
        .map(|_| {
            let state = playback.step().expect("within the run");
            let snapshot: crate::state::Snapshot = serde_json::from_slice(state).unwrap();
            snapshot.checksum
        })
        .collect();
    assert_eq!(first, second, "a reset replay is bit-identical");
}
