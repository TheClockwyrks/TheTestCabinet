use super::*;
use serde_json::json;
use std::fs;
use tempfile::TempDir;
use test_cabinet_core::gg::{GgCapabilityConfig, GgCapabilitySet};

/// A capability set with the `fsm` capability enabled and its `machine` param set to `machine` (or,
/// when `machine` is empty, with no `machine` param at all).
fn fsm_set(machine: &str) -> GgCapabilitySet {
    let mut set = GgCapabilitySet::minimal("mock/echo");
    let mut cap = GgCapabilityConfig::enabled(CAPABILITY_FSM);
    if !machine.is_empty() {
        cap.params = json!({ PARAM_MACHINE: machine });
    }
    set.agents[0].capabilities.push(cap);
    set
}

/// Each built-in machine resolves to its ordered states — the process order is a fixed property of
/// the machine, authored in the harness.
#[test]
fn built_in_machines_have_their_states_in_order() {
    let tdd = FsmRuntime::resolve(fsm_set(MACHINE_TDD).root());
    assert_eq!(tdd.machine_name(), MACHINE_TDD);
    assert_eq!(
        state_names(&tdd),
        vec!["write_tests", "implement", "verify"],
        "tdd is write tests → implement → verify"
    );

    let plan = FsmRuntime::resolve(fsm_set(MACHINE_PLAN_FIRST).root());
    assert_eq!(
        state_names(&plan),
        vec!["plan", "implement"],
        "plan-first is plan → implement"
    );
}

/// The names of a runtime's machine states, in order.
fn state_names(fsm: &FsmRuntime) -> Vec<&'static str> {
    fsm.machine
        .as_ref()
        .expect("an active machine")
        .states
        .iter()
        .map(|state| state.name)
        .collect()
}

/// An absent `fsm` capability, an enabled one with no `machine`, and an enabled one naming a machine
/// gg does not ship all leave **no** FSM driving the run (the feature is off).
#[test]
fn no_or_unknown_machine_is_inactive() {
    // Absent capability.
    assert!(!FsmRuntime::resolve(GgCapabilitySet::minimal("mock/echo").root()).is_active());
    // Enabled but no `machine` param.
    assert!(!FsmRuntime::resolve(fsm_set("").root()).is_active());
    // Enabled with an unrecognized machine name.
    let bogus = FsmRuntime::resolve(fsm_set("does-not-exist").root());
    assert!(!bogus.is_active(), "an unknown machine drives nothing");
    // The disabled capability is off even with a machine named.
    let mut disabled = fsm_set(MACHINE_TDD);
    disabled.agents[0]
        .capabilities
        .iter_mut()
        .find(|c| c.id == CAPABILITY_FSM)
        .unwrap()
        .enabled = false;
    assert!(!FsmRuntime::resolve(disabled.root()).is_active());
}

/// `configured_machine` reports the raw configured name (so the announce path can warn about an
/// unrecognized one), and `is_builtin_machine` recognizes only the shipped machines.
#[test]
fn configured_machine_and_builtins() {
    assert_eq!(configured_machine(&fsm_set(MACHINE_TDD)), Some(MACHINE_TDD));
    assert_eq!(configured_machine(&fsm_set("bogus")), Some("bogus"));
    assert_eq!(configured_machine(&fsm_set("")), None);
    assert_eq!(
        configured_machine(&GgCapabilitySet::minimal("mock/echo")),
        None
    );

    assert!(is_builtin_machine(MACHINE_TDD));
    assert!(is_builtin_machine(MACHINE_PLAN_FIRST));
    assert!(!is_builtin_machine("bogus"));
}

/// The `TestsExist` guard refuses until a test file is present, then allows the advance — the
/// concrete enforcement that keeps `tdd` in `write_tests` until tests exist. It recognizes both a
/// test-marked file name and any file under a test directory, and ignores VCS/dependency noise.
#[test]
fn tests_exist_guard_checks_the_workspace() {
    let dir = TempDir::new().unwrap();
    let guard = AdvanceGuard::TestsExist;

    // Empty workspace: refused.
    assert!(guard.evaluate(dir.path()).is_err());

    // A non-test source file alone does not satisfy it.
    fs::write(dir.path().join("game.js"), "// impl").unwrap();
    assert!(
        guard.evaluate(dir.path()).is_err(),
        "an implementation file is not a test"
    );

    // A test-marked file name satisfies it.
    fs::write(dir.path().join("game.test.js"), "// test").unwrap();
    assert!(guard.evaluate(dir.path()).is_ok());
}

/// A file living under a conventional test directory counts as a test for the guard.
#[test]
fn tests_exist_guard_recognizes_a_test_directory() {
    let dir = TempDir::new().unwrap();
    let guard = AdvanceGuard::TestsExist;
    let tests = dir.path().join("tests");
    fs::create_dir_all(&tests).unwrap();
    fs::write(tests.join("smoke.js"), "// a test under tests/").unwrap();
    assert!(guard.evaluate(dir.path()).is_ok());
}

/// A stray "test"-named file inside an ignored directory (like `node_modules`) must not satisfy the
/// guard — the walk skips dependency/VCS noise.
#[test]
fn tests_exist_guard_ignores_dependency_noise() {
    let dir = TempDir::new().unwrap();
    let guard = AdvanceGuard::TestsExist;
    let noise = dir.path().join("node_modules").join("dep");
    fs::create_dir_all(&noise).unwrap();
    fs::write(noise.join("thing.test.js"), "// vendored test").unwrap();
    assert!(
        guard.evaluate(dir.path()).is_err(),
        "a test file inside node_modules does not count as the agent's tests"
    );
}

/// The `ImplementationExists` guard requires a non-test source file — it keeps `tdd` in `implement`
/// until there is something to verify, and does not count the tests themselves.
#[test]
fn implementation_exists_guard_requires_a_non_test_file() {
    let dir = TempDir::new().unwrap();
    let guard = AdvanceGuard::ImplementationExists;

    // Only a test file: refused (there is nothing to verify yet).
    fs::write(dir.path().join("game.test.js"), "// test").unwrap();
    assert!(
        guard.evaluate(dir.path()).is_err(),
        "the tests alone are not an implementation"
    );

    // A real source file satisfies it.
    fs::write(dir.path().join("game.js"), "// impl").unwrap();
    assert!(guard.evaluate(dir.path()).is_ok());
}

/// The `Unconditional` guard always allows the advance (the agent decides its work is ready).
#[test]
fn unconditional_guard_always_allows() {
    let dir = TempDir::new().unwrap();
    assert!(AdvanceGuard::Unconditional.evaluate(dir.path()).is_ok());
}

/// The per-state toolset gate: a read-only state (`plan-first`'s `plan`) offers only read-only tools
/// plus `advance_state`; an `All` state offers everything; and `advance_state` is offered only while
/// the current state is one the agent leaves by calling it (not a terminal or review state).
#[test]
fn tool_gating_mirrors_the_state_policy() {
    // plan-first plan state: read-only.
    let plan = FsmRuntime::resolve(fsm_set(MACHINE_PLAN_FIRST).root());
    assert_eq!(plan.current_state().unwrap().name, "plan");
    assert!(plan.offers("read_file"), "read-only tools are offered");
    assert!(plan.offers("list_dir"));
    assert!(
        !plan.offers("write_file"),
        "mutating tools are withheld in the read-only plan state"
    );
    assert!(
        plan.offers(ADVANCE_STATE_TOOL),
        "advance_state (the exit) is offered in the plan state"
    );

    // tdd write_tests: full toolset, and advance_state offered (Advance exit).
    let tdd = FsmRuntime::resolve(fsm_set(MACHINE_TDD).root());
    assert!(tdd.offers("write_file"), "an All state offers every tool");
    assert!(tdd.offers(ADVANCE_STATE_TOOL));

    // A run with no machine never offers advance_state, but does not restrict anything else.
    let none = FsmRuntime::disabled();
    assert!(!none.offers(ADVANCE_STATE_TOOL));
    assert!(none.offers("write_file"));
}

/// `advance` walks forward one state at a time, never skipping and never running off the end.
#[test]
fn advance_steps_through_states() {
    let mut fsm = FsmRuntime::resolve(fsm_set(MACHINE_TDD).root());
    assert_eq!(fsm.current_index(), 0);
    assert_eq!(fsm.current_state().unwrap().name, "write_tests");

    assert_eq!(fsm.advance().map(|s| s.name), Some("implement"));
    assert_eq!(fsm.current_index(), 1);
    assert_eq!(fsm.advance().map(|s| s.name), Some("verify"));
    assert_eq!(fsm.current_index(), 2);
    // No skipping and no running off the end: at the last state `advance` yields nothing.
    assert_eq!(fsm.advance().map(|s| s.name), None);
    assert_eq!(fsm.current_index(), 2);
}
