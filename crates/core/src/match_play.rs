//! Shared adversarial match play: the canonical match setup, a one-off
//! head-to-head ("quick") match, and a round-robin tournament.
//!
//! The [`AdversarialValidator`](crate::adversarial_validator) scores a run by
//! playing its submission against the case's committed baseline. The interactive
//! **arena** modes reuse the very same machinery to let an operator pit *any* two
//! controllers (baselines or controllers built by prior runs) head-to-head, and to
//! run a whole field of controllers as a tournament. This module is the one place
//! the canonical match parameters (map, seed, sandbox, simulation) are assembled,
//! so the validator and the arena can never disagree on how a match is played.
//!
//! It is deliberately **out_dir-agnostic**: a caller resolves controller wasm bytes
//! however it likes (a baseline from the case's `references/`, a prior run's module
//! from the host's run output dir) and hands them in as [`ResolvedController`]s.
//! The two persistence-owning callers — the worker and the desktop shell — own the
//! disk writes, progress reporting, and backend publish; this module only plays
//! matches and tallies results.

use std::collections::BTreeMap;
use std::path::Path;

use foray_core::board::Team;
use foray_core::config::{BoardParamsSerde, Rules, Simulation};
use foray_core::replay::{Replay, ReplayResult};
use foray_core::state::Ended;
use foray_host::{ForfeitInfo, MatchSetup, RunError, SandboxLimits, board_for, run_match};
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::test_case::TestCaseVersion;
use crate::validation::AdversarialOutcome;

/// The shipped map id, recorded in every replay so playback regenerates the maze.
pub const MAP_ID: &str = "mirror-32x16";

/// The fixed seed every canonical match's maze is generated from, so all matches
/// in a case play on the same board and are directly comparable.
pub const CANONICAL_SEED: u64 = 0xC0FFEE;

/// The run-root-relative filename a match's replay is written to (the validator's
/// run asset, and the per-match artifact name a tournament stores).
pub const REPLAY_JSON: &str = "replay.json";

/// The ids of the baseline controllers a case commits under `references/<id>.wasm`,
/// always available as opponents in the arena. `border-soldier` is also the
/// canonical scoring opponent the validator uses.
pub const BASELINE_IDS: &[&str] = &["border-soldier", "greedy-raider", "random"];

/// Where a controller came from — surfaced so the arena UI can group baselines
/// apart from controllers built by prior runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ControllerKind {
    /// A baseline committed with the case (`references/<id>.wasm`).
    Baseline,
    /// A controller a prior run produced (resolved from the host's run output dir).
    Run,
}

/// A controller a match can be played with, identified but not yet loaded.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControllerRef {
    /// The stable id: a baseline name, or a prior run's id.
    pub id: String,
    /// Where it came from.
    pub kind: ControllerKind,
    /// An optional human-facing label (e.g. the model id of the run that built it).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

/// A [`ControllerRef`] with its wasm module bytes resolved by the caller.
#[derive(Debug, Clone)]
pub struct ResolvedController {
    /// The controller's identity (id, kind, label).
    pub controller: ControllerRef,
    /// The compiled controller module. Empty or invalid bytes load-fail, which is
    /// a clean forfeit, never a panic.
    pub wasm: Vec<u8>,
}

/// One match's result, summarized so a tournament list can show the outcome
/// without loading (and replaying) the match. Serializes `camelCase` to mirror the
/// `@test-cabinet/run-record` TypeScript contract.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchSummary {
    /// Stable id for this match within its tournament (also the replay's storage
    /// segment): `"{redId}__vs__{blueId}"`.
    pub match_id: String,
    /// The controller that played Red (the lower-sorted id in a tournament pair).
    pub red_id: String,
    /// The controller that played Blue.
    pub blue_id: String,
    /// The winning controller's id, or `None` for a draw.
    pub winner: Option<String>,
    /// How the match ended (`swept`, `time_limit`, or `forfeit`).
    pub win_type: String,
    /// The outcome from Red's perspective.
    pub outcome_for_red: AdversarialOutcome,
    /// Red's banked score (the points Red earned this match).
    pub red_score: u32,
    /// Blue's banked score (the points Blue earned this match).
    pub blue_score: u32,
    /// How many ticks the match ran for.
    pub ticks: u32,
    /// Enemy raiders Red tagged ("kills").
    pub red_kills: u32,
    /// Enemy raiders Blue tagged.
    pub blue_kills: u32,
    /// The storage segment the replay is kept under, or `None` when no match ran
    /// (a controller failed to load, so there is nothing to play back).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub replay_key: Option<String>,
    /// Why a controller lost on a technicality, or `None` for a clean result. This
    /// is set both when a controller failed to *load* (no match ran) and when one
    /// *forfeited mid-match* (fuel/memory/trap/contract-invalid action) — in the
    /// latter case the replay records only `Ended::Forfeit`, so this carries the
    /// reason a player would otherwise have no way to read.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// One row of a tournament's standings: a controller's total points and record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Standing {
    /// The controller this row ranks.
    pub participant_id: String,
    /// Total points — the sum of banked seeds the controller earned across all its
    /// matches. The standings are ranked by this, highest first.
    pub points: u32,
    /// Matches won.
    pub wins: u32,
    /// Matches lost.
    pub losses: u32,
    /// Matches drawn.
    pub draws: u32,
    /// 1-based rank (1 is best), assigned after sorting.
    pub rank: u32,
}

/// A persisted tournament: the field, the ranked standings, and every match's
/// summary. The per-match replays are stored alongside (keyed by
/// [`MatchSummary::replay_key`]); this record carries only the summaries so it
/// loads cheaply. Serializes `camelCase` to mirror the TypeScript contract.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TournamentRecord {
    /// Unique tournament id (caller-assigned).
    pub id: String,
    /// RFC 3339 timestamp the tournament was run at.
    pub created_at: String,
    /// The test case the field competed under.
    pub test_case_slug: String,
    /// The exact case version.
    pub test_case_version: String,
    /// The case variant the canonical match used.
    pub variant: String,
    /// The competing controllers (identity only, no bytes).
    pub participants: Vec<ControllerRef>,
    /// The standings, ranked highest points first.
    pub standings: Vec<Standing>,
    /// Every match's summary, in the order they were played.
    pub matches: Vec<MatchSummary>,
}

/// The outcome of a one-off ("quick") match: the summary plus the replay, when one
/// was produced. The replay is `None` only when a controller failed to load.
#[derive(Debug, Clone)]
pub struct MatchOutcome {
    /// The match summary (always produced, even on a load forfeit).
    pub summary: MatchSummary,
    /// The browser-playable replay, or `None` when no match ran.
    pub replay: Option<Replay>,
}

/// A tournament ready to persist: the record plus each match's replay, keyed by
/// the match id (the caller writes these out and serves them on demand).
#[derive(Debug, Clone)]
pub struct TournamentBuild {
    /// The standings/summaries record.
    pub record: TournamentRecord,
    /// `(match_id, replay)` for every match that produced a replay.
    pub replays: Vec<(String, Replay)>,
}

/// Build the canonical [`MatchSetup`] for `test_case` with the given participant
/// ids. This is the single source of the canonical map/seed/sandbox/simulation
/// parameters; the validator and both arena modes call it so a match is played the
/// same way everywhere.
pub fn canonical_match_setup(
    test_case: &TestCaseVersion,
    red_id: &str,
    blue_id: &str,
) -> Result<MatchSetup> {
    let (Some(contract), Some(sandbox), Some(simulation)) = (
        test_case.contract.as_ref(),
        test_case.sandbox.as_ref(),
        test_case.simulation.as_ref(),
    ) else {
        return Err(Error::Validation(
            "an adversarial match requires [contract], [sandbox], and [simulation]".to_string(),
        ));
    };
    Ok(MatchSetup {
        entry: contract.entry.clone(),
        limits: SandboxLimits {
            fuel_per_tick: sandbox.fuel_per_tick,
            max_memory_bytes: sandbox.max_memory_bytes as usize,
        },
        map_id: MAP_ID.to_string(),
        seed: CANONICAL_SEED,
        board_params: BoardParamsSerde::default(),
        red_id: red_id.to_string(),
        blue_id: blue_id.to_string(),
        rules: Rules::default(),
        sim: Simulation {
            timestep_ms: simulation.timestep_ms,
            max_ticks: simulation.max_ticks,
        },
    })
}

/// Read a baseline controller's committed wasm module
/// (`<case root>/references/<name>.wasm`).
pub fn resolve_baseline(test_case: &TestCaseVersion, name: &str) -> Result<Vec<u8>> {
    let path = test_case
        .root
        .join("references")
        .join(format!("{name}.wasm"));
    Ok(std::fs::read(path)?)
}

/// Resolve a prior run's controller module from a host's run output dir:
/// `<out_dir>/<run_id>/implementation/<build.module>`. The build module path is
/// taken from the case manifest (all participants share the same case).
pub fn resolve_run_controller(
    out_dir: &Path,
    run_id: &str,
    test_case: &TestCaseVersion,
) -> Result<Vec<u8>> {
    let module_rel = test_case
        .build
        .as_ref()
        .and_then(|build| build.module.as_ref())
        .ok_or_else(|| {
            Error::Validation("the case declares no build.module to resolve".to_string())
        })?;
    let path = out_dir.join(run_id).join("implementation").join(module_rel);
    Ok(std::fs::read(path)?)
}

/// Play a single head-to-head match between two resolved controllers and return
/// the replay plus its summary. A controller that fails to load forfeits the match
/// cleanly (no replay); a wasm-engine failure is an infrastructure error.
pub fn run_quick_match(
    test_case: &TestCaseVersion,
    red: &ResolvedController,
    blue: &ResolvedController,
) -> Result<MatchOutcome> {
    let red_id = &red.controller.id;
    let blue_id = &blue.controller.id;
    let match_id = match_id(red_id, blue_id);
    let setup = canonical_match_setup(test_case, red_id, blue_id)?;
    let board = board_for(&setup);

    match run_match(&red.wasm, &blue.wasm, board, &setup) {
        Ok(summary) => {
            // A mid-match forfeit (fuel/memory/trap/bad action) still produces a
            // replay, but the replay says only that a forfeit happened — capture the
            // *reason* into the summary detail so the board can show why.
            let detail = forfeit_detail(summary.forfeit.as_ref());
            let replay = summary.replay;
            let mut summary = summarize_match(&match_id, red_id, blue_id, &replay, None);
            summary.detail = detail;
            Ok(MatchOutcome {
                summary,
                replay: Some(replay),
            })
        }
        Err(RunError::Engine(err)) => Err(Error::Validation(format!(
            "the wasm engine could not be built: {err}"
        ))),
        Err(RunError::LoadRed(err)) => Ok(MatchOutcome {
            summary: forfeit_summary(&match_id, red_id, blue_id, Team::Red, err.to_string()),
            replay: None,
        }),
        Err(RunError::LoadBlue(err)) => Ok(MatchOutcome {
            summary: forfeit_summary(&match_id, red_id, blue_id, Team::Blue, err.to_string()),
            replay: None,
        }),
    }
}

/// Run a round-robin tournament: every unordered pair of `participants` plays
/// exactly once, with a deterministic seat assignment (the lower-sorted id is
/// always Red) so the field is reproducible. Each participant's points are the sum
/// of the seeds it banked across its matches; the standings rank by points,
/// highest first.
pub fn run_tournament(
    test_case: &TestCaseVersion,
    variant: &str,
    tournament_id: &str,
    created_at: &str,
    mut participants: Vec<ResolvedController>,
    mut on_match: impl FnMut(usize, usize, &MatchSummary),
) -> Result<TournamentBuild> {
    // Sort by id so the Red/Blue seat for any pair is stable across runs.
    participants.sort_by(|a, b| a.controller.id.cmp(&b.controller.id));

    let mut matches: Vec<MatchSummary> = Vec::new();
    let mut replays: Vec<(String, Replay)> = Vec::new();
    let mut points: BTreeMap<String, u32> = BTreeMap::new();
    let mut wins: BTreeMap<String, u32> = BTreeMap::new();
    let mut losses: BTreeMap<String, u32> = BTreeMap::new();
    let mut draws: BTreeMap<String, u32> = BTreeMap::new();
    for participant in &participants {
        points.entry(participant.controller.id.clone()).or_insert(0);
        wins.entry(participant.controller.id.clone()).or_insert(0);
        losses.entry(participant.controller.id.clone()).or_insert(0);
        draws.entry(participant.controller.id.clone()).or_insert(0);
    }

    let total = participants.len();
    let mut played = 0usize;
    let pair_count = total * total.saturating_sub(1) / 2;
    for i in 0..total {
        for j in (i + 1)..total {
            let red = &participants[i];
            let blue = &participants[j];
            let outcome = run_quick_match(test_case, red, blue)?;
            let summary = outcome.summary;

            *points.get_mut(&summary.red_id).unwrap() += summary.red_score;
            *points.get_mut(&summary.blue_id).unwrap() += summary.blue_score;
            match summary.winner.as_deref() {
                Some(w) if w == summary.red_id => {
                    *wins.get_mut(&summary.red_id).unwrap() += 1;
                    *losses.get_mut(&summary.blue_id).unwrap() += 1;
                }
                Some(_) => {
                    *wins.get_mut(&summary.blue_id).unwrap() += 1;
                    *losses.get_mut(&summary.red_id).unwrap() += 1;
                }
                None => {
                    *draws.get_mut(&summary.red_id).unwrap() += 1;
                    *draws.get_mut(&summary.blue_id).unwrap() += 1;
                }
            }

            if let Some(replay) = outcome.replay {
                replays.push((summary.match_id.clone(), replay));
            }
            played += 1;
            on_match(played, pair_count, &summary);
            matches.push(summary);
        }
    }

    // Rank by points desc, then wins desc, then id asc for a stable order.
    let mut standings: Vec<Standing> = participants
        .iter()
        .map(|participant| {
            let id = &participant.controller.id;
            Standing {
                participant_id: id.clone(),
                points: points[id],
                wins: wins[id],
                losses: losses[id],
                draws: draws[id],
                rank: 0,
            }
        })
        .collect();
    standings.sort_by(|a, b| {
        b.points
            .cmp(&a.points)
            .then_with(|| b.wins.cmp(&a.wins))
            .then_with(|| a.participant_id.cmp(&b.participant_id))
    });
    for (index, standing) in standings.iter_mut().enumerate() {
        standing.rank = index as u32 + 1;
    }

    let record = TournamentRecord {
        id: tournament_id.to_string(),
        created_at: created_at.to_string(),
        test_case_slug: test_case.slug.clone(),
        test_case_version: test_case.version.clone(),
        variant: variant.to_string(),
        participants: participants
            .into_iter()
            .map(|participant| participant.controller)
            .collect(),
        standings,
        matches,
    };
    Ok(TournamentBuild { record, replays })
}

/// The stable match id (and replay storage segment) for a pair.
pub fn match_id(red_id: &str, blue_id: &str) -> String {
    format!("{red_id}__vs__{blue_id}")
}

/// Render a mid-match forfeit into the human-readable `detail` the summary carries
/// (which team forfeited, on what tick, and why). `None` for a normally-decided
/// match, so the summary's `detail` stays empty unless a controller misbehaved.
fn forfeit_detail(forfeit: Option<&ForfeitInfo>) -> Option<String> {
    let forfeit = forfeit?;
    let mut parts = Vec::new();
    if let Some(reason) = &forfeit.red {
        parts.push(format!("red forfeited at tick {}: {reason}", forfeit.tick));
    }
    if let Some(reason) = &forfeit.blue {
        parts.push(format!("blue forfeited at tick {}: {reason}", forfeit.tick));
    }
    (!parts.is_empty()).then(|| parts.join("; "))
}

/// Summarize a decided match's replay from Red's perspective.
pub fn summarize_match(
    match_id: &str,
    red_id: &str,
    blue_id: &str,
    replay: &Replay,
    replay_key: Option<String>,
) -> MatchSummary {
    let result = &replay.result;
    let winner = result.winner.map(|team| match team {
        Team::Red => red_id.to_string(),
        Team::Blue => blue_id.to_string(),
    });
    MatchSummary {
        match_id: match_id.to_string(),
        red_id: red_id.to_string(),
        blue_id: blue_id.to_string(),
        winner,
        win_type: ended_to(result.ended),
        outcome_for_red: outcome_for(result, Team::Red),
        red_score: result.score.red,
        blue_score: result.score.blue,
        ticks: result.ticks,
        red_kills: result.kills.red,
        blue_kills: result.kills.blue,
        replay_key,
        detail: None,
    }
}

/// Build the summary for a match that never ran because a controller failed to
/// load: the loading side forfeits, the other wins by forfeit, and there is no
/// replay to play back.
fn forfeit_summary(
    match_id: &str,
    red_id: &str,
    blue_id: &str,
    loser: Team,
    detail: String,
) -> MatchSummary {
    let (winner, outcome_for_red) = match loser {
        Team::Red => (blue_id.to_string(), AdversarialOutcome::Forfeit),
        Team::Blue => (red_id.to_string(), AdversarialOutcome::Win),
    };
    MatchSummary {
        match_id: match_id.to_string(),
        red_id: red_id.to_string(),
        blue_id: blue_id.to_string(),
        winner: Some(winner),
        win_type: "forfeit".to_string(),
        outcome_for_red,
        red_score: 0,
        blue_score: 0,
        ticks: 0,
        red_kills: 0,
        blue_kills: 0,
        replay_key: None,
        detail: Some(detail),
    }
}

/// The outcome of a decided match from `team`'s perspective. A forfeit win (the
/// opponent forfeited) is a [`Win`](AdversarialOutcome::Win); losing by one's own
/// forfeit is a [`Forfeit`](AdversarialOutcome::Forfeit), distinct from a normal
/// [`Loss`](AdversarialOutcome::Loss).
pub(crate) fn outcome_for(result: &ReplayResult, team: Team) -> AdversarialOutcome {
    match (result.winner, result.ended) {
        (Some(winner), _) if winner == team => AdversarialOutcome::Win,
        // A forfeit with no winner means both forfeited.
        (None, Ended::Forfeit) => AdversarialOutcome::Forfeit,
        (None, _) => AdversarialOutcome::Draw,
        // A decided forfeit against this team is this team forfeiting.
        (Some(_), Ended::Forfeit) => AdversarialOutcome::Forfeit,
        (Some(_), _) => AdversarialOutcome::Loss,
    }
}

/// Map a foray-core [`Ended`] to the replay's wire spelling (`swept`,
/// `time_limit`, `forfeit`) through serde, so the recorded string is by
/// construction the same one the published replay carries.
pub(crate) fn ended_to(ended: Ended) -> String {
    serde_json::to_value(ended)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_else(|| {
            match ended {
                Ended::Swept => "swept",
                Ended::TimeLimit => "time_limit",
                Ended::Forfeit => "forfeit",
            }
            .to_string()
        })
}

#[cfg(test)]
#[path = "match_play.test.rs"]
mod tests;
