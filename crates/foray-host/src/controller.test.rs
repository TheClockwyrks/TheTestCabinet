//! Smoke tests for the wasm host: a full match against a trivial controller, and
//! the forfeit paths (a trap and a contract-invalid action).
//!
//! The controllers are assembled from inline WebAssembly text with `wat`, so the
//! tests need no extra build step or committed binary. Each exports the v1 ABI
//! (`memory`, `alloc`, `tick`) and bakes its action JSON into a data segment.

use foray_core::Team;
use foray_core::config::{Rules, Simulation};
use foray_core::replay::REPLAY_VERSION;
use foray_core::state::Ended;
use wasmtime::Engine;

use super::Controller;
use crate::{ForfeitReason, InvokeError, MatchSetup, SandboxLimits, board_for, run_match};

/// A controller that returns a valid all-`Stop` action every tick. `alloc` hands
/// back the same fixed scratch offset every call (the host overwrites it with the
/// observation, which this controller ignores), so memory never grows unbounded
/// across a long match. The action JSON
/// (`{"moves":[{"agent":0,...},{"agent":1,...},{"agent":2,...}]}`, 86 bytes) sits
/// in a data segment at offset 0; the scratch region starts at 4096, well past it.
fn stop_controller() -> Vec<u8> {
    wat::parse_str(STOP_WAT).expect("the stop controller assembles")
}

const STOP_WAT: &str = r#"
(module
  (memory (export "memory") 1)
  (data (i32.const 0) "{\22moves\22:[{\22agent\22:0,\22dir\22:\22Stop\22},{\22agent\22:1,\22dir\22:\22Stop\22},{\22agent\22:2,\22dir\22:\22Stop\22}]}")
  (func (export "alloc") (param $len i32) (result i32) (i32.const 4096))
  (func (export "tick") (param $ptr i32) (param $len i32) (result i64)
    ;; pack (out_ptr=0) << 32 | (out_len=86)
    (i64.or (i64.shl (i64.const 0) (i64.const 32)) (i64.const 86))))
"#;

/// A controller that traps on every `tick` (an `unreachable`). It still exports a
/// working `alloc` so the host can write the observation before the trap.
fn trap_controller() -> Vec<u8> {
    wat::parse_str(TRAP_WAT).expect("the trap controller assembles")
}

const TRAP_WAT: &str = r#"
(module
  (memory (export "memory") 1)
  (func (export "alloc") (param $len i32) (result i32) (i32.const 0))
  (func (export "tick") (param $ptr i32) (param $len i32) (result i64)
    (unreachable)))
"#;

/// A controller that plays a legal all-`Stop` for [`PLAYED_TICKS`] ticks and then
/// traps — a forfeit in the *middle* of a match rather than on the first invoke. The
/// call counter is a mutable global, which survives across invocations because the
/// host holds one `Store`/`Instance` per controller for the whole match.
fn traps_after_playing_controller() -> Vec<u8> {
    wat::parse_str(TRAPS_AFTER_PLAYING_WAT.replace("$PLAYED", &PLAYED_TICKS.to_string()))
        .expect("the trap-after-playing controller assembles")
}

/// How many ticks [`traps_after_playing_controller`] plays before it traps.
const PLAYED_TICKS: u32 = 3;

const TRAPS_AFTER_PLAYING_WAT: &str = r#"
(module
  (memory (export "memory") 1)
  (global $calls (mut i32) (i32.const 0))
  (data (i32.const 0) "{\22moves\22:[{\22agent\22:0,\22dir\22:\22Stop\22},{\22agent\22:1,\22dir\22:\22Stop\22},{\22agent\22:2,\22dir\22:\22Stop\22}]}")
  (func (export "alloc") (param $len i32) (result i32) (i32.const 4096))
  (func (export "tick") (param $ptr i32) (param $len i32) (result i64)
    (global.set $calls (i32.add (global.get $calls) (i32.const 1)))
    ;; The first $PLAYED calls answer legally; the next one traps.
    (if (i32.gt_u (global.get $calls) (i32.const $PLAYED))
      (then (unreachable)))
    (i64.or (i64.shl (i64.const 0) (i64.const 32)) (i64.const 86))))
"#;

/// A controller whose action JSON parses but is contract-invalid: it names only a
/// single agent (id 0), so the team's other two owned agents are missing — a
/// forfeit per the contract's structural check, not a clamp.
fn invalid_controller() -> Vec<u8> {
    wat::parse_str(INVALID_WAT).expect("the invalid controller assembles")
}

const INVALID_WAT: &str = r#"
(module
  (memory (export "memory") 1)
  (data (i32.const 0) "{\22moves\22:[{\22agent\22:0,\22dir\22:\22Stop\22}]}")
  (func (export "alloc") (param $len i32) (result i32) (i32.const 4096))
  (func (export "tick") (param $ptr i32) (param $len i32) (result i64)
    (i64.or (i64.shl (i64.const 0) (i64.const 32)) (i64.const 36))))
"#;

/// A tiny match setup on a small generated board so the match terminates quickly
/// at `max_ticks` (neither stop controller ever scores). The board is generated
/// from the same seed/params recorded in the setup, so the replay reconstructs.
fn test_setup() -> MatchSetup {
    MatchSetup {
        entry: "tick".into(),
        limits: SandboxLimits::default(),
        map_id: "test-mirror".into(),
        seed: 0x1234,
        board_params: foray_core::config::BoardParamsSerde {
            width: 8,
            height: 6,
            seeds_per_half: 2,
            large_seeds_per_half: 1,
            jelly_per_half: 1,
            wall_density_tenths: 2,
        },
        red_id: "red".into(),
        blue_id: "blue".into(),
        rules: Rules::default(),
        // A short cap so the all-stop match ends fast.
        sim: Simulation {
            timestep_ms: 16,
            max_ticks: 50,
        },
    }
}

#[test]
fn full_match_against_stop_controllers_reaches_the_time_limit() {
    let setup = test_setup();
    let board = board_for(&setup);
    let red = stop_controller();
    let blue = stop_controller();

    let summary = run_match(&red, &blue, board, &setup).expect("the match runs");
    let replay = summary.replay;

    assert_eq!(replay.version, REPLAY_VERSION);
    // Neither controller ever moves, so no seed is banked: the match runs to the
    // tick cap and ends as a tied time-limit draw.
    assert_eq!(replay.result.ended, Ended::TimeLimit);
    assert_eq!(replay.result.winner, None);
    assert_eq!(replay.result.ticks, setup.sim.max_ticks);
    assert_eq!(replay.ticks.len() as u32, setup.sim.max_ticks);

    // The published replay must reconstruct bit-for-bit (the board is regenerated
    // from the recorded seed + params).
    replay.reconstruct().expect("the replay reconstructs");
}

#[test]
fn a_trapping_controller_forfeits_and_the_match_still_produces_a_replay() {
    let setup = test_setup();
    let board = board_for(&setup);
    // Red traps; Blue is well-behaved. Red should forfeit and Blue should win.
    let summary =
        run_match(&trap_controller(), &stop_controller(), board, &setup).expect("the match runs");

    // The host reports *why* Red lost (the replay records only that a forfeit
    // happened): Red trapped on tick 0, Blue did not forfeit.
    let forfeit = summary.forfeit.as_ref().expect("a forfeit was recorded");
    assert_eq!(forfeit.tick, 0);
    assert!(matches!(
        forfeit.red,
        Some(ForfeitReason::Invoke(InvokeError::Trap(_)))
    ));
    assert!(forfeit.blue.is_none());

    let replay = summary.replay;
    assert_eq!(replay.result.ended, Ended::Forfeit);
    assert_eq!(replay.result.winner, Some(Team::Blue));
    // Red trapped when asked for its very first action, so the match ended before a
    // single tick was played: zero ticks transpired and zero were recorded. The log
    // carries only the ticks that were *played*, never the one a controller died on.
    assert_eq!(replay.result.ticks, 0);
    assert_eq!(replay.ticks.len(), 0);
    replay.reconstruct().expect("a forfeit replay reconstructs");
}

#[test]
fn a_mid_match_forfeit_records_only_the_ticks_that_were_played() {
    let setup = test_setup();
    let board = board_for(&setup);
    // Red plays legally for PLAYED_TICKS ticks, then traps on the next invoke.
    let summary = run_match(
        &traps_after_playing_controller(),
        &stop_controller(),
        board,
        &setup,
    )
    .expect("the match runs");

    let forfeit = summary.forfeit.as_ref().expect("a forfeit was recorded");
    // Red answered PLAYED_TICKS times, so those ticks advanced; it then trapped when
    // asked for the *next* action, which is the tick the match forfeits on.
    assert_eq!(forfeit.tick, PLAYED_TICKS);

    let replay = summary.replay;
    assert_eq!(replay.result.ended, Ended::Forfeit);
    assert_eq!(replay.result.winner, Some(Team::Blue));

    // The regression this pins: the forfeited tick is neither played nor recorded, so
    // the log holds exactly the ticks that transpired. The recorder used to push that
    // tick and then bail before advancing it, leaving the log one longer than the
    // result claimed — and browser playback, which steps every recorded tick, then ran
    // a tick the engine never did, banking seeds for the surviving colony that the
    // recorded score never counted.
    assert_eq!(replay.result.ticks, PLAYED_TICKS);
    assert_eq!(replay.ticks.len() as u32, PLAYED_TICKS);

    // Reconstruction now re-derives a forfeit's score/kills/tick count and checks them
    // against the committed result (only `winner`/`ended` are taken on trust), so this
    // also proves the recorded score is the score at the moment of the forfeit.
    replay.reconstruct().expect("a forfeit replay reconstructs");
}

#[test]
fn a_contract_invalid_action_forfeits() {
    let setup = test_setup();
    let board = board_for(&setup);
    // Blue emits a structurally invalid action (missing agents); Red is fine.
    let summary = run_match(&stop_controller(), &invalid_controller(), board, &setup)
        .expect("the match runs");
    let replay = summary.replay;

    assert_eq!(replay.result.ended, Ended::Forfeit);
    assert_eq!(replay.result.winner, Some(Team::Red));
}

#[test]
fn a_controller_that_runs_out_of_fuel_forfeits() {
    // A fuel ceiling so small that even calling `alloc`/`tick` exhausts it on the
    // first tick: the controller forfeits and its opponent wins.
    let mut setup = test_setup();
    setup.limits.fuel_per_tick = 1;
    let board = board_for(&setup);

    // Red has a vanishing fuel budget; Blue is well-behaved but also shares the
    // ceiling, so both forfeit on tick 0 — a forfeit draw. The point under test is
    // that fuel exhaustion is classified as a forfeit, not a host error.
    let summary = run_match(&stop_controller(), &stop_controller(), board, &setup)
        .expect("the match runs even when controllers exhaust fuel");
    assert_eq!(summary.replay.result.ended, Ended::Forfeit);
    assert_eq!(summary.replay.result.ticks, 0);
}

#[test]
fn a_module_missing_the_entry_export_fails_to_load() {
    let engine = Engine::default();
    // A module with memory + alloc but no `tick` export.
    let wasm = wat::parse_str(
        r#"(module (memory (export "memory") 1)
            (func (export "alloc") (param i32) (result i32) (i32.const 0)))"#,
    )
    .unwrap();
    let err = match Controller::load(&engine, &wasm, "tick", SandboxLimits::default()) {
        Ok(_) => panic!("loading without the entry export should fail"),
        Err(err) => err,
    };
    assert!(
        err.to_string().contains("tick"),
        "error names the missing export: {err}"
    );
}
