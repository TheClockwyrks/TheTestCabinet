//! The sandbox's failure taxonomy, and the one guarantee that is about what does *not* happen.
//!
//! Nothing here touches the component: these are the cases the sandbox answers before the engine is
//! involved, plus the rendering of the errors themselves. Keeping them out of `sandbox.test.rs`
//! keeps a per-process component compile off tests that have no need of one.

use std::time::Duration;

use super::*;
use crate::ending::EndingRole;
use crate::limits::{TurnErrorKind, TurnErrorType};
use crate::sandbox::fake::{CallLog, FakeToolApi, process_isolated, typescript};
use crate::sandbox::language::fixture;

/// **A program that does not compile never touches the engine.** It is the only failure that costs
/// nothing at all — no store, no instantiate, no fuel — so the fact that it short-circuits before the
/// component is a property worth asserting rather than assuming.
#[test]
fn a_prepare_error_never_touches_the_engine() {
    let log = CallLog::default();
    let (outcome, _api) = run_program(
        typescript(),
        "const x: = ;",
        ProgramScope {
            enabled: &[],
            modules: &[],
            ending: RunEnding::Role(EndingRole::Standard),
            library: false,
            docview_close: false,
        },
        SandboxLimits::default(),
        None,
        FakeToolApi::new(&log),
    );

    let error = outcome.result.expect_err("invalid TypeScript cannot run");
    assert!(matches!(error, SandboxError::Prepare(_)), "{error:?}");
    assert!(
        !error.is_artifact_defect() && !error.is_host_fault(),
        "a program that did not compile is the model's to fix, not gg's: {error:?}"
    );
    // The counter is only exact when this test owns its process; under `cargo test` sibling threads
    // race to compile the shared component. See [`process_isolated`].
    if process_isolated() {
        assert_eq!(
            crate::sandbox::engine::compiles(),
            0,
            "the component must not be compiled for a program that cannot run"
        );
    }
    assert_eq!(outcome.elapsed, Duration::ZERO);
    assert!(outcome.tool_calls.is_empty());
    assert!(outcome.logs.is_empty());
    assert!(
        outcome.completion.is_none(),
        "nothing ran, so nothing ended"
    );
    assert!(log.calls().is_empty());
}

/// A module-syntax refusal is the same shape of failure, carrying the guidance the model acts on.
#[test]
fn an_unsupported_feature_is_a_prepare_error_with_guidance() {
    let log = CallLog::default();
    let (outcome, _api) = run_program(
        typescript(),
        "import fs from 'node:fs';\nreturn 1;",
        ProgramScope {
            enabled: &[],
            modules: &[],
            ending: RunEnding::Role(EndingRole::Standard),
            library: false,
            docview_close: false,
        },
        SandboxLimits::default(),
        None,
        FakeToolApi::new(&log),
    );

    let error = outcome.result.expect_err("an import cannot run");
    assert!(matches!(error, SandboxError::Prepare(_)), "{error:?}");
    assert!(error.to_string().contains("`import`"), "{error}");
    // Exact only under process isolation; see [`process_isolated`].
    if process_isolated() {
        assert_eq!(crate::sandbox::engine::compiles(), 0);
    }
}

/// **The program a compiler rejected is still a program that was compiled**, and the sandbox reports
/// what that cost.
///
/// This is the path the figure exists for. A compile that spends four seconds and then refuses the
/// program spent them: the model gets its turn back, the run pays the wall clock, and every other
/// reading of the turn is zero — the membrane's clock never started, so `elapsed` is
/// [`Duration::ZERO`] and the whole cost would otherwise be absorbed into the turn's response time.
/// Asserted against the fixture language, which is the one implementation of the seam that declares
/// it compiles.
#[test]
fn a_compiler_that_rejected_the_program_still_reports_what_it_cost() {
    let language = super::fixture_languages()
        .next()
        .expect("the fixture language is registered under test");
    assert!(
        language.prepare_compiles(),
        "this assertion is about a language that compiles"
    );

    let log = CallLog::default();
    let (outcome, _api) = run_program(
        language,
        "def f\n  a ?? b",
        ProgramScope {
            enabled: &[],
            modules: &[],
            ending: RunEnding::Role(EndingRole::Standard),
            library: false,
            docview_close: false,
        },
        SandboxLimits::default(),
        None,
        FakeToolApi::new(&log),
    );

    let error = outcome
        .result
        .expect_err("`??` is not a token in that language");
    assert!(matches!(error, SandboxError::Prepare(_)), "{error:?}");
    assert!(
        outcome.compile.is_some(),
        "a compiling language reports what preparing the program cost, even when it refused it"
    );
    assert_eq!(
        outcome.elapsed,
        Duration::ZERO,
        "nothing ran, so the only non-zero reading of this turn is the compile"
    );
}

/// The fixture language, which is the one registered implementation that declares it
/// [compiles](crate::sandbox::ProgramLanguage::prepare_compiles) — and therefore the only one that
/// can raise the two failures a compiler has.
fn compiling_language() -> &'static dyn crate::sandbox::ProgramLanguage {
    let language = super::fixture_languages()
        .next()
        .expect("the fixture language is registered under test");
    assert!(
        language.prepare_compiles(),
        "these assertions are about a language that compiles"
    );
    language
}

/// Run `source` through the compiling language, which is expected to refuse it.
fn refused(source: &str) -> SandboxOutcome {
    let log = CallLog::default();
    let (outcome, _api) = run_program(
        compiling_language(),
        source,
        ProgramScope {
            enabled: &[],
            modules: &[],
            ending: RunEnding::Role(EndingRole::Standard),
            library: false,
            docview_close: false,
        },
        SandboxLimits::default(),
        None,
        FakeToolApi::new(&log),
    );
    outcome
}

/// **A program the compiler read and rejected is the model's to fix, and never an artifact defect.**
///
/// The distinction this band exists for. `SandboxError::Compile` is the *embedded interpreter
/// component* failing to compile — an artifact defect that ends the session on the first occurrence,
/// because every further turn would fail identically. A model's own type error is the exact opposite:
/// the next turn's program may well compile, because the model will have changed it. Routing one
/// through the other would end a run over a typo in a type annotation.
#[test]
fn a_program_its_compiler_rejected_is_recoverable_and_the_models_to_fix() {
    let outcome = refused(&format!("def f\n  x = {}\n", fixture::MISTYPED));
    let error = outcome
        .result
        .as_ref()
        .expect_err("the fixture's checker rejects this source");

    assert!(
        matches!(error, SandboxError::Prepare(PrepareError::Compile(_))),
        "a compiler's rejection of the model's program is a prepare failure: {error:?}"
    );
    assert!(
        !error.is_artifact_defect(),
        "a model's type error must never read as a defect in the prebuilt component: {error:?}"
    );
    assert!(!error.is_host_fault(), "{error:?}");
    assert_eq!(
        error.turn_error_type(),
        Some(TurnErrorType::TranspileCompile),
        "it is recorded as its own type rather than pooled with syntax errors"
    );
    assert_eq!(
        error.turn_error_type().map(TurnErrorType::kind),
        Some(TurnErrorKind::Transpile),
        "and under the base kind every prepare failure lands on"
    );
    assert!(
        error.to_string().contains(fixture::MISTYPED),
        "the compiler's own diagnostic is what the model gets back: {error}"
    );
    assert!(
        outcome.compile.is_some(),
        "the compile that produced the rejection cost real time and is reported"
    );
}

/// **A compiler that could not finish is charged to the run, not to the model** — and does not end
/// the session.
///
/// Three claims, and each is a different way the failure could be got wrong. It is not the model's
/// program, so it must not arrive as a `transpile` error beside genuine type errors and skew the one
/// rate a checked language's arm is read on. It is not gg's plumbing and not the embedded artifact,
/// so it must not end the session — a compiler that fell over on one program may well compile the
/// next. And it is still an error turn, so a run whose image has no compiler at all stops on its
/// error ceilings rather than burning to its deadline.
#[test]
fn a_compiler_that_could_not_finish_is_its_own_kind_of_failure() {
    let outcome = refused(&format!("def f\n  {}\n", fixture::NO_COMPILER));
    let error = outcome
        .result
        .as_ref()
        .expect_err("the fixture's compiler falls over on this source");

    assert!(
        matches!(error, SandboxError::Toolchain(_)),
        "the compiler falling over is not a prepare failure: {error:?}"
    );
    assert!(
        !error.is_artifact_defect() && !error.is_host_fault(),
        "neither predicate may claim it, because both of them end the session: {error:?}"
    );
    assert_eq!(
        error.turn_error_type(),
        Some(TurnErrorType::ToolchainFailed),
        "the turn is still an error, so the ceilings can stop a run with a broken compiler"
    );
    assert_eq!(
        error.turn_error_type().map(TurnErrorType::kind),
        Some(TurnErrorKind::Toolchain),
        "under its own base kind, which is the whole mechanism by which the attribution survives"
    );
    assert!(
        outcome.compile.is_some(),
        "the compile was attempted and cost time, whatever it did afterwards"
    );
    assert_eq!(outcome.elapsed, Duration::ZERO, "nothing ran");
}

/// A language whose prepare step compiles nothing reports **nothing**, rather than a zero.
///
/// `Some(0)` and `None` are different claims — "compiled, in under a millisecond" against "there is
/// no compiler on this path at all" — and a zero on every turn of every run would put a column of
/// noise in front of the one study the field exists for, making an arm that genuinely compiles
/// instantly indistinguishable from one that does not compile at all.
///
/// Its subject is a fixture, because every **registered** language now compiles: TypeScript's
/// prepare step runs `tsc`. That is exactly why the branch needs one — a claim with no subject is a
/// claim nothing has ever checked.
#[test]
fn a_language_that_compiles_nothing_reports_no_compile_time_at_all() {
    let free = fixture::a_language_that_does_not_compile();
    assert!(!free.prepare_compiles());

    let log = CallLog::default();
    let (outcome, _api) = run_program(
        free,
        "use tools\n",
        ProgramScope {
            enabled: &[],
            modules: &[],
            ending: RunEnding::Role(EndingRole::Standard),
            library: false,
            docview_close: false,
        },
        SandboxLimits::default(),
        None,
        FakeToolApi::new(&log),
    );

    assert!(outcome.result.is_err());
    assert_eq!(outcome.compile, None);
}

/// **TypeScript compiles, and says so.** Its prepare step runs `tsc` over the model's own source
/// against the SDK's declarations, so every program it prepares — including the one the compiler
/// rejected, which is the reading that would otherwise be reported as nothing — is timed.
#[test]
fn typescript_reports_what_checking_a_program_cost() {
    assert!(typescript().prepare_compiles());

    let log = CallLog::default();
    let (outcome, _api) = run_program(
        typescript(),
        "view.openText(\"x\", 42);\n",
        ProgramScope {
            enabled: &[],
            modules: &[],
            ending: RunEnding::Role(EndingRole::Standard),
            library: false,
            docview_close: false,
        },
        SandboxLimits::default(),
        None,
        FakeToolApi::new(&log),
    );

    let Err(SandboxError::Prepare(PrepareError::Compile(diagnostics))) = &outcome.result else {
        panic!("a number is not a string: {:?}", outcome.result);
    };
    assert!(
        diagnostics.starts_with("program.ts(1,20): error TS2345:"),
        "the model is handed tsc's own diagnostic at its own coordinates: {diagnostics}"
    );
    assert!(
        outcome.compile.is_some_and(|spent| spent > Duration::ZERO),
        "and the check it paid for is charged to the program that paid it"
    );
    assert_eq!(outcome.elapsed, Duration::ZERO, "nothing ran");
}

/// How the loop disposes of a sandbox failure: whose fault it was, and therefore what the turn was.
///
/// A test-local mirror of the loop's four choices, written here so this file can assert the mapping
/// is **total and unambiguous** without reaching into the loop. The loop derives its own answer from
/// the same two predicates, in the same order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Disposition {
    /// gg's own machinery failed. The session ends; the model's error budget is untouched.
    GgsFault,
    /// The embedded artifact is broken. The session ends; the model's error budget is untouched.
    ArtifactDefect,
    /// The reply was not runnable source in the run's program language. An error turn; nothing ran.
    ModelsPrepareError,
    /// The language's compiler could not finish. An error turn the run carries on from, and the one
    /// that is charged to the run rather than to the model: nothing was decided about the program.
    ToolchainFailure,
    /// The sandbox stopped a program that *did* run. An error turn; the calls it landed stand.
    ModelsSandboxLimit,
}

/// The disposition the loop derives, from nothing but the two public predicates plus the one
/// remaining distinction between an error turn that ran and one that did not.
///
/// This is deliberately the *consumer's* algorithm rather than a second copy of the taxonomy: what
/// the test below proves is that this algorithm agrees, on every variant, with the hand-written
/// specification in [`declared_disposition`].
fn derived_disposition(error: &SandboxError) -> Disposition {
    if error.is_artifact_defect() {
        Disposition::ArtifactDefect
    } else if error.is_host_fault() {
        Disposition::GgsFault
    } else if matches!(error, SandboxError::Prepare(_)) {
        Disposition::ModelsPrepareError
    } else if matches!(error, SandboxError::Toolchain(_)) {
        Disposition::ToolchainFailure
    } else {
        Disposition::ModelsSandboxLimit
    }
}

/// What each variant is *declared* to be, variant by variant, with no wildcard.
///
/// The absence of a `_ =>` arm is the point: a new [`SandboxError`] cannot be added without someone
/// deciding here whose failure it is, which is exactly the decision that a wildcard would make
/// silently — and would make wrongly, since the safe-looking default (an error the model is told to
/// fix) is the one that charges gg's defects to the model.
fn declared_disposition(error: &SandboxError) -> Disposition {
    match error {
        SandboxError::Prepare(_) => Disposition::ModelsPrepareError,
        SandboxError::Toolchain(_) => Disposition::ToolchainFailure,
        SandboxError::Engine(_) => Disposition::GgsFault,
        SandboxError::Host(_) => Disposition::GgsFault,
        SandboxError::Compile(_) => Disposition::ArtifactDefect,
        SandboxError::Instantiate(_) => Disposition::ArtifactDefect,
        SandboxError::Timeout { .. } => Disposition::ModelsSandboxLimit,
        SandboxError::OutOfMemory { .. } => Disposition::ModelsSandboxLimit,
        SandboxError::Trap(_) => Disposition::ModelsSandboxLimit,
    }
}

/// How many variants [`SandboxError`] has, so the sample below can be checked for completeness.
///
/// Kept beside [`declared_disposition`], whose exhaustive `match` is what makes a new variant
/// impossible to add without coming here.
const SANDBOX_ERROR_VARIANTS: usize = 9;

/// One of every [`SandboxError`], for the totality assertions below.
fn every_sandbox_error() -> Vec<SandboxError> {
    vec![
        SandboxError::Prepare(PrepareError::Syntax("bad".into())),
        SandboxError::Toolchain("`fixturec` exited with signal 11".into()),
        SandboxError::Engine("no fuel metering".into()),
        SandboxError::Host("the blocking task panicked".into()),
        SandboxError::Compile("not a component".into()),
        SandboxError::Instantiate("missing import".into()),
        SandboxError::Timeout {
            limit: Duration::from_secs(42),
        },
        SandboxError::OutOfMemory { limit: 42 },
        SandboxError::Trap("unreachable".into()),
    ]
}

/// **Every sandbox failure maps to exactly one turn disposition**, and the two predicates the loop
/// reads agree with the hand-written classification on every one of them.
///
/// Three properties in one, because they are one property: the mapping is *total* (every variant is
/// sampled), *unambiguous* (no variant is both gg's fault and the artifact's), and *agreed* (the
/// algorithm the loop runs produces the declared answer). A gap in any of the three is how a failure
/// ends up charged to the wrong party — the model rewriting a correct program to appease a bug in
/// gg, or gg burning a run to its deadline over a syntax error.
#[test]
fn every_sandbox_failure_maps_to_exactly_one_turn_disposition() {
    let sample = every_sandbox_error();
    assert_eq!(
        sample.len(),
        SANDBOX_ERROR_VARIANTS,
        "every SandboxError variant must be sampled here, or the totality below proves nothing"
    );

    for error in &sample {
        assert!(
            !(error.is_artifact_defect() && error.is_host_fault()),
            "{error:?} claims two owners; the loop would have to guess which one to report"
        );
        assert_eq!(
            derived_disposition(error),
            declared_disposition(error),
            "the loop's algorithm and the declared classification disagree about {error:?}"
        );
    }
}

/// **The recorded turn error type is a partition of the same taxonomy**: exactly the failures the
/// two predicates disclaim have one, and every one of those is distinct.
///
/// The distinctness is the fix. The turn loop used to reach the sandbox ceilings through an
/// `Err(_)` arm that had already matched the error and then never looked at the variant, so a
/// runaway loop, a program that allocated past its cap and a guest trap were one `sandbox_limit`
/// row — three different defects, one bucket, and no way to tell from a run's record which had
/// happened.
#[test]
fn exactly_the_failures_the_model_owns_carry_a_recorded_type() {
    let mut recorded = Vec::new();
    for error in every_sandbox_error() {
        let error_type = error.turn_error_type();
        let owned_by_the_model = !error.is_artifact_defect() && !error.is_host_fault();
        assert_eq!(
            error_type.is_some(),
            owned_by_the_model,
            "{error:?}: a type is recorded for exactly the failures charged to the model"
        );
        if let Some(error_type) = error_type {
            // ...and under the base kind the disposition says it is.
            let expected = match declared_disposition(&error) {
                Disposition::ModelsPrepareError => TurnErrorKind::Transpile,
                Disposition::ToolchainFailure => TurnErrorKind::Toolchain,
                Disposition::ModelsSandboxLimit => TurnErrorKind::SandboxLimit,
                other => panic!("{error:?} is {other:?} and should carry no type"),
            };
            assert_eq!(error_type.kind(), expected, "{error:?}");
            recorded.push(error_type);
        }
    }

    let distinct: std::collections::BTreeSet<&str> = recorded
        .iter()
        .map(|error| error.wire().wire_id())
        .collect();
    assert_eq!(
        distinct.len(),
        recorded.len(),
        "the five recordable failures must not share a type: {distinct:?}"
    );
    assert!(
        distinct.is_superset(&std::collections::BTreeSet::from([
            "sandbox_timeout",
            "sandbox_out_of_memory",
            "sandbox_trap",
        ])),
        "the three ceilings are three types: {distinct:?}"
    );
    // ...and a compiler that could not finish is charged to its own base, not to the model's
    // transpile rate. That separation is the whole reason the variant exists.
    assert!(
        distinct.contains("toolchain_failed"),
        "a compiler that could not finish carries its own type: {distinct:?}"
    );
}

/// The five prepare failures are five recorded types, because they have five different causes: a
/// syntax error is a typo, a semantic error is almost always two programs in one reply, a compile
/// error is a whole coherent program written against the wrong surface, a lowering failure is a
/// defect in gg's own pipeline, and a refusal is gg declining a feature.
///
/// The enum's own rustdoc has always claimed that "telling them apart in the telemetry is how each
/// shows up as a rate rather than as anecdote". Until now the telemetry did not tell them apart.
#[test]
fn every_prepare_failure_is_recorded_as_its_own_type() {
    let cases = [
        (
            PrepareError::Syntax("unexpected token".into()),
            TurnErrorType::TranspileSyntax,
        ),
        (
            PrepareError::Semantic("`x` declared twice".into()),
            TurnErrorType::TranspileSemantic,
        ),
        (
            PrepareError::Compile("`x` is not assignable to `Word`".into()),
            TurnErrorType::TranspileCompile,
        ),
        (
            PrepareError::Lowering("could not lower".into()),
            TurnErrorType::TranspileLowering,
        ),
        (
            PrepareError::Unsupported("no module loader".into()),
            TurnErrorType::TranspileUnsupported,
        ),
    ];
    for (prepare, expected) in cases {
        assert_eq!(prepare.turn_error_type(), expected, "{prepare:?}");
        assert_eq!(expected.kind(), TurnErrorKind::Transpile, "{prepare:?}");
        // The whole `SandboxError` wrapping it must agree, since that is what the turn loop holds.
        assert_eq!(
            SandboxError::Prepare(prepare.clone()).turn_error_type(),
            Some(expected)
        );
    }
}

/// The three classes the guest already types an uncaught throw with are three recorded types.
///
/// `program_tool_error` is the one worth having: it says the model is fighting a call it could not
/// make, rather than mis-writing its own program, and it was previously indistinguishable from a
/// `TypeError`.
#[test]
fn every_uncaught_throw_class_is_recorded_as_its_own_type() {
    let cases = [
        (
            ProgramErrorKind::ToolFailure,
            TurnErrorType::ProgramToolError,
        ),
        (
            ProgramErrorKind::UnknownName,
            TurnErrorType::ProgramUnknownName,
        ),
        (ProgramErrorKind::Other, TurnErrorType::ProgramThrow),
    ];
    for (kind, expected) in cases {
        assert_eq!(kind.turn_error_type(), expected, "{kind:?}");
        assert_eq!(expected.kind(), TurnErrorKind::ProgramFault, "{kind:?}");
    }
}

/// Which failures are defects in the embedded artifact. Every subsequent turn would fail
/// identically, so the loop ends the session loudly instead of burning to the deadline.
#[test]
fn only_a_compile_or_instantiate_failure_is_an_artifact_defect() {
    for error in every_sandbox_error() {
        let expected = matches!(
            error,
            SandboxError::Compile(_) | SandboxError::Instantiate(_)
        );
        assert_eq!(
            error.is_artifact_defect(),
            expected,
            "{error:?} is classified as artifact drift when it is not (or the reverse)"
        );
    }
}

/// **Which failures are gg's own** — and, in particular, that a panic inside the sandbox's blocking
/// task is *not* laundered as a guest trap.
///
/// The distinction is the whole reason [`SandboxError::Host`] exists. A trap is something the program
/// did, and is answered with advice about writing smaller programs; a host fault is a defect in gg,
/// and answering it that way would send a model rewriting a program that was never wrong — while the
/// error budget that is meant to stop a failing *model* quietly counted gg's bug instead.
#[test]
fn only_the_engine_and_host_failures_are_ggs_own_fault() {
    for error in every_sandbox_error() {
        let expected = matches!(error, SandboxError::Engine(_) | SandboxError::Host(_));
        assert_eq!(
            error.is_host_fault(),
            expected,
            "{error:?} is classified as gg's own failure when it is not (or the reverse)"
        );
    }
    assert!(
        !SandboxError::Toolchain("`swiftc` was killed".into()).is_host_fault()
            && !SandboxError::Toolchain("`swiftc` was killed".into()).is_artifact_defect(),
        "a compiler that fell over is neither gg's plumbing nor the embedded artifact: both of \
         those end the session, and the next program may well compile"
    );
    assert!(
        !SandboxError::Trap("wasm trap: unreachable".into()).is_host_fault(),
        "a guest trap is the program's, not gg's"
    );
}

/// Every error renders into a sentence a model (or an operator reading a log) can act on. The two
/// resource failures name their ceiling, and the memory one names the guest's floor as well —
/// otherwise a cap set below ~10 MiB looks like a mysterious instantiation failure.
#[test]
fn every_sandbox_error_renders_something_actionable() {
    assert_eq!(
        SandboxError::Prepare(PrepareError::Unsupported("no imports".into())).to_string(),
        "the program did not compile: no imports"
    );
    assert_eq!(
        SandboxError::Engine("duplicate import name".into()).to_string(),
        "failed to prepare the wasm engine: duplicate import name"
    );
    assert_eq!(
        SandboxError::Compile("not a component".into()).to_string(),
        "the sandbox component failed to compile: not a component"
    );
    assert_eq!(
        SandboxError::Instantiate("unknown import".into()).to_string(),
        "the sandbox component failed to instantiate: unknown import"
    );
    assert_eq!(
        SandboxError::Timeout {
            limit: Duration::from_secs(30)
        }
        .to_string(),
        "the program ran longer than its 30s execution timeout and was stopped"
    );
    let memory = SandboxError::OutOfMemory { limit: 4_194_304 }.to_string();
    assert!(memory.contains("4194304-byte memory cap"), "{memory}");
    assert!(memory.contains("10 MiB"), "{memory}");
    assert_eq!(
        SandboxError::Trap("wasm trap: unreachable".into()).to_string(),
        "the sandbox trapped: wasm trap: unreachable"
    );
    // The host fault reads as gg's, not as the program's: an operator seeing this in a log must not
    // go looking for what the model wrote wrong.
    assert_eq!(
        SandboxError::Host("task panicked at 'index out of bounds'".into()).to_string(),
        "the code sandbox did not complete: task panicked at 'index out of bounds'"
    );
}
