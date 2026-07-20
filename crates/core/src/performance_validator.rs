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
use lattice_host::{RunError, SandboxLimits, run_submission, score_against};

use crate::error::Result;
use crate::execution::ArtifactCollection;
use crate::reference::RenderedReference;
use crate::test_case::{PerformanceCase, ProofFile, TestCaseVersion, Variant};
use crate::validation::{
    PerformanceCaseResult, PerformanceResult, PerformanceSnapshotCheck, ProofResult,
    ValidationSummary, Validator,
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

        let limits = SandboxLimits {
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

        // Score every held-out case. A run is correct only when every case is; the
        // total fuel a correct engine consumes is the comparable result. `loaded`
        // tracks whether the engine ran on every case without a *host* failure —
        // correctness is carried separately, mirroring the adversarial type's
        // "presented a controller" load signal.
        let mut case_results = Vec::with_capacity(test_case.cases.len());
        let mut all_correct = true;
        let mut loaded = true;
        let mut total_fuel: u64 = 0;
        for (index, case) in test_case.cases.iter().enumerate() {
            let result = score_case(
                repo,
                test_case,
                &module_wasm,
                limits,
                &contract.entry,
                case,
                index,
            );
            if result.correct {
                total_fuel = total_fuel.saturating_add(result.fuel.unwrap_or(0));
            } else {
                all_correct = false;
            }
            // A host failure (the engine could not be run at all) means it never
            // truly loaded for that case; a wrong-but-runnable answer still loaded.
            if result.fuel.is_none() {
                loaded = false;
            }
            case_results.push(result);
        }

        let result = PerformanceResult {
            correct: all_correct,
            total_fuel: all_correct.then_some(total_fuel),
            cases: case_results,
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
    limits: SandboxLimits,
    entry: &str,
    case: &PerformanceCase,
    // The case's position in the manifest — the index playback addresses its
    // published scenario by.
    index: usize,
) -> PerformanceCaseResult {
    // The case-relative input path is what a reviewer ties the result back to.
    let input_label = case
        .input
        .strip_prefix(&test_case.root)
        .unwrap_or(&case.input)
        .to_string_lossy()
        .replace('\\', "/");

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
                format!("could not read input scenario: {err}"),
            );
        }
    };
    let scenario = match lattice_core::Scenario::parse(&scenario_bytes) {
        Ok(scenario) => scenario,
        Err(err) => {
            return case_authoring_error(input_label, format!("input scenario is invalid: {err}"));
        }
    };
    let expected: Vec<Snapshot> = match std::fs::read(&case.expected) {
        Ok(bytes) => match serde_json::from_slice(&bytes) {
            Ok(expected) => expected,
            Err(err) => {
                return case_authoring_error(
                    input_label,
                    format!("expected answer is not a valid state array: {err}"),
                );
            }
        },
        Err(err) => {
            return case_authoring_error(
                input_label,
                format!("could not read expected answer: {err}"),
            );
        }
    };

    // Run the engine once on this scenario through the shared host. A module that
    // fails to load or fails mid-run is a host-level failure for this case — there
    // is no fuel to record and the case is incorrect.
    let run = match run_submission(module_wasm, &scenario, limits, entry) {
        Ok(run) => run,
        Err(err) => {
            return PerformanceCaseResult {
                input: input_label,
                correct: false,
                fuel: None,
                first_mismatch_tick: None,
                detail: Some(host_failure_detail(&err)),
                // The engine never ran, so there is no produced state to record
                // and nothing to play back.
                snapshots: Vec::new(),
                scenario_json: None,
            };
        }
    };

    // Compare per-snapshot checksums against the oracle's answer through the shared
    // scoring rule, so the validator and the `lattice run` CLI can never disagree on
    // what "correct" means. The fuel is recorded either way (it is meaningless when
    // incorrect, but kept for diagnostics).
    let score = score_against(&expected, &run);

    // Write the engine's produced state into the run tree so a reviewer can diff it
    // against the oracle. Non-fatal: this is debuggability material, not a scored
    // artifact (v1 has no replay renderer).
    write_state_debug(repo, case, &run.snapshots);

    // Publish the scenario only for a case the engine actually got right. Playback
    // is offered for passing runs alone, so republishing the scored scenario into a
    // failing run's tree would carry the held-out input further than anything reads
    // it. `first_mismatch_tick` is what a failing case is diagnosed from.
    let scenario_json = if score.correct {
        write_scenario(repo, index, &scenario_bytes)
    } else {
        None
    };

    PerformanceCaseResult {
        input: input_label,
        correct: score.correct,
        fuel: Some(score.fuel),
        first_mismatch_tick: score.first_mismatch_tick,
        detail: score.detail,
        // Recorded whether or not the run was correct: for a correct run this is
        // what playback verifies itself against, and for an incorrect one it shows
        // exactly what the engine produced at each snapshot.
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
fn case_authoring_error(input: String, detail: String) -> PerformanceCaseResult {
    PerformanceCaseResult {
        input,
        correct: false,
        fuel: None,
        first_mismatch_tick: None,
        detail: Some(detail),
        // The case files could not be read, so the engine never ran.
        snapshots: Vec::new(),
        scenario_json: None,
    }
}

/// A human-readable reason for a host-level failure on one case, distinguishing a
/// module that failed to *load* from one that failed *during* its single run.
fn host_failure_detail(err: &RunError) -> String {
    match err {
        RunError::Load(inner) => format!("the engine failed to load: {inner}"),
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
            cases,
            detail: Some(detail),
        }),
    }
}

#[cfg(test)]
#[path = "performance_validator.test.rs"]
mod tests;
