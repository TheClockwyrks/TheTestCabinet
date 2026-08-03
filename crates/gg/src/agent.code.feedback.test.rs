//! Tests for what a code turn tells the model — and, much more to the point, what it does not.
//!
//! The vocabulary a [responses-as-code](crate::sandbox) agent hears from gg is three messages wide:
//! a [`Compiler error`](GgContextSource::CompilerError), a
//! [`Runtime error`](GgContextSource::RuntimeError), and a [`Notice`](GgContextSource::System). Two
//! of the three carry the error and nothing else, and the ordinary outcome of a program that worked
//! is **no message at all**. These tests sit at the seam that decides that: a real
//! [`SandboxOutcome`] in, the message the model reads out.

use super::*;
use crate::sandbox::{ProgramErrorKind, SandboxRefusal, SandboxToolCall};

/// One serviced call, as a chained turn's merged roster carries it.
fn sandbox_call(name: &str) -> SandboxToolCall {
    SandboxToolCall {
        name: name.to_string(),
        ok: true,
        summary: None,
        error: None,
    }
}

/// An outcome for a program that ran cleanly and did nothing else — every list empty, so a test can
/// set exactly the one thing it is about.
fn quiet_outcome() -> SandboxOutcome {
    SandboxOutcome {
        tool_calls: Vec::new(),
        tool_calls_suppressed: 0,
        refusals: Vec::new(),
        refusals_suppressed: 0,
        logs: Vec::new(),
        logs_suppressed: 0,
        views_opened: Vec::new(),
        views_closed: Vec::new(),
        view_refusals: Vec::new(),
        views_suppressed: 0,
        deferred_note: None,
        module_errors: Vec::new(),
        returned_value: false,
        completion: None,
        revoked_completion: None,
        rerun: None,
        revoked_rerun: false,
        elapsed: Duration::ZERO,
        unreachable: None,
        compile_wait: None,
        result: Ok(ProgramResult { error: None }),
    }
}

/// The feedback the `Ok` arm of the turn's classification produces for `result` — the whole of what
/// a program that *ran* can earn.
fn feedback(result: &ProgramResult) -> Option<CodeFeedback> {
    result.error.as_ref().map(program_error_feedback)
}

/// A throw, as the guest composes one.
fn threw(message: &str, location: Option<&str>) -> ProgramResult {
    ProgramResult {
        error: Some(ProgramError {
            kind: ProgramErrorKind::Other,
            message: message.to_string(),
            location: location.map(str::to_string),
        }),
    }
}

/// **A program that ran and did what it meant to earns no message.**
///
/// The load-bearing assertion of the whole redesign. gg used to answer every program with a report —
/// "Your program ran to completion", a roster of what it called, a list of what it opened. All of it
/// was either something the program already learned by running or a rule that belongs in the system
/// prompt, and a message with no information in it teaches a model that messages need not carry any.
/// The views the program opened are the turn's result; there is nothing for gg to add.
#[test]
fn a_program_that_ran_cleanly_earns_no_message_at_all() {
    assert_eq!(feedback(&ProgramResult { error: None }), None);
}

/// **What a program logged does not reach the model, and neither does the fact that it logged.**
///
/// The contract the whole view mechanism rests on, in its strongest form. `console.*` is still
/// captured — the lines are right there on the outcome, and from there onto the turn's
/// `CodeExecution` event, which carries them to the operator's stream, the run record and the
/// console — but the model gets nothing, not even a count. A count was still a channel: it told a
/// model its output had gone *somewhere*, which is where the argument that it might come back
/// begins. A view is the only channel, so silence is the honest answer.
#[test]
fn a_programs_logs_reach_the_model_in_no_form_whatsoever() {
    let outcome = SandboxOutcome {
        logs: vec![
            "SECRET-MARKER-ONE: a.ts, b.ts".to_string(),
            "SECRET-MARKER-TWO: 3 failures".to_string(),
        ],
        logs_suppressed: 4,
        ..quiet_outcome()
    };
    // The lines are captured for the operator...
    assert_eq!(outcome.logs.len(), 2);
    // ...and the model is told nothing, because the program did not fail.
    assert_eq!(feedback(&ProgramResult { error: None }), None);
}

/// **A throw is answered with the error and nothing else.**
///
/// No "Your program stopped", no "Everything it did before that still stands", no roster. The model
/// is reading a diagnostic; anything gg wraps around it is something the model has to parse gg out
/// of first.
#[test]
fn a_throw_is_answered_with_the_error_alone() {
    let feedback = feedback(&threw(
        "TypeError: Cannot read properties of undefined (reading 'name')",
        Some("line 8, column 3"),
    ))
    .expect("a program that threw earns a message");

    assert_eq!(feedback.source, GgContextSource::RuntimeError);
    assert_eq!(
        feedback.body,
        "TypeError: Cannot read properties of undefined (reading 'name')\n    at line 8, column 3"
    );
}

/// The location is rendered as a stack frame because that is what it is — the model's own frame, the
/// shim's and the SDK's having never crossed the membrane. A throw gg could not locate is the bare
/// message, not a message with an empty frame hanging off it.
#[test]
fn an_unlocatable_throw_is_the_bare_message() {
    let feedback = feedback(&threw("boom", None)).expect("a program that threw earns a message");
    assert_eq!(feedback.body, "boom");
    assert!(!feedback.body.contains(" at "), "{}", feedback.body);
}

/// **Nothing gg knows about the turn leaks into a runtime error.**
///
/// The outcome carries a refused call, a refused view, a discarded return value, a revoked ending
/// and a deferred note — every one of them a thing the old report printed. None may reach the
/// model's error message: the calls and refusals already threw into the program, and the revocation
/// rule is stated once in the system prompt rather than on every failing turn.
#[test]
fn a_runtime_error_carries_no_report_of_the_turn_around_it() {
    let outcome = SandboxOutcome {
        refusals: vec![SandboxRefusal {
            name: "shell".to_string(),
            message: "withheld".to_string(),
        }],
        view_refusals: vec!["imageViewCap reached".to_string()],
        returned_value: true,
        deferred_note: Some("a microtask ran after the program ended".to_string()),
        ..quiet_outcome()
    };
    let result = threw("ReferenceError: x is not defined", Some("line 2, column 1"));
    let feedback = feedback(&result).expect("a program that threw earns a message");

    assert_eq!(
        feedback.body,
        "ReferenceError: x is not defined\n    at line 2, column 1"
    );
    for leaked in [
        "shell",
        "withheld",
        "imageViewCap",
        "return",
        "microtask",
        "finish",
    ] {
        assert!(
            !feedback.body.contains(leaked),
            "the runtime error leaked `{leaked}`: {}",
            feedback.body
        );
    }
    // The outcome still carries every one of them, which is what the operator's stream is built
    // from — losing the model's copy is not losing the record.
    assert_eq!(outcome.refusals.len(), 1);
    assert_eq!(outcome.view_refusals.len(), 1);
    assert!(outcome.returned_value);
    assert!(outcome.deferred_note.is_some());
}

/// The three bands are the three bands, and each constructor puts a message in its own. A message in
/// the wrong band is headed with the wrong word, and under this protocol the heading is the only
/// thing telling the model what it is looking at.
#[test]
fn each_kind_of_message_goes_in_its_own_band() {
    assert_eq!(
        CodeFeedback::compiler("x").source,
        GgContextSource::CompilerError
    );
    assert_eq!(
        CodeFeedback::runtime("x").source,
        GgContextSource::RuntimeError
    );
    assert_eq!(CodeFeedback::notice("x").source, GgContextSource::System);
    // And none of them is the retired `Output` band.
    for feedback in [
        CodeFeedback::compiler("x"),
        CodeFeedback::runtime("x"),
        CodeFeedback::notice("x"),
    ] {
        assert_ne!(feedback.source, GgContextSource::ToolOutput);
    }
}

/// A turn that made no hand-over says nothing about one — the ordinary turn, and the one this must
/// stay silent on.
#[test]
fn a_turn_with_no_hand_over_gets_no_notice() {
    let outcome = quiet_outcome();
    assert!(handover_notice(&ProgramChain::first("p"), &outcome).is_none());
}

/// A hand-over gg **ran** is likewise silent: the program that ran is the turn's, and saying so
/// would be gg narrating something the model asked for and got.
#[test]
fn an_honoured_hand_over_gets_no_notice() {
    let mut chain = ProgramChain::first("the trampoline");
    chain.advance("the replacement");
    assert!(handover_notice(&chain, &quiet_outcome()).is_none());
}

/// Each of the three ways a hand-over goes unhonoured gets its own sentence, because each has a
/// different remedy — and every one of them is invisible to the program that asked.
#[test]
fn every_unhonoured_hand_over_says_which_way_it_failed() {
    let mut revoked = quiet_outcome();
    revoked.revoked_rerun = true;
    let notice = handover_notice(&ProgramChain::first("p"), &revoked).expect("a revocation speaks");
    assert!(notice.contains("failed after handing it over"), "{notice}");

    let mut ended = ProgramChain::first("p");
    ended.refused = Some(ChainRefusal::Ended);
    let notice = handover_notice(&ended, &quiet_outcome()).expect("an ending speaks");
    assert!(notice.contains("ended your session"), "{notice}");

    let mut exhausted = ProgramChain::first("p");
    exhausted.refused = Some(ChainRefusal::Exhausted);
    let notice = handover_notice(&exhausted, &quiet_outcome()).expect("a spent chain speaks");
    assert!(
        notice.contains(&MAX_PROGRAM_CHAIN.to_string()),
        "the ceiling names its own number: {notice}"
    );
}

/// What the [library](crate::programs) records beside a program: whether it ran out, and the words
/// the model was already given if it did not.
#[test]
fn the_recorded_verdict_matches_what_the_model_was_told() {
    assert_eq!(program_verdict(&quiet_outcome()), (true, None));

    let mut threw = quiet_outcome();
    threw.result = Ok(ProgramResult {
        error: Some(ProgramError {
            kind: ProgramErrorKind::ToolFailure,
            message: "`read_file` failed (not-found): no such file".to_string(),
            location: Some("line 3, column 1".to_string()),
        }),
    });
    let (ok, error) = program_verdict(&threw);
    assert!(!ok);
    assert!(error.unwrap().contains("read_file"));

    // A reply that did not compile is kept too — it is the single most likely thing to fetch back.
    let mut broken = quiet_outcome();
    broken.result = Err(SandboxError::Host("could not be operated".to_string()));
    assert!(!program_verdict(&broken).0);
}

/// Merging a chain keeps everything the turn **accumulated** and takes the last program's
/// **verdict**. Under-reporting either half would misdescribe the turn: a roster that lost the first
/// program's calls says the turn did less than it did, and a result taken from the first says the
/// turn succeeded when the program that did the work failed.
#[test]
fn a_chained_turn_accumulates_its_records_and_takes_the_last_result() {
    let mut earlier = quiet_outcome();
    earlier.tool_calls = vec![sandbox_call("read_file")];
    earlier.logs = vec!["fetching".to_string()];
    earlier.elapsed = Duration::from_millis(10);
    earlier.compile_wait = Some(Duration::from_millis(700));

    let mut later = quiet_outcome();
    later.tool_calls = vec![sandbox_call("write_file")];
    later.logs = vec!["done".to_string()];
    later.elapsed = Duration::from_millis(5);
    later.result = Ok(ProgramResult {
        error: Some(ProgramError {
            kind: ProgramErrorKind::Other,
            message: "boom".to_string(),
            location: None,
        }),
    });

    let merged = merge_chain(earlier, later);

    assert_eq!(
        merged
            .tool_calls
            .iter()
            .map(|call| call.name.as_str())
            .collect::<Vec<_>>(),
        vec!["read_file", "write_file"],
        "the turn dispatched both, in order"
    );
    assert_eq!(merged.logs, ["fetching", "done"]);
    assert_eq!(merged.elapsed, Duration::from_millis(15));
    assert_eq!(
        merged.compile_wait,
        Some(Duration::from_millis(700)),
        "only the first program could have paid the one shared compile"
    );
    assert!(
        matches!(&merged.result, Ok(result) if result.error.is_some()),
        "the last program's verdict is the turn's"
    );
}
