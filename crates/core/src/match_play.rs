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
//! The persistence-owning caller — the arena service — owns the disk writes,
//! progress reporting, and backend publish; this module only plays matches and
//! tallies results.

use std::collections::BTreeMap;
use std::path::Path;

use crate::error::{Error, Result};
use crate::test_case::TestCaseVersion;
use crate::validation::AdversarialOutcome;
use foray_core::board::Team;
use foray_core::config::{BoardParamsSerde, Rules, Simulation};
use foray_core::replay::Replay;
use foray_core::state::Ended;
use foray_host::{
    Decided, DecidedBy, ForfeitInfo, FuelStats, MatchSetup, RunError, SandboxLimits, board_for,
    run_match,
};

// The shapes a match and a tournament are recorded in, the opponent lists and the
// names a match and its replay are stored under are read by the arena, the backend
// and the console as well as played here, so they live in
// `test_cabinet_contracts::match_play` and are re-exported at their old paths.
pub use test_cabinet_contracts::match_play::*;

/// The shipped map id, recorded in every replay so playback regenerates the maze.
pub const MAP_ID: &str = "mirror-32x16";

/// The fixed seed every canonical match's maze is generated from, so all matches
/// in a case play on the same board and are directly comparable.
pub const CANONICAL_SEED: u64 = 0xC0FFEE;

/// A [`ControllerRef`] with its wasm module bytes resolved by the caller.
#[derive(Debug, Clone)]
pub struct ResolvedController {
    /// The controller's identity (id, kind, label).
    pub controller: ControllerRef,
    /// The compiled controller module. Empty or invalid bytes load-fail, which is
    /// a clean forfeit, never a panic.
    pub wasm: Vec<u8>,
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
        // Name the sections that are actually absent rather than the three an adversarial
        // match needs: which ones are missing is the whole of what this failure knows.
        let missing: Vec<&str> = [
            ("[contract]", test_case.contract.is_none()),
            ("[sandbox]", test_case.sandbox.is_none()),
            ("[simulation]", test_case.simulation.is_none()),
        ]
        .into_iter()
        .filter_map(|(section, absent)| absent.then_some(section))
        .collect();
        return Err(Error::Validation(format!(
            "test case `{}@{}` declares no {} for its adversarial match",
            test_case.slug,
            test_case.version,
            missing.join(", ")
        )));
    };
    // An adversarial case's resolved `[sandbox]` always carries `fuel_per_tick`
    // (resolution requires it for this type and forbids the performance
    // `fuel_limit`); guard the invariant rather than unwrapping blind.
    let fuel_per_tick = sandbox.fuel_per_tick.ok_or_else(|| {
        Error::Validation(format!(
            "test case `{}@{}` declares no sandbox.fuel_per_tick for its adversarial match",
            test_case.slug, test_case.version
        ))
    })?;
    Ok(MatchSetup {
        entry: contract.entry.clone(),
        limits: SandboxLimits {
            fuel_per_tick,
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
            // The efficiency tie-break and the recorded fuel totals come from the
            // host summary (the replay alone has neither), so resolve them before we
            // unwrap the replay out of it.
            let decided = summary.decided();
            let fuel = summary.fuel;
            let replay = summary.replay;
            let mut summary =
                summarize_match(&match_id, red_id, blue_id, &replay, decided, &fuel, None);
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
/// always Red) so the field is reproducible. The standings rank by **number of
/// wins**, highest first — and because a level-score match is broken by the
/// efficiency tie-break, a leaner controller banks a win where it would once have
/// drawn.
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
    let mut wins: BTreeMap<String, u32> = BTreeMap::new();
    let mut losses: BTreeMap<String, u32> = BTreeMap::new();
    let mut draws: BTreeMap<String, u32> = BTreeMap::new();
    for participant in &participants {
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
            let mut summary = outcome.summary;

            // `summary.winner` already carries the efficiency tie-break, so the
            // win/loss/draw tally counts a level-score match for the leaner side.
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

            // A quick match hands its replay straight back, so `run_quick_match`
            // leaves the key unset; a tournament persists each replay under the
            // match id, so record that segment here. A load forfeit produces no
            // replay and keeps the key `None`.
            if let Some(replay) = outcome.replay {
                summary.replay_key = Some(summary.match_id.clone());
                replays.push((summary.match_id.clone(), replay));
            }
            played += 1;
            on_match(played, pair_count, &summary);
            matches.push(summary);
        }
    }

    // Rank by wins desc, then fewest losses, then id asc for a stable order.
    let mut standings: Vec<Standing> = participants
        .iter()
        .map(|participant| {
            let id = &participant.controller.id;
            Standing {
                participant_id: id.clone(),
                wins: wins[id],
                losses: losses[id],
                draws: draws[id],
                rank: 0,
            }
        })
        .collect();
    standings.sort_by(|a, b| {
        b.wins
            .cmp(&a.wins)
            .then_with(|| a.losses.cmp(&b.losses))
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

/// Summarize a decided match from Red's perspective. `decided` carries the
/// efficiency tie-break (computed by the host, which alone meters fuel) and `fuel`
/// the per-controller totals that decided it; the replay supplies the rules facts
/// (scores, kills, tick count, and how it ended).
pub fn summarize_match(
    match_id: &str,
    red_id: &str,
    blue_id: &str,
    replay: &Replay,
    decided: Decided,
    fuel: &FuelStats,
    replay_key: Option<String>,
) -> MatchSummary {
    let result = &replay.result;
    let winner = decided.winner.map(|team| match team {
        Team::Red => red_id.to_string(),
        Team::Blue => blue_id.to_string(),
    });
    MatchSummary {
        match_id: match_id.to_string(),
        red_id: red_id.to_string(),
        blue_id: blue_id.to_string(),
        winner,
        win_type: win_type_for(decided),
        outcome_for_red: outcome_from(decided, Team::Red),
        red_score: result.score.red,
        blue_score: result.score.blue,
        ticks: result.ticks,
        red_kills: result.kills.red,
        blue_kills: result.kills.blue,
        red_fuel: fuel.red_total,
        blue_fuel: fuel.blue_total,
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
        // No match ran, so neither controller burned any fuel.
        red_fuel: 0,
        blue_fuel: 0,
        replay_key: None,
        detail: Some(detail),
    }
}

/// The outcome of a decided match from `team`'s perspective, after the efficiency
/// tie-break. A forfeit win (the opponent forfeited) is a
/// [`Win`](AdversarialOutcome::Win); losing by one's own forfeit is a
/// [`Forfeit`](AdversarialOutcome::Forfeit), distinct from a normal
/// [`Loss`](AdversarialOutcome::Loss). A level-score match resolved by fuel is a
/// plain win or loss; only a genuine draw (level score *and* level fuel, or a
/// double forfeit) returns [`Draw`](AdversarialOutcome::Draw)/`Forfeit`.
pub(crate) fn outcome_from(decided: Decided, team: Team) -> AdversarialOutcome {
    match (decided.winner, decided.by) {
        (Some(winner), DecidedBy::Forfeit) if winner == team => AdversarialOutcome::Win,
        // A decided forfeit against this team is this team forfeiting.
        (Some(_), DecidedBy::Forfeit) => AdversarialOutcome::Forfeit,
        (Some(winner), _) if winner == team => AdversarialOutcome::Win,
        (Some(_), _) => AdversarialOutcome::Loss,
        // No winner on a forfeit means both forfeited.
        (None, DecidedBy::Forfeit) => AdversarialOutcome::Forfeit,
        (None, _) => AdversarialOutcome::Draw,
    }
}

/// The wire spelling of how a match was decided: the rules ending (`swept`,
/// `time_limit`, `forfeit`), or `efficiency` when a level score was broken by the
/// fuel tie-break.
pub(crate) fn win_type_for(decided: Decided) -> String {
    match decided.by {
        DecidedBy::Efficiency => "efficiency".to_string(),
        // The rules endings keep their wire spelling single-sourced in `ended_to`.
        DecidedBy::Sweep => ended_to(Ended::Swept),
        DecidedBy::Score => ended_to(Ended::TimeLimit),
        DecidedBy::Forfeit => ended_to(Ended::Forfeit),
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
