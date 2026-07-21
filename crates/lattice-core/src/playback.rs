//! Browser-playback driver: a scenario stepped one tick at a time, emitting the
//! canonical state each tick for a renderer to draw.
//!
//! This is the engine half of the [browser
//! visualization](../../../apps/docs/src/content/docs/testing/performance/lattice/architecture.md):
//! the site ships no second simulation, it loads *this* crate compiled to
//! `wasm32-unknown-unknown` and steps it. The renderer holds **no rules of its
//! own** — every position, phase, and count it draws comes from here.
//!
//! It is deliberately separate from the `wasm32`-only `abi` shims
//! that wrap it, so the stepping logic is ordinary Rust that compiles and is
//! tested on the host. The ABI adds only the C boundary and a module global.
//!
//! ## Why stepping, and not the recorded snapshots
//!
//! A performance run records only the scenario's *scheduled* snapshots — three of
//! them, thousands of ticks apart (`cases/small.json` snapshots a 50,000-tick run
//! at 12,500 / 25,000 / 50,000). Between two of those, items are spawned,
//! consumed, and re-routed, so there is nothing to interpolate across: an
//! animation has to re-simulate. Because the engine is deterministic and a
//! submission is correct only when it reproduced these very checksums, re-stepping
//! the oracle reconstructs exactly the factory the graded run computed.
//!
//! [`Snapshot::checksum`] rides along on every step, so a renderer can *prove* it:
//! at a scheduled snapshot tick the stepped checksum must equal the one the run
//! recorded. That check is the analogue of Foray's replay-drift gate — it is what
//! makes the frames "the run's factory" rather than merely a plausible one.

use crate::scenario::{Entity, Grid, Scenario, ScenarioError};
use crate::state::Snapshot;
use crate::world::World;

/// A loaded scenario positioned for stepping.
#[derive(Debug, Clone)]
pub struct Playback {
    /// Kept so [`Playback::reset`] can rebuild the world without re-parsing.
    scenario: Scenario,
    world: World,
    /// The static layout JSON, serialized once at load.
    board: Vec<u8>,
    /// The most recent step's snapshot JSON, held so the ABI can hand out a
    /// pointer that stays valid until the next step.
    out: Vec<u8>,
}

impl Playback {
    /// Parse and validate a scenario, positioned at tick 0 (before any advance).
    ///
    /// Goes through [`Scenario::parse`] — the same entry the host and CLI use — so
    /// playback accepts exactly the scenarios the graded path does. Validation is
    /// not optional: an off-grid entity or a bad snapshot schedule would otherwise
    /// surface as a panic deep in the world build, which across the C ABI is an
    /// unrecoverable wasm trap rather than a failed load.
    pub fn load(json: &str) -> Result<Playback, ScenarioError> {
        Ok(Playback::from_scenario(Scenario::parse(json.as_bytes())?))
    }

    /// Build from an already-validated scenario.
    fn from_scenario(scenario: Scenario) -> Playback {
        let world = World::new(&scenario);
        let board = serde_json::to_vec(&BoardJson::build(&scenario, &world))
            // The board is built from types this crate owns and every field is
            // representable in JSON, so this cannot fail; an empty board reads as
            // a load failure to the caller rather than panicking across the ABI.
            .unwrap_or_default();
        Playback {
            scenario,
            world,
            board,
            out: Vec::new(),
        }
    }

    /// The static layout the renderer draws once: grid, run length, snapshot
    /// schedule, and every entity with its resolved footprint tiles.
    pub fn board(&self) -> &[u8] {
        &self.board
    }

    /// Advance exactly one tick and return that tick's canonical state as JSON, or
    /// `None` once the scenario's `ticks` are exhausted.
    ///
    /// One tick per call — *not* one displayed frame. The renderer runs its own
    /// continuous clock and interpolates between the ticks it has pulled; drawing
    /// one tick per frame makes a packed belt appear frozen, because the item at a
    /// given position each tick is a *different* item advancing into it.
    pub fn step(&mut self) -> Option<&[u8]> {
        if self.world.tick >= self.scenario.ticks {
            return None;
        }
        self.world.advance();
        let snapshot = self.world.snapshot();
        self.out = serde_json::to_vec(&snapshot).unwrap_or_default();
        Some(&self.out)
    }

    /// Rewind to tick 0 so playback can loop or re-seek from the start.
    pub fn reset(&mut self) {
        self.world = World::new(&self.scenario);
        self.out.clear();
    }

    /// The current tick (`0` before the first [`step`](Playback::step)).
    pub fn tick(&self) -> u64 {
        self.world.tick
    }

    /// The canonical state at the current tick, without advancing. Lets a caller
    /// read tick 0 (the empty factory) before stepping.
    pub fn snapshot(&self) -> Snapshot {
        self.world.snapshot()
    }
}

/// The static layout a renderer draws once, then overlays each tick's state onto.
#[derive(serde::Serialize)]
struct BoardJson<'a> {
    /// The scenario wire version, so a renderer can refuse a shape it predates.
    version: u32,
    grid: &'a Grid,
    /// Total ticks the scenario runs for — the playback timeline's length.
    ticks: u64,
    /// The scheduled snapshot ticks. A renderer compares its stepped checksum
    /// against the run's recorded one at exactly these ticks.
    snapshots: &'a [u64],
    entities: Vec<BoardEntity<'a>>,
}

/// One placed entity plus the tiles it actually occupies.
#[derive(serde::Serialize)]
struct BoardEntity<'a> {
    /// Flattened, so an entity reads as `{ "type": "belt", "x": .., "tiles": .. }`
    /// — the same internally-tagged shape the scenario uses, which a renderer
    /// already has to understand.
    #[serde(flatten)]
    entity: &'a Entity,
    /// Every tile this entity covers, ascending. One for a belt, two for a
    /// splitter, nine for an assembler — resolved by the engine so the renderer
    /// never re-derives placement geometry.
    tiles: Vec<[i32; 2]>,
    /// For an inserter, the ticks its arm is held between picking an item up and
    /// dropping it — its tier's `SWING`. `None` for every other entity.
    ///
    /// A snapshot reports `swing_left` as a countdown, which is only meaningful
    /// against the total it counts down from. Resolving that here keeps the tier
    /// table on the engine's side of the boundary: a renderer that hard-coded it
    /// would hold a rule, and would silently drift if a tier's swing ever changed.
    #[serde(skip_serializing_if = "Option::is_none")]
    swing: Option<u16>,
    /// For a belt, the position units an unobstructed item on it advances per
    /// tick — its tier's `SPEED`. `None` for every other entity.
    ///
    /// Resolved here for the same reason as `swing`: a renderer interpolating
    /// between two ticks has to know how far an item was *expected* to travel in
    /// order to match each item to its own next-tick position, and hard-coding
    /// the tier table on the renderer's side would put a rule there and let it
    /// drift silently if a tier's speed ever changed.
    #[serde(skip_serializing_if = "Option::is_none")]
    speed: Option<u32>,
}

impl<'a> BoardJson<'a> {
    fn build(scenario: &'a Scenario, world: &World) -> BoardJson<'a> {
        let footprints = world.footprints();
        let entities = scenario
            .entities
            .iter()
            .enumerate()
            .map(|(index, entity)| BoardEntity {
                entity,
                // `World` builds its machines parallel to the scenario's entities,
                // so the index lines up; default to empty rather than panicking if
                // that ever stops holding.
                tiles: footprints
                    .get(index)
                    .map(|tiles| tiles.iter().map(|&(x, y)| [x, y]).collect())
                    .unwrap_or_default(),
                swing: match entity {
                    Entity::Inserter { .. } => Some(crate::prototypes::INSERTER_SWING),
                    _ => None,
                },
                speed: match entity {
                    Entity::Belt { tier, .. } => crate::prototypes::belt_speed(tier),
                    _ => None,
                },
            })
            .collect();
        BoardJson {
            version: scenario.version,
            grid: &scenario.grid,
            ticks: scenario.ticks,
            snapshots: &scenario.snapshots,
            entities,
        }
    }
}

#[cfg(test)]
#[path = "playback.test.rs"]
mod tests;
