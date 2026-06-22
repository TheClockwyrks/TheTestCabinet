//! End-to-end tests for the host's public scoring path: a known-good submission
//! scored `correct` against the oracle, and a wrong-answer submission scored
//! `incorrect`. Both run a real `wat`-assembled module through `score_submission`,
//! the exact path the CLI's `run` and the core validator share.

use lattice_core::Scenario;

use crate::{SandboxLimits, run_submission, score_submission};

/// The single-sink scenario whose canonical output is the 88-byte `state` JSON the
/// good submission bakes. One snapshot at tick 4, an empty `consumed` map.
fn sink_scenario() -> Scenario {
    let bytes = br#"{"version":1,"grid":{"width":4,"height":1},"ticks":4,"snapshots":[4],"entities":[{"type":"sink","x":3,"y":0,"dir":"W"}]}"#;
    Scenario::parse(bytes).expect("the scenario parses")
}

/// A submission that returns the oracle's exact `state` for [`sink_scenario`].
fn correct_submission() -> Vec<u8> {
    wat::parse_str(CORRECT_WAT).expect("the correct submission assembles")
}

const CORRECT_WAT: &str = r#"
(module
  (memory (export "memory") 1)
  (data (i32.const 0) "[{\22tick\22:4,\22checksum\22:\22fnv1a64:aba7e962a95ec70d\22,\22entities\22:[{\22sink\22:{\22consumed\22:{}}}]}]")
  (func (export "alloc") (param $len i32) (result i32) (i32.const 4096))
  (func (export "simulate") (param $ptr i32) (param $len i32) (result i64)
    (i64.or (i64.shl (i64.const 0) (i64.const 32)) (i64.const 88))))
"#;

/// A submission that returns one snapshot at tick 4 with the *wrong* checksum
/// (`fnv1a64:0000000000000000`) — structurally valid `state` JSON, so it parses,
/// but it does not match the oracle, so it scores incorrect at the first snapshot.
fn wrong_submission() -> Vec<u8> {
    wat::parse_str(WRONG_WAT).expect("the wrong submission assembles")
}

const WRONG_WAT: &str = r#"
(module
  (memory (export "memory") 1)
  (data (i32.const 0) "[{\22tick\22:4,\22checksum\22:\22fnv1a64:0000000000000000\22,\22entities\22:[{\22sink\22:{\22consumed\22:{}}}]}]")
  (func (export "alloc") (param $len i32) (result i32) (i32.const 4096))
  (func (export "simulate") (param $ptr i32) (param $len i32) (result i64)
    (i64.or (i64.shl (i64.const 0) (i64.const 32)) (i64.const 88))))
"#;

#[test]
fn run_submission_returns_the_snapshots_and_fuel() {
    let scenario = sink_scenario();
    let run = run_submission(
        &correct_submission(),
        &scenario,
        SandboxLimits::default(),
        "simulate",
    )
    .expect("the submission runs");

    assert_eq!(run.snapshots.len(), 1);
    assert_eq!(run.snapshots[0].tick, 4);
    assert!(run.fuel_consumed > 0, "the run consumed fuel");
}

#[test]
fn score_submission_marks_a_matching_engine_correct() {
    let scenario = sink_scenario();
    let score = score_submission(
        &correct_submission(),
        &scenario,
        SandboxLimits::default(),
        "simulate",
    )
    .expect("the submission runs");

    assert!(
        score.correct,
        "the matching engine scores correct: {score:?}"
    );
    assert!(score.fuel > 0);
    assert!(score.first_mismatch_tick.is_none());
    assert!(score.detail.is_none());
}

#[test]
fn score_submission_marks_a_wrong_engine_incorrect_at_the_first_mismatch() {
    let scenario = sink_scenario();
    let score = score_submission(
        &wrong_submission(),
        &scenario,
        SandboxLimits::default(),
        "simulate",
    )
    .expect("the submission runs (it is wrong, not un-runnable)");

    assert!(!score.correct, "the wrong engine scores incorrect");
    // The mismatch is reported at the first (and only) scheduled snapshot.
    assert_eq!(score.first_mismatch_tick, Some(4));
    assert!(score.detail.is_some(), "an incorrect score explains itself");
}

#[test]
fn defaults_match_the_performance_manifest() {
    let limits = SandboxLimits::default();
    assert_eq!(limits.fuel_limit, 5_000_000_000);
    assert_eq!(limits.max_memory_bytes, 268_435_456);
}
