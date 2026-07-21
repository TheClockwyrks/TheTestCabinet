//! Live match state: the agents, the live caches, jelly, scores, and the result.
//!
//! [`MatchState`] is everything that *changes* over a match — distinct from the
//! static [`Board`]. It is built from a board with [`MatchState::new`], advanced
//! one tick at a time by [`crate::tick::advance`], and queried for the result.
//! A match's score is the seeds each colony has *banked*; carried (un-banked)
//! load is not score and is lost if the carrier is tagged.
//!
//! Role is **derived, never stored**: an agent is a soldier on its own half and a
//! raider on the enemy half, decided purely by `pos` against the board's border.
//! Storing the role would let it drift from position; deriving it makes the
//! "roles flip at the border" rule unfalsifiable.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::board::{Board, Pos, Team};
use crate::config::Rules;

/// The role an agent currently has, derived from the half it stands on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "lowercase")]
pub enum Role {
    /// On its own half: a defender that can tag enemy raiders.
    Soldier,
    /// On the enemy half: a forager that eats caches and carries the load home.
    Raider,
}

/// One agent. Three per team; agents are not typed — the same agent is a soldier
/// or raider depending on where it currently stands.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Agent {
    /// Stable per-team index `0..3`, used to address moves in an
    /// [`Action`](crate::contract::Action).
    pub id: u32,
    /// The colony this agent belongs to (does not change).
    pub team: Team,
    /// Current tile.
    pub pos: Pos,
    /// **Ordinary** seeds picked up and not yet banked.
    pub carrying: u32,
    /// **Large** seeds picked up and not yet banked. Kept apart from `carrying`
    /// because a large seed is an object, not a quantity: on a tag it drops back
    /// onto the board whole (still worth `large_seed_value`) rather than shattering
    /// into that many ordinary caches. The two are combined into one figure by
    /// [`load`](Agent::load), which is what carry-weight and banking actually read.
    pub carrying_large: u32,
    /// Remaining tag-immunity ticks from royal jelly. While `> 0` the agent
    /// cannot be tagged; decremented once per tick.
    pub immune_ticks: u32,
    /// Banked movement charge under the [carry-weight speed
    /// model](crate::config::Rules). Each tick the agent earns
    /// [`move_speed`](Agent::move_speed) charge; once it reaches
    /// `move_resolution` it steps one tile and spends that much. A fast agent
    /// banks a full step every tick; a heavy raider takes several ticks to bank
    /// one. Kept in `[0, move_resolution]`.
    pub move_accum: u32,
}

impl Agent {
    /// This agent's total load in seed-equivalents: ordinary seeds plus each large
    /// seed counted as `large_seed_value`. This one figure is both what the agent
    /// *banks* and what it *weighs* — value and weight are deliberately the same
    /// number, which is what makes "carry only the big seed" a light load that still
    /// out-runs a soldier, and "the big seed plus one more" a load that does not.
    pub fn load(&self, rules: &Rules) -> u32 {
        self.carrying + rules.large_seed_value * self.carrying_large
    }

    /// The role this agent has *right now*, from its position and the border.
    pub fn role(&self, board: &Board) -> Role {
        if board.team_of_column(self.pos.x) == self.team {
            Role::Soldier
        } else {
            Role::Raider
        }
    }

    /// The movement charge this agent earns per tick under the carry-weight speed
    /// model (see [`Rules`]). A soldier earns
    /// `soldier_speed`; a light raider earns the full `move_resolution` (moving
    /// every tick); a raider carrying past `light_load` loses
    /// `move_resolution - soldier_speed` per extra seed, floored at `min_speed`.
    /// This is Foray's signature carry-weight mechanic, so it lives in one place
    /// and is read by both the tick advance and the `world` observation.
    pub fn move_speed(&self, board: &Board, rules: &Rules) -> u32 {
        match self.role(board) {
            // Soldiers move at a fixed pace, regardless of any (impossible) load —
            // only raiders carry.
            Role::Soldier => rules.soldier_speed,
            Role::Raider => {
                let over = self.load(rules).saturating_sub(rules.light_load);
                let penalty = rules.move_resolution.saturating_sub(rules.soldier_speed) * over;
                rules
                    .move_resolution
                    .saturating_sub(penalty)
                    .max(rules.min_speed)
            }
        }
    }

    /// Whether this agent will step a tile if it tries to move this tick: it has
    /// banked enough charge that one more tick of [`move_speed`](Agent::move_speed)
    /// reaches `move_resolution`. A heavy raider mid-stall reads `false`, and any
    /// move it is given collapses to `Stop`. Exposed to controllers via `world`
    /// so they never have to re-derive the cadence.
    pub fn can_move_this_tick(&self, board: &Board, rules: &Rules) -> bool {
        self.move_accum + self.move_speed(board, rules) >= rules.move_resolution
    }
}

/// How a match ended. Mirrors the replay's `ended` field exactly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum Ended {
    /// One colony banked *all* of the enemy's seeds — the decisive win.
    Swept,
    /// The `max_ticks` cap was reached; higher banked score wins, equal is a draw.
    TimeLimit,
    /// A controller trapped, exhausted fuel/memory, or returned an invalid
    /// action. The engine never produces this itself — the host
    /// ([`foray-cli`](../../../crates/foray-cli)) sets it — but the type carries
    /// it so a forfeit result is representable in a replay.
    Forfeit,
}

/// The decided outcome of a match.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct MatchResult {
    /// The winning colony, or `None` for a draw.
    pub winner: Option<Team>,
    /// Final banked score per colony.
    pub score: Score,
    /// How many enemy raiders each colony tagged over the match — the "kills".
    pub kills: Kills,
    /// How the match ended.
    pub ended: Ended,
    /// The tick at which it ended.
    pub ticks: u32,
}

/// Banked seeds per colony — the score.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
pub struct Score {
    /// Seeds Red has banked.
    pub red: u32,
    /// Seeds Blue has banked.
    pub blue: u32,
}

impl Score {
    /// The banked count for `team`.
    pub fn get(&self, team: Team) -> u32 {
        match team {
            Team::Red => self.red,
            Team::Blue => self.blue,
        }
    }

    /// Add `amount` to `team`'s banked score.
    pub fn add(&mut self, team: Team, amount: u32) {
        match team {
            Team::Red => self.red += amount,
            Team::Blue => self.blue += amount,
        }
    }
}

/// Tags inflicted per colony — a "kill" is a soldier tagging an enemy raider. A
/// team's count is the number of *enemy* raiders it tagged (Red's count is the
/// Blue raiders Red soldiers respawned, and vice versa). Surfaced on the
/// [`MatchResult`] so a match summary can report kills without replaying the match.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
pub struct Kills {
    /// Enemy (Blue) raiders Red has tagged.
    pub red: u32,
    /// Enemy (Red) raiders Blue has tagged.
    pub blue: u32,
}

impl Kills {
    /// The tag count credited to `team`.
    pub fn get(&self, team: Team) -> u32 {
        match team {
            Team::Red => self.red,
            Team::Blue => self.blue,
        }
    }

    /// Credit `team` with one tag against an enemy raider.
    pub fn add(&mut self, team: Team, amount: u32) {
        match team {
            Team::Red => self.red += amount,
            Team::Blue => self.blue += amount,
        }
    }
}

/// One large seed: an *object* on the board, not a tile in a set.
///
/// It is worth [`large_seed_value`](crate::config::Rules::large_seed_value) ordinary
/// seeds and it **moves**: every `large_seed_drift_ticks` it walks one tile toward
/// the border, whether or not anyone is standing on it. That last clause is the whole
/// anti-camping property — a defender cannot squat a large seed the way it can squat
/// an ordinary cache, because the seed simply walks out from under it. To hold one
/// back a defender must *recall* it, which costs a walk out, a stand, and a walk home.
#[derive(Debug, Clone)]
pub struct LargeSeed {
    /// Whose larder this seed belongs to — the half it sits on, raided by the other
    /// colony. Its own colony can recall it; the enemy can eat it.
    pub half: Team,
    /// The spawn tile, and where a recall puts it back.
    pub home: Pos,
    /// Current tile. Meaningless while `carried_by` is set.
    pub pos: Pos,
    /// The tile this seed drifts toward — its own **lane**, on the stop column. Each
    /// seed of a half gets a distinct one, so the two do not funnel down the same
    /// tunnel and come to rest side by side. `None` only if walls cut the stop column
    /// off from this seed's spawn, in which case it simply never drifts.
    pub target: Option<Pos>,
    /// Maze distance from [`home`](LargeSeed::home) to every reachable tile of its
    /// half, so the recall guard is an O(1) lookup rather than a per-tick search.
    pub home_dist: BTreeMap<Pos, u32>,
    /// Ticks banked toward the next drift step.
    pub drift_accum: u32,
    /// *Consecutive* ticks an own-side ant has stood on it. Resets the moment none
    /// does, so a recall must be seen through in one stint.
    pub recall_accum: u32,
    /// The index into [`MatchState::agents`] of the raider carrying it, if any.
    pub carried_by: Option<usize>,
    /// Set once it has been banked — it is out of play for the rest of the match,
    /// exactly like an eaten ordinary cache.
    pub banked: bool,
}

impl LargeSeed {
    /// Whether this seed is on the board right now: not carried, not banked.
    pub fn on_board(&self) -> bool {
        !self.banked && self.carried_by.is_none()
    }
}

/// Everything mutable in a match.
#[derive(Debug, Clone)]
pub struct MatchState {
    /// The current tick (0 before any advance).
    pub tick: u32,
    /// The six agents (three per team), Red's first then Blue's.
    pub agents: Vec<Agent>,
    /// Live seed caches on Red's half — what Blue raiders eat. Includes dropped,
    /// recoverable caches scattered by tags. A `BTreeSet` so membership tests are
    /// fast and serialization order is deterministic.
    pub red_caches: BTreeSet<Pos>,
    /// Live seed caches on Blue's half — what Red raiders eat.
    pub blue_caches: BTreeSet<Pos>,
    /// Active royal-jelly nodes on Red's half.
    pub red_jelly: BTreeSet<Pos>,
    /// Active royal-jelly nodes on Blue's half.
    pub blue_jelly: BTreeSet<Pos>,
    /// Consumed jelly nodes on Red's half regrowing at their own tile, with the
    /// ticks left before they do. A node is in exactly one of `red_jelly` (active)
    /// or here (regrowing), never both — so the *active* sets stay the single
    /// source of truth for what a raider can eat and what the board draws.
    pub red_jelly_regrowing: BTreeMap<Pos, u32>,
    /// Consumed jelly nodes on Blue's half regrowing at their own tile.
    pub blue_jelly_regrowing: BTreeMap<Pos, u32>,
    /// Every large seed in the match, both halves, in a fixed order (Red's then
    /// Blue's). One flat list rather than a pair, because an agent references the
    /// seed it carries by index and a raider is by definition holding a seed from
    /// the *other* half.
    pub large_seeds: Vec<LargeSeed>,
    /// Banked score.
    pub score: Score,
    /// Tags inflicted per colony so far — the running kill count, carried into
    /// the [`MatchResult`] when the match decides.
    pub kills: Kills,
    /// How many of each colony's *original* caches remain unbanked — the sweep
    /// counter. A colony wins by sweep when the opponent's total drops to zero,
    /// i.e. every seed that started on the opponent's half has been banked. We
    /// track the original totals here because dropped caches re-enter
    /// `*_caches`; the sweep test must count *banked-away* seeds, not live ones.
    pub red_seeds_total: u32,
    pub blue_seeds_total: u32,
    /// Set once the match has been decided; `None` while in progress.
    pub result: Option<MatchResult>,
}

impl MatchState {
    /// Build the initial state for a board: three agents per team at their nest,
    /// all caches, large seeds, and jelly live, zero score.
    pub fn new(board: &Board, rules: &Rules) -> MatchState {
        let agents = [Team::Red, Team::Blue]
            .into_iter()
            .flat_map(|team| {
                let nest = board.nest(team);
                (0..3).map(move |id| Agent {
                    id,
                    team,
                    pos: nest,
                    carrying: 0,
                    carrying_large: 0,
                    immune_ticks: 0,
                    move_accum: 0,
                })
            })
            .collect();

        let red_caches: BTreeSet<Pos> = board.initial_seeds(Team::Red).iter().copied().collect();
        let blue_caches: BTreeSet<Pos> = board.initial_seeds(Team::Blue).iter().copied().collect();

        // Red's large seeds first, then Blue's, so the flat list has a fixed order.
        // Lanes are handed out per half, each seed claiming a stop-column tile no
        // other seed of that half has taken — otherwise the two converge and rest on
        // top of each other, and two objectives become one.
        let mut large_seeds: Vec<LargeSeed> = Vec::new();
        for half in [Team::Red, Team::Blue] {
            let mut lanes_taken: Vec<Pos> = Vec::new();
            for home in board.initial_large_seeds(half) {
                let target = board.drift_target(*home, half, &lanes_taken);
                if let Some(lane) = target {
                    lanes_taken.push(lane);
                }
                large_seeds.push(LargeSeed {
                    half,
                    home: *home,
                    pos: *home,
                    target,
                    home_dist: board.home_distances(*home, half),
                    drift_accum: 0,
                    recall_accum: 0,
                    carried_by: None,
                    banked: false,
                });
            }
        }

        // The sweep denominator is a half's total *value*, not its number of objects:
        // a large seed is worth `large_seed_value` toward it, exactly as it is worth
        // that much when banked. Counting objects here would make a sweep unreachable
        // (you could bank every seed on the half and still fall short of the bar).
        let large_value = |half: Team| {
            large_seeds.iter().filter(|seed| seed.half == half).count() as u32
                * rules.large_seed_value
        };

        MatchState {
            tick: 0,
            agents,
            red_seeds_total: red_caches.len() as u32 + large_value(Team::Red),
            blue_seeds_total: blue_caches.len() as u32 + large_value(Team::Blue),
            large_seeds,
            red_caches,
            blue_caches,
            red_jelly: board.initial_jelly(Team::Red).iter().copied().collect(),
            blue_jelly: board.initial_jelly(Team::Blue).iter().copied().collect(),
            red_jelly_regrowing: BTreeMap::new(),
            blue_jelly_regrowing: BTreeMap::new(),
            score: Score::default(),
            kills: Kills::default(),
            result: None,
        }
    }

    /// The live caches on `team`'s half (the caches `team`'s opponent raids).
    pub fn caches(&self, team: Team) -> &BTreeSet<Pos> {
        match team {
            Team::Red => &self.red_caches,
            Team::Blue => &self.blue_caches,
        }
    }

    /// Mutable access to the live caches on `team`'s half.
    pub fn caches_mut(&mut self, team: Team) -> &mut BTreeSet<Pos> {
        match team {
            Team::Red => &mut self.red_caches,
            Team::Blue => &mut self.blue_caches,
        }
    }

    /// The active jelly nodes on `team`'s half.
    pub fn jelly(&self, team: Team) -> &BTreeSet<Pos> {
        match team {
            Team::Red => &self.red_jelly,
            Team::Blue => &self.blue_jelly,
        }
    }

    /// Mutable access to the active jelly nodes on `team`'s half.
    pub fn jelly_mut(&mut self, team: Team) -> &mut BTreeSet<Pos> {
        match team {
            Team::Red => &mut self.red_jelly,
            Team::Blue => &mut self.blue_jelly,
        }
    }

    /// Mutable access to the regrowing (consumed) jelly nodes on `team`'s half.
    pub fn jelly_regrowing_mut(&mut self, team: Team) -> &mut BTreeMap<Pos, u32> {
        match team {
            Team::Red => &mut self.red_jelly_regrowing,
            Team::Blue => &mut self.blue_jelly_regrowing,
        }
    }

    /// The original cache total on `team`'s half — the denominator of the sweep
    /// test against `team`.
    pub fn seeds_total(&self, team: Team) -> u32 {
        match team {
            Team::Red => self.red_seeds_total,
            Team::Blue => self.blue_seeds_total,
        }
    }

    /// Whether the match is over.
    pub fn is_over(&self) -> bool {
        self.result.is_some()
    }
}
