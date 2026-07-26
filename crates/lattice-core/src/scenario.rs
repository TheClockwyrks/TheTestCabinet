//! The `scenario` input: a factory blueprint, a tick count, and a snapshot
//! schedule.
//!
//! A scenario is what crosses the wasm boundary into a submission. These types
//! derive serde (the JSON wire form) and, behind the `schema` feature, schemars
//! (so `schemas/scenario.json` is generated from the very type the engine
//! deserializes and can never drift). The illustrative JSON in the architecture
//! doc is authoritative: field names are `snake_case`, `dir` is uppercase
//! `"N"|"S"|"E"|"W"`, `lane` is `"left"|"right"|"both"`, and an entity's `type`,
//! `tier`, `recipe`, and `item` are lowercase kebab strings.
//!
//! Entities are listed in **placement order**, which is also the order they
//! appear in the [output](crate::state). The top-level `Scenario` and `Grid`
//! reject unknown fields so a typo there is a parse error.

use serde::{Deserialize, Serialize};

use crate::prototypes;

/// The wire `version` every scenario must declare. Bumped only by a breaking
/// change to the scenario or state shape.
pub const SCENARIO_VERSION: u32 = 1;

/// A cardinal direction. The grid is `x` rightward (E = +x) and `y` downward
/// (S = +y); the canonical orientation in any reference material is flow-east.
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
}

impl Dir {
    /// The unit step `(dx, dy)` this direction advances one tile.
    pub fn delta(self) -> (i32, i32) {
        match self {
            Dir::N => (0, -1),
            Dir::S => (0, 1),
            Dir::E => (1, 0),
            Dir::W => (-1, 0),
        }
    }

    /// The tile one step in this direction from `(x, y)`.
    pub fn step(self, x: i32, y: i32) -> (i32, i32) {
        let (dx, dy) = self.delta();
        (x + dx, y + dy)
    }
}

/// Which lane(s) of a belt a fixture acts on. `left`/`right` are relative to the
/// direction of travel: for an E-facing belt the left lane is the `-y` (north)
/// side and the right lane is the `+y` (south) side; the other facings rotate
/// that convention. `both` means act on left then right independently.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "lowercase")]
pub enum Lane {
    /// The left lane relative to the direction of travel.
    Left,
    /// The right lane relative to the direction of travel.
    Right,
    /// Both lanes (left then right, independently).
    Both,
}

/// The grid the scenario plays out on. Each tile holds at most one entity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct Grid {
    /// Grid width in tiles.
    pub width: i32,
    /// Grid height in tiles.
    pub height: i32,
}

/// One placed entity. Internally tagged on `type`, so the JSON reads
/// `{ "type": "belt", "x": .., .. }`. Each variant carries only its
/// type-specific fields (serde's internally-tagged representation does not
/// support per-variant `deny_unknown_fields`, so an entity is matched on the
/// fields it declares).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Entity {
    /// A two-lane transport belt occupying one tile, facing `dir`, of belt
    /// `tier`.
    Belt {
        x: i32,
        y: i32,
        dir: Dir,
        /// A belt tier name from the prototype table (`"slow"`/`"fast"`/
        /// `"express"`).
        tier: String,
    },
    /// A two-tile balancer. Anchored at `(x, y)`; its second tile is one step
    /// perpendicular-clockwise of `dir` (for E/W: `(x, y+1)`; for N/S:
    /// `(x+1, y)`).
    Splitter { x: i32, y: i32, dir: Dir },
    /// A swing arm. Picks up from the tile *behind* it and drops onto the tile
    /// *in front*, set by `dir`.
    /// There is one kind of inserter, so this carries no tier — every inserter
    /// swings at the single `SWING` constant from the prototype table.
    Inserter { x: i32, y: i32, dir: Dir },
    /// A 3×3 crafting machine anchored at `(x, y)`, covering `(x..x+3, y..y+3)`.
    Assembler {
        x: i32,
        y: i32,
        /// A recipe name from the prototype table (`"iron-gear"`, …).
        recipe: String,
    },
    /// A test fixture that emits `item` onto `lane` of the downstream belt once
    /// every `period` ticks, respecting compaction (it stalls when the gap is too
    /// small). Infinite supply.
    Source {
        x: i32,
        y: i32,
        dir: Dir,
        /// The item id this source emits (from the prototype item table).
        item: String,
        /// Which lane(s) of the downstream belt to emit onto.
        lane: Lane,
        /// Ticks between emissions. An emission is attempted on every tick `t`
        /// with `t > 0 && t % period == 0`.
        period: u32,
    },
    /// A test fixture that consumes and counts every item that reaches it.
    Sink { x: i32, y: i32, dir: Dir },
}

impl Entity {
    /// The anchor tile `(x, y)` of this entity.
    pub fn anchor(&self) -> (i32, i32) {
        match self {
            Entity::Belt { x, y, .. }
            | Entity::Splitter { x, y, .. }
            | Entity::Inserter { x, y, .. }
            | Entity::Assembler { x, y, .. }
            | Entity::Source { x, y, .. }
            | Entity::Sink { x, y, .. } => (*x, *y),
        }
    }
}

/// The full scenario: blueprint, run length, and snapshot schedule.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct Scenario {
    /// The wire version; must equal [`SCENARIO_VERSION`].
    pub version: u32,
    /// The tile grid.
    pub grid: Grid,
    /// Simulate this many ticks from an empty start.
    pub ticks: u64,
    /// The ticks at which to emit canonical state. Strictly ascending, each
    /// `> 0` and `<= ticks`.
    pub snapshots: Vec<u64>,
    /// The placed entities, in placement order (= output order).
    pub entities: Vec<Entity>,
}

/// Why a scenario failed validation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScenarioError {
    /// `version` was not [`SCENARIO_VERSION`].
    UnsupportedVersion(u32),
    /// The grid had a non-positive dimension.
    BadGrid { width: i32, height: i32 },
    /// `snapshots` was empty.
    NoSnapshots,
    /// A snapshot tick was `0`, exceeded `ticks`, or was not strictly greater
    /// than the previous one.
    BadSnapshots,
    /// A belt referenced an unknown tier.
    UnknownBeltTier(String),
    /// An assembler referenced an unknown recipe.
    UnknownRecipe(String),
    /// A source referenced an unknown item.
    UnknownItem(String),
    /// A source declared `period == 0` (would emit every tick / divide by zero).
    ZeroPeriod,
    /// An entity anchor lay outside the grid.
    OffGrid { x: i32, y: i32 },
    /// The scenario JSON failed to parse.
    Parse(String),
}

impl std::fmt::Display for ScenarioError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ScenarioError::UnsupportedVersion(v) => {
                write!(
                    f,
                    "unsupported scenario version {v} (expected {SCENARIO_VERSION})"
                )
            }
            ScenarioError::BadGrid { width, height } => {
                write!(f, "grid dimensions must be positive (got {width}x{height})")
            }
            ScenarioError::NoSnapshots => write!(f, "scenario declares no snapshots"),
            ScenarioError::BadSnapshots => {
                write!(f, "snapshots must be strictly ascending, each in 1..=ticks")
            }
            ScenarioError::UnknownBeltTier(t) => write!(f, "unknown belt tier {t:?}"),
            ScenarioError::UnknownRecipe(r) => write!(f, "unknown recipe {r:?}"),
            ScenarioError::UnknownItem(i) => write!(f, "unknown item {i:?}"),
            ScenarioError::ZeroPeriod => write!(f, "a source's period must be positive"),
            ScenarioError::OffGrid { x, y } => write!(f, "entity anchor ({x},{y}) is off the grid"),
            ScenarioError::Parse(e) => write!(f, "scenario parse error: {e}"),
        }
    }
}

impl std::error::Error for ScenarioError {}

impl Scenario {
    /// Parse a scenario from JSON bytes and validate it. This is the single entry
    /// the host and CLI use — a returned `Scenario` is guaranteed to satisfy
    /// every rule [`validate`](Scenario::validate) checks.
    pub fn parse(bytes: &[u8]) -> Result<Scenario, ScenarioError> {
        let scenario: Scenario =
            serde_json::from_slice(bytes).map_err(|e| ScenarioError::Parse(e.to_string()))?;
        scenario.validate()?;
        Ok(scenario)
    }

    /// Validate the structural rules serde cannot express: a supported version, a
    /// positive grid, a non-empty strictly-ascending snapshot schedule within the
    /// run, every prototype reference resolvable, and every anchor on the grid.
    pub fn validate(&self) -> Result<(), ScenarioError> {
        if self.version != SCENARIO_VERSION {
            return Err(ScenarioError::UnsupportedVersion(self.version));
        }
        if self.grid.width <= 0 || self.grid.height <= 0 {
            return Err(ScenarioError::BadGrid {
                width: self.grid.width,
                height: self.grid.height,
            });
        }
        if self.snapshots.is_empty() {
            return Err(ScenarioError::NoSnapshots);
        }
        let mut prev = 0u64;
        for &t in &self.snapshots {
            if t == 0 || t > self.ticks || t <= prev {
                return Err(ScenarioError::BadSnapshots);
            }
            prev = t;
        }
        for entity in &self.entities {
            let (x, y) = entity.anchor();
            if x < 0 || y < 0 || x >= self.grid.width || y >= self.grid.height {
                return Err(ScenarioError::OffGrid { x, y });
            }
            match entity {
                Entity::Belt { tier, .. } => {
                    if prototypes::belt_speed(tier).is_none() {
                        return Err(ScenarioError::UnknownBeltTier(tier.clone()));
                    }
                }
                Entity::Assembler { recipe, .. } => {
                    if prototypes::recipe(recipe).is_none() {
                        return Err(ScenarioError::UnknownRecipe(recipe.clone()));
                    }
                }
                Entity::Source { item, period, .. } => {
                    if prototypes::item_index(item).is_none() {
                        return Err(ScenarioError::UnknownItem(item.clone()));
                    }
                    if *period == 0 {
                        return Err(ScenarioError::ZeroPeriod);
                    }
                }
                // Nothing to validate: these carry no prototype reference.
                Entity::Splitter { .. } | Entity::Inserter { .. } | Entity::Sink { .. } => {}
            }
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "scenario.test.rs"]
mod tests;
