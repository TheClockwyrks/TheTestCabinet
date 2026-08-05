//! Tests for the **ending calls** — the model-facing membrane functions that end a session.
//!
//! Host-only, and that is the design rather than a testing convenience: an ending call sets a flag in
//! the agent's own [`MembraneState`], so everything it guarantees is a property of this file's
//! subject and none of it is a property of the guest. What the guest still owes — that the call
//! returns rather than stopping the program, and that a program failing afterwards loses the ending —
//! is asserted against the real component in `sandbox.test.rs`, which is where a component compile is
//! already being paid for.

use std::time::{Duration, Instant};

use super::super::ErrorCode;
use super::super::test_cabinet::gg::files::Host as FilesHost;
use super::*;
use crate::ending::EndingRole;
use crate::sandbox::fake::{
    CallLog, all_tools, canned_outcome, membrane, membrane_as, membrane_ending, membrane_in,
    membrane_with, typescript,
};
use crate::sandbox::language::fixture::fixture_language;
use crate::sandbox::{FINISH_FUNCTION, RunEnding};

/// The summary a [`Finished`](Ending::Finished) ending carries, or a panic naming what it was
/// instead — every assertion below is about a specific ending, so a wrong variant is a test failure
/// rather than an `Option` to unwrap.
fn summary_of(ending: &Ending) -> &str {
    match ending {
        Ending::Finished { summary } => summary,
        other => panic!("expected a finished ending, got {other:?}"),
    }
}

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
        summary_of(&completion.ending),
        "wrote MANIFEST.md and verified it lists all four files",
        "the summary is carried verbatim; it becomes the session's final text"
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
        summary_of(&completion.ending),
        "the last word",
        "the last summary is the session's: it is the one written with the most work behind it"
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
        assert!(refused.message.contains("NOT over"), "{}", refused.message);
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
    assert_eq!(
        parts.revoked_completion,
        Some(Ending::Finished {
            summary: "wrote it all".to_string(),
        })
    );

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
        summary_of(&parts.completion.expect("the completion stands").ending),
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
        summary_of(&parts.completion.expect("the ending still stands").ending),
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

/// **A reviewer's verdict is a typed declaration, not prose to be read back.**
///
/// `approve` takes nothing — an approval carries no further obligation — and `request-changes` takes
/// the list of changes, which is refused if there is nothing actionable in it. That refusal is the
/// whole point: the list is dispatched verbatim to the agent that must fix the work, and an empty one
/// would give it nothing to do.
#[test]
fn a_reviewer_declares_a_verdict() {
    let log = CallLog::default();
    let mut state = membrane_as(&log, EndingRole::Review);

    state
        .approve()
        .expect("an approval carries nothing to refuse");
    assert_eq!(
        state
            .into_parts()
            .completion
            .expect("a verdict stands")
            .ending,
        Ending::Approved
    );

    let log = CallLog::default();
    let mut state = membrane_as(&log, EndingRole::Review);
    state
        .request_changes(vec![
            "  fix the off-by-one in `step()`  ".to_string(),
            "   ".to_string(),
        ])
        .expect("a list with one real item is accepted");
    assert_eq!(
        state
            .into_parts()
            .completion
            .expect("a verdict stands")
            .ending,
        Ending::ChangesRequested {
            items: vec!["fix the off-by-one in `step()`".to_string()],
        },
        "blank entries are dropped and the rest trimmed"
    );
}

/// A rejection with nothing to act on is refused, and the refusal names the call that *was*
/// appropriate — spelled the way this program would write it, not in gg's own vocabulary.
#[test]
fn a_rejection_with_no_changes_is_refused() {
    let log = CallLog::default();
    let mut state = membrane_as(&log, EndingRole::Review);

    for empty in [vec![], vec![String::new()], vec!["  ".to_string()]] {
        let refused = state
            .request_changes(empty)
            .expect_err("a rejection with nothing in it is not a verdict");
        assert_eq!(refused.code, ErrorCode::InvalidArgument);
        assert_eq!(
            refused.tool, "request_changes",
            "the identity field is gg's own name for the call, as it is for every bound tool"
        );
        assert!(
            refused.message.contains("`review.approve`"),
            "the instruction is TypeScript's spelling: {}",
            refused.message
        );
    }

    let parts = state.into_parts();
    assert!(
        parts.completion.is_none(),
        "the reviewer is still working: {:?}",
        parts.completion
    );
}

/// **An ending outside this agent's role is refused by the HOST, not merely absent from its scope.**
///
/// This is the check the whole file's subject rests on. A verdict is the one declaration nothing
/// downstream re-examines — [the loop](crate::agent) reads it straight off the ending and never
/// re-asks whose it was — so an agent doing work that could reach `approve` could hand back an
/// approval of its own work. Withholding the name from the guest's scope is what stops that today,
/// and it stops nothing at all for a guest that links its SDK as an ordinary library rather than
/// building a scope. So the membrane holds the role and checks it.
#[test]
fn an_ending_outside_this_agents_role_is_refused_by_the_host() {
    let log = CallLog::default();
    let mut state = membrane_as(&log, EndingRole::Standard);

    for refused in [
        state
            .approve()
            .expect_err("an agent doing work has no verdict to give"),
        state
            .request_changes(vec!["rewrite it".to_string()])
            .expect_err("nor a rejection"),
    ] {
        assert_eq!(refused.code, ErrorCode::Unavailable);
        assert!(
            refused.message.contains("harness.finish"),
            "it is told which ending it does have: {}",
            refused.message
        );
    }
    assert!(
        state.into_parts().completion.is_none(),
        "a refused ending declared nothing"
    );

    let log = CallLog::default();
    let mut state = membrane_as(&log, EndingRole::Review);

    let refused = state
        .finish("the work is done".to_string())
        .expect_err("a reviewer is not the one who says the work is complete");

    assert_eq!(refused.code, ErrorCode::Unavailable);
    assert_eq!(refused.tool, FINISH_FUNCTION);
    assert!(
        refused.message.contains("review.approve")
            && refused.message.contains("review.requestChanges"),
        "it is told which endings it does have: {}",
        refused.message
    );
    assert!(state.into_parts().completion.is_none());
}

/// **A refusal names the calls this program could have made in that program's own language**, not in
/// gg's.
///
/// gg's [vocabulary](crate::sandbox::language::SurfaceCall) is `snake_case` and belongs to no SDK:
/// `request_changes` is a name TypeScript does not bind and a model could not write. A sentence whose
/// whole job is to say "call this instead" has to say something callable, so it goes through
/// [`spell`](crate::sandbox::language::spell) — and the two spellings below are the same three calls
/// under two languages, which is the only way to prove the sentence follows the language rather than
/// happening to match one.
#[test]
fn a_refusal_names_the_endings_the_way_this_program_would_write_them() {
    let log = CallLog::default();
    let mut state = membrane_in(typescript(), &log, EndingRole::Review);

    let refused = state
        .finish("the work is done".to_string())
        .expect_err("a reviewer does not finish");

    assert!(
        refused.message.contains("harness.finish")
            && refused.message.contains("review.approve")
            && refused.message.contains("review.requestChanges"),
        "TypeScript's own spellings, qualified by object: {}",
        refused.message
    );
    assert!(
        !refused.message.contains("request_changes"),
        "and never gg's internal name, which no SDK binds: {}",
        refused.message
    );

    // The same refusal in a language that spells every function in `snake_case`. Nothing here is
    // hard-coded twice: the fixture's catalogue is what decides, exactly as TypeScript's did above.
    let log = CallLog::default();
    let mut state = membrane_in(fixture_language(), &log, EndingRole::Review);

    let refused = state
        .finish("the work is done".to_string())
        .expect_err("a reviewer does not finish");

    assert!(
        refused.message.contains("review.request_changes"),
        "the fixture language's spelling: {}",
        refused.message
    );
    assert!(
        !refused.message.contains("requestChanges"),
        "and not TypeScript's: {}",
        refused.message
    );
}

/// The role is checked **before** the declaration's shape, and the order is what makes the refusal
/// useful: an agent that may not approve is told so, rather than told to write a better argument for
/// a call it was never going to be allowed to make.
#[test]
fn the_role_is_checked_before_the_declaration_is_read() {
    let log = CallLog::default();
    let mut state = membrane_as(&log, EndingRole::Standard);

    // An empty change list is `invalid-argument` for a reviewer. For an agent doing work it is not
    // the problem, and saying it was would send the model off to write changes it may not request.
    let refused = state
        .request_changes(Vec::new())
        .expect_err("not this agent's ending");

    assert_eq!(refused.code, ErrorCode::Unavailable);

    // The mirror: an empty summary is `invalid-argument` for an agent doing work, and beside the
    // point for a reviewer.
    let log = CallLog::default();
    let mut state = membrane_as(&log, EndingRole::Review);

    let refused = state
        .finish(String::new())
        .expect_err("not this agent's ending");

    assert_eq!(refused.code, ErrorCode::Unavailable);
}

/// An **on-use script** — the code a skill or a memory runs when the agent first reads it — may
/// declare no ending at all.
///
/// It is not the agent's turn: the model did not write it, does not see it, and is not answering for
/// it. A skill that could end the session would end it on nobody's authority.
#[test]
fn an_on_use_script_may_declare_no_ending_at_all() {
    let log = CallLog::default();
    let mut state = membrane_ending(&log, RunEnding::None);

    let refusals = [
        state.finish("done".to_string()).err(),
        state.approve().err(),
        state.request_changes(vec!["rewrite it".to_string()]).err(),
    ];

    for (call, refused) in ["harness.finish", "review.approve", "review.requestChanges"]
        .into_iter()
        .zip(refusals)
    {
        let refused = refused.unwrap_or_else(|| panic!("`{call}` ends no session from a script"));
        assert_eq!(refused.code, ErrorCode::Unavailable, "`{call}`");
        assert!(
            refused.message.contains("skill or a memory"),
            "`{call}`: {}",
            refused.message
        );
    }
    assert!(state.into_parts().completion.is_none());
}

/// A withheld ending goes on the **refusal roster**, under its whole `object.key` identity.
///
/// It is the same fact a withheld tool is — the model reached for something this run does not offer
/// it — and it is the fact a toolset ablation is run to count. There is no tool name to file it
/// under, so it is filed under the name the model actually wrote.
#[test]
fn a_withheld_ending_is_recorded_on_the_refusal_roster() {
    let log = CallLog::default();
    let mut state = membrane_as(&log, EndingRole::Standard);

    state.approve().expect_err("not this agent's ending");

    let parts = state.into_parts();
    assert_eq!(
        parts
            .refusals
            .iter()
            .map(|refusal| refusal.name.as_str())
            .collect::<Vec<_>>(),
        vec!["review.approve"]
    );
    assert!(
        log.calls().is_empty(),
        "nothing was dispatched: {:?}",
        log.names()
    );
}
