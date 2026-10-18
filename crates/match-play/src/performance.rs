//! The performance half of the runner: one submission engine over one held-out
//! case.
//!
//! A performance run is scored per case, not per match: the engine is invoked
//! **once per case** through the shared [`lattice_host`] host (the very same host
//! the `lattice` CLI uses, so there is exactly one host implementation), under the
//! case's run ceiling and the manifest's memory cap and `[contract] entry`, and its
//! per-snapshot checksums are compared against the case's committed `expected`
//! oracle answer through the host's shared scoring rule. Correctness (checksums) and
//! fuel (consumed against the pass line) are two independent axes.
//!
//! [`run_case`] reads the case's committed files and returns the recorded
//! [`PerformanceCaseResult`] plus what the caller may publish into the run tree: the
//! engine's produced snapshots and, for a correct answer, the scored scenario. The
//! caller owns those writes and the smoke-then-stress scheduling across the cases.

use lattice_core::{Scenario, Snapshot};
use lattice_host::{InvokeError, RunError, run_submission, score_against};
use test_cabinet_contracts::test_case::{PerformanceCase, TestCaseVersion};
use test_cabinet_contracts::validation::{
    PerformanceCaseKind, PerformanceCaseResult, PerformanceSnapshotCheck,
};

// The per-run sandbox limits, so a caller configures a case without linking the
// host itself.
pub use lattice_host::SandboxLimits;

/// One case run through the host: its recorded result and what the caller may
/// publish from it.
#[derive(Debug, Clone)]
pub struct CaseRun {
    /// The case's recorded result. Its `scenario_json` is `None`: the published
    /// scenario's name is the caller's, which writes it (see [`scenario`]).
    ///
    /// [`scenario`]: CaseRun::scenario
    pub result: PerformanceCaseResult,
    /// The snapshots the engine produced, when it ran to an answer (right or
    /// wrong), so a reviewer can diff them against the oracle. `None` when the
    /// engine never produced a full answer or the case files could not be read.
    pub produced: Option<Vec<Snapshot>>,
    /// The scored scenario's committed bytes, only when the engine's **answer** was
    /// correct (an over-ceiling run included): what browser playback re-simulates.
    /// A wrong run keeps the held-out input out of a tree that never solved it.
    pub scenario: Option<Vec<u8>>,
}

/// Run `module_wasm` over one held-out `case` of `test_case` and score it.
///
/// `base_limits.fuel_limit` is the **pass line**; the engine runs at the case's
/// (possibly wider) run ceiling, `case.fuel_ceiling`, so a too-slow engine can
/// finish and have its overshoot recorded. A read or parse failure of a committed
/// case file is a case-authoring failure recorded as the case's detail; a host
/// failure (the engine could not be run) leaves `fuel = None`; a wrong but runnable
/// answer records the fuel and the first mismatch. Never an error: every outcome is
/// a recorded result.
pub fn run_case(
    test_case: &TestCaseVersion,
    module_wasm: &[u8],
    base_limits: SandboxLimits,
    entry: &str,
    case: &PerformanceCase,
) -> CaseRun {
    let pass_limit = base_limits.fuel_limit;
    // The case-relative input path is what a reviewer ties the result back to.
    let input_label = input_label(test_case, case);

    // The committed scenario and the reference oracle's `state` answer both live in
    // the version folder (the secret scored set). A read or parse failure here is a
    // case-authoring error, not the submission's fault. The scenario is kept as
    // bytes as well as parsed: a correct run hands them back for republishing.
    let scenario_bytes = match std::fs::read(&case.input) {
        Ok(bytes) => bytes,
        Err(err) => {
            return not_run(case_authoring_error(
                input_label,
                case.kind,
                format!("could not read input scenario: {err}"),
            ));
        }
    };
    let scenario = match Scenario::parse(&scenario_bytes) {
        Ok(scenario) => scenario,
        Err(err) => {
            return not_run(case_authoring_error(
                input_label,
                case.kind,
                format!("input scenario is invalid: {err}"),
            ));
        }
    };
    let expected: Vec<Snapshot> = match std::fs::read(&case.expected) {
        Ok(bytes) => match serde_json::from_slice(&bytes) {
            Ok(expected) => expected,
            Err(err) => {
                return not_run(case_authoring_error(
                    input_label,
                    case.kind,
                    format!("expected answer is not a valid state array: {err}"),
                ));
            }
        },
        Err(err) => {
            return not_run(case_authoring_error(
                input_label,
                case.kind,
                format!("could not read expected answer: {err}"),
            ));
        }
    };

    // Run the engine once on this scenario at the case's **run ceiling** (the
    // resolved `fuel_ceiling`, the pass line widened by its runway, `>= fuel_limit`
    // by resolution). A module that fails to load, exhausts even the runway, or
    // otherwise fails mid-run is a host-level failure for this case: no fuel to
    // record, and no produced state to play back.
    let run_ceiling = case.fuel_ceiling;
    let run_limits = SandboxLimits {
        fuel_limit: run_ceiling,
        max_memory_bytes: base_limits.max_memory_bytes,
    };
    let run = match run_submission(module_wasm, &scenario, run_limits, entry) {
        Ok(run) => run,
        Err(err) => {
            return not_run(PerformanceCaseResult {
                input: input_label,
                kind: case.kind,
                correct: false,
                over_ceiling: false,
                skipped: false,
                fuel: None,
                first_mismatch_tick: None,
                detail: Some(run_failure_detail(&err, pass_limit, run_ceiling)),
                // The engine never produced a full answer, so there is nothing to
                // play back.
                snapshots: Vec::new(),
                scenario_json: None,
            });
        }
    };

    // Compare per-snapshot checksums against the oracle's answer through the shared
    // scoring rule, so the validator and the `lattice run` CLI can never disagree on
    // what a *correct answer* is. Fuel is a separate axis, judged below.
    let score = score_against(&expected, &run);

    // Two independent axes: the answer (checksums) and the fuel (consumed vs the
    // pass line). A STRESS case needs both — a correct answer over the pass line is
    // `over_ceiling`, not a pass, but not "incorrect" either. A SMOKE case is a
    // correctness pre-flight only: its fuel is not scored, so a correct answer passes
    // regardless of what it burned, and it is never over the ceiling.
    let answer_correct = score.correct;
    let (over_ceiling, passed) = match case.kind {
        PerformanceCaseKind::Smoke => (false, answer_correct),
        PerformanceCaseKind::Stress => (
            answer_correct && run.fuel_consumed > pass_limit,
            answer_correct && run.fuel_consumed <= pass_limit,
        ),
    };
    let detail = if over_ceiling {
        Some(format!(
            "correct answer, but over the fuel ceiling: consumed {} fuel against a {} limit",
            run.fuel_consumed, pass_limit
        ))
    } else {
        // Correct-and-passing: no detail. Wrong: the checksum-mismatch detail.
        score.detail
    };

    let result = PerformanceCaseResult {
        input: input_label,
        kind: case.kind,
        correct: passed,
        over_ceiling,
        skipped: false,
        fuel: Some(run.fuel_consumed),
        first_mismatch_tick: score.first_mismatch_tick,
        detail,
        // Recorded whether or not the run passed: for a passing run this is what
        // playback verifies itself against (the console's player compares the frames
        // it draws to these at the graded ticks inside the played window), and for a
        // wrong or over-ceiling one it shows exactly what the engine produced at each
        // snapshot. These are checksums the host derived from the returned state, not
        // ones the engine merely reported — see `lattice_host::score_against`.
        snapshots: run
            .snapshots
            .iter()
            .map(|snapshot| PerformanceSnapshotCheck {
                tick: snapshot.tick,
                checksum: snapshot.checksum.clone(),
            })
            .collect(),
        scenario_json: None,
    };
    CaseRun {
        result,
        produced: Some(run.snapshots),
        // Republished only when the *answer* was correct: an over-ceiling run
        // answered right, so it earns playback (that is the whole point of the
        // runway: see how a correct-but-slow engine behaves).
        scenario: answer_correct.then_some(scenario_bytes),
    }
}

/// A [`PerformanceCaseResult`] for a stress case that was **not run** because a
/// smoke test failed first. It counts as a failure (the run is incorrect), but is
/// marked [`skipped`](PerformanceCaseResult::skipped) so it reads as "not run to
/// save time" rather than "the engine ran and got it wrong". `fuel = None`, but
/// unlike a host failure it does not lower the run's load signal — the engine was
/// never given the case.
pub fn skipped_case(input: String) -> PerformanceCaseResult {
    PerformanceCaseResult {
        input,
        kind: PerformanceCaseKind::Stress,
        correct: false,
        over_ceiling: false,
        skipped: true,
        fuel: None,
        first_mismatch_tick: None,
        detail: Some(
            "Skipped — a smoke test failed, so the stress scenarios were not run.".to_string(),
        ),
        snapshots: Vec::new(),
        scenario_json: None,
    }
}

/// The case-relative input path a result records under, so a reviewer can tie it
/// back to its case (forward-slashed, relative to the version folder).
pub fn input_label(test_case: &TestCaseVersion, case: &PerformanceCase) -> String {
    case.input
        .strip_prefix(&test_case.root)
        .unwrap_or(&case.input)
        .to_string_lossy()
        .replace('\\', "/")
}

/// A [`CaseRun`] for a case the engine produced no answer for.
fn not_run(result: PerformanceCaseResult) -> CaseRun {
    CaseRun {
        result,
        produced: None,
        scenario: None,
    }
}

/// A [`PerformanceCaseResult`] for a case whose committed input/expected files
/// could not be read or parsed — a case-authoring error, not the submission's
/// fault. `fuel = None` (the engine never ran) so the run's load signal reflects
/// the gap.
fn case_authoring_error(
    input: String,
    kind: PerformanceCaseKind,
    detail: String,
) -> PerformanceCaseResult {
    PerformanceCaseResult {
        input,
        kind,
        correct: false,
        over_ceiling: false,
        skipped: false,
        fuel: None,
        first_mismatch_tick: None,
        detail: Some(detail),
        // The case files could not be read, so the engine never ran.
        snapshots: Vec::new(),
        scenario_json: None,
    }
}

/// A human-readable reason for a host-level failure on one case, distinguishing a
/// module that failed to *load*, one that burned through even its **runway** before
/// finishing (the case is beyond hope of a fuel reading), and any other mid-run
/// failure. `pass_limit`/`run_ceiling` frame the runway when it was exhausted.
fn run_failure_detail(err: &RunError, pass_limit: u64, run_ceiling: u64) -> String {
    match err {
        RunError::Load(inner) => format!("the engine failed to load: {inner}"),
        RunError::Invoke(InvokeError::OutOfFuel { .. }) if run_ceiling > pass_limit => format!(
            "the engine exhausted its runway ({run_ceiling} fuel, {}x the {pass_limit} ceiling) \
             before finishing — too slow to even measure",
            run_ceiling / pass_limit.max(1)
        ),
        RunError::Invoke(InvokeError::OutOfFuel { .. }) => {
            format!("the engine exhausted the {pass_limit} fuel ceiling before finishing")
        }
        other => format!("the engine failed during the run: {other}"),
    }
}

#[cfg(test)]
#[path = "performance.test.rs"]
mod tests;
