//! Tests for what a code turn's [feedback](code_result_context) tells the model — and, as much to
//! the point, what it no longer tells it.
//!
//! These sit at the seam the [template tests](crate::prompts) cannot reach: `CodeResultContext` has
//! no field a log line could ride in on, so the only place the "logs are captured but not shown"
//! contract can be asserted end to end is here, where a real [`SandboxOutcome`] carrying real log
//! lines is turned into the words the model reads.

use super::*;

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

/// A program that ran to its end with no throw.
fn ran() -> ProgramResult {
    ProgramResult { error: None }
}

/// The feedback a given outcome produces, rendered as the model is shown it.
fn feedback(outcome: &SandboxOutcome) -> String {
    prompts::render_code_result(&code_result_context(outcome, &ran()))
}

/// **What a program logged does not reach the model; the fact that it logged does.**
///
/// This is the contract the whole view mechanism rests on. `console.*` is still captured — the lines
/// are right there on the outcome, and from there onto the turn's `CodeExecution` event, which is
/// what carries them to the operator's stream, the run record and the console — but the prompt gets
/// a count and a pointer at the channel that does carry, never the text. A model that could still read its own logs would have no reason to
/// open a view, and the anonymous, unattributable, unevictable blob this feature exists to remove
/// would simply come back.
#[test]
fn a_programs_logs_are_counted_in_the_feedback_and_never_quoted() {
    let outcome = SandboxOutcome {
        logs: vec![
            "SECRET-MARKER-ONE: a.ts, b.ts".to_string(),
            "SECRET-MARKER-TWO: 3 failures".to_string(),
        ],
        // The capture caps dropped four more. They are counted too: the number describes what the
        // program did, not what gg's buffer kept.
        logs_suppressed: 4,
        ..quiet_outcome()
    };

    let context = code_result_context(&outcome, &ran());
    assert_eq!(context.logged_lines, 6);

    let rendered = feedback(&outcome);
    for quoted in ["SECRET-MARKER-ONE", "SECRET-MARKER-TWO", "a.ts, b.ts"] {
        assert!(
            !rendered.contains(quoted),
            "a log line reached the model's prompt:\n{rendered}"
        );
    }
    assert!(
        rendered.contains("Your program logged 6 line(s)."),
        "the count is what survives, and it is stated in the turn it happened:\n{rendered}"
    );
    assert!(
        rendered.contains("`view.openText(label, body)`"),
        "a model told its output vanished must be told what to use instead:\n{rendered}"
    );
    // ...and the lines are still on the outcome, which is what the turn's `CodeExecution` event —
    // the only record of a program's output — is built from.
    assert_eq!(outcome.logs.len(), 2);
}

/// A program that only logged is **not** silent — it is answered by the nudge — and a program that
/// did nothing at all still is.
///
/// The distinction matters because the two need opposite words. "No output recorded." tells a model
/// that its program produced nothing; saying that to a program that logged twelve lines would be
/// false, and would leave it looking for a bug in code that worked.
#[test]
fn logging_is_not_silence_but_doing_nothing_is() {
    let logged = code_result_context(
        &SandboxOutcome {
            logs: vec!["ok".to_string()],
            ..quiet_outcome()
        },
        &ran(),
    );
    assert!(!logged.silent);

    let nothing = code_result_context(&quiet_outcome(), &ran());
    assert!(nothing.silent);
    assert!(feedback(&quiet_outcome()).contains("No output recorded."));
}

/// Every list the feedback can render counts against silence, not just the opens.
///
/// A program whose only act was a `view.close` is told that it closed something; printing "No output
/// recorded." underneath that line would contradict the line above it.
#[test]
fn any_view_activity_counts_as_having_said_something() {
    for outcome in [
        SandboxOutcome {
            views_opened: vec![SandboxViewOpened {
                kind: ViewKind::Text,
                selector: "notes".to_string(),
                tokens: 12,
                superseded: false,
            }],
            ..quiet_outcome()
        },
        SandboxOutcome {
            views_closed: vec!["notes".to_string()],
            ..quiet_outcome()
        },
        SandboxOutcome {
            view_refusals: vec![
                "`view.openText` was refused: over MAX_TEXT_VIEW_BYTES".to_string(),
            ],
            ..quiet_outcome()
        },
    ] {
        let rendered = feedback(&outcome);
        assert!(
            !code_result_context(&outcome, &ran()).silent,
            "a view call is something the program said:\n{rendered}"
        );
        assert!(!rendered.contains("No output recorded."), "{rendered}");
    }
}

/// The opened views reach the feedback whole: the kind in the model's own vocabulary, the selector
/// verbatim (it is what `view.close` takes), the cost, and whether the call **replaced** a view
/// rather than adding one.
#[test]
fn the_opened_views_are_reported_in_the_programs_own_vocabulary() {
    let outcome = SandboxOutcome {
        views_opened: vec![
            SandboxViewOpened {
                kind: ViewKind::Text,
                selector: "changed-files".to_string(),
                tokens: 42,
                superseded: false,
            },
            SandboxViewOpened {
                kind: ViewKind::File,
                selector: "specs/rules.md".to_string(),
                tokens: 1200,
                superseded: true,
            },
        ],
        views_closed: vec!["stale-notes".to_string()],
        views_suppressed: 9,
        ..quiet_outcome()
    };
    let rendered = feedback(&outcome);
    assert!(
        rendered.contains("- opened text view `changed-files` (~42 tokens)"),
        "{rendered}"
    );
    assert!(
        rendered.contains("- replaced file view `specs/rules.md` (~1200 tokens)"),
        "{rendered}"
    );
    assert!(
        rendered.contains("- closed view `stale-notes`"),
        "{rendered}"
    );
    assert!(
        rendered.contains("(9 further view call(s) were not listed)"),
        "a truncated listing must say so, or it reads as a program that stopped calling:\n\
         {rendered}"
    );
}

/// The operator's one-line stream summary still quotes the last log line.
///
/// It is the counterpart of everything above: logs stopped being model-facing, and they did **not**
/// stop being the run's narration. A spawner reading "its last program logged: …" is the operator's
/// view of the turn, not the model's.
#[test]
fn the_spawners_report_still_quotes_the_last_log_line() {
    let outcome = SandboxOutcome {
        logs: vec!["first".to_string(), "wrote out/plan.md".to_string()],
        ..quiet_outcome()
    };
    assert_eq!(
        program_report(&outcome, &ran()),
        "its last program logged: wrote out/plan.md"
    );
}
