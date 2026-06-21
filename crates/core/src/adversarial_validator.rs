//! Validator for adversarial runs.
//!
//! An adversarial run's authoritative output is the wasm controller the model's
//! `[build]` produced in-container. This validator does **not** build anything
//! itself — by the time it runs, the build commands have already executed in the
//! run container and the produced module sits at the case's `build.module` path
//! under the run root. The validator (lead decision 4):
//!
//! 1. reads the submission module (Red) from `build.module`,
//! 2. reads the case's committed canonical baseline opponent module (Blue),
//! 3. runs **one** canonical match through the shared [`foray_host`] host — the
//!    very same host the [`foray` CLI](../../../crates/foray-cli) uses, so there
//!    is exactly one host implementation,
//! 4. writes the published, browser-playable `replay.json` into the run tree so
//!    it is collected and served as an ordinary run asset, and
//! 5. records the [`AdversarialResult`] (winner, per-team score, `ended`, ticks,
//!    and the outcome from the submission's perspective).
//!
//! A submission that fails to *load* — it did not build, does not export the
//! contract entry, or cannot instantiate — is recorded as a **forfeit loss**, not
//! a crash. A submission that loads but breaks the rules *during* the match
//! (traps, exhausts fuel/memory, returns an invalid action) forfeits through the
//! host, which still produces a replay. Either way the run yields a recorded
//! result and a playable replay.

use foray_core::board::Team;
use foray_core::config::{BoardParamsSerde, Rules, Simulation};
use foray_core::replay::ReplayResult;
use foray_core::state::Ended;
use foray_host::{MatchSetup, RunError, SandboxLimits, board_for, run_match};

use crate::error::Result;
use crate::execution::ArtifactCollection;
use crate::reference::RenderedReference;
use crate::test_case::{ProofFile, TestCaseVersion};
use crate::validation::{
    AdversarialOutcome, AdversarialResult, AdversarialTeam, ValidationSummary, Validator,
};
use crate::validator::proof_results;

/// The run-root-relative path the published replay is written to inside the
/// produced tree, then collected and served as an ordinary run asset.
const REPLAY_JSON: &str = "replay.json";

/// The version-folder-relative path the case commits its canonical baseline
/// opponent (Blue) wasm module at. The case ships this module so the validator
/// always has a fixed opponent to score the submission against (lead decision 4).
const BASELINE_MODULE: &str = "references/border-soldier.wasm";

/// The id recorded for the baseline opponent in the replay and the result, so a
/// site reader and a consumer of the run record both name the same fixed
/// opponent.
const BASELINE_OPPONENT_ID: &str = "border-soldier";

/// The model/controller id recorded as Red (the submission) in the replay.
const SUBMISSION_ID: &str = "submission";

/// A validator for adversarial runs. It keeps no state: every output is derived
/// from the run's own produced module and the case's committed opponent.
#[derive(Debug, Clone, Default)]
pub struct AdversarialValidator;

impl AdversarialValidator {
    /// A new adversarial validator.
    pub fn new() -> Self {
        Self
    }
}

impl Validator for AdversarialValidator {
    fn validate(
        &self,
        test_case: &TestCaseVersion,
        artifacts: &ArtifactCollection,
        _references: &[RenderedReference],
        proofs: &[ProofFile],
    ) -> Result<ValidationSummary> {
        let repo = &artifacts.repo_path;
        // A case may still declare proofs; record their presence as for any type.
        let proof_results = proof_results(proofs, repo);

        // The orchestrator only routes adversarial cases here, so the tables are
        // present; guard the invariants rather than panicking. The `[build]`
        // table carries the produced module path; `[contract]`, `[sandbox]`, and
        // `[simulation]` configure the match.
        let (Some(build), Some(contract), Some(sandbox), Some(simulation)) = (
            test_case.build.as_ref(),
            test_case.contract.as_ref(),
            test_case.sandbox.as_ref(),
            test_case.simulation.as_ref(),
        ) else {
            return Ok(failed(
                "adversarial validation requires [build], [contract], [sandbox], and [simulation]",
                proof_results,
            ));
        };
        let Some(module_rel) = build.module.as_ref() else {
            return Ok(failed(
                "adversarial validation requires build.module",
                proof_results,
            ));
        };

        // The submission is the wasm controller the in-container build produced.
        // A missing module means the build never emitted one (it did not compile,
        // or emitted to a different path) — a forfeit, not a crash.
        let submission_path = repo.join(module_rel);
        let red_wasm = match std::fs::read(&submission_path) {
            Ok(bytes) => bytes,
            Err(err) => {
                return Ok(forfeit_loss(
                    proof_results,
                    format!(
                        "the build produced no controller module at `{}`: {err}",
                        module_rel.display()
                    ),
                ));
            }
        };

        // The baseline opponent (Blue) is committed with the case. A missing
        // baseline is a case-authoring error, not the submission's fault, so it is
        // a failed load rather than a forfeit charged to the model.
        let baseline_path = test_case.root.join(BASELINE_MODULE);
        let blue_wasm = match std::fs::read(&baseline_path) {
            Ok(bytes) => bytes,
            Err(err) => {
                return Ok(failed(
                    &format!("the case ships no baseline opponent at `{BASELINE_MODULE}`: {err}"),
                    proof_results,
                ));
            }
        };

        // Build the canonical match setup from the case's tables. The board is
        // generated deterministically from the recorded seed and params so the
        // replay reconstructs the identical maze on playback.
        let setup = MatchSetup {
            entry: contract.entry.clone(),
            limits: SandboxLimits {
                fuel_per_tick: sandbox.fuel_per_tick,
                // The manifest caps memory in bytes; the host takes a `usize`.
                max_memory_bytes: sandbox.max_memory_bytes as usize,
            },
            map_id: MAP_ID.to_string(),
            seed: CANONICAL_SEED,
            board_params: BoardParamsSerde::default(),
            red_id: SUBMISSION_ID.to_string(),
            blue_id: BASELINE_OPPONENT_ID.to_string(),
            rules: Rules::default(),
            sim: Simulation {
                timestep_ms: simulation.timestep_ms,
                max_ticks: simulation.max_ticks,
            },
        };
        let board = board_for(&setup);

        // Run the single canonical match. A controller that fails to *load* (does
        // not compile to a valid module or is missing the contract export) is a
        // `RunError` — the match never starts; that is the submission forfeiting
        // by failing to present a controller. A controller that loads but breaks a
        // rule mid-match forfeits through the host, which still returns a replay.
        let replay = match run_match(&red_wasm, &blue_wasm, board, &setup) {
            Ok(summary) => summary.replay,
            Err(RunError::LoadRed(err)) => {
                return Ok(forfeit_loss(
                    proof_results,
                    format!("the submission controller failed to load: {err}"),
                ));
            }
            Err(RunError::LoadBlue(err)) => {
                return Ok(failed(
                    &format!("the baseline opponent failed to load: {err}"),
                    proof_results,
                ));
            }
            Err(RunError::Engine(err)) => {
                return Ok(failed(
                    &format!("the wasm engine could not be built: {err}"),
                    proof_results,
                ));
            }
        };

        // Write the published replay into the produced tree so it is collected and
        // served as a run asset. A write failure leaves the run unscorable.
        let replay_path = repo.join(REPLAY_JSON);
        if let Err(err) = std::fs::write(&replay_path, replay.to_json()) {
            return Ok(failed(
                &format!("could not write the replay: {err}"),
                proof_results,
            ));
        }

        let result = summarize(&replay.result);
        Ok(ValidationSummary {
            // The match produced a recorded result and a playable replay: the load
            // signal is positive even when the submission forfeited (it presented a
            // controller; how it played is the `outcome`, not the load).
            loaded: true,
            detail: None,
            install: None,
            build: None,
            checks: Vec::new(),
            proofs: proof_results,
            asset: None,
            adversarial: Some(result),
        })
    }
}

/// The shipped map's id, recorded in the replay so playback regenerates the maze.
const MAP_ID: &str = "mirror-32x16";

/// The seed the canonical match's maze is generated from. Fixed so every run of a
/// case plays on the same board and runs are comparable.
const CANONICAL_SEED: u64 = 0xC0FFEE;

/// Build the recorded [`AdversarialResult`] from a decided match's result, from
/// the **submission's** (Red's) perspective.
fn summarize(result: &ReplayResult) -> AdversarialResult {
    let winner = result.winner.map(team_to);
    let ended = ended_to(result.ended);
    let outcome = match result.ended {
        Ended::Forfeit => match result.winner {
            // The submission won by the opponent forfeiting.
            Some(Team::Red) => AdversarialOutcome::Win,
            // The submission forfeited — the recorded loss it owns.
            _ => AdversarialOutcome::Forfeit,
        },
        _ => match result.winner {
            Some(Team::Red) => AdversarialOutcome::Win,
            Some(Team::Blue) => AdversarialOutcome::Loss,
            None => AdversarialOutcome::Draw,
        },
    };
    AdversarialResult {
        replay_json: REPLAY_JSON.to_string(),
        opponent: BASELINE_OPPONENT_ID.to_string(),
        submission_team: AdversarialTeam::Red,
        winner,
        red_score: result.score.red,
        blue_score: result.score.blue,
        ended,
        ticks: result.ticks,
        outcome,
        detail: None,
    }
}

/// Map a foray-core [`Team`] to the validation-side [`AdversarialTeam`].
fn team_to(team: Team) -> AdversarialTeam {
    match team {
        Team::Red => AdversarialTeam::Red,
        Team::Blue => AdversarialTeam::Blue,
    }
}

/// Map a foray-core [`Ended`] to the replay's wire spelling, matching the JSON the
/// replay records (`swept`, `time_limit`, `forfeit`).
///
/// Serialized through serde so the recorded result's `ended` is, by construction,
/// the *same* string the published `replay.json` carries — a hand-maintained match
/// arm here had drifted to a different spelling (`timeLimit`) than the snake_case
/// serde emits for [`Ended`], so the two artifacts disagreed for time-limit
/// matches. Deriving from serde removes the drift.
fn ended_to(ended: Ended) -> String {
    serde_json::to_value(ended)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        // `Ended` is a plain unit-variant enum: it always serializes to a string,
        // so this fallback is unreachable, but keep the spelling correct if not.
        .unwrap_or_else(|| {
            match ended {
                Ended::Swept => "swept",
                Ended::TimeLimit => "time_limit",
                Ended::Forfeit => "forfeit",
            }
            .to_string()
        })
}

/// A [`ValidationSummary`] for an adversarial run that could not be scored at all
/// (a case-authoring or infrastructure failure, not the submission's play). The
/// load signal is negative and there is no recorded match.
fn failed(detail: &str, proofs: Vec<crate::validation::ProofResult>) -> ValidationSummary {
    ValidationSummary {
        loaded: false,
        detail: Some(detail.to_string()),
        install: None,
        build: None,
        checks: Vec::new(),
        proofs,
        asset: None,
        adversarial: None,
    }
}

/// A [`ValidationSummary`] for a submission that forfeited *before* a match could
/// run — it did not present a loadable controller. There is no replay to play
/// back (no match occurred), but the run is scored: a forfeit loss to the
/// baseline, with the reason in [`AdversarialResult::detail`]. The load signal is
/// negative because nothing playable was produced.
fn forfeit_loss(proofs: Vec<crate::validation::ProofResult>, detail: String) -> ValidationSummary {
    ValidationSummary {
        loaded: false,
        detail: Some(detail.clone()),
        install: None,
        build: None,
        checks: Vec::new(),
        proofs,
        asset: None,
        adversarial: Some(AdversarialResult {
            replay_json: String::new(),
            opponent: BASELINE_OPPONENT_ID.to_string(),
            submission_team: AdversarialTeam::Red,
            // The opponent wins by forfeit.
            winner: Some(AdversarialTeam::Blue),
            red_score: 0,
            blue_score: 0,
            ended: "forfeit".to_string(),
            ticks: 0,
            outcome: AdversarialOutcome::Forfeit,
            detail: Some(detail),
        }),
    }
}

#[cfg(test)]
#[path = "adversarial_validator.test.rs"]
mod tests;
