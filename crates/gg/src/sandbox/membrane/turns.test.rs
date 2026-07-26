//! Tests for the three turn-level transitions, which always fail at the membrane.

use super::super::ErrorCode;
use super::*;
use crate::sandbox::fake::{CallLog, membrane};

/// Each of the three refuses with `refused` and the guidance that says what to do instead, is
/// recorded as a **refusal** rather than as a serviced call, and — the part that matters most —
/// never reaches the invoker: there is no dispatch to make, because a mode change is not a value.
#[test]
fn every_turn_level_transition_is_refused_without_reaching_the_loop() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    let plan_mode = state
        .enter_plan_mode()
        .expect_err("entering plan mode is refused");
    let submit = state
        .submit_plan("the plan".to_string())
        .expect_err("submitting a plan is refused");
    let advance = state
        .advance_state(Some("done".to_string()))
        .expect_err("advancing the state is refused");

    for (error, tool, what) in [
        (&plan_mode, ENTER_PLAN_MODE_TOOL, "entering plan mode"),
        (&submit, SUBMIT_PLAN_TOOL, "submitting a plan"),
        (
            &advance,
            ADVANCE_STATE_TOOL,
            "advancing the run's process state",
        ),
    ] {
        assert_eq!(error.code, ErrorCode::Refused, "{tool}");
        assert_eq!(error.tool, tool);
        assert!(
            error.message.contains(what),
            "the refusal must say what was attempted: {}",
            error.message
        );
        assert!(
            error.message.contains("turn-level transition"),
            "the refusal must explain why: {}",
            error.message
        );
        assert!(
            error.message.contains("Do the work directly instead."),
            "the refusal must say how to proceed: {}",
            error.message
        );
        assert!(
            !error.message.contains("next turn"),
            "the refusal must NOT promise a later turn: under responses-as-code every turn is a \
             program, so there is none that could make the transition: {}",
            error.message
        );
    }

    assert!(
        log.calls().is_empty(),
        "a turn-level transition must never reach the loop"
    );

    let parts = state.into_parts();
    assert!(
        parts.calls.is_empty(),
        "a refusal is not a serviced call and must not inflate the turn's tool-call count"
    );
    assert_eq!(parts.refusals.len(), 3);
    assert_eq!(
        parts
            .refusals
            .iter()
            .map(|refusal| refusal.name.as_str())
            .collect::<Vec<_>>(),
        [ENTER_PLAN_MODE_TOOL, SUBMIT_PLAN_TOOL, ADVANCE_STATE_TOOL]
    );
}
