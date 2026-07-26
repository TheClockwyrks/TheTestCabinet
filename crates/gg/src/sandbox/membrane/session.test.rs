//! Tests for `finish` — the one model-facing membrane function that ends the run.
//!
//! Host-only, and that is the design rather than a testing convenience: `finish` sets a flag in the
//! agent's own [`MembraneState`], so everything it guarantees is a property of this file's subject
//! and none of it is a property of the guest. What the guest still owes — that the call returns
//! rather than stopping the program, and that a program failing afterwards loses the ending — is
//! asserted against the real component in `a_program_ends_the_run_by_calling_finish`
//! (`crates/gg/src/sandbox.test.rs`), which is where a component compile is already being paid for.

use std::time::{Duration, Instant};

use super::super::ErrorCode;
use super::super::test_cabinet::gg::files::Host as FilesHost;
use super::*;
use crate::sandbox::FINISH_FUNCTION;
use crate::sandbox::fake::{CallLog, all_tools, canned_outcome, membrane, membrane_with};

/// One call sets the flag: the completion is recorded verbatim and survives out of the store.
#[test]
fn the_first_finish_records_the_completion() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    state
        .finish("wrote MANIFEST.md and verified it lists all four files".to_string())
        .expect("the first completion is accepted");

    let parts = state.into_parts();
    let completion = parts.completion.expect("the completion survives the store");
    assert_eq!(
        completion.summary, "wrote MANIFEST.md and verified it lists all four files",
        "the summary is carried verbatim; it becomes the run's final text"
    );
    assert_eq!(
        completion.superseded, 0,
        "one call is not a superseded completion"
    );
}

/// A second call replaces the summary, and the replacements are counted.
///
/// Last-wins rather than first-wins, because there is no longer an unwind that makes a second call
/// evidence of a program fighting its own harness: `finish` returns, so two calls is an ordinary
/// shape — two branches that both run, a call inside a loop — and the later summary is the one
/// written with more of the program's work behind it. Nothing about it is a failure, so nothing is
/// thrown and nothing lands in the refusal roster; the count is kept only so the loop can say so on
/// the operator's stream.
#[test]
fn a_later_finish_replaces_the_summary_and_the_replacements_are_counted() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    state
        .finish("the first word".to_string())
        .expect("accepted");
    state
        .finish("the second word".to_string())
        .expect("a second call is not a failure");
    state
        .finish("the last word".to_string())
        .expect("nor is a third");

    let parts = state.into_parts();
    let completion = parts.completion.expect("a completion stands");
    assert_eq!(
        completion.summary, "the last word",
        "the last summary is the run's: it is the one written with the most work behind it"
    );
    assert_eq!(completion.superseded, 2);
    assert!(
        parts.refusals.is_empty(),
        "a replaced summary is counted, never recorded as a refused tool call: {:?}",
        parts.refusals
    );
}

/// An empty summary finishes nothing, and says what to write instead.
///
/// The summary becomes the run's final text — and, for a subagent, its entire answer to whoever
/// asked for the work — so "the run is over and I have nothing to say about it" is not a completion
/// gg accepts on a model's behalf. It is checked here rather than in the guest because this is the
/// trust boundary, and the guest may not be the only thing standing between a blank final word and
/// the run record.
#[test]
fn an_empty_summary_finishes_nothing() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    for blank in ["", "   ", "\n\t "] {
        let refused = state
            .finish(blank.to_string())
            .expect_err("a blank summary is not a completion");
        assert_eq!(refused.code, ErrorCode::InvalidArgument);
        assert_eq!(
            refused.tool, FINISH_FUNCTION,
            "the failure names the function that raised it, which is not a gg tool"
        );
        assert!(
            refused.message.contains("The run is NOT finished"),
            "{}",
            refused.message
        );
    }

    let parts = state.into_parts();
    assert!(
        parts.completion.is_none(),
        "the run is still live: {:?}",
        parts.completion
    );
}

/// **A revoked completion is taken back and kept.**
///
/// The two callers are the two ways a program can fail after `finish` returned — the shim's `catch`
/// and a sandbox ceiling — and both mean the same thing: the summary describes checks the program
/// never finished running. The summary is kept rather than dropped so the turn's feedback can tell
/// the model its ending was cancelled; a model whose ending vanished silently would simply write it
/// again and read the same failure.
#[test]
fn a_revoked_completion_is_taken_back_and_kept() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    state.finish("wrote it all".to_string()).expect("accepted");
    state.revoke_completion();

    let parts = state.into_parts();
    assert!(parts.completion.is_none(), "the ending is gone");
    assert_eq!(parts.revoked_completion.as_deref(), Some("wrote it all"));

    // Revoking when nothing was declared is a no-op, not a phantom ending to report.
    let log = CallLog::default();
    let mut state = membrane(&log);
    state.revoke_completion();
    let parts = state.into_parts();
    assert!(parts.completion.is_none());
    assert!(parts.revoked_completion.is_none());
}

/// **A spent wall-clock budget does not withhold the exit.**
///
/// Every tool call is refused once the run's deadline has passed, which is right: gg should not
/// start work it cannot finish. Finishing performs no work and ends the run, which is exactly what a
/// spent budget wants — refusing it would trap a model that has done its job inside a run with no way
/// to say so.
#[test]
fn finishing_is_allowed_after_the_wall_clock_budget_is_spent() {
    let log = CallLog::default();
    let spent = Instant::now() - Duration::from_secs(1);
    let mut state = membrane_with(&log, &all_tools(), Some(spent), canned_outcome);

    let refused = state
        .list_dir(None)
        .expect_err("a spent budget refuses ordinary work");
    assert_eq!(refused.code, ErrorCode::LimitExceeded);

    state
        .finish("stopped early: the run's budget ran out mid-way".to_string())
        .expect("finishing is never refused for a spent budget");

    let parts = state.into_parts();
    assert_eq!(
        parts
            .completion
            .expect("the completion stands")
            .summary
            .as_str(),
        "stopped early: the run's budget ran out mid-way"
    );
}

/// Finishing is neither a tool call nor a refusal: it never reaches the invoker, it does not appear
/// in the roster the model reads next turn, and it is not in `refusals` either.
///
/// Both halves matter. A serviced call would emit `ToolCall`/`ToolResult` telemetry and a replay
/// entry for something no tool implements; a refusal would put `finish` in front of the model as a
/// call gg *declined*, which is the opposite of what happened.
#[test]
fn finishing_is_neither_a_tool_call_nor_a_refusal() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    state.finish("done".to_string()).expect("accepted");

    assert!(
        log.calls().is_empty(),
        "finishing dispatches nothing: there is no tool to invoke"
    );
    let parts = state.into_parts();
    assert!(parts.calls.is_empty(), "{:?}", parts.calls);
    assert_eq!(parts.calls_suppressed, 0);
    assert!(parts.refusals.is_empty(), "{:?}", parts.refusals);
    assert_eq!(parts.refusals_suppressed, 0);
}

/// **Work after a completion is ordinary work.** The call is dispatched, serviced and recorded like
/// any other.
///
/// It used to be refused, on the reasoning that gg should do nothing more once the model has
/// declared the run over. That reasoning belonged to a `finish` that stopped the program: with one
/// that returns, the statements after it are statements the model wrote knowing they would run — a
/// last write, a tidying pass, a check it wanted logged — and refusing them would turn a shape the
/// prompt calls harmless into a failed turn.
#[test]
fn a_tool_call_after_a_completion_is_ordinary_work() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    state.finish("done".to_string()).expect("accepted");
    state
        .list_dir(None)
        .expect("a finished run still does the work its program asks for");

    assert_eq!(
        log.names(),
        ["list_dir"],
        "the call reaches the loop like any other"
    );

    let parts = state.into_parts();
    assert_eq!(
        parts
            .calls
            .iter()
            .map(|call| call.name.as_str())
            .collect::<Vec<_>>(),
        ["list_dir"],
        "and is recorded in the roster like any other"
    );
    assert!(parts.refusals.is_empty(), "{:?}", parts.refusals);
    assert_eq!(
        parts.completion.expect("the ending still stands").summary,
        "done",
        "later work does not retract the ending — only a failure does"
    );
}

/// A tool withheld by the run's capability set is refused as *unavailable*, whether or not the run
/// has been declared finished — the capability backstop is the only gate on this path now.
#[test]
fn a_withheld_tool_is_refused_as_unavailable() {
    let log = CallLog::default();
    let mut state = membrane_with(&log, &[], None, canned_outcome);

    let refused = state.list_dir(None).expect_err("the tool is not offered");

    assert_eq!(refused.code, ErrorCode::Unavailable);
    assert!(
        refused.message.contains("unknown tool"),
        "{}",
        refused.message
    );
}
