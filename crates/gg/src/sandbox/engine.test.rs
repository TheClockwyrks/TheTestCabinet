//! Tests for the process-wide engine and the compiled-component cache.
//!
//! **These cost a real compile.** Every test here that touches [`component`] pays a full
//! `Component::new` of the ~13 MB artifact in its own process, because `cargo nextest` runs one
//! process per test — measured at ~1.2 s with the root manifest's `[profile.dev.package.*]`
//! cranelift pins and ~7.6 s without them. That is the whole reason the end-to-end tests in
//! `sandbox.test.rs` are consolidated into a handful of functions instead of one per behaviour.

use super::*;
use crate::sandbox::fake::{CallLog, FakeToolApi, process_isolated};
use crate::sandbox::{SandboxLimits, run_program};

/// **HR2: the component is compiled once per process, never per turn.**
///
/// Asserted with a counter rather than a stopwatch. A timing test would pass on a fast machine
/// whatever the code did, and flake on a loaded one; the counter says exactly what is claimed —
/// `Component::new` ran once — and keeps saying it when the machine is busy.
///
/// Every route to the component is exercised in this one process, because each of them would
/// otherwise pay its own compile in its own test: the warm-up, two direct [`component`] calls, and
/// two whole [`run_program`] calls that prove nothing on the turn path reaches around the cache.
#[test]
fn the_component_compiles_once_per_process() {
    // The whole property here is about the process-global compile counter and the cold 0→1
    // transition, which only exist when this test owns its process. `cargo nextest` — the runner the
    // repo mandates and CI uses — guarantees that; under the forbidden `cargo test` the parallel
    // threads race to compile the shared component and the counter is meaningless, so there is
    // nothing to prove. See [`process_isolated`] for the full reasoning.
    if !process_isolated() {
        return;
    }

    assert_eq!(compiles(), 0, "nothing has compiled yet in this process");

    // Warming up is what moves the compile off the first code turn's critical path. On a one-core
    // container that compile is ~4.8 s, which is the difference between a first turn that feels
    // instant and one that does not.
    let warmed =
        crate::sandbox::precompile().expect("the warm-up compiles the committed component");
    assert_eq!(compiles(), 1, "the warm-up compiles it");
    // The warm-up is the caller that paid the compile, so it is the one that reports how long it
    // took — the figure the run logs, and the only measurement of this machine's compile cost that
    // does not require timing a whole turn from outside.
    assert!(
        warmed.is_some_and(|took| took > Duration::ZERO),
        "the warm-up did not report how long the compile took: {warmed:?}"
    );
    assert_eq!(
        crate::sandbox::precompile().expect("a second warm-up is free"),
        None,
        "a warm-up that found the component already compiled waited for nothing"
    );
    assert_eq!(compiles(), 1, "the warm-up is idempotent");

    let (first, first_wait) = component().expect("the committed component is ready");
    let (second, second_wait) = component().expect("the second call is served from the cache");
    assert_eq!(compiles(), 1, "asking for it must not recompile");
    // Neither call compiled anything, so neither waited: the compile-wait figure is `Some` only for
    // the caller that actually paid the compile, which here was the warm-up above.
    assert_eq!(first_wait, None, "a cached component reported a wait");
    assert_eq!(second_wait, None, "a cached component reported a wait");
    // The *same* instance, not an equal one: a `Component` is bound to the engine that compiled it,
    // and sharing that one instance is what makes reuse free.
    assert!(
        std::ptr::eq(first, second),
        "the cache returned a different instance"
    );

    let log = CallLog::default();
    run_program(
        "return 1;",
        &[],
        SandboxLimits::default(),
        None,
        FakeToolApi::new(&log),
    );
    assert_eq!(compiles(), 1, "running a program must not recompile");

    run_program(
        "return 2;",
        &[],
        SandboxLimits::default(),
        None,
        FakeToolApi::new(&log),
    );
    assert_eq!(
        compiles(),
        1,
        "a second turn must not recompile — this is the whole latency design"
    );
}

/// A component that is not a component at all is a compile error, not a panic. Unreachable in a
/// real build — the artifact is committed and every test here compiles it — but the classification
/// has to exist, because it is what tells the loop that a failure is in the ARTIFACT rather than in
/// anything the model wrote.
#[test]
fn bad_component_bytes_are_a_compile_error() {
    let Err(error) = compile_bytes(b"this is not a wasm component") else {
        panic!("garbage must not compile as a component");
    };
    assert!(
        matches!(error, SandboxError::Compile(_)),
        "expected a compile error, got {error:?}"
    );
    assert!(
        error.is_artifact_defect(),
        "a bad artifact must be reported as an artifact defect, not as a program fault"
    );
}

/// The committed artifact is within the documented size band.
///
/// It is ~13.4 MB because it embeds a JavaScript engine. A build that produced something far
/// smaller dropped the engine; one far larger picked up something it should not have. Either way
/// the number belongs in a test rather than only in prose, because the artifact is committed and
/// nobody re-reads its size.
#[test]
fn the_committed_component_is_within_the_documented_size_band() {
    let bytes = component_bytes().len();
    assert!(
        (12 * 1024 * 1024..=15 * 1024 * 1024).contains(&bytes),
        "the committed component is {bytes} bytes, outside the documented 12–15 MiB band"
    );
}

/// **The program that pays the compile reports what it cost, and no other program does.**
///
/// [`precompile`](crate::sandbox::precompile) *overlaps* the compile with the run's first model
/// request rather than eliminating it, so on a container with one or two cores a model that answers
/// quickly gets its first program back before the warm-up has finished — and that program then
/// compiles the component inside its own span. This test is that case: nothing warms up first, so
/// the first program pays, and the figure it reports is what makes "did this program wait on the one
/// shared compile?" answerable from the turn's own telemetry instead of from timestamps across
/// sibling runs.
#[test]
fn the_program_that_pays_the_compile_reports_what_it_cost() {
    // "The first program pays the compile" is a process-global, once-per-process fact: it is only
    // observable when this test owns its process and is therefore the caller that compiles the
    // component. `cargo nextest` (the mandated runner, and CI) guarantees that; under `cargo test`
    // some sibling thread may already have compiled it — or several may be racing to — so neither the
    // counter nor `compile_wait` is a truth to assert. See [`process_isolated`].
    if !process_isolated() {
        return;
    }

    let log = CallLog::default();
    let (cold, _api) = run_program(
        "return 1;",
        &[],
        SandboxLimits::default(),
        None,
        FakeToolApi::new(&log),
    );
    assert_eq!(compiles(), 1, "the first program compiled the component");
    assert!(
        cold.compile_wait
            .is_some_and(|waited| waited > Duration::ZERO),
        "the program that compiled it did not report what that cost: {:?}",
        cold.compile_wait
    );

    let (warm, _api) = run_program(
        "return 2;",
        &[],
        SandboxLimits::default(),
        None,
        FakeToolApi::new(&log),
    );
    assert_eq!(compiles(), 1, "and no later program recompiles it");
    assert_eq!(
        warm.compile_wait, None,
        "a program served from the cache waited for nothing, so it must report nothing"
    );
}
