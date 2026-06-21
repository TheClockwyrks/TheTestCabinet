//! The controller-facing contract: the `World` observation handed in and the
//! `Action` returned, plus their JSON Schemas.
//!
//! These two types are the **only** channel between a controller and the game
//! (the overview's anti-cheat guarantee). The JSON shapes match
//! architecture.md exactly, and the schemas are *generated from these types* via
//! schemars, so the schema the manifest seeds and the bytes the engine
//! (de)serializes can never disagree.
//!
//! Legality has two deliberately separated tiers:
//! - **Schema-invalid output is a forfeit** — but every illegal *intent* is made
//!   unrepresentable by the type itself: an [`Action`] can only ever name a
//!   direction for an agent, never mutate state. Cheating cannot compile.
//! - **A well-formed but blocked move is clamped to `Stop`**, never punished —
//!   handled in [`crate::tick`], not here.

use serde::{Deserialize, Serialize};

use crate::board::{Board, Pos, Team};
use crate::config::Rules;
use crate::state::{MatchState, Role};

/// A cardinal move or a hold. The only thing a controller can express per agent —
/// there is no variant that touches game state, so an [`Action`] is structurally
/// incapable of cheating.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
pub enum Dir {
    /// North: `y - 1`.
    N,
    /// South: `y + 1`.
    S,
    /// East: `x + 1`.
    E,
    /// West: `x - 1`.
    W,
    /// Hold position.
    Stop,
}

impl Dir {
    /// The tile this direction moves to from `pos`. `Stop` returns `pos`.
    pub fn apply(self, pos: Pos) -> Pos {
        match self {
            Dir::N => Pos::new(pos.x, pos.y - 1),
            Dir::S => Pos::new(pos.x, pos.y + 1),
            Dir::E => Pos::new(pos.x + 1, pos.y),
            Dir::W => Pos::new(pos.x - 1, pos.y),
            Dir::Stop => pos,
        }
    }
}

/// One agent's move within an [`Action`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
pub struct Move {
    /// The owned agent's id (`0..3`).
    pub agent: u32,
    /// The direction to move it (or `Stop`).
    pub dir: Dir,
}

/// A controller's output for one tick: one move per owned agent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
pub struct Action {
    /// One entry per owned agent. The host validates that exactly the team's
    /// three ids appear, each once.
    pub moves: Vec<Move>,
}

impl Action {
    /// All `Stop` — the safe fallback the host uses when a controller forfeits
    /// (the match still advances so a replay is produced).
    pub fn all_stop() -> Action {
        Action {
            moves: (0..3)
                .map(|agent| Move {
                    agent,
                    dir: Dir::Stop,
                })
                .collect(),
        }
    }

    /// Validate that `self` is a well-formed action for `team`: exactly the
    /// team's three agent ids, each present once. Schema validation would catch
    /// malformed JSON; this catches the structural rules the JSON Schema cannot
    /// express (the right id set). A failure here is a **forfeit** in the host.
    pub fn validate_for(&self, team: Team, state: &MatchState) -> Result<(), ContractError> {
        let mut seen = std::collections::BTreeSet::new();
        let owned: std::collections::BTreeSet<u32> = state
            .agents
            .iter()
            .filter(|a| a.team == team)
            .map(|a| a.id)
            .collect();
        for mv in &self.moves {
            if !owned.contains(&mv.agent) {
                return Err(ContractError::UnownedAgent(mv.agent));
            }
            if !seen.insert(mv.agent) {
                return Err(ContractError::DuplicateAgent(mv.agent));
            }
        }
        if seen != owned {
            return Err(ContractError::MissingAgents);
        }
        Ok(())
    }

    /// The direction this action assigns to `agent`, or `Stop` if absent.
    pub fn dir_for(&self, agent: u32) -> Dir {
        self.moves
            .iter()
            .find(|m| m.agent == agent)
            .map(|m| m.dir)
            .unwrap_or(Dir::Stop)
    }
}

/// Why an action failed contract validation (a forfeit-worthy condition).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContractError {
    /// A move named an agent the team does not own.
    UnownedAgent(u32),
    /// An agent appeared more than once.
    DuplicateAgent(u32),
    /// Not every owned agent was given a move.
    MissingAgents,
}

impl std::fmt::Display for ContractError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ContractError::UnownedAgent(id) => write!(f, "action names unowned agent {id}"),
            ContractError::DuplicateAgent(id) => write!(f, "agent {id} appears more than once"),
            ContractError::MissingAgents => write!(f, "action omits one or more owned agents"),
        }
    }
}

impl std::error::Error for ContractError {}

// ---------------------------------------------------------------------------
// The `world` observation. A view *built for a team* each tick — never the raw
// authoritative state, and never the opponent's view.
// ---------------------------------------------------------------------------

/// The static board view embedded in every observation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
pub struct BoardView {
    pub width: i32,
    pub height: i32,
    /// First column belonging to Blue's half (matches the engine's `border_x`).
    pub border_x: i32,
    /// Blocked tiles, static for the match, as `[x, y]` pairs.
    pub walls: Vec<[i32; 2]>,
}

/// One of the controller's *own* agents, with the carry-weight cadence
/// pre-computed so the controller never re-derives it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
pub struct OwnAgentView {
    pub id: u32,
    pub x: i32,
    pub y: i32,
    pub role: Role,
    pub carrying: u32,
    pub immune_ticks: u32,
    /// Whether this agent may move this tick under carry-weight (see
    /// [`crate::state::Agent::can_move_this_tick`]). A move submitted for an
    /// agent reading `false` is a no-op.
    pub can_move_this_tick: bool,
}

/// One of the opposing colony's agents. The same fields minus `can_move_this_tick`
/// (a controller does not drive enemies, so their cadence is not exposed).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
pub struct EnemyAgentView {
    pub id: u32,
    pub x: i32,
    pub y: i32,
    pub role: Role,
    pub carrying: u32,
    pub immune_ticks: u32,
}

/// A royal-jelly node in the observation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
pub struct JellyView {
    pub x: i32,
    pub y: i32,
    /// Always `true` in the list (consumed nodes are dropped from it), but kept
    /// explicit to match architecture.md's shape and leave room for a future
    /// recharge variant.
    pub active: bool,
}

/// Remaining (un-banked-away) seed totals per half, the sweep-progress signal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
pub struct SeedsRemaining {
    /// Seeds still to be banked away from Red's half (what Blue must sweep).
    pub red_half: u32,
    /// Seeds still to be banked away from Blue's half (what Red must sweep).
    pub blue_half: u32,
}

/// The per-tick observation handed to one team's controller. Fully observable in
/// v1 (no fog) — a deliberate first-case simplification.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
pub struct World {
    pub tick: u32,
    pub timestep_ms: u32,
    /// Which colony this controller drives.
    pub team: Team,
    pub board: BoardView,
    pub score: ScoreView,
    pub seeds_remaining: SeedsRemaining,
    /// This team's three agents.
    pub my_agents: Vec<OwnAgentView>,
    /// The opposing colony's three agents.
    pub enemies: Vec<EnemyAgentView>,
    /// Every uneaten cache (including dropped, recoverable ones) on the board.
    pub seeds: Vec<[i32; 2]>,
    /// Active royal-jelly nodes.
    pub jelly: Vec<JellyView>,
}

/// Banked score, as the observation spells it (`{ "red": .., "blue": .. }`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
pub struct ScoreView {
    pub red: u32,
    pub blue: u32,
}

impl World {
    /// Build the observation for `team` from the authoritative state. This is the
    /// view boundary: it copies out only what `team` is allowed to see and
    /// pre-computes the carry-weight cadence for its own agents. `timestep_ms` is
    /// the host's faked simulation delta, surfaced to the controller verbatim.
    pub fn observe(
        board: &Board,
        state: &MatchState,
        team: Team,
        rules: &Rules,
        timestep_ms: u32,
    ) -> World {
        let my_agents = state
            .agents
            .iter()
            .filter(|a| a.team == team)
            .map(|a| OwnAgentView {
                id: a.id,
                x: a.pos.x,
                y: a.pos.y,
                role: a.role(board),
                carrying: a.carrying,
                immune_ticks: a.immune_ticks,
                can_move_this_tick: a.can_move_this_tick(board, rules),
            })
            .collect();

        let enemies = state
            .agents
            .iter()
            .filter(|a| a.team != team)
            .map(|a| EnemyAgentView {
                id: a.id,
                x: a.pos.x,
                y: a.pos.y,
                role: a.role(board),
                carrying: a.carrying,
                immune_ticks: a.immune_ticks,
            })
            .collect();

        let mut seeds: Vec<[i32; 2]> = state
            .red_caches
            .iter()
            .chain(state.blue_caches.iter())
            .map(|p| [p.x, p.y])
            .collect();
        seeds.sort();

        let mut jelly: Vec<JellyView> = state
            .red_jelly
            .iter()
            .chain(state.blue_jelly.iter())
            .map(|p| JellyView {
                x: p.x,
                y: p.y,
                active: true,
            })
            .collect();
        jelly.sort_by_key(|j| (j.x, j.y));

        World {
            tick: state.tick,
            timestep_ms,
            team,
            board: BoardView {
                width: board.width,
                height: board.height,
                border_x: board.border_x,
                walls: board.walls().iter().map(|p| [p.x, p.y]).collect(),
            },
            score: ScoreView {
                red: state.score.red,
                blue: state.score.blue,
            },
            seeds_remaining: SeedsRemaining {
                // Seeds still to be banked away = original total minus what the
                // opponent has banked. This is the sweep signal: when the value
                // for a half hits zero, that half has been swept.
                red_half: state.red_seeds_total - state.score.get(Team::Blue),
                blue_half: state.blue_seeds_total - state.score.get(Team::Red),
            },
            my_agents,
            enemies,
            seeds,
            jelly,
        }
    }

    /// Serialize to the JSON bytes the host writes into the controller's memory.
    pub fn to_json(&self) -> Vec<u8> {
        serde_json::to_vec(self).expect("World always serializes")
    }
}

/// The JSON Schemas the manifest seeds verbatim. Generated from the very types
/// the engine (de)serializes, so they cannot drift from the engine.
#[cfg(feature = "schema")]
pub fn world_schema() -> serde_json::Value {
    let schema = schemars::schema_for!(World);
    serde_json::to_value(schema).expect("the world schema serializes")
}

/// The action JSON Schema (see [`world_schema`]).
#[cfg(feature = "schema")]
pub fn action_schema() -> serde_json::Value {
    let schema = schemars::schema_for!(Action);
    serde_json::to_value(schema).expect("the action schema serializes")
}

/// The world schema as the canonical pretty-printed string seeded into the case.
#[cfg(feature = "schema")]
pub fn world_schema_string() -> String {
    let mut text =
        serde_json::to_string_pretty(&world_schema()).expect("the world schema serializes");
    text.push('\n');
    text
}

/// The action schema as the canonical pretty-printed string seeded into the case.
#[cfg(feature = "schema")]
pub fn action_schema_string() -> String {
    let mut text =
        serde_json::to_string_pretty(&action_schema()).expect("the action schema serializes");
    text.push('\n');
    text
}
