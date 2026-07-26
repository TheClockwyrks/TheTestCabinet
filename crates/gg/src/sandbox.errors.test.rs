//! The sandbox's failure taxonomy, and the one guarantee that is about what does *not* happen.
//!
//! Nothing here touches the component: these are the cases the sandbox answers before the engine is
//! involved, plus the rendering of the errors themselves. Keeping them out of `sandbox.test.rs`
//! keeps a per-process component compile off tests that have no need of one.

use super::transpile::TranspileError;
use super::*;
use crate::sandbox::fake::{CallLog, FakeInvoker};

/// **A program that does not compile never touches the engine.** It is the only failure that costs
/// nothing at all — no store, no instantiate, no fuel — so the fact that it short-circuits before the
/// component is a property worth asserting rather than assuming.
#[test]
fn a_transpile_error_never_touches_the_engine() {
    let log = CallLog::default();
    let outcome = run_program(
        "const x: = ;",
        &[],
        SandboxLimits::default(),
        None,
        Box::new(FakeInvoker::new(&log)),
    );

    let error = outcome.result.expect_err("invalid TypeScript cannot run");
    assert!(matches!(error, SandboxError::Transpile(_)), "{error:?}");
    assert!(
        !error.is_artifact_defect() && !error.is_host_fault(),
        "a program that did not compile is the model's to fix, not gg's: {error:?}"
    );
    assert_eq!(
        crate::sandbox::engine::compiles(),
        0,
        "the component must not be compiled for a program that cannot run"
    );
    assert_eq!(outcome.fuel_consumed, 0);
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
fn an_unsupported_feature_is_a_transpile_error_with_guidance() {
    let log = CallLog::default();
    let outcome = run_program(
        "import fs from 'node:fs';\nreturn 1;",
        &[],
        SandboxLimits::default(),
        None,
        Box::new(FakeInvoker::new(&log)),
    );

    let error = outcome.result.expect_err("an import cannot run");
    assert!(matches!(error, SandboxError::Transpile(_)), "{error:?}");
    assert!(error.to_string().contains("`import`"), "{error}");
    assert_eq!(crate::sandbox::engine::compiles(), 0);
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
    /// The committed artifact is broken. The session ends; the model's error budget is untouched.
    ArtifactDefect,
    /// The reply was not runnable TypeScript. An error turn; nothing ran.
    ModelsTranspileError,
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
    } else if matches!(error, SandboxError::Transpile(_)) {
        Disposition::ModelsTranspileError
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
        SandboxError::Transpile(_) => Disposition::ModelsTranspileError,
        SandboxError::Engine(_) => Disposition::GgsFault,
        SandboxError::Host(_) => Disposition::GgsFault,
        SandboxError::Compile(_) => Disposition::ArtifactDefect,
        SandboxError::Instantiate(_) => Disposition::ArtifactDefect,
        SandboxError::OutOfFuel { .. } => Disposition::ModelsSandboxLimit,
        SandboxError::OutOfMemory { .. } => Disposition::ModelsSandboxLimit,
        SandboxError::Trap(_) => Disposition::ModelsSandboxLimit,
    }
}

/// How many variants [`SandboxError`] has, so the sample below can be checked for completeness.
///
/// Kept beside [`declared_disposition`], whose exhaustive `match` is what makes a new variant
/// impossible to add without coming here.
const SANDBOX_ERROR_VARIANTS: usize = 8;

/// One of every [`SandboxError`], for the totality assertions below.
fn every_sandbox_error() -> Vec<SandboxError> {
    vec![
        SandboxError::Transpile(TranspileError::Parse("bad".into())),
        SandboxError::Engine("no fuel metering".into()),
        SandboxError::Host("the blocking task panicked".into()),
        SandboxError::Compile("not a component".into()),
        SandboxError::Instantiate("missing import".into()),
        SandboxError::OutOfFuel { limit: 42 },
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

/// Which failures are defects in the committed artifact. Every subsequent turn would fail
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
        SandboxError::Transpile(TranspileError::Unsupported("no imports".into())).to_string(),
        "the program did not compile: no imports"
    );
    assert_eq!(
        SandboxError::Engine("fuel metering unavailable".into()).to_string(),
        "failed to prepare the wasm engine: fuel metering unavailable"
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
        SandboxError::OutOfFuel {
            limit: 200_000_000_000
        }
        .to_string(),
        "the program exhausted its fuel ceiling of 200000000000"
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
