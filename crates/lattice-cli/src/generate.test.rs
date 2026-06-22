//! Tests for the scenario generator: determinism, validity, and that a generated
//! scenario actually solves under the oracle.

use lattice_core::Engine;

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
