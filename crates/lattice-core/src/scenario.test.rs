//! Tests for scenario parsing and validation.

use super::*;

/// A minimal valid scenario: one source feeding one belt into one sink.
fn minimal_json() -> &'static str {
    r#"{
        "version": 1,
        "grid": { "width": 8, "height": 4 },
        "ticks": 100,
        "snapshots": [50, 100],
        "entities": [
            { "type": "source", "x": 0, "y": 1, "dir": "E", "item": "iron-ore", "lane": "both", "period": 4 },
            { "type": "belt", "x": 1, "y": 1, "dir": "E", "tier": "fast" },
            { "type": "sink", "x": 2, "y": 1, "dir": "W" }
        ]
    }"#
}

#[test]
fn a_minimal_scenario_parses_and_validates() {
    let scenario = Scenario::parse(minimal_json().as_bytes()).expect("valid scenario parses");
    assert_eq!(scenario.version, 1);
    assert_eq!(scenario.entities.len(), 3);
    assert_eq!(scenario.snapshots, vec![50, 100]);
}

#[test]
fn the_wrong_version_is_rejected() {
    let bad = minimal_json().replace("\"version\": 1", "\"version\": 2");
    assert_eq!(
        Scenario::parse(bad.as_bytes()),
        Err(ScenarioError::UnsupportedVersion(2))
    );
}

#[test]
fn snapshots_must_be_ascending_within_the_run() {
    let descending = minimal_json().replace("[50, 100]", "[100, 50]");
    assert_eq!(
        Scenario::parse(descending.as_bytes()),
        Err(ScenarioError::BadSnapshots)
    );

    let past_end = minimal_json().replace("[50, 100]", "[50, 200]");
    assert_eq!(
        Scenario::parse(past_end.as_bytes()),
        Err(ScenarioError::BadSnapshots)
    );

    let zero = minimal_json().replace("[50, 100]", "[0, 100]");
    assert_eq!(
        Scenario::parse(zero.as_bytes()),
        Err(ScenarioError::BadSnapshots)
    );
}

#[test]
fn unknown_prototype_references_are_rejected() {
    let bad_tier = minimal_json().replace("\"tier\": \"fast\"", "\"tier\": \"ultra\"");
    assert_eq!(
        Scenario::parse(bad_tier.as_bytes()),
        Err(ScenarioError::UnknownBeltTier("ultra".into()))
    );

    let bad_item = minimal_json().replace("\"item\": \"iron-ore\"", "\"item\": \"gold\"");
    assert_eq!(
        Scenario::parse(bad_item.as_bytes()),
        Err(ScenarioError::UnknownItem("gold".into()))
    );
}

#[test]
fn an_offgrid_anchor_is_rejected() {
    let offgrid = minimal_json().replace(
        "\"x\": 2, \"y\": 1, \"dir\": \"W\"",
        "\"x\": 99, \"y\": 1, \"dir\": \"W\"",
    );
    assert!(matches!(
        Scenario::parse(offgrid.as_bytes()),
        Err(ScenarioError::OffGrid { .. })
    ));
}

#[test]
fn a_zero_period_source_is_rejected() {
    let bad = minimal_json().replace("\"period\": 4", "\"period\": 0");
    assert_eq!(
        Scenario::parse(bad.as_bytes()),
        Err(ScenarioError::ZeroPeriod)
    );
}

#[test]
fn unknown_top_level_fields_are_rejected() {
    let bad = minimal_json().replace("\"ticks\": 100,", "\"ticks\": 100, \"bogus\": 1,");
    assert!(matches!(
        Scenario::parse(bad.as_bytes()),
        Err(ScenarioError::Parse(_))
    ));
}

#[test]
fn a_scenario_round_trips_through_json() {
    let scenario = Scenario::parse(minimal_json().as_bytes()).unwrap();
    let json = serde_json::to_vec(&scenario).unwrap();
    let back = Scenario::parse(&json).unwrap();
    assert_eq!(scenario, back);
}
