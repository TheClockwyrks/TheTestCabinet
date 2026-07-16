//! The match driver: a thin wrapper that owns a [`Board`] + [`MatchState`] and
//! steps the [tick advance](crate::tick).
//!
//! The native CLI host uses [`Match::step`] each tick, feeding it the actions it
//! got from the two wasm controllers and recording them into a [`Replay`]. The
//! browser reconstruction uses the *same* `Match` driven by the recorded actions
//! ([`crate::replay::Replay::reconstruct`]) — one driver, so a replay can never
//! diverge from the rules that produced it.

use serde::{Deserialize, Serialize};

use crate::board::{Board, Team};
use crate::config::{Rules, Simulation};
use crate::contract::{Action, World};
use crate::state::{MatchResult, MatchState, Role, Score};

/// A running (or finished) match: the static board plus the live state and the
/// rules/loop config that govern it.
#[derive(Debug, Clone)]
pub struct Match {
    /// The static maze.
    pub board: Board,
    /// The live state.
    pub state: MatchState,
    /// Rule constants (carry weight, jelly).
    pub rules: Rules,
    /// Loop config (timestep, max_ticks).
    pub sim: Simulation,
}

impl Match {
    /// Start a match on `board` with the given rules and loop config.
    pub fn new(board: Board, rules: Rules, sim: Simulation) -> Match {
        let state = MatchState::new(&board, &rules);
        Match {
            board,
            state,
            rules,
            sim,
        }
    }

    /// The observation handed to `team`'s controller this tick.
    pub fn observe(&self, team: Team) -> World {
        World::observe(
            &self.board,
            &self.state,
            team,
            &self.rules,
            self.sim.timestep_ms,
        )
    }

    /// Advance one tick with both teams' (already contract-valid) actions.
    /// Returns the result if this tick ended the match.
    pub fn step(&mut self, red: &Action, blue: &Action) -> Option<MatchResult> {
        crate::tick::advance(
            &self.board,
            &mut self.state,
            red,
            blue,
            &self.rules,
            &self.sim,
        )
    }

    /// Whether the match has been decided.
    pub fn is_over(&self) -> bool {
        self.state.is_over()
    }

    /// The decided result, if any.
    pub fn result(&self) -> Option<MatchResult> {
        self.state.result
    }

    /// A flat, render-ready snapshot of the current frame for the browser
    /// playback layer. The renderer holds no rules — it only draws what is here —
    /// so this carries everything a frame needs: agents (with derived role),
    /// live caches, active jelly, score, and the result once decided.
    pub fn snapshot(&self) -> StateSnapshot {
        StateSnapshot {
            tick: self.state.tick,
            agents: self
                .state
                .agents
                .iter()
                .map(|a| AgentSnapshot {
                    id: a.id,
                    team: a.team,
                    x: a.pos.x,
                    y: a.pos.y,
                    role: a.role(&self.board),
                    carrying: a.carrying,
                    immune_ticks: a.immune_ticks,
                })
                .collect(),
            seeds: self
                .state
                .red_caches
                .iter()
                .chain(self.state.blue_caches.iter())
                .map(|p| [p.x, p.y])
                .collect(),
            // Kept apart from `seeds` here, unlike in the controller's `world` (where
            // large seeds are folded into the seed list so a naive controller still
            // picks them up). A renderer has the opposite need: it must draw them
            // *differently*, so it wants them separated.
            large_seeds: self
                .state
                .large_seeds
                .iter()
                .filter(|seed| seed.on_board())
                .map(|seed| [seed.pos.x, seed.pos.y])
                .collect(),
            jelly: self
                .state
                .red_jelly
                .iter()
                .chain(self.state.blue_jelly.iter())
                .map(|p| [p.x, p.y])
                .collect(),
            score: self.state.score,
            result: self.state.result,
        }
    }
}

/// One agent as the renderer sees it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentSnapshot {
    pub id: u32,
    pub team: Team,
    pub x: i32,
    pub y: i32,
    pub role: Role,
    pub carrying: u32,
    pub immune_ticks: u32,
}

/// A single render frame: the mutable state at one tick. The static board is sent
/// once when the replay loads, so a frame need not repeat the walls.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StateSnapshot {
    pub tick: u32,
    pub agents: Vec<AgentSnapshot>,
    /// Live ordinary caches as `[x, y]`.
    pub seeds: Vec<[i32; 2]>,
    /// Large seeds currently on the board (not carried, not banked) as `[x, y]`.
    /// They move, so a renderer draws them per frame like an agent, not like a
    /// fixture.
    pub large_seeds: Vec<[i32; 2]>,
    /// Active jelly nodes as `[x, y]`.
    pub jelly: Vec<[i32; 2]>,
    pub score: Score,
    /// The decided result once the match is over (so the renderer can show the
    /// outcome on the final frame); `None` while in progress.
    pub result: Option<MatchResult>,
}
