//! The native wasm host for the **Foray** adversarial test case (on-disk slug
//! `foray`).
//!
//! This crate loads two competing controller wasm modules, drives a single match
//! through [`foray-core`](foray_core)'s authoritative rules, meters each per-tick
//! controller invocation against a wasmtime fuel ceiling and a linear-memory cap,
//! and returns the published [`Replay`](foray_core::replay::Replay).
//!
//! ## Why this lives here, not in the CLI or in core
//!
//! The host is factored into its own crate so it has exactly one implementation
//! (lead decision 7):
//!
//! - The [`foray` CLI](../../../crates/foray-cli) is a thin clap wrapper that
//!   reads files, builds a [`Match`](foray_core::engine::Match), and calls
//!   [`run_match`].
//! - The core `AdversarialValidator` (a later phase) depends on this crate to
//!   score a submission, rather than re-implementing the host.
//!
//! `foray-core` must stay wasm-compilable for browser playback, so the wasmtime
//! dependency lives **here** and never in core. This crate marshals JSON across
//! the wasm boundary and hands actions to the engine; it owns **no** game rule.
//!
//! ## The match it runs
//!
//! [`run_match`] runs the single canonical match the validator scores (lead
//! decision 4): the submission as one team, the case's committed baseline
//! opponent as the other, on the case's map and seed. The per-tick loop, the
//! controller ABI, and the sandbox enforcement live in [`match_runner`] and
//! [`controller`].

mod controller;
mod match_runner;

pub use controller::{Controller, InvokeError, LoadError};
pub use match_runner::{ForfeitInfo, ForfeitReason};

use std::cmp::Ordering;

use foray_core::board::{Board, BoardParams, Team};
use foray_core::config::{BoardParamsSerde, Rules, Simulation};
use foray_core::engine::Match;
use foray_core::replay::Replay;
use foray_core::state::Ended;

/// The per-controller, per-tick sandbox limits from the manifest's `[sandbox]`
/// table. Applied to **every** invocation of **every** controller.
#[derive(Debug, Clone, Copy)]
pub struct SandboxLimits {
    /// The wasmtime fuel ceiling for a single tick. Refilled to this value before
    /// each invocation, so it bounds the work of one tick without banking unused
    /// fuel into later ticks.
    pub fuel_per_tick: u64,
    /// The linear-memory cap in bytes. A `memory.grow` that would exceed it is
    /// denied, forfeiting the invocation.
    pub max_memory_bytes: usize,
}

impl Default for SandboxLimits {
    /// The manifest's documented defaults (50,000,000 fuel; 64 MiB). The fuel
    /// ceiling sits well above a competent controller's measured per-tick peak
    /// (~10M for one running several BFS) so a real submission has headroom; see
    /// the case manifest's `[sandbox]` notes.
    fn default() -> SandboxLimits {
        SandboxLimits {
            fuel_per_tick: 50_000_000,
            max_memory_bytes: 64 * 1024 * 1024,
        }
    }
}

/// Everything a match needs that is fixed for its whole run: the controller
/// contract entry name, the sandbox limits, the rules/loop config, and the
/// identity recorded in the replay header (map id, seed, participant ids, board
/// params). The [`Match`] itself (board + live state) is passed separately so a
/// caller can build it however it likes (generate or load a map TOML).
#[derive(Debug, Clone)]
pub struct MatchSetup {
    /// The contract entry the controller exports (the manifest's `[contract] entry`,
    /// `tick` for Foray).
    pub entry: String,
    /// The per-tick sandbox limits.
    pub limits: SandboxLimits,
    /// The map id recorded in the replay (e.g. `"mirror-32x16"`).
    pub map_id: String,
    /// The seed the maze was generated from, recorded so a reconstructor
    /// regenerates the identical board.
    pub seed: u64,
    /// The board-generation parameters, recorded for the same reason.
    pub board_params: BoardParamsSerde,
    /// The model/controller id playing Red (site-facing provenance).
    pub red_id: String,
    /// The model/controller id playing Blue.
    pub blue_id: String,
    /// The rule constants the match runs under.
    pub rules: Rules,
    /// The simulation loop config (timestep, max_ticks).
    pub sim: Simulation,
}

/// The outcome of running a match: the published, browser-playable replay. The
/// committed result inside the replay carries the winner, score, `ended`, and tick
/// count — everything a caller needs to score the run.
#[derive(Debug, Clone)]
pub struct MatchSummary {
    /// The recorded replay, ready to write to `replay.json` and play back.
    pub replay: Replay,
    /// Why the match ended on a forfeit, when it did (which team, the tick, and the
    /// reason). `None` for a normally-decided match (sweep or time limit). The
    /// replay records only *that* a forfeit happened; this is the *reason* a caller
    /// surfaces — the CLI prints it and the arena threads it into its summary.
    pub forfeit: Option<ForfeitInfo>,
    /// Per-controller fuel accounting over the match: the per-tick peak (sandbox
    /// headroom) and the whole-match total (efficiency). Lets a caller report how
    /// much headroom a submission had, and is what [`decided`](Self::decided) uses
    /// to break a level-score draw in favour of the leaner controller.
    pub fuel: FuelStats,
}

/// How a match's winner was decided, once the efficiency tie-break is layered on
/// top of the rules result.
///
/// The rules engine ([`foray_core`]) only knows banked score and forfeits — it
/// compiles to wasm for browser replay and deliberately has no notion of fuel, so
/// it reports a level-score time-limit match as a draw. The *efficiency* tie-break
/// is a host concern (fuel is metered here, in [`FuelStats`]) and is resolved here,
/// never entering the replay's committed result. So a replay that reconstructs to a
/// "draw" can still have a [`Decided`] winner — the match verdict, not the rules
/// outcome.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecidedBy {
    /// One colony banked every one of the enemy's seeds.
    Sweep,
    /// A higher banked score at the time limit.
    Score,
    /// The banked score was level at the time limit, so the win went to the
    /// controller that consumed less total fuel.
    Efficiency,
    /// A controller forfeited (the other wins) — or both did (a draw).
    Forfeit,
}

/// A match's winner with the efficiency tie-break applied — see [`DecidedBy`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Decided {
    /// The winning team, or `None` for a true draw: a level score *and* level fuel,
    /// or a double forfeit.
    pub winner: Option<Team>,
    /// How that winner was decided.
    pub by: DecidedBy,
}

/// The fuel each controller consumed over a match, paired with the ceiling they ran
/// under. `red_peak`/`blue_peak` are the largest fuel any single tick of that
/// controller drew (`alloc` + the contract entry) — comparing them to `ceiling`
/// tells a model whether it ran comfortably within budget or one heavy tick from a
/// forfeit. `red_total`/`blue_total` are the whole-match draw, the efficiency
/// measure that decides a level-score draw.
#[derive(Debug, Clone, Copy)]
pub struct FuelStats {
    /// The per-tick fuel ceiling both controllers ran under.
    pub ceiling: u64,
    /// Red's peak single-tick fuel draw.
    pub red_peak: u64,
    /// Blue's peak single-tick fuel draw.
    pub blue_peak: u64,
    /// Red's total fuel drawn across the whole match.
    pub red_total: u64,
    /// Blue's total fuel drawn across the whole match.
    pub blue_total: u64,
}

impl MatchSummary {
    /// The match winner with the efficiency tie-break applied.
    ///
    /// A sweep or a decisive time-limit score returns the rules winner unchanged. A
    /// *level* time-limit score — which the rules engine reports as a draw — is
    /// broken in favour of the controller that consumed less total fuel, and stays a
    /// draw only when the fuel totals are also exactly equal. A forfeit returns the
    /// rules winner (the non-forfeiting team, or `None` if both failed).
    ///
    /// This is the one place the tie-break is computed; the `foray` CLI and the
    /// arena/validator in `core` all call it so a given matchup is never scored two
    /// different ways.
    pub fn decided(&self) -> Decided {
        let result = &self.replay.result;
        match result.ended {
            Ended::Swept => Decided {
                winner: result.winner,
                by: DecidedBy::Sweep,
            },
            Ended::Forfeit => Decided {
                winner: result.winner,
                by: DecidedBy::Forfeit,
            },
            Ended::TimeLimit => match result.winner {
                // A decisive score at the time limit needs no tie-break.
                Some(team) => Decided {
                    winner: Some(team),
                    by: DecidedBy::Score,
                },
                // Level score: the leaner controller (less total fuel) wins; only an
                // exact fuel tie is a true draw.
                None => match self.fuel.red_total.cmp(&self.fuel.blue_total) {
                    Ordering::Less => Decided {
                        winner: Some(Team::Red),
                        by: DecidedBy::Efficiency,
                    },
                    Ordering::Greater => Decided {
                        winner: Some(Team::Blue),
                        by: DecidedBy::Efficiency,
                    },
                    Ordering::Equal => Decided {
                        winner: None,
                        by: DecidedBy::Score,
                    },
                },
            },
        }
    }
}

/// Run the single canonical match between two controller modules and return its
/// replay. This is the reusable entry both the CLI and the validator call.
///
/// `red_wasm`/`blue_wasm` are the controller module bytes (Red is conventionally
/// the submission, Blue the baseline). `board` is the maze the match runs on — the
/// CLI loads the committed map TOML, but a caller may also generate it; `setup`
/// carries the seed/params that *regenerate* the same board for reconstruction, so
/// `board` and `setup` must describe the same maze.
///
/// A controller that fails to load (does not compile, cannot instantiate, or is
/// missing a contract export) is a build/legality failure, surfaced as a
/// [`RunError`] — the match never starts. A controller that breaks the rules
/// *during* the match (traps, runs out of fuel/memory, or returns a
/// contract-invalid action) **forfeits**, and the returned replay records the
/// forfeit outcome — a match always produces a replay once both controllers load.
pub fn run_match(
    red_wasm: &[u8],
    blue_wasm: &[u8],
    board: Board,
    setup: &MatchSetup,
) -> Result<MatchSummary, RunError> {
    let game = Match::new(board, setup.rules, setup.sim);
    match_runner::run_with_modules(red_wasm, blue_wasm, game, setup)
}

/// Generate the canonical board for `setup` from its seed and board params — the
/// convenience a caller without a map file uses (e.g. a test, or a validator that
/// regenerates rather than ships the TOML).
pub fn board_for(setup: &MatchSetup) -> Board {
    let params: BoardParams = setup.board_params.into();
    Board::generate(setup.map_id.clone(), params, setup.seed)
}

/// Why a match could not be *run*. These are failures that prevent a match from
/// starting at all — distinct from an in-match forfeit, which produces a valid
/// replay rather than an error.
#[derive(Debug, thiserror::Error)]
pub enum RunError {
    /// The wasm engine could not be configured (e.g. fuel metering unavailable in
    /// this build of wasmtime).
    #[error("failed to build the wasm engine: {0}")]
    Engine(String),
    /// Red's controller module failed to load.
    #[error("red controller failed to load: {0}")]
    LoadRed(#[source] LoadError),
    /// Blue's controller module failed to load.
    #[error("blue controller failed to load: {0}")]
    LoadBlue(#[source] LoadError),
}

#[cfg(test)]
mod decided_tests {
    use super::*;
    use foray_core::replay::{Participants, Replay, ReplayResult};
    use foray_core::state::{Kills, Score};

    /// A [`MatchSummary`] carrying just enough to exercise [`MatchSummary::decided`]:
    /// the committed result and the per-controller fuel totals.
    fn summary(
        winner: Option<Team>,
        ended: Ended,
        red_total: u64,
        blue_total: u64,
    ) -> MatchSummary {
        let result = ReplayResult {
            winner,
            score: Score { red: 4, blue: 4 },
            kills: Kills::default(),
            ended,
            ticks: 100,
        };
        let replay = Replay {
            version: foray_core::replay::REPLAY_VERSION,
            map: "mirror-32x16".to_string(),
            seed: "0x1".to_string(),
            timestep_ms: 16,
            participants: Participants {
                red: "red".to_string(),
                blue: "blue".to_string(),
            },
            board: BoardParamsSerde::default(),
            rules: Rules::default(),
            simulation: Simulation::default(),
            ticks: Vec::new(),
            result,
        };
        MatchSummary {
            replay,
            forfeit: None,
            fuel: FuelStats {
                ceiling: 1_000,
                red_peak: 0,
                blue_peak: 0,
                red_total,
                blue_total,
            },
        }
    }

    #[test]
    fn a_decisive_score_or_sweep_keeps_the_rules_winner() {
        let swept = summary(Some(Team::Red), Ended::Swept, 999, 1);
        assert_eq!(
            swept.decided(),
            Decided {
                winner: Some(Team::Red),
                by: DecidedBy::Sweep
            },
            "a sweep ignores fuel even when the winner burned far more"
        );

        let scored = summary(Some(Team::Blue), Ended::TimeLimit, 1, 999);
        assert_eq!(
            scored.decided(),
            Decided {
                winner: Some(Team::Blue),
                by: DecidedBy::Score
            },
        );
    }

    #[test]
    fn a_level_score_is_broken_in_favour_of_the_leaner_controller() {
        let red_leaner = summary(None, Ended::TimeLimit, 100, 250);
        assert_eq!(
            red_leaner.decided(),
            Decided {
                winner: Some(Team::Red),
                by: DecidedBy::Efficiency
            },
        );

        let blue_leaner = summary(None, Ended::TimeLimit, 250, 100);
        assert_eq!(
            blue_leaner.decided(),
            Decided {
                winner: Some(Team::Blue),
                by: DecidedBy::Efficiency
            },
        );
    }

    #[test]
    fn an_exact_fuel_tie_stays_a_draw() {
        let dead_heat = summary(None, Ended::TimeLimit, 200, 200);
        assert_eq!(
            dead_heat.decided(),
            Decided {
                winner: None,
                by: DecidedBy::Score
            },
            "level score and level fuel is a genuine draw"
        );
    }

    #[test]
    fn a_forfeit_is_never_overridden_by_fuel() {
        // The non-forfeiting team wins even if it burned more fuel.
        let blue_forfeited = summary(Some(Team::Red), Ended::Forfeit, 999, 1);
        assert_eq!(
            blue_forfeited.decided(),
            Decided {
                winner: Some(Team::Red),
                by: DecidedBy::Forfeit
            },
        );

        // Both forfeited: a draw, regardless of fuel.
        let both_forfeited = summary(None, Ended::Forfeit, 100, 250);
        assert_eq!(
            both_forfeited.decided(),
            Decided {
                winner: None,
                by: DecidedBy::Forfeit
            },
        );
    }
}
