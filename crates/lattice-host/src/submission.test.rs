//! Smoke tests for the submission loader and the once-per-scenario invocation.
//!
//! The submissions are assembled from inline WebAssembly text with `wat`, so the
//! tests need no extra build step or committed binary. Each exports the v1 ABI
//! (`memory`, `alloc`, `simulate`) and bakes its `state` JSON into a data segment.

use wasmtime::{Config, Engine};

use super::{InvokeError, Submission};

/// The default per-scenario limits the tests load submissions under.
const FUEL: u64 = 5_000_000_000;
const MEMORY: usize = 268_435_456;

/// A fuel-metered engine (the host always enables fuel; the tests mirror that so
/// the fuel reading and the out-of-fuel classification are exercised).
fn engine() -> Engine {
    let mut config = Config::new();
    config.consume_fuel(true);
    Engine::new(&config).expect("a fuel-metered engine builds")
}

/// A submission that returns one fixed, valid `state` snapshot every call. The
/// 88-byte `state` JSON is the canonical output for a single-sink scenario (one
/// snapshot at tick 4, an empty `consumed` map) — exactly what
/// `lattice-core`'s oracle produces — so it scores `correct` against that
/// scenario. It ignores the scenario the host writes in (returning a constant),
/// which is fine for the host smoke test: the host's job is to marshal bytes and
/// meter fuel, not to judge whether the engine actually simulated.
fn echo_state_submission() -> Vec<u8> {
    wat::parse_str(STATE_WAT).expect("the state submission assembles")
}

const STATE_WAT: &str = r#"
(module
  (memory (export "memory") 1)
  (data (i32.const 0) "[{\22tick\22:4,\22checksum\22:\22fnv1a64:aba7e962a95ec70d\22,\22entities\22:[{\22sink\22:{\22consumed\22:{}}}]}]")
  (func (export "alloc") (param $len i32) (result i32) (i32.const 4096))
  (func (export "simulate") (param $ptr i32) (param $len i32) (result i64)
    ;; pack (out_ptr=0) << 32 | (out_len=88)
    (i64.or (i64.shl (i64.const 0) (i64.const 32)) (i64.const 88))))
"#;

/// A submission that traps on every `simulate` (an `unreachable`). It still
/// exports a working `alloc` so the host can write the scenario before the trap.
fn trap_submission() -> Vec<u8> {
    wat::parse_str(TRAP_WAT).expect("the trap submission assembles")
}

const TRAP_WAT: &str = r#"
(module
  (memory (export "memory") 1)
  (func (export "alloc") (param $len i32) (result i32) (i32.const 0))
  (func (export "simulate") (param $ptr i32) (param $len i32) (result i64)
    (unreachable)))
"#;

#[test]
fn a_well_formed_submission_returns_its_state_and_consumes_fuel() {
    let engine = engine();
    let mut submission =
        Submission::load(&engine, &echo_state_submission(), "simulate", FUEL, MEMORY)
            .expect("the submission loads");

    let scenario = br#"{"version":1,"grid":{"width":4,"height":1},"ticks":4,"snapshots":[4],"entities":[{"type":"sink","x":3,"y":0,"dir":"W"}]}"#;
    let (state, fuel) = submission.invoke(scenario).expect("the submission runs");

    // The bytes read back are exactly the baked `state` JSON.
    assert_eq!(state.len(), 88);
    assert!(state.starts_with(b"[{\"tick\":4"));
    // Some fuel was consumed (alloc + simulate ran), and well under the ceiling.
    assert!(fuel > 0, "the run consumed fuel");
    assert!(fuel < FUEL, "the run did not exhaust the ceiling");
}

#[test]
fn a_trapping_submission_reports_a_trap() {
    let engine = engine();
    let mut submission = Submission::load(&engine, &trap_submission(), "simulate", FUEL, MEMORY)
        .expect("the submission loads");

    let scenario =
        br#"{"version":1,"grid":{"width":4,"height":1},"ticks":4,"snapshots":[4],"entities":[]}"#;
    let err = submission
        .invoke(scenario)
        .expect_err("a trapping submission fails the run");
    assert!(matches!(err, InvokeError::Trap(_)), "got {err:?}");
}

#[test]
fn a_submission_that_runs_out_of_fuel_is_classified_as_out_of_fuel() {
    // A fuel ceiling so small that even calling `alloc`/`simulate` exhausts it.
    let engine = engine();
    let mut submission = Submission::load(&engine, &echo_state_submission(), "simulate", 1, MEMORY)
        .expect("the submission loads");

    let scenario =
        br#"{"version":1,"grid":{"width":4,"height":1},"ticks":4,"snapshots":[4],"entities":[]}"#;
    let err = submission
        .invoke(scenario)
        .expect_err("a starved submission fails the run");
    assert!(matches!(err, InvokeError::OutOfFuel), "got {err:?}");
}

#[test]
fn a_module_missing_the_entry_export_fails_to_load() {
    let engine = engine();
    // A module with memory + alloc but no `simulate` export.
    let wasm = wat::parse_str(
        r#"(module (memory (export "memory") 1)
            (func (export "alloc") (param i32) (result i32) (i32.const 0)))"#,
    )
    .unwrap();
    let err = match Submission::load(&engine, &wasm, "simulate", FUEL, MEMORY) {
        Ok(_) => panic!("loading without the entry export should fail"),
        Err(err) => err,
    };
    assert!(
        err.to_string().contains("simulate"),
        "error names the missing export: {err}"
    );
}
