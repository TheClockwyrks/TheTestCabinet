//! Native cross-checks that the transport engine's fast-forward is bit-exact.
//!
//! The whole optimization stands on one claim: skipping whole cycles produces the
//! *identical* canonical state the oracle's tick-by-tick simulation produces.
//! These tests assert that directly — they run [`run`] (the transport engine's
//! plain Rust entry, no wasm) and [`lattice_core::Engine`] on the same scenarios
//! and compare every snapshot's checksum. They also assert the engine actually
//! *found* a cycle on a periodic scenario (otherwise it would be correct but no
//! faster than naive, and the fuel gap the case depends on would be a fiction).

use super::*;
use lattice_core::{Engine, Scenario};

fn parse(json: &str) -> Scenario {
    Scenario::parse(json.as_bytes()).expect("test scenario is valid")
}

/// A long-running source -> belts -> sink line: it saturates and cycles, so the
/// transport engine should fast-forward most of it.
fn pipe() -> Scenario {
    parse(
        r#"{
            "version": 1,
            "grid": { "width": 12, "height": 4 },
            "ticks": 50000,
            "snapshots": [10000, 25000, 50000],
            "entities": [
                { "type": "source", "x": 0, "y": 1, "dir": "E", "item": "iron-ore", "lane": "both", "period": 4 },
                { "type": "belt", "x": 1, "y": 1, "dir": "E", "tier": "fast" },
                { "type": "belt", "x": 2, "y": 1, "dir": "E", "tier": "fast" },
                { "type": "belt", "x": 3, "y": 1, "dir": "E", "tier": "fast" },
                { "type": "belt", "x": 4, "y": 1, "dir": "E", "tier": "fast" },
                { "type": "splitter", "x": 5, "y": 1, "dir": "E" },
                { "type": "belt", "x": 6, "y": 1, "dir": "E", "tier": "fast" },
                { "type": "belt", "x": 7, "y": 1, "dir": "E", "tier": "fast" },
                { "type": "sink", "x": 8, "y": 1, "dir": "E" }
            ]
        }"#,
    )
}

/// A scenario with two lines of different belt tiers and source periods, so the
/// cycle period is the LCM of the periods and the fingerprint must capture both
/// lines' source phases to be a true cycle.
fn two_lines() -> Scenario {
    parse(
        r#"{
            "version": 1,
            "grid": { "width": 10, "height": 6 },
            "ticks": 40000,
            "snapshots": [9000, 20000, 40000],
            "entities": [
                { "type": "source", "x": 0, "y": 0, "dir": "E", "item": "copper-ore", "lane": "both", "period": 3 },
                { "type": "belt", "x": 1, "y": 0, "dir": "E", "tier": "slow" },
                { "type": "belt", "x": 2, "y": 0, "dir": "E", "tier": "slow" },
                { "type": "sink", "x": 3, "y": 0, "dir": "E" },
                { "type": "source", "x": 0, "y": 2, "dir": "E", "item": "iron-plate", "lane": "left", "period": 5 },
                { "type": "belt", "x": 1, "y": 2, "dir": "E", "tier": "express" },
                { "type": "belt", "x": 2, "y": 2, "dir": "E", "tier": "express" },
                { "type": "sink", "x": 3, "y": 2, "dir": "E" }
            ]
        }"#,
    )
}

/// The transport engine and the oracle must agree on every snapshot checksum.
fn assert_matches_oracle(scenario: &Scenario) {
    let oracle = Engine::solve(scenario);
    let transport = run(scenario);
    assert_eq!(
        transport.len(),
        oracle.len(),
        "same number of snapshots as the oracle"
    );
    for (want, got) in oracle.iter().zip(&transport) {
        assert_eq!(want.tick, got.tick, "snapshot ticks line up");
        assert_eq!(
            want.checksum, got.checksum,
            "checksum at tick {} matches the oracle",
            want.tick
        );
    }
}

#[test]
fn pipe_matches_the_oracle() {
    assert_matches_oracle(&pipe());
}

#[test]
fn two_lines_match_the_oracle() {
    assert_matches_oracle(&two_lines());
}

#[test]
fn a_periodic_scenario_actually_finds_a_cycle() {
    // Drive the driver directly so we can inspect that a cycle was discovered —
    // without it the engine is correct but no faster than naive.
    let scenario = pipe();
    let mut driver = Driver::new(&scenario);
    driver.advance_to(*scenario.snapshots.last().unwrap());
    assert!(
        driver.cycle.is_some(),
        "the saturated pipe settles into a detectable cycle"
    );
}

#[test]
fn fast_forward_does_not_overshoot_the_final_tick() {
    // The final snapshot must land on exactly `ticks`, even after fast-forwarding
    // whole cycles — the remainder phase must simulate the leftover precisely.
    let scenario = pipe();
    let transport = run(&scenario);
    assert_eq!(transport.last().unwrap().tick, 50000);
}
