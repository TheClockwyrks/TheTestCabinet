//! Validator for performance runs.
//!
//! A performance run's authoritative output is the wasm **engine** the model's
//! `[build]` produced in-container. This validator does **not** build anything
//! itself — by the time it runs, the build commands have already executed in the
//! run container and the produced module sits at the case's `build.module` path
//! under the run root. The validator (mirroring the [adversarial
//! validator](crate::adversarial_validator), with the two semantic differences the
//! performance type carries):
//!
//! 1. reads the submission engine from `build.module`,
//! 2. for **every** held-out input case the manifest declares, reads the case's
//!    committed `input` scenario and `expected` answer (both live in the version
//!    folder — the secret scored set — never in the run),
//! 3. runs the engine **once per case** through the shared [`lattice_host`] host —
//!    the very same host the [`lattice` CLI](../../../crates/lattice-cli) uses, so
//!    there is exactly one host implementation — under the manifest's per-case
//!    `[sandbox]` fuel/memory limits and `[contract] entry`,
//! 4. checks each case's per-snapshot checksums against the `expected` oracle
//!    output and records the fuel the engine burned, and
//! 5. records the [`PerformanceResult`]: correct iff every case is, and the total
//!    fuel a correct engine consumed (the comparable performance result).
//!
//! The two differences from the adversarial validator: the contract entry is
//! invoked **once per case** (not per tick — the engine runs the whole simulation
//! in one metered call), and scoring is **correctness (checksum) + fuel**, not a
//! head-to-head match.
//!
//! Like the adversarial validator, it writes browser-playable material into the run
//! tree: the engine's produced `state` JSON per case (so a reviewer can diff it
//! against the oracle), and — for a case the engine got *right* — the scored
//! scenario itself, which is what browser playback re-simulates. The scenario is
//! republished rather than replayed because a run records only its scheduled
//! snapshots, thousands of ticks apart, with nothing to interpolate between.
//!
//! A submission that fails to *load* (it did not build, does not export the
//! contract entry, or cannot instantiate) is recorded with `correct = false` and a
//! reason — never a crash. A submission that loads but is wrong (a checksum miss,
//! the wrong snapshot count) or that fails mid-run on one case (a trap, fuel/memory
//! exhaustion) makes that case — and the run — incorrect, with the reason recorded.

use lattice_core::Snapshot;
use lattice_host::{InvokeError, RunError, SandboxLimits, run_submission, score_against};

use crate::error::Result;
use crate::execution::ArtifactCollection;
use crate::reference::RenderedReference;
use crate::test_case::{PerformanceCase, ProofFile, TestCaseVersion, Variant};
use crate::validation::{
    PerformanceCaseKind, PerformanceCaseResult, PerformanceResult, PerformanceSnapshotCheck,
    ProofResult, ValidationSummary, Validator,
};
use crate::validator::proof_results;

/// The run-tree subdirectory the validator writes each case's produced `state`
/// JSON and (for a passing case) its scored scenario into. Neither is a scored
/// artifact — the state is there so a reviewer can diff a submission's output
/// against the oracle, and the scenario is there so browser playback can
/// reconstruct the factory — so a write failure is non-fatal in both cases.
const STATE_DIR: &str = "performance";

/// A validator for performance runs. It keeps no state: every output is derived
/// from the run's own produced module and the case's committed scored set.
#[derive(Debug, Clone, Default)]
pub struct PerformanceValidator;

impl PerformanceValidator {
    /// A new performance validator.
    pub fn new() -> Self {
        Self
    }
}

impl Validator for PerformanceValidator {
    fn validate(
        &self,
        test_case: &TestCaseVersion,
        _variant: &Variant,
        artifacts: &ArtifactCollection,
        _references: &[RenderedReference],
        proofs: &[ProofFile],
    ) -> Result<ValidationSummary> {
        let repo = &artifacts.repo_path;
        // A case may still declare proofs; record their presence as for any type.
        let proof_results = proof_results(proofs, repo);

        // The orchestrator only routes performance cases here, so the tables are
        // present; guard the invariants rather than panicking. `[build]` carries the
        // produced module path; `[contract] entry`/`[sandbox]` configure the run.
        let Some(build) = test_case.build.as_ref() else {
            return Ok(failed(
                "performance validation requires [build]",
                proof_results,
            ));
        };
        let Some(module_rel) = build.module.as_ref() else {
            return Ok(failed(
                "performance validation requires build.module",
                proof_results,
            ));
        };
        let Some(contract) = test_case.contract.as_ref() else {
            return Ok(failed(
                "performance validation requires [contract]",
                proof_results,
            ));
        };
        let Some(sandbox) = test_case.sandbox.as_ref() else {
            return Ok(failed(
                "performance validation requires [sandbox]",
                proof_results,
            ));
        };
        // A performance case meters per input case via `fuel_limit`; its absence is a
        // case-authoring error (resolution requires it for this type).
        let Some(fuel_limit) = sandbox.fuel_limit else {
            return Ok(failed(
                "performance validation requires sandbox.fuel_limit",
                proof_results,
            ));
        };
        if test_case.cases.is_empty() {
            return Ok(failed(
                "performance validation requires at least one [[case]]",
                proof_results,
            ));
        }

        // `fuel_limit` is the pass line. Each case runs on its own **run ceiling**
        // (`case.fuel_ceiling`, which is `fuel_limit` widened by the case's runway)
        // so a too-slow engine can finish and have its overshoot recorded; the
        // pass/fail comparison is still against `fuel_limit`.
        let base_limits = SandboxLimits {
            fuel_limit,
            max_memory_bytes: sandbox.max_memory_bytes as usize,
        };

        // The submission is the wasm engine the in-container build produced. A
        // missing module means the build never emitted one (it did not compile, or
        // emitted to a different path) — recorded as incorrect, not a crash.
        let submission_path = repo.join(module_rel);
        let module_wasm = match std::fs::read(&submission_path) {
            Ok(bytes) => bytes,
            Err(err) => {
                return Ok(incorrect(
                    proof_results,
                    Vec::new(),
                    format!(
                        "the build produced no engine module at `{}`: {err}",
                        module_rel.display()
                    ),
                ));
            }
        };

        // Score the held-out set in two phases, keeping every result in its declared
        // manifest order (a published scenario is addressed by its case index, so the
        // order must not shift).
        //
        // Phase 1 — the SMOKE cases: a cheap correctness pre-flight, each a tiny
        // scenario exercising one behaviour. Phase 2 — the STRESS cases: the large
        // scored scenarios whose fuel is the comparable result. Every smoke case must
        // reproduce the oracle before ANY stress case runs; if one fails, the stress
        // cases are skipped and counted as failures, so a broken engine is caught in
        // milliseconds instead of after burning through the large scenarios.
        let mut results: Vec<Option<PerformanceCaseResult>> =
            (0..test_case.cases.len()).map(|_| None).collect();

        // Phase 1: run every smoke case.
        for (index, case) in test_case.cases.iter().enumerate() {
            if case.kind != PerformanceCaseKind::Smoke {
                continue;
            }
            results[index] = Some(score_case(
                repo,
                test_case,
                &module_wasm,
                base_limits,
                &contract.entry,
                case,
                index,
            ));
        }
        // The gate: every smoke case must have passed. (Vacuously true when a case
        // declares no smoke tests, so a case without them behaves exactly as before.)
        let smoke_ok = results
            .iter()
            .flatten()
            .all(|r| r.kind != PerformanceCaseKind::Smoke || r.correct);

        // Phase 2: the stress cases — run them only if the smoke gate passed, else
        // record each as skipped (a failure, but distinct from a wrong answer).
        for (index, case) in test_case.cases.iter().enumerate() {
            if case.kind != PerformanceCaseKind::Stress {
                continue;
            }
            results[index] = Some(if smoke_ok {
                score_case(
                    repo,
                    test_case,
                    &module_wasm,
                    base_limits,
                    &contract.entry,
                    case,
                    index,
                )
            } else {
                skipped_case(input_label(test_case, case))
            });
        }

        let case_results: Vec<PerformanceCaseResult> = results
            .into_iter()
            .map(|r| r.expect("every case is scored or skipped"))
            .collect();

        // Roll up. A run is correct only when every case — smoke and stress — passed.
        // The comparable score is the fuel a correct engine burned across the STRESS
        // cases; smoke fuel is a pre-flight, not scored. `loaded` tracks whether the
        // engine ran without a *host* failure on the cases that actually ran — a
        // skipped case never ran, so it neither raises nor lowers that signal.
        let mut all_correct = true;
        let mut loaded = true;
        let mut total_fuel: u64 = 0;
        for result in &case_results {
            if !result.correct {
                all_correct = false;
            }
            if result.correct && result.kind == PerformanceCaseKind::Stress {
                total_fuel = total_fuel.saturating_add(result.fuel.unwrap_or(0));
            }
            // A host failure (the engine could not be run) means it never truly
            // loaded for that case; a wrong-but-runnable answer still loaded, and a
            // skipped case was never offered to the engine at all.
            if !result.skipped && result.fuel.is_none() {
                loaded = false;
            }
        }

        let result = PerformanceResult {
            correct: all_correct,
            total_fuel: all_correct.then_some(total_fuel),
            fuel_limit: Some(fuel_limit),
            cases: case_results,
            // Publish the run's own engine so browser playback can load and step it
            // over each scenario — the same wasm that graded every case, drawing the
            // factory the submission actually computed. Non-fatal (like the scenario
            // write): a failure just leaves playback unavailable.
            module_wasm: write_module(repo, &module_wasm),
            detail: None,
        };
        Ok(ValidationSummary {
            // The engine ran on every case without a host error: the load signal is
            // positive even when an answer was wrong (it presented an engine; whether
            // it is correct is the `performance.correct` gate, not the load).
            loaded,
            detail: None,
            install: None,
            build: None,
            checks: Vec::new(),
            proofs: proof_results,
            debug_scripts: Vec::new(),
            asset: None,
            voxel: None,
            ui: None,
            material: None,
            particle: None,
            audio: None,
            adversarial: None,
            performance: Some(result),
        })
    }
}

/// Score one held-out case: read its scenario and expected answer, run the engine
/// once through the shared host, and compare. A read/parse error on a committed
/// case file is a case-authoring failure recorded as that case's detail; a host
/// failure (the engine could not be run) leaves `fuel = None`; a wrong-but-runnable
/// answer records the fuel and the first mismatch.
fn score_case(
    repo: &std::path::Path,
    test_case: &TestCaseVersion,
    module_wasm: &[u8],
    // `fuel_limit` here is the **pass/fail line**; the case's `fuel_ceiling` is the
    // (possibly wider) run ceiling the engine actually gets. `max_memory_bytes` is
    // the memory cap for the run.
    base_limits: SandboxLimits,
    entry: &str,
    case: &PerformanceCase,
    // The case's position in the manifest — the index playback addresses its
    // published scenario by.
    index: usize,
) -> PerformanceCaseResult {
    let pass_limit = base_limits.fuel_limit;
    // The case-relative input path is what a reviewer ties the result back to.
    let input_label = input_label(test_case, case);

    // The committed scenario and the reference oracle's `state` answer both live in
    // the version folder (the secret scored set). A read or parse failure here is a
    // case-authoring error, not the submission's fault.
    // Kept as bytes as well as parsed: a passing run republishes them into its own
    // tree so browser playback can reconstruct the factory (see `write_scenario`).
    let scenario_bytes = match std::fs::read(&case.input) {
        Ok(bytes) => bytes,
        Err(err) => {
            return case_authoring_error(
                input_label,
                case.kind,
                format!("could not read input scenario: {err}"),
            );
        }
    };
    let scenario = match lattice_core::Scenario::parse(&scenario_bytes) {
        Ok(scenario) => scenario,
        Err(err) => {
            return case_authoring_error(
                input_label,
                case.kind,
                format!("input scenario is invalid: {err}"),
            );
        }
    };
    let expected: Vec<Snapshot> = match std::fs::read(&case.expected) {
        Ok(bytes) => match serde_json::from_slice(&bytes) {
            Ok(expected) => expected,
            Err(err) => {
                return case_authoring_error(
                    input_label,
                    case.kind,
                    format!("expected answer is not a valid state array: {err}"),
                );
            }
        },
        Err(err) => {
            return case_authoring_error(
                input_label,
                case.kind,
                format!("could not read expected answer: {err}"),
            );
        }
    };

    // Run the engine once on this scenario through the shared host, at this case's
    // **run ceiling** (`fuel_ceiling` = the pass line widened by its runway). A
    // module that fails to load, exhausts even the runway, or otherwise fails
    // mid-run is a host-level failure for this case — no fuel to record, and no
    // produced state to play back.
    // The run ceiling is the case's resolved `fuel_ceiling` — the pass line widened
    // by its runway (`>= fuel_limit` by resolution). The engine may burn up to here;
    // the pass/fail comparison below is still against `pass_limit`.
    let run_ceiling = case.fuel_ceiling;
    let run_limits = SandboxLimits {
        fuel_limit: run_ceiling,
        max_memory_bytes: base_limits.max_memory_bytes,
    };
    let run = match run_submission(module_wasm, &scenario, run_limits, entry) {
        Ok(run) => run,
        Err(err) => {
            return PerformanceCaseResult {
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
            };
        }
    };

    // Compare per-snapshot checksums against the oracle's answer through the shared
    // scoring rule, so the validator and the `lattice run` CLI can never disagree on
    // what a *correct answer* is. Fuel is a separate axis, judged below.
    let score = score_against(&expected, &run);

    // Write the engine's produced state into the run tree so a reviewer can diff it
    // against the oracle. Non-fatal: this is debuggability material, not a scored
    // artifact (v1 has no replay renderer).
    write_state_debug(repo, case, &run.snapshots);

    // Republish the scored scenario for playback only when the *answer* was correct
    // — an over-ceiling run answered right, so it earns playback (that is the whole
    // point of the runway: see how a correct-but-slow engine behaves). A wrong run
    // does not, keeping the held-out input out of a tree that never solved it.
    let scenario_json = if score.correct {
        write_scenario(repo, index, &scenario_bytes)
    } else {
        None
    };

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

    PerformanceCaseResult {
        input: input_label,
        kind: case.kind,
        correct: passed,
        over_ceiling,
        skipped: false,
        fuel: Some(run.fuel_consumed),
        first_mismatch_tick: score.first_mismatch_tick,
        detail,
        // Recorded whether or not the run passed: for a passing run this is what
        // playback verifies itself against, and for a wrong or over-ceiling one it
        // shows exactly what the engine produced at each snapshot.
        snapshots: run
            .snapshots
            .iter()
            .map(|snapshot| PerformanceSnapshotCheck {
                tick: snapshot.tick,
                checksum: snapshot.checksum.clone(),
            })
            .collect(),
        scenario_json,
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

/// A [`PerformanceCaseResult`] for a stress case that was **not run** because a
/// smoke test failed first. It counts as a failure (the run is incorrect), but is
/// marked [`skipped`](PerformanceCaseResult::skipped) so it reads as "not run to
/// save time" rather than "the engine ran and got it wrong". `fuel = None`, but
/// unlike a host failure it does not lower the run's load signal — the engine was
/// never given the case.
fn skipped_case(input: String) -> PerformanceCaseResult {
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
fn input_label(test_case: &TestCaseVersion, case: &PerformanceCase) -> String {
    case.input
        .strip_prefix(&test_case.root)
        .unwrap_or(&case.input)
        .to_string_lossy()
        .replace('\\', "/")
}

/// A human-readable reason for a host-level failure on one case, distinguishing a
/// module that failed to *load*, one that burned through even its **runway** before
/// finishing (the case is beyond hope of a fuel reading), and any other mid-run
/// failure. `pass_limit`/`run_ceiling` frame the runway when it was exhausted.
fn run_failure_detail(err: &RunError, pass_limit: u64, run_ceiling: u64) -> String {
    match err {
        RunError::Load(inner) => format!("the engine failed to load: {inner}"),
        RunError::Invoke(InvokeError::OutOfFuel) if run_ceiling > pass_limit => format!(
            "the engine exhausted its runway ({run_ceiling} fuel, {}x the {pass_limit} ceiling) \
             before finishing — too slow to even measure",
            run_ceiling / pass_limit.max(1)
        ),
        RunError::Invoke(InvokeError::OutOfFuel) => {
            format!("the engine exhausted the {pass_limit} fuel ceiling before finishing")
        }
        other => format!("the engine failed during the run: {other}"),
    }
}

/// Write a case's produced `state` JSON into `performance/<input-stem>.state.json`
/// under the run root, so a reviewer can diff the engine's output against the
/// oracle. Best-effort: any failure is swallowed (it is debuggability material, not
/// a scored artifact).
fn write_state_debug(repo: &std::path::Path, case: &PerformanceCase, snapshots: &[Snapshot]) {
    let stem = case_stem(case);
    let dir = repo.join(STATE_DIR);
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    if let Ok(json) = serde_json::to_vec_pretty(snapshots) {
        let _ = std::fs::write(dir.join(format!("{stem}.state.json")), json);
    }
}

/// Copy a case's scored scenario to the run root as `scenario.json` (case 0) or
/// `scenario-<index>.json`, returning that name, so the published run carries what
/// browser playback needs to reconstruct the factory.
///
/// The name is deliberately **flat and index-addressed**, mirroring an adversarial
/// run's `replay.json` / `replay-1.json`: assets are served through a one-segment
/// `/runs/{id}/asset/{file}` route, so a name carrying a directory could not be
/// requested. The index is the case's position in the manifest, which is what
/// [`crate::playable::serve_asset_file`] resolves back.
///
/// The scored scenario is deliberately not seeded into the run's workspace — the
/// engine must never see it — so it does not otherwise exist in the produced tree;
/// this copies it in only once the engine has already been run and graded. Returns
/// `None` if the copy fails, which simply means this case has no playback.
/// Publish the run's engine module into the run tree so browser playback can fetch
/// and step it. One module per run (every case's playback drives the same wasm), so
/// it is written once at a fixed name. Non-fatal — a write failure just leaves
/// playback unavailable, exactly as a failed scenario write does.
fn write_module(repo: &std::path::Path, module: &[u8]) -> Option<String> {
    let name = "engine.wasm";
    std::fs::create_dir_all(repo).ok()?;
    std::fs::write(repo.join(name), module).ok()?;
    Some(name.to_string())
}

fn write_scenario(repo: &std::path::Path, index: usize, scenario: &[u8]) -> Option<String> {
    let name = if index == 0 {
        "scenario.json".to_string()
    } else {
        format!("scenario-{index}.json")
    };
    std::fs::create_dir_all(repo).ok()?;
    std::fs::write(repo.join(&name), scenario).ok()?;
    Some(name)
}

/// The `<input-stem>` a case's produced files are named after.
fn case_stem(case: &PerformanceCase) -> String {
    case.input
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "case".to_string())
}

/// A [`ValidationSummary`] for a performance run that could not be scored at all (a
/// case-authoring or infrastructure failure, not the submission's engine). The load
/// signal is negative and there is no recorded result.
fn failed(detail: &str, proofs: Vec<ProofResult>) -> ValidationSummary {
    ValidationSummary {
        loaded: false,
        detail: Some(detail.to_string()),
        install: None,
        build: None,
        checks: Vec::new(),
        proofs,
        debug_scripts: Vec::new(),
        asset: None,
        voxel: None,
        ui: None,
        material: None,
        particle: None,
        audio: None,
        adversarial: None,
        performance: None,
    }
}

/// A [`ValidationSummary`] for a submission that produced no loadable engine — it
/// did not build, or emitted no module. There is nothing to score per case, but the
/// run is recorded: incorrect, with the reason in the [`PerformanceResult`]. The
/// load signal is negative because nothing runnable was produced.
fn incorrect(
    proofs: Vec<ProofResult>,
    cases: Vec<PerformanceCaseResult>,
    detail: String,
) -> ValidationSummary {
    ValidationSummary {
        loaded: false,
        detail: Some(detail.clone()),
        install: None,
        build: None,
        checks: Vec::new(),
        proofs,
        debug_scripts: Vec::new(),
        asset: None,
        voxel: None,
        ui: None,
        material: None,
        particle: None,
        audio: None,
        adversarial: None,
        performance: Some(PerformanceResult {
            correct: false,
            total_fuel: None,
            fuel_limit: None,
            cases,
            // A run that failed before scoring has no engine to publish for
            // playback (the module was missing, unloadable, or the manifest was
            // incomplete) — so there is nothing to step, and playback is simply
            // unavailable rather than falling back to the reference engine.
            module_wasm: None,
            detail: Some(detail),
        }),
    }
}

#[cfg(test)]
#[path = "performance_validator.test.rs"]
mod tests;
