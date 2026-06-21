//! The replay format and reconstruction.
//!
//! A replay is a **seed plus a per-tick input log** — not a frame dump (the
//! lockstep model from the adversarial overview). It records everything needed to
//! re-run the engine and reproduce the match bit-for-bit: the map id, the seed,
//! the timestep, the participants, every tick's two action sets, and the
//! committed result. [`Replay::reconstruct`] re-runs the recorded actions through
//! the *same* [`Match`](crate::engine::Match) the producer used, and a
//! [`ReplayDrift`] is raised if the reconstructed result disagrees with the
//! committed one — that means the engine changed under the replay and is a bug,
//! not a re-scoring.
//!
//! The JSON shape matches architecture.md exactly, including `seed` as a string
//! (so a `0x…` literal round-trips) and `ended`/`winner` spelled as the docs show.

use serde::{Deserialize, Serialize};

use crate::board::{Board, Team};
use crate::config::{BoardParamsSerde, Rules, Simulation};
use crate::contract::Action;
use crate::engine::Match;
use crate::state::{Ended, Kills, MatchResult, Score};

/// The current replay format version. Bumping the engine in a way that changes
/// reconstruction must bump this so an old replay is recognizably incompatible.
///
/// `2` added per-team `kills` to the committed result.
pub const REPLAY_VERSION: u32 = 2;

/// One tick's recorded inputs: each team's action.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TickInput {
    /// Red's action for this tick.
    pub red: Action,
    /// Blue's action for this tick.
    pub blue: Action,
}

/// The model/controller ids that played the match (site-facing provenance).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Participants {
    pub red: String,
    pub blue: String,
}

/// The committed outcome, in the replay's wire spelling.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReplayResult {
    /// `"red"`, `"blue"`, or `null` for a draw.
    pub winner: Option<Team>,
    /// Final banked score.
    pub score: Score,
    /// Tags inflicted per colony — the "kills". Defaulted on read so a
    /// pre-`kills` replay (format `1`) still parses as zero kills.
    #[serde(default)]
    pub kills: Kills,
    /// How the match ended.
    pub ended: Ended,
    /// The tick it ended on.
    pub ticks: u32,
}

impl From<MatchResult> for ReplayResult {
    fn from(result: MatchResult) -> ReplayResult {
        ReplayResult {
            winner: result.winner,
            score: result.score,
            kills: result.kills,
            ended: result.ended,
            ticks: result.ticks,
        }
    }
}

/// A full replay — the published, browser-playable artifact.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Replay {
    /// Format version (see [`REPLAY_VERSION`]).
    pub version: u32,
    /// The map id (the map definition ships with the case).
    pub map: String,
    /// The seed that produced the maze, as a string so a `0x…` literal survives
    /// the round-trip.
    pub seed: String,
    /// The faked timestep in milliseconds.
    pub timestep_ms: u32,
    /// The model/controller ids per colony.
    pub participants: Participants,
    /// The board-generation parameters, so a reconstructor regenerates the
    /// *identical* maze from `seed` without shipping the map file. Defaulted on
    /// read for forward-compatibility with replays that omit it (they use the
    /// shipped `mirror-32x16` defaults).
    #[serde(default)]
    pub board: BoardParamsSerde,
    /// The rule constants the match ran under (carry weight, jelly), recorded so
    /// reconstruction uses the exact same rules even if the defaults later change.
    #[serde(default)]
    pub rules: Rules,
    /// The simulation loop config (timestep is also surfaced at top level for the
    /// renderer; this carries `max_ticks` too).
    #[serde(default)]
    pub simulation: Simulation,
    /// One entry per tick, in order.
    pub ticks: Vec<TickInput>,
    /// The committed result the reconstruction must reproduce.
    pub result: ReplayResult,
}

/// The reconstructed match disagreed with the committed result — the engine
/// drifted from what produced the replay.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplayDrift {
    /// What the committed replay says.
    pub committed: ReplayResult,
    /// What re-running the inputs produced.
    pub reconstructed: ReplayResult,
}

impl std::fmt::Display for ReplayDrift {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "replay drift: committed {:?} but reconstruction produced {:?}",
            self.committed, self.reconstructed
        )
    }
}

impl std::error::Error for ReplayDrift {}

/// Parse `seed` from its string form. Accepts decimal and `0x…` hex, mirroring
/// the `--seed 0xC0FFEE` the CLI accepts.
pub fn parse_seed(seed: &str) -> Result<u64, std::num::ParseIntError> {
    let trimmed = seed.trim();
    if let Some(hex) = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
    {
        u64::from_str_radix(hex, 16)
    } else {
        trimmed.parse()
    }
}

/// The fixed identity of a match — everything a replay records that is *not* the
/// per-tick log or the result. Grouped so [`Replay::record`] takes the match
/// header, the inputs, and the outcome as three clear arguments rather than a
/// long positional list the host can transpose.
#[derive(Debug, Clone)]
pub struct RecordHeader {
    /// The map id.
    pub map: String,
    /// The seed the maze was generated from.
    pub seed: u64,
    /// The model/controller ids per colony.
    pub participants: Participants,
    /// The board-generation parameters used.
    pub board: BoardParamsSerde,
    /// The rule constants the match ran under.
    pub rules: Rules,
    /// The simulation loop config.
    pub sim: Simulation,
}

impl Replay {
    /// Build a replay from a match header, the recorded inputs, and the decided
    /// result. The host calls this after the match loop.
    pub fn record(header: RecordHeader, ticks: Vec<TickInput>, result: MatchResult) -> Replay {
        Replay {
            version: REPLAY_VERSION,
            map: header.map,
            seed: format!("0x{:X}", header.seed),
            timestep_ms: header.sim.timestep_ms,
            participants: header.participants,
            board: header.board,
            rules: header.rules,
            simulation: header.sim,
            ticks,
            result: result.into(),
        }
    }

    /// Regenerate the board this replay was produced on, from its seed and
    /// recorded board params. Browser playback uses this — it never ships or
    /// parses the map TOML.
    pub fn board(&self) -> Result<Board, ReplayError> {
        let seed = parse_seed(&self.seed).map_err(|_| ReplayError::BadSeed(self.seed.clone()))?;
        Ok(Board::generate(self.map.clone(), self.board.into(), seed))
    }

    /// Re-run the recorded inputs through the engine, reproducing the match. The
    /// board is regenerated from the seed (see [`Replay::board`]). Returns the
    /// reconstructed [`Match`] (so the renderer can step it again) or a drift
    /// error if the reproduced result disagrees with the committed one.
    pub fn reconstruct(&self) -> Result<Match, ReplayError> {
        let board = self.board()?;
        self.reconstruct_on(board)
    }

    /// Reconstruct on a caller-supplied board (e.g. the native CLI loads the
    /// committed map TOML rather than regenerating). The board must be the one the
    /// match was produced on, or reconstruction will drift.
    pub fn reconstruct_on(&self, board: Board) -> Result<Match, ReplayError> {
        let mut game = Match::new(board, self.rules, self.simulation);

        let mut reconstructed = None;
        for input in &self.ticks {
            if game.is_over() {
                break;
            }
            reconstructed = game.step(&input.red, &input.blue);
        }

        // A forfeit cannot be re-derived from inputs alone (the host decides it),
        // so for a forfeit we trust the committed result and stamp it onto the
        // reconstructed state rather than checking the engine reproduced it.
        let reproduced: ReplayResult = match self.result.ended {
            Ended::Forfeit => self.result,
            _ => reconstructed
                .map(ReplayResult::from)
                .ok_or(ReplayError::Incomplete)?,
        };

        if reproduced != self.result {
            return Err(ReplayError::Drift(ReplayDrift {
                committed: self.result,
                reconstructed: reproduced,
            }));
        }
        game.state.result = Some(MatchResult {
            winner: self.result.winner,
            score: self.result.score,
            kills: self.result.kills,
            ended: self.result.ended,
            ticks: self.result.ticks,
        });
        Ok(game)
    }

    /// Serialize to the canonical pretty-printed JSON artifact.
    pub fn to_json(&self) -> String {
        let mut text = serde_json::to_string_pretty(self).expect("a Replay serializes to JSON");
        text.push('\n');
        text
    }

    /// Parse a replay from JSON.
    pub fn from_json(text: &str) -> Result<Replay, serde_json::Error> {
        serde_json::from_str(text)
    }
}

/// Why a replay could not be reconstructed.
#[derive(Debug)]
pub enum ReplayError {
    /// The recorded `seed` string was neither decimal nor `0x…` hex.
    BadSeed(String),
    /// The tick log ran out before the match was decided — a truncated replay.
    Incomplete,
    /// The reconstruction disagreed with the committed result.
    Drift(ReplayDrift),
}

impl std::fmt::Display for ReplayError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ReplayError::BadSeed(s) => write!(f, "invalid seed string {s:?}"),
            ReplayError::Incomplete => write!(f, "replay ended before the match was decided"),
            ReplayError::Drift(drift) => write!(f, "{drift}"),
        }
    }
}

impl std::error::Error for ReplayError {}
