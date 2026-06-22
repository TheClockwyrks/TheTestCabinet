//! Validator for adversarial runs.
//!
//! An adversarial run's authoritative output is the wasm controller the model's
//! `[build]` produced in-container. This validator does **not** build anything
//! itself — by the time it runs, the build commands have already executed in the
//! run container and the produced module sits at the case's `build.module` path
//! under the run root. The validator:
//!
//! 1. reads the submission module (Red) from `build.module` once,
//! 2. plays it against each committed reference opponent (Blue) in
//!    [`AUTO_REPLAY_OPPONENTS`] — the three baselines plus the hidden `fuel-probe`
//!    — through the shared [`foray_host`] host (the very same host the
//!    [`foray` CLI`](../../../crates/foray-cli) uses, so there is exactly one host
//!    implementation),
//! 3. writes each published, browser-playable replay into the run tree (the
//!    canonical opponent's as `replay.json`, the rest as `replay-<i>.json`) so they
//!    are collected and served as ordinary run assets, and
//! 4. records the [`AdversarialResult`]: one [`AdversarialReplay`] per opponent,
//!    with the canonical opponent's match mirrored to the top-level scored fields.
//!
//! These replays are the run's evidence of play — they *replace*
//! proof-of-implementation for adversarial cases, since the match is programmatic
//! and reproducible from the recorded ticks.
//!
//! A submission that fails to *load* — it did not build, does not export the
//! contract entry, or cannot instantiate — is recorded as a **forfeit loss**, not
//! a crash. A submission that loads but breaks the rules *during* a match
//! (traps, exhausts fuel/memory, returns an invalid action) forfeits through the
//! host, which still produces a replay. Either way the run yields a recorded
//! result and playable replays.

use foray_core::board::Team;
use foray_core::replay::ReplayResult;
use foray_host::{RunError, board_for, run_match};

use crate::error::Result;
use crate::execution::ArtifactCollection;
use crate::match_play::{
    AUTO_REPLAY_OPPONENTS, canonical_match_setup, ended_to, outcome_for, replay_filename,
    resolve_baseline,
};
use crate::reference::RenderedReference;
use crate::test_case::{ProofFile, TestCaseVersion};
use crate::validation::{
    AdversarialOutcome, AdversarialReplay, AdversarialResult, AdversarialTeam, ValidationSummary,
    Validator,
};
use crate::validator::proof_results;

/// The canonical opponent id (`border-soldier`): the first of
/// [`AUTO_REPLAY_OPPONENTS`], whose match is mirrored to the result's top-level
/// scored fields and written to `replay.json`.
const CANONICAL_OPPONENT_ID: &str = AUTO_REPLAY_OPPONENTS[0].0;

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
        // `[simulation]` configure the match (validated by `canonical_match_setup`).
        let Some(build) = test_case.build.as_ref() else {
            return Ok(failed(
                "adversarial validation requires [build]",
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
        // The controller's run-root-relative path, forward-slashed so it is stable
        // across hosts (the push flow uploads the wasm at this path to the backend).
        let module_str = module_rel.to_string_lossy().replace('\\', "/");
        let submission_path = repo.join(module_rel);
        let red_wasm = match std::fs::read(&submission_path) {
            Ok(bytes) => bytes,
            Err(err) => {
                // The build emitted no controller at all: record an empty module
                // path (there is nothing to upload).
                return Ok(forfeit_loss(
                    proof_results,
                    String::new(),
                    format!(
                        "the build produced no controller module at `{}`: {err}",
                        module_rel.display()
                    ),
                ));
            }
        };

        // Play the submission against each committed reference opponent in turn,
        // writing one published replay per opponent and recording its outcome. The
        // submission loads identically against every opponent, so the first load
        // forfeit decides the whole run (a forfeit loss with no playable match).
        let mut replays: Vec<AdversarialReplay> = Vec::with_capacity(AUTO_REPLAY_OPPONENTS.len());
        for (index, (opponent_id, scored)) in AUTO_REPLAY_OPPONENTS.iter().enumerate() {
            // The opponent (Blue) is committed with the case under `references/`. A
            // missing opponent is a case-authoring error, not the submission's
            // fault, so it is a failed load rather than a forfeit charged to the
            // model.
            let blue_wasm = match resolve_baseline(test_case, opponent_id) {
                Ok(bytes) => bytes,
                Err(err) => {
                    return Ok(failed(
                        &format!(
                            "the case ships no opponent `{opponent_id}` under `references/`: {err}"
                        ),
                        proof_results,
                    ));
                }
            };

            // Build the canonical match setup — the single shared source of the
            // map/seed/sandbox/simulation params (also used by the arena modes). The
            // board is generated deterministically from the recorded seed and params
            // so the replay reconstructs the identical maze on playback. Missing
            // `[contract]`/`[sandbox]`/`[simulation]` is a case-authoring error.
            let setup = match canonical_match_setup(test_case, SUBMISSION_ID, opponent_id) {
                Ok(setup) => setup,
                Err(err) => return Ok(failed(&err.to_string(), proof_results)),
            };
            let board = board_for(&setup);

            // A controller that fails to *load* (does not compile to a valid module
            // or is missing the contract export) is a `RunError` — the match never
            // starts; that is the submission forfeiting by failing to present a
            // controller. A controller that loads but breaks a rule mid-match
            // forfeits through the host, which still returns a replay.
            let replay = match run_match(&red_wasm, &blue_wasm, board, &setup) {
                Ok(summary) => summary.replay,
                Err(RunError::LoadRed(err)) => {
                    // A controller was emitted (it just won't load): record its path
                    // so a reviewer could still inspect the artifact.
                    return Ok(forfeit_loss(
                        proof_results,
                        module_str,
                        format!("the submission controller failed to load: {err}"),
                    ));
                }
                Err(RunError::LoadBlue(err)) => {
                    return Ok(failed(
                        &format!("the opponent `{opponent_id}` failed to load: {err}"),
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

            // Write the published replay into the produced tree so it is collected
            // and served as a run asset. A write failure leaves the run unscorable.
            let rel = replay_filename(index);
            if let Err(err) = std::fs::write(repo.join(&rel), replay.to_json()) {
                return Ok(failed(
                    &format!("could not write the replay vs `{opponent_id}`: {err}"),
                    proof_results,
                ));
            }

            replays.push(replay_entry(opponent_id, &rel, *scored, &replay.result));
        }

        let result = summarize(replays, module_str);
        Ok(ValidationSummary {
            // The matches produced recorded results and playable replays: the load
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
            performance: None,
        })
    }
}

/// Build one [`AdversarialReplay`] from a decided match's result, from the
/// **submission's** (Red's) perspective. The `ended`/outcome derivation is the
/// shared [`match_play`](crate::match_play) logic, so a run's recorded result and
/// an arena match's summary describe the same match identically.
fn replay_entry(
    opponent: &str,
    replay_json: &str,
    scored: bool,
    result: &ReplayResult,
) -> AdversarialReplay {
    AdversarialReplay {
        opponent: opponent.to_string(),
        replay_json: replay_json.to_string(),
        winner: result.winner.map(team_to),
        red_score: result.score.red,
        blue_score: result.score.blue,
        ended: ended_to(result.ended),
        ticks: result.ticks,
        outcome: outcome_for(result, Team::Red),
        scored,
    }
}

/// Assemble the recorded [`AdversarialResult`] from every opponent's replay,
/// mirroring the **canonical** opponent's match (`replays[0]`, `border-soldier`)
/// to the top-level scored fields scoring and the leaderboard read. `replays` is
/// never empty here — the validator only calls this after at least the canonical
/// match ran. `controller_module` is the run-root-relative path to the produced
/// wasm, recorded so the push flow can upload it.
fn summarize(replays: Vec<AdversarialReplay>, controller_module: String) -> AdversarialResult {
    let canonical = &replays[0];
    AdversarialResult {
        replay_json: canonical.replay_json.clone(),
        opponent: canonical.opponent.clone(),
        submission_team: AdversarialTeam::Red,
        winner: canonical.winner,
        red_score: canonical.red_score,
        blue_score: canonical.blue_score,
        ended: canonical.ended.clone(),
        ticks: canonical.ticks,
        outcome: canonical.outcome,
        detail: None,
        controller_module,
        replays,
    }
}

/// Map a foray-core [`Team`] to the validation-side [`AdversarialTeam`].
fn team_to(team: Team) -> AdversarialTeam {
    match team {
        Team::Red => AdversarialTeam::Red,
        Team::Blue => AdversarialTeam::Blue,
    }
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
        performance: None,
    }
}

/// A [`ValidationSummary`] for a submission that forfeited *before* a match could
/// run — it did not present a loadable controller. There is no replay to play
/// back (no match occurred), but the run is scored: a forfeit loss to the
/// baseline, with the reason in [`AdversarialResult::detail`]. The load signal is
/// negative because nothing playable was produced.
fn forfeit_loss(
    proofs: Vec<crate::validation::ProofResult>,
    controller_module: String,
    detail: String,
) -> ValidationSummary {
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
            opponent: CANONICAL_OPPONENT_ID.to_string(),
            submission_team: AdversarialTeam::Red,
            // The opponent wins by forfeit.
            winner: Some(AdversarialTeam::Blue),
            red_score: 0,
            blue_score: 0,
            ended: "forfeit".to_string(),
            ticks: 0,
            outcome: AdversarialOutcome::Forfeit,
            detail: Some(detail),
            controller_module,
            // No match ran, so there are no playable replays to record.
            replays: Vec::new(),
        }),
        performance: None,
    }
}

#[cfg(test)]
#[path = "adversarial_validator.test.rs"]
mod tests;
