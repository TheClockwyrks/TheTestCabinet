//! Tests for what a code turn tells the model — and, much more to the point, what it does not.
//!
//! The vocabulary a [responses-as-code](crate::sandbox) agent hears from gg is three messages wide:
//! a [`Compiler error`](GgContextSource::CompilerError), a
//! [`Runtime error`](GgContextSource::RuntimeError), and a [`Notice`](GgContextSource::System). Two
//! of the three carry the error and nothing else, and the ordinary outcome of a program that worked
//! is **no message at all**. These tests sit at the seam that decides that: a real
//! [`SandboxOutcome`] in, the message the model reads out.

use super::*;
use crate::knowledge::KnowledgeModules;
use crate::sandbox::fixture;
use crate::sandbox::{PrepareError, ProgramErrorKind, SandboxRefusal, SandboxToolCall};
use crate::telemetry::CollectingSink;

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
        api_calls: 0,
        undocumented: GgUndocumentedCalls::default(),
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
        compile: None,
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
        view_refusals: vec!["view body exceeds max size (99999 bytes; max 65536)".to_string()],
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
        "exceeds max size",
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
    // And none of them is `ToolOutput`: that band is the tool-calling path's, and a program has no
    // tool results — what gg says back to a code-mode agent is a compiler error, a runtime error or
    // a notice, never output from a call the model never made.
    for feedback in [
        CodeFeedback::compiler("x"),
        CodeFeedback::runtime("x"),
        CodeFeedback::notice("x"),
    ] {
        assert_ne!(feedback.source, GgContextSource::ToolOutput);
    }
}

/// A turn whose code modules all loaded says nothing about them, which is nearly every turn.
#[test]
fn a_turn_with_no_broken_module_gets_no_notice() {
    assert!(module_error_notice(&quiet_outcome().module_errors).is_none());
}

/// **A code module that failed to load is named, with what the failure said.**
///
/// The binding is simply absent afterwards, and an absent name reads exactly like one this run
/// never granted — so silence here sends the model to fix a capability grant over a skill whose
/// code threw. Every failure is named rather than the first: they came from different skills, and a
/// model told about one of three would meet the next one next turn.
#[test]
fn every_module_that_failed_to_load_is_named_with_its_failure() {
    let notice = module_error_notice(&[
        (
            "skill `layout`".to_string(),
            "ReferenceError: grid is not defined".to_string(),
        ),
        (
            "memory `palette`".to_string(),
            "its on-use script failed: TypeError: hues.map is not a function".to_string(),
        ),
    ])
    .expect("two broken modules speak");

    assert!(notice.contains("2 code modules"), "{notice}");
    assert!(notice.contains("skill `layout`"), "{notice}");
    assert!(notice.contains("grid is not defined"), "{notice}");
    assert!(notice.contains("memory `palette`"), "{notice}");
    assert!(notice.contains("hues.map is not a function"), "{notice}");

    let one = module_error_notice(&[("skill `layout`".to_string(), "boom".to_string())])
        .expect("one broken module speaks");
    assert!(one.contains("1 code module did not load"), "{one}");
}

/// A turn that made no hand-over says nothing about one — the ordinary turn, and the one this must
/// stay silent on.
#[test]
fn a_turn_with_no_hand_over_gets_no_notice() {
    let outcome = quiet_outcome();
    assert!(
        handover_notice(
            GgProgramLanguage::TypeScript,
            &ProgramChain::first("p"),
            &outcome
        )
        .is_none()
    );
}

/// A hand-over gg **ran** is likewise silent: the program that ran is the turn's, and saying so
/// would be gg narrating something the model asked for and got.
#[test]
fn an_honoured_hand_over_gets_no_notice() {
    let mut chain = ProgramChain::first("the trampoline");
    chain.advance("the replacement");
    assert!(handover_notice(GgProgramLanguage::TypeScript, &chain, &quiet_outcome()).is_none());
}

/// Each of the three ways a hand-over goes unhonoured gets its own sentence, because each has a
/// different remedy — and every one of them is invisible to the program that asked.
#[test]
fn every_unhonoured_hand_over_says_which_way_it_failed() {
    let mut revoked = quiet_outcome();
    revoked.revoked_rerun = true;
    let notice = handover_notice(
        GgProgramLanguage::TypeScript,
        &ProgramChain::first("p"),
        &revoked,
    )
    .expect("a revocation speaks");
    assert!(notice.contains("failed after handing it over"), "{notice}");

    let mut ended = ProgramChain::first("p");
    ended.refused = Some(ChainRefusal::Ended);
    let notice = handover_notice(GgProgramLanguage::TypeScript, &ended, &quiet_outcome())
        .expect("an ending speaks");
    assert!(notice.contains("ended the session"), "{notice}");

    let mut exhausted = ProgramChain::first("p");
    exhausted.refused = Some(ChainRefusal::Exhausted);
    let notice = handover_notice(GgProgramLanguage::TypeScript, &exhausted, &quiet_outcome())
        .expect("a spent chain speaks");
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

/// **A chained turn's compile cost is every program's, added up** — the one figure that moves the
/// opposite way from `compile_wait` beside it. The shared interpreter component is compiled at most
/// once, so the first link's wait is the turn's; but a compiling language compiles each program in
/// the chain, so a turn that handed over three times paid three compiles and has to say so. Taking
/// the last link's figure, or the first's, would report a quarter of what the turn cost.
#[test]
fn a_chained_turn_sums_what_compiling_its_programs_cost() {
    let mut earlier = quiet_outcome();
    earlier.compile = Some(Duration::from_millis(1_200));
    earlier.compile_wait = Some(Duration::from_millis(700));

    let mut later = quiet_outcome();
    later.compile = Some(Duration::from_millis(900));

    let merged = merge_chain(earlier, later);

    assert_eq!(
        merged.compile,
        Some(Duration::from_millis(2_100)),
        "every link of the chain compiled a program of its own"
    );
    assert_eq!(
        merged.compile_wait,
        Some(Duration::from_millis(700)),
        "the shared component is compiled once, however long the chain"
    );
}

/// A language that compiles nothing reports nothing, and merging two of its programs must not
/// invent a zero: `Some(0)` and `None` are different claims — "compiled, instantly" against "this
/// language does not compile" — and only the second is true of a type-strip.
#[test]
fn a_chain_of_uncompiled_programs_reports_no_compile_time() {
    let merged = merge_chain(quiet_outcome(), quiet_outcome());
    assert_eq!(merged.compile, None);
}

/// A chain that begins in a compiling language and ends without a figure — the shape a partial
/// reading takes if a link ever fails to produce one — keeps what it does know rather than
/// discarding it.
#[test]
fn a_chain_keeps_the_one_compile_figure_it_has() {
    let mut earlier = quiet_outcome();
    earlier.compile = Some(Duration::from_millis(400));
    assert_eq!(
        merge_chain(earlier, quiet_outcome()).compile,
        Some(Duration::from_millis(400))
    );

    let mut later = quiet_outcome();
    later.compile = Some(Duration::from_millis(400));
    assert_eq!(
        merge_chain(quiet_outcome(), later).compile,
        Some(Duration::from_millis(400))
    );
}

/// **An on-use script's compile is the turn's, exactly as its execution time is.**
///
/// A script is a whole program of its own — a compiling language hands its source to the compiler
/// like any other — and the turn is what triggered it. The `elapsed` beside it has always been
/// summed for that reason; a compile figure that was not would leave a skill-heavy compiled arm
/// reporting less than it spent, silently and always in the direction that makes it look cheap.
#[test]
fn an_on_use_scripts_compile_is_charged_to_the_turn_that_triggered_it() {
    let mut turn = quiet_outcome();
    turn.compile = Some(Duration::from_millis(800));
    turn.elapsed = Duration::from_millis(12);

    let mut script = quiet_outcome();
    script.compile = Some(Duration::from_millis(500));
    script.elapsed = Duration::from_millis(3);
    script.tool_calls = vec![sandbox_call("write_file")];

    assert_eq!(absorb_on_use_script(&mut turn, script), None);

    assert_eq!(
        turn.compile,
        Some(Duration::from_millis(1_300)),
        "the turn paid for the script it triggered, compiler included"
    );
    assert_eq!(turn.elapsed, Duration::from_millis(15));
    assert_eq!(turn.tool_calls.len(), 1, "and for what the script called");
}

/// A script in a language that compiles nothing must not invent a figure for a turn that has none —
/// the same "`None` is not a zero" rule the chain merge keeps, at the second site that folds one.
#[test]
fn an_on_use_script_that_compiled_nothing_leaves_the_turn_reporting_nothing() {
    let mut turn = quiet_outcome();
    assert_eq!(absorb_on_use_script(&mut turn, quiet_outcome()), None);
    assert_eq!(turn.compile, None);
}

/// A script that **failed** still hands back what it spent — the cost is not conditional on the
/// script working — and its failure comes back as the sentence the turn names the skill with.
#[test]
fn a_failed_on_use_script_is_still_charged_and_still_reported() {
    let mut turn = quiet_outcome();
    turn.compile = Some(Duration::from_millis(100));

    let mut script = quiet_outcome();
    script.compile = Some(Duration::from_millis(400));
    script.result = Ok(threw("nope", None));

    let failure = absorb_on_use_script(&mut turn, script).expect("a throw is reported");
    assert!(failure.contains("nope"));
    assert_eq!(turn.compile, Some(Duration::from_millis(500)));
    assert!(
        matches!(&turn.result, Ok(result) if result.error.is_none()),
        "the turn's own verdict is untouched by what a skill's script did"
    );
}

// ---------------------------------------------------------------------------------------------
// What the sandbox's own failures are told to the model as
// ---------------------------------------------------------------------------------------------

/// The decision for one sandbox failure, with the operator's stream thrown away.
///
/// In TypeScript, which is one of the two arms whose catalogue declares no library set: these tests
/// are about which band a failure lands in and whose it was, and an arm that appends a set would
/// have every one of them asserting the set as well.
/// [`decision_for_arm`] is what the set's own tests use.
fn decision_for(error: SandboxError) -> CodeTurnOutcome {
    decision_for_arm(GgProgramLanguage::TypeScript, error)
}

/// The decision for one sandbox failure on a named arm.
fn decision_for_arm(language: GgProgramLanguage, error: SandboxError) -> CodeTurnOutcome {
    let emitter = Emitter::with_sink(None, Box::new(CollectingSink::new()));
    sandbox_failure_decision(language, &error, &[], &emitter)
}

/// The feedback bodies of a decision, paired with the band each landed in.
fn banded(decision: &CodeTurnOutcome) -> Vec<(GgContextSource, String)> {
    match decision {
        CodeTurnOutcome::Continue { feedback, .. } => feedback
            .iter()
            .map(|message| (message.source, message.body.clone()))
            .collect(),
        _ => panic!("expected a turn the run carries on from, got one that ended the session"),
    }
}

/// The turn error type a decision recorded, or `None` if it recorded none.
fn recorded_type(decision: &CodeTurnOutcome) -> Option<TurnErrorType> {
    match decision {
        CodeTurnOutcome::Continue { error, .. } => *error,
        _ => panic!("expected a turn the run carries on from, got one that ended the session"),
    }
}

/// **A program its own compiler rejected reaches the model as a `Compiler error` carrying the
/// compiler's diagnostic** — and the turn carries on.
///
/// The whole point of the band. A type error is the model's to fix and the model can only fix it if
/// it is handed what the compiler said; wrapping gg's prose around it, or ending the session over it,
/// are the two ways this goes wrong. On this arm the diagnostic is the whole message, because its
/// catalogue declares no library set — see
/// [the two tests below](a_rejection_names_the_library_set_the_compiler_measured_the_program_against)
/// for the arm that does.
#[test]
fn a_compilers_rejection_reaches_the_model_as_the_compilers_own_words() {
    let decision = decision_for(SandboxError::Prepare(PrepareError::Compile(
        "line 3: `Sprite` is not assignable to `Entity`".to_string(),
    )));

    assert_eq!(
        banded(&decision),
        vec![(
            GgContextSource::CompilerError,
            "line 3: `Sprite` is not assignable to `Entity`".to_string()
        )],
        "the diagnostic goes out verbatim, under the heading that says nothing ran"
    );
    assert_eq!(
        recorded_type(&decision),
        Some(TurnErrorType::TranspileCompile),
        "recorded as a compile error rather than pooled with syntax errors"
    );
}

/// **A rejected program is answered with the library set the compiler measured it against.**
///
/// The set used to be a section of every compiled arm's system prompt, read on every turn of every
/// run. It is delivered here instead because the mistake it prevents — a program written against a
/// package this arm does not carry — is one the compiler detects, so the fact is delivered at the
/// moment it is detected. This is the gate that keeps it delivered *somewhere*: dropping it from the
/// prompt and never adding it here would leave the model with no way to learn what it may import.
#[test]
fn a_rejection_names_the_library_set_the_compiler_measured_the_program_against() {
    let decision = decision_for_arm(
        GgProgramLanguage::Rust,
        SandboxError::Prepare(PrepareError::Compile(
            "E0432: unresolved import".to_string(),
        )),
    );
    let banded = banded(&decision);
    let [(source, body)] = banded.as_slice() else {
        panic!("a rejection is one message: {banded:?}");
    };
    assert_eq!(*source, GgContextSource::CompilerError);
    assert!(
        body.starts_with("E0432: unresolved import\n\n"),
        "the compiler's own first line is still the message's first line: {body}"
    );
    let expected =
        crate::sandbox::library_set(crate::sandbox::language(GgProgramLanguage::Rust).catalogue())
            .expect("this arm's catalogue declares a library set");
    assert!(
        body.ends_with(&expected),
        "the set is quoted from the arm's own catalogue: {body}"
    );
    for group in &crate::sandbox::language(GgProgramLanguage::Rust)
        .catalogue()
        .libraries
    {
        for name in &group.modules {
            assert!(
                body.contains(name.as_str()),
                "`{name}` is in the catalogue and not in what the model was told: {body}"
            );
        }
    }
}

/// **An arm that declares no library set is answered with the diagnostic alone.**
///
/// A heading over an empty list is a sentence about nothing, and a trailing blank line would say a
/// section had been omitted. The two arms in this position are the ones whose programs get their
/// runtime's own standard library and nothing else.
#[test]
fn an_arm_with_no_declared_library_set_adds_nothing_to_its_diagnostic() {
    for language in [GgProgramLanguage::TypeScript, GgProgramLanguage::JavaScript] {
        assert!(
            crate::sandbox::library_set(crate::sandbox::language(language).catalogue()).is_none(),
            "{language:?} has started declaring a library set; this test picked it for not having one"
        );
        let decision = decision_for_arm(
            language,
            SandboxError::Prepare(PrepareError::Compile("TS2322: not assignable".to_string())),
        );
        assert_eq!(
            banded(&decision),
            vec![(
                GgContextSource::CompilerError,
                "TS2322: not assignable".to_string()
            )],
            "{language:?}"
        );
    }
}

/// **A compiler that could not finish reaches the model in no band at all, and ends the session.**
///
/// The failure this variant exists to keep separable, and the one that is silent when it regresses.
/// Nothing read the program, so there is no diagnostic — and there is no honest sentence to put in
/// its place either, because every instruction gg could write is an instruction to answer for an
/// image the model cannot see. The `Compiler error` band would say the program was rejected, and a
/// `System` notice saying "write it again" would send the model rewriting something that was never
/// wrong on every turn of a run whose compiler is simply absent. So the model is told nothing, the
/// fault is gg's, and the run ends.
#[test]
fn a_compiler_that_could_not_finish_is_fatal_and_tells_the_model_nothing() {
    let decision = decision_for(SandboxError::Toolchain(
        "`swiftc` exited with signal 11 (SIGSEGV)".to_string(),
    ));

    let CodeTurnOutcome::Fatal { fault, message } = &decision else {
        panic!("a compiler that could not finish must end the session");
    };
    assert_eq!(
        *fault,
        FatalFault::Toolchain,
        "and it is named as the environment's rather than pooled with gg's own plumbing"
    );
    assert!(
        message.contains("SIGSEGV"),
        "the operator's line carries the compiler's own words: {message}"
    );
}

/// A compiler that rejected a program is the only preparation failure the session survives.
///
/// The arms are one `match` away from each other and every one of them is "a compile failed", so
/// what separates them is whose failure it was rather than what it looked like. Only a diagnostic
/// about the model's own text is the model's to answer.
#[test]
fn only_a_rejected_program_leaves_the_session_running() {
    for (error, ends) in [
        (SandboxError::Toolchain("killed".to_string()), true),
        (
            SandboxError::Prepare(PrepareError::Compile("type error".to_string())),
            false,
        ),
        (SandboxError::Compile("not a component".to_string()), true),
        (
            SandboxError::Instantiate("missing import".to_string()),
            true,
        ),
        (SandboxError::Host("the task panicked".to_string()), true),
        (
            SandboxError::Lowering("the surface did not check".to_string()),
            true,
        ),
    ] {
        let named = error.to_string();
        let decision = decision_for(error);
        assert_eq!(
            matches!(decision, CodeTurnOutcome::Fatal { .. }),
            ends,
            "{named}"
        );
    }
}

// ---------------------------------------------------------------------------------------------
// The other consumer of the prepare seam: a skill's or a memory's code
// ---------------------------------------------------------------------------------------------

/// The failure a load of `source` produced, in a language that compiles.
fn knowledge_failure(source: &str) -> KnowledgeError {
    KnowledgeModules::new()
        .load(
            crate::sandbox::fixture_languages()
                .next()
                .expect("there is a fixture language"),
            KnowledgeOrigin::Skill,
            "csv-tools",
            Some(source),
            None,
        )
        .expect_err("this source does not prepare")
}

/// **A skill whose compiler crashed reaches the operator, the run's fault latch, and not the model.**
///
/// The prepare seam has two consumers — a turn's own program and a code skill or memory — and this
/// is the second. The same failure through the same seam must be attributed the same way at both, or
/// the doctrine holds only where somebody happened to write it down: nothing about the skill's
/// source was judged, so the model is not told its code is wrong, the compiler's crash detail goes
/// where somebody can fix the image, and the run ends rather than carrying on with an agent gg
/// silently denied code it was told it had.
#[test]
fn a_knowledge_load_whose_compiler_crashed_reaches_the_operator_and_ends_the_run() {
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));
    let fault = FaultLatch::default();
    let error = knowledge_failure(&format!("def parse(text)\n  {}\n", fixture::NO_COMPILER));

    record_knowledge_failure(&error, &Agent::root(ROOT_AGENT_ID), &fault, &emitter);

    assert!(
        fault
            .raised()
            .is_some_and(|raised| raised.contains("SIGSEGV")),
        "a compiler gg could not run is gg's defect and ends the run: {:?}",
        fault.raised()
    );

    let logged: Vec<(String, String)> = sink
        .events()
        .into_iter()
        .filter_map(|event| match event.kind {
            GgTelemetryKind::Log { level, message } => Some((level, message)),
            _ => None,
        })
        .collect();
    assert_eq!(logged.len(), 1, "{logged:?}");
    assert_eq!(logged[0].0, "error", "it is the operator's run to fix");
    assert!(logged[0].1.contains("SIGSEGV"), "{:?}", logged[0].1);
    assert!(
        !error.to_string().contains("SIGSEGV"),
        "and the model reads none of it: {error}"
    );
}

/// **A skill gg accepted and could not prepare is charged to gg, not to whoever wrote it.**
///
/// The third arm of the same seam, and the one that reads most like the author's fault: it comes
/// back carrying a diagnostic, so a consumer that split on "is there something to show?" would file
/// it as a bad argument and hand the model gg's own internals under a heading saying its code was
/// rejected. The split is on *whose source failed*, and this one is a bug in the harness about a
/// source the language accepted — so the load is refused as an I/O failure, the detail goes to the
/// operator who can act on a gg bug, and the run ends rather than carrying on with an agent silently
/// denied code it was told it had.
#[test]
fn a_knowledge_load_gg_could_not_prepare_is_ggs_defect_and_not_a_bad_argument() {
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));
    let fault = FaultLatch::default();
    let error = knowledge_failure(&format!("def parse(text)\n  {}\n", fixture::UNLOWERABLE));

    assert_eq!(
        knowledge_refusal_class(&error),
        ToolFailure::IoError,
        "nothing about the model's argument was judged, so it was not the argument that was wrong"
    );

    record_knowledge_failure(&error, &Agent::root(ROOT_AGENT_ID), &fault, &emitter);

    assert!(
        fault
            .raised()
            .is_some_and(|raised| raised.contains("lowering pass")),
        "a source gg accepted and could not prepare is gg's defect and ends the run: {:?}",
        fault.raised()
    );
    let logged: Vec<String> = sink
        .events()
        .into_iter()
        .filter_map(|event| match event.kind {
            GgTelemetryKind::Log { level, message } if level == "error" => Some(message),
            _ => None,
        })
        .collect();
    assert!(
        logged
            .iter()
            .any(|message| message.contains("lowering pass")),
        "the operator is the only reader of a bug report about gg: {logged:?}"
    );
    assert!(
        !error.to_string().contains("lowering pass"),
        "and the model reads none of it: {error}"
    );
}

/// A skill the language read and **rejected** logs nothing and breaks nothing: the model already has
/// the whole of it, a second copy on the operator's stream is noise that trains an operator to skim
/// the band, and the author's mistake is not a defect of gg's.
#[test]
fn a_knowledge_load_the_language_rejected_says_nothing_to_the_operator() {
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));
    let fault = FaultLatch::default();
    let error = knowledge_failure(&format!("def parse(text)\n  x = {}\n", fixture::MISTYPED));

    record_knowledge_failure(&error, &Agent::root(ROOT_AGENT_ID), &fault, &emitter);

    assert!(sink.events().is_empty(), "{:?}", sink.events());
    assert!(
        fault.raised().is_none(),
        "a source the language read and rejected is the author's, not gg's: {:?}",
        fault.raised()
    );
}

/// **A memory write refused because the compiler crashed is not recorded as a bad argument.**
///
/// A write whose code the language rejected is `invalid-argument` and always was — the model wrote
/// that code on that call. A write whose *compiler* fell over is refused for a different reason
/// entirely: the argument was never judged, and the class is what a study slices by, so calling it
/// malformed would outlive the turn as a count of model errors that were not the model's.
#[test]
fn a_write_refused_by_a_crashed_compiler_is_not_an_invalid_argument() {
    assert_eq!(
        knowledge_refusal_class(&knowledge_failure(&format!(
            "def parse(text)\n  x = {}\n",
            fixture::MISTYPED
        ))),
        ToolFailure::InvalidArgument,
        "code the language read and rejected is the model's argument being wrong"
    );
    assert_eq!(
        knowledge_refusal_class(&knowledge_failure(&format!(
            "def parse(text)\n  {}\n",
            fixture::NO_COMPILER
        ))),
        ToolFailure::IoError,
        "a compiler that could not finish is a process gg ran failing, not a bad argument"
    );
}
