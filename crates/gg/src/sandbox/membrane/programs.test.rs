//! Tests for the **program library** calls — the two reads that go straight to the api and the one
//! write that sets a flag in the agent's own state.
//!
//! Host-only, for the reason [`session`](super::super::session)'s are: `rerun` sets a field on
//! [`MembraneState`], so everything it guarantees is a property of this file's subject. What the
//! guest owes on top — that the object is absent from a scope without the capability, and that a
//! program that fails afterwards loses its hand-over — is asserted against the real component in
//! `sandbox.test.rs`, where a component compile is already being paid for.

use super::super::test_cabinet::gg::types::ErrorCode;
use super::*;
use crate::sandbox::fake::{CallLog, FakeToolApi, membrane_from};

/// A membrane state whose library already holds `programs` (turn, source).
fn membrane_holding(log: &CallLog, programs: &[(u64, &str)]) -> MembraneState<FakeToolApi> {
    let mut api = FakeToolApi::new(log);
    for (turn, source) in programs {
        api = api.with_program(*turn, source);
    }
    membrane_from(api)
}

#[test]
fn history_lists_the_shape_of_every_kept_program() {
    let log = CallLog::default();
    let mut state = membrane_holding(&log, &[(1, "one"), (2, "two\nlines")]);

    let history = state.history();

    assert_eq!(history.len(), 2);
    assert_eq!(history[0].turn, 1);
    assert_eq!(history[1].turn, 2);
    assert_eq!(history[1].lines, 2);
    assert!(history[1].ok);
}

#[test]
fn history_is_empty_rather_than_a_failure_before_the_first_program() {
    let log = CallLog::default();
    let mut state = membrane_holding(&log, &[]);

    assert!(state.history().is_empty());
}

#[test]
fn get_returns_the_most_recent_program_with_no_turn() {
    let log = CallLog::default();
    let mut state = membrane_holding(&log, &[(1, "first"), (2, "second")]);

    assert_eq!(state.get(None).unwrap(), "second");
    assert_eq!(state.get(Some(1)).unwrap(), "first");
}

#[test]
fn a_turn_the_library_does_not_hold_is_not_found() {
    let log = CallLog::default();
    let mut state = membrane_holding(&log, &[(1, "first")]);

    let error = state.get(Some(9)).unwrap_err();

    assert_eq!(error.code, ErrorCode::NotFound);
    assert!(error.message.contains('1'), "{}", error.message);
}

#[test]
fn a_hand_over_is_registered_rather_than_performed() {
    let log = CallLog::default();
    let mut state = membrane_holding(&log, &[]);

    state
        .rerun("fs.writeFile('a.ts', 'x');".to_string())
        .expect("the first hand-over is accepted");

    // Nothing was dispatched: registering a program is a decision about the turn, and the loop is
    // what acts on it once this program has ended.
    assert!(log.calls().is_empty());
    let parts = state.into_parts();
    assert_eq!(parts.rerun.as_deref(), Some("fs.writeFile('a.ts', 'x');"));
    assert!(!parts.revoked_rerun);
}

#[test]
fn the_first_hand_over_stands_and_a_second_is_refused() {
    let log = CallLog::default();
    let mut state = membrane_holding(&log, &[]);

    state.rerun("the one that runs".to_string()).unwrap();
    let error = state
        .rerun("the one that does not".to_string())
        .unwrap_err();

    assert_eq!(error.code, ErrorCode::Refused);
    assert_eq!(
        state.into_parts().rerun.as_deref(),
        Some("the one that runs"),
        "a silently replaced program is a change the model cannot see, so the first stands"
    );
}

#[test]
fn a_blank_source_is_refused_rather_than_handed_to_a_compiler() {
    let log = CallLog::default();
    let mut state = membrane_holding(&log, &[]);

    let error = state.rerun("   \n  ".to_string()).unwrap_err();

    assert_eq!(error.code, ErrorCode::InvalidArgument);
    assert!(state.into_parts().rerun.is_none());
}

#[test]
fn a_hand_over_is_revoked_when_the_program_then_fails() {
    let log = CallLog::default();
    let mut state = membrane_holding(&log, &[]);
    state.rerun("the replacement".to_string()).unwrap();

    // The one call that revokes: the shim's `catch`, and a sandbox ceiling, both route here.
    state.revoke_completion();

    let parts = state.into_parts();
    assert!(
        parts.rerun.is_none(),
        "a program that did not run to its end did not decide what runs next"
    );
    assert!(
        parts.revoked_rerun,
        "the model is told the replacement was not run, rather than left waiting for it"
    );
}

#[test]
fn a_refused_hand_over_is_not_recorded_on_the_tool_refusal_roster() {
    let log = CallLog::default();
    let mut state = membrane_holding(&log, &[]);

    state.rerun(String::new()).unwrap_err();

    assert!(
        state.into_parts().refusals.is_empty(),
        "`rerun` is not a gg tool, so a line naming it there would name a tool that does not exist"
    );
}
