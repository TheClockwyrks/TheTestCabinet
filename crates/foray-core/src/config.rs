//! The tunable rule constants and per-match configuration.
//!
//! These are the levers the overview calls "proposed defaults — the exact
//! constants are tunable in the specs" (carry-weight divisor `W`, jelly immunity
//! `J`, the timestep, and `max_ticks`). They are data, not hard-coded literals,
//! so the manifest/specs can retune the game without touching the engine.

use serde::{Deserialize, Serialize};

use crate::board::BoardParams;

/// The rule constants that shape play. Defaults match the overview's proposed
/// values (lead decision 5).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rules {
    /// Carry-weight divisor `W`: a raider carrying `load` moves once every
    /// `1 + floor(load / W)` ticks. Larger `W` = lighter penalty per seed.
    pub carry_weight_divisor: u32,
    /// Jelly immunity window `J`: ticks of tag-immunity granted by a royal-jelly
    /// node.
    pub jelly_immunity_ticks: u32,
}

impl Default for Rules {
    fn default() -> Rules {
        Rules {
            carry_weight_divisor: 3,
            jelly_immunity_ticks: 40,
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
    pub jelly_per_half: usize,
    pub wall_density_tenths: u32,
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
            jelly_per_half: params.jelly_per_half,
            wall_density_tenths: params.wall_density_tenths,
        }
    }
}
