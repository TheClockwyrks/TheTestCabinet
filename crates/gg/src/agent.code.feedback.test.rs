//! Tests for what a code turn tells the model — and, much more to the point, what it does not.
//!
//! The vocabulary a [responses-as-code](crate::sandbox) agent hears from gg is three messages wide:
//! a [`Compiler error`](GgContextSource::CompilerError), a
//! [`Runtime error`](GgContextSource::RuntimeError), and a [`Notice`](GgContextSource::System). Two
//! of the three carry the error and nothing else, and the ordinary outcome of a program that worked
//! is **no message at all**. These tests sit at the seam that decides that: a real
//! [`SandboxOutcome`] in, the message the model reads out.

use super::*;
use crate::sandbox::{ProgramErrorKind, SandboxRefusal};

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
        returned_value: false,
        completion: None,
        revoked_completion: None,
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
