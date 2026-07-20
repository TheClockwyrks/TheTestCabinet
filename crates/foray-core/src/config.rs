//! The tunable rule constants and per-match configuration.
//!
//! These are the levers the overview calls "proposed defaults — the exact
//! constants are tunable in the specs" (the carry-weight speed model, jelly
//! immunity `J`, the timestep, and `max_ticks`). They are data, not hard-coded
//! literals, so the manifest/specs can retune the game without touching the
//! engine.

use serde::{Deserialize, Serialize};

use crate::board::BoardParams;

/// The rule constants that shape play.
///
/// # The carry-weight speed model
///
/// Movement is a **fixed-point speed accumulator** rather than a one-tile-per-
/// tick step: each agent earns `move_speed` charge points per tick and steps one
/// tile once it has banked [`move_resolution`](Rules::move_resolution) of them.
/// Expressing speed in sub-tile charge is what lets a raider be *slightly* faster
/// than a soldier on a tile-locked board — without it, a soldier already moving
/// every tick could never be outrun (Pac-Man's edge over the ghosts, ported to a
/// grid).
///
/// - A **soldier** earns [`soldier_speed`](Rules::soldier_speed) per tick, set
///   just below `move_resolution`, so it moves slightly slower than one tile/tick
///   — the headroom a raider needs to be faster.
/// - A **light raider** (carrying at most [`light_load`](Rules::light_load))
///   earns the full `move_resolution` per tick: it moves *every* tick, the board
///   speed cap, so a light raider always out-paces a soldier. Keeping the first
///   few seeds free of any penalty is deliberate — otherwise a raider would slow
///   the instant it ate anything and a colony could never make progress.
/// - Past `light_load`, a raider loses
///   `move_resolution - soldier_speed` charge per extra seed. That makes
///   `light_load + 1` seeds match the soldier exactly, `light_load + 2` slower by
///   the same margin a light raider was *faster*, and so on down to a floor of
///   [`min_speed`](Rules::min_speed) (a very heavy raider crawls, never freezes).
///
/// `load` is both your score and your vulnerability: the heavier you bank toward,
/// the easier you are to run down.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rules {
    /// Charge points an agent must bank to step one tile. Higher = finer speed
    /// resolution. A light raider earning exactly this much per tick moves every
    /// tick (the one-tile-per-tick cap).
    #[serde(default = "default_move_resolution")]
    pub move_resolution: u32,
    /// Charge a soldier earns per tick. Below [`move_resolution`](Rules::move_resolution)
    /// so soldiers move just under one tile/tick; the difference is exactly a
    /// light raider's speed edge *and* the per-seed carry penalty.
    #[serde(default = "default_soldier_speed")]
    pub soldier_speed: u32,
    /// Loads at or below this carry no speed penalty — a light raider moves every
    /// tick. The soldier-speed crossover is at `light_load + 1`.
    #[serde(default = "default_light_load")]
    pub light_load: u32,
    /// Floor on a laden raider's per-tick charge, so an over-loaded raider crawls
    /// rather than freezing entirely.
    #[serde(default = "default_min_speed")]
    pub min_speed: u32,
    /// Jelly immunity window `J`: ticks of immunity granted by a royal-jelly node.
    /// While it lasts the eater cannot be tagged *and* tags any non-immune enemy it
    /// meets — see [`crate::tick`] for the single rule both halves fall out of.
    #[serde(default = "default_jelly_immunity_ticks")]
    pub jelly_immunity_ticks: u32,
    /// Ticks a consumed royal-jelly node takes to grow back at the same tile.
    /// Jelly is the only counter to a defender parked on a cache (an immune raider
    /// walks through it), so it has to be *renewable*: a one-shot node lets a
    /// camper deny a seed for the rest of the match once both nodes are spent.
    #[serde(default = "default_jelly_respawn_ticks")]
    pub jelly_respawn_ticks: u32,
    /// What one large seed is worth when banked — **and** what it weighs while
    /// carried. The two are the same number on purpose. At `3` it lands exactly on
    /// [`light_load`](Rules::light_load): a raider carrying nothing but a large seed
    /// is still light, so it still out-runs a soldier and a clean snatch-and-run
    /// works — but one ordinary seed on top of it tips the raider to soldier speed.
    /// Worth more than it weighs and it would be a free pickup; heavier than
    /// `light_load` and a raider could never out-run the defence home with one.
    #[serde(default = "default_large_seed_value")]
    pub large_seed_value: u32,
    /// Ticks between a large seed's drift steps. It walks one tile at a time toward
    /// the border along a fixed path through the maze, whether or not anyone stands
    /// on it — which is what stops a defender from simply parking on it: the seed is
    /// a moving target, not a tile to squat.
    ///
    /// It drifts until the **border** stops it — the last column of its own half —
    /// and no further: a seed is stolen by a raid, never conceded by the clock. So an
    /// ignored seed ends up sitting on the seam, one step from an enemy raider who
    /// can grab it and bank it by stepping straight back. Leaving it there is a
    /// choice, and an expensive one.
    #[serde(default = "default_large_seed_drift_ticks")]
    pub large_seed_drift_ticks: u32,
    /// Consecutive ticks an ant must stand on its **own** large seed to recall it to
    /// its spawn tile. The cost of a recall is the walk out and the walk back.
    #[serde(default = "default_large_seed_recall_ticks")]
    pub large_seed_recall_ticks: u32,
    /// How far a large seed must have drifted (in steps along its path) before it
    /// can be recalled at all. This closes two degenerate holes at once: an ant
    /// cannot stand on the spawn tile to pin the seed there, and — the subtler one —
    /// cannot camp the *first* tile of the drift path and yo-yo the seed back and
    /// forth at near-zero cost, keeping it forever out of reach. The defence has to
    /// let the seed get out before it can pull it back.
    #[serde(default = "default_large_seed_recall_min_steps")]
    pub large_seed_recall_min_steps: u32,
}

fn default_move_resolution() -> u32 {
    8
}
fn default_soldier_speed() -> u32 {
    7
}
fn default_light_load() -> u32 {
    3
}
fn default_min_speed() -> u32 {
    1
}
fn default_jelly_immunity_ticks() -> u32 {
    40
}
fn default_jelly_respawn_ticks() -> u32 {
    1_200
}
fn default_large_seed_value() -> u32 {
    3
}
fn default_large_seed_drift_ticks() -> u32 {
    300
}
fn default_large_seed_recall_ticks() -> u32 {
    150
}
fn default_large_seed_recall_min_steps() -> u32 {
    3
}

impl Default for Rules {
    fn default() -> Rules {
        Rules {
            move_resolution: default_move_resolution(),
            soldier_speed: default_soldier_speed(),
            light_load: default_light_load(),
            min_speed: default_min_speed(),
            jelly_immunity_ticks: default_jelly_immunity_ticks(),
            jelly_respawn_ticks: default_jelly_respawn_ticks(),
            large_seed_value: default_large_seed_value(),
            large_seed_drift_ticks: default_large_seed_drift_ticks(),
            large_seed_recall_ticks: default_large_seed_recall_ticks(),
            large_seed_recall_min_steps: default_large_seed_recall_min_steps(),
        }
    }
}

/// The simulation-loop configuration: the faked timestep and the hard tick cap.
/// Separate from [`Rules`] because these bound the *loop*, not play, and map
/// directly onto the manifest's `[simulation]` table.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Simulation {
    /// The fixed, faked delta handed to game logic each tick (milliseconds).
    pub timestep_ms: u32,
    /// Hard cap on match length; reaching it ends the match on score (a draw if
    /// tied). At a 16 ms timestep the overview's 10-minute cap is 37,500 ticks.
    pub max_ticks: u32,
}

impl Default for Simulation {
    fn default() -> Simulation {
        Simulation {
            timestep_ms: 16,
            // 10 minutes of game time at 16 ms/tick.
            max_ticks: 37_500,
        }
    }
}

/// The serde-able board-generation parameters recorded in a replay, mirroring
/// [`BoardParams`] (which is a plain config struct without serde so the board
/// module stays serialization-free). Defaulting to the shipped `mirror-32x16`
/// values means a replay that omits the block regenerates that exact maze.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct BoardParamsSerde {
    pub width: i32,
    pub height: i32,
    pub seeds_per_half: usize,
    /// Defaulted so a replay written before large seeds existed still loads and
    /// regenerates its maze — it simply has none.
    #[serde(default = "default_large_seeds_per_half")]
    pub large_seeds_per_half: usize,
    pub jelly_per_half: usize,
    pub wall_density_tenths: u32,
}

fn default_large_seeds_per_half() -> usize {
    BoardParams::default().large_seeds_per_half
}

impl Default for BoardParamsSerde {
    fn default() -> BoardParamsSerde {
        BoardParams::default().into()
    }
}

impl From<BoardParams> for BoardParamsSerde {
    fn from(params: BoardParams) -> BoardParamsSerde {
        BoardParamsSerde {
            width: params.width,
            height: params.height,
            seeds_per_half: params.seeds_per_half,
            large_seeds_per_half: params.large_seeds_per_half,
            jelly_per_half: params.jelly_per_half,
            wall_density_tenths: params.wall_density_tenths,
        }
    }
}

impl From<BoardParamsSerde> for BoardParams {
    fn from(params: BoardParamsSerde) -> BoardParams {
        BoardParams {
            width: params.width,
            height: params.height,
            seeds_per_half: params.seeds_per_half,
            large_seeds_per_half: params.large_seeds_per_half,
            jelly_per_half: params.jelly_per_half,
            wall_density_tenths: params.wall_density_tenths,
        }
    }
}
