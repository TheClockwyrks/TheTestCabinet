//! **What compiling cost reaches the outcome** — for every registered language, through the real
//! [`run_program`].
//!
//! [`SandboxOutcome::compile`] is the seam's one measurement of what a *compiled* arm pays per turn.
//! It is not a diagnostic: it is the number the study is for. A run's telemetry carries it as
//! `compile_ms` on every code-execution event, TCQ slices on it, and the whole argument for pricing
//! a language — "PureScript costs 1.4 s a turn, Python costs nothing" — is that field and nothing
//! else.
//!
//! It was, until this module, asserted only indirectly. Each arm answers
//! [`prepare_compiles`](ProgramLanguage::prepare_compiles) and each arm's own tests assert that
//! answer; the one line that turns the answer into a reading lives in [`run_program`], and the arms'
//! substrate harnesses are near-copies of that function which pass `None` straight through. So the
//! most expensive arms in the study — the ones whose compile cost is the reason they exist — had
//! nothing observing that their cost arrives anywhere.
//!
//! # Why it is one test over every language rather than one per arm
//!
//! Because the property is the seam's, not an arm's: a language that compiles reports a reading and
//! a language that does not reports absence, and the two claims are different — `None` says "this
//! language has no compiler", `Some(0)` would say "it compiled, instantly". A per-arm test would let
//! a new arm register with the question unasked, which is exactly how this gap opened.
//!
//! It costs one real compile per compiled arm, twice (a program that compiles and a program that
//! does not), plus the interpreter components those programs are evaluated by. That is the price of
//! observing the number end to end rather than trusting the line that produces it.

use std::time::Duration;

use super::*;
use crate::ending::EndingRole;
use crate::sandbox::fake::{CallLog, FakeToolApi, all_tools, canned_outcome};

/// Drive `program` through the real [`run_program`] in `language`, with every tool bound.
fn outcome_of(language: &'static dyn ProgramLanguage, program: &str) -> SandboxOutcome {
    let log = CallLog::default();
    let (outcome, _api) = run_program(
        language,
        program,
        ProgramScope {
            enabled: &all_tools(),
            modules: &[],
            ending: RunEnding::Role(EndingRole::Standard),
            library: false,
            docview_close: false,
        },
        SandboxLimits::default(),
        None,
        FakeToolApi::with(&log, canned_outcome),
    );
    outcome
}

/// **Every language's answer about whether it compiles arrives as a reading on the outcome** — and
/// on both paths, including the one where the compiler rejected the program.
///
/// The program each language is driven with is the one whole program the seam guarantees every
/// language can write ([`open_docs_views_statement`](ProgramLanguage::open_docs_views_statement)),
/// so this needs no per-arm fixture and a new arm is inside it the moment it registers.
///
/// The second half is the half a compiled arm would most easily lose: a program the compiler
/// rejected never reaches the engine, so it returns through
/// [`before_start`](SandboxOutcome::before_start) — a different construction of the outcome, which
/// takes the reading as a parameter rather than accumulating it. A compile that spent four seconds
/// rejecting a program is exactly the cost that arm has to answer for, so absence there would be a
/// systematic under-report of every failing turn.
#[test]
fn every_language_reports_what_compiling_its_program_cost() {
    for language in all_languages() {
        let compiles = language.prepare_compiles();
        let name = language.display_name();

        let accepted = outcome_of(language, &language.open_docs_views_statement(&["readFile"]));
        assert!(
            accepted.result.is_ok(),
            "{name}: the program the seam guarantees it can write did not run: {:?}",
            accepted.result
        );
        assert_eq!(
            accepted.compile.is_some(),
            compiles,
            "{name}: says prepare_compiles() = {compiles}, but the outcome's compile reading was \
             {:?}",
            accepted.compile
        );
        if compiles {
            assert!(
                accepted.compile > Some(Duration::ZERO),
                "{name}: a real compiler ran and the reading was {:?}; a zero here means the clock \
                 is not around the compile",
                accepted.compile
            );
        }

        // Something no compiler accepts, in any of these languages: a bare delimiter.
        let rejected = outcome_of(language, "((({");
        assert_eq!(
            rejected.compile.is_some(),
            compiles,
            "{name}: a rejected program reported compile = {:?}; the cost of a compile that said \
             no is still the cost of a compile",
            rejected.compile
        );
        if compiles {
            assert!(
                rejected.result.is_err(),
                "{name}: a checked language accepted `((({{`, so this half proves nothing"
            );
            assert!(
                rejected.compile > Some(Duration::ZERO),
                "{name}: the compiler rejected the program in {:?}",
                rejected.compile
            );
        }
    }
}

/// **The languages that compile nothing are named, so the absence is a decision rather than a
/// default.**
///
/// [`prepare_compiles`](ProgramLanguage::prepare_compiles) defaults to "there is a checker", so an
/// arm that forgets to declare one reports `None` forever and looks free. Naming the two arms that
/// are genuinely free — JavaScript, whose whole point is being TypeScript without the check, and
/// Python, whose interpreter is inside the committed component — means a third one joining them
/// fails here and has to be argued for rather than merely committed.
#[test]
fn only_the_arms_with_no_compiler_report_no_compile_cost() {
    let free: Vec<&str> = all_languages()
        .filter(|language| !language.prepare_compiles())
        .map(ProgramLanguage::display_name)
        .collect();
    assert_eq!(
        free,
        vec!["JavaScript", "Python"],
        "an arm's compile cost went missing, or a new free arm arrived without saying so"
    );
}
