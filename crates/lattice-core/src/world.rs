//! The live, fixed-point world built from a [`Scenario`](crate::scenario): the
//! grid of entities, the items moving on belt lanes, and the machine state.
//!
//! This is the reference engine's working representation. It is written for
//! **clarity and canonical correctness**, not minimal fuel — it is the oracle,
//! and reproducing its *outputs* with far less work is the model's task. Items on
//! a lane are stored as an explicit list of `(pos, item)` pairs ordered from the
//! output end backward (ascending `pos`); the per-tick advance in [`crate::tick`]
//! walks that list and applies the compaction clamp directly. An efficient
//! submission would instead store gaps and update lines in constant time — but
//! the *answer* it must reproduce is exactly what this straightforward model
//! produces.
//!
//! Geometry conventions (pinned in `specs/prototypes.md`):
//! - `x` is rightward (E = +x), `y` is downward (S = +y).
//! - A lane position is units from the tile's **output end** (the downstream edge
//!   in the direction of travel), so it lives in `0..TILE` and "forward"
//!   decreases it.
//! - For a belt facing `dir`, the **left** lane is the side 90° counter-clockwise
//!   of travel and the **right** lane is 90° clockwise. For E-facing: left = the
//!   `-y` (north) side, right = the `+y` (south) side.

use std::collections::HashMap;

use crate::prototypes::{self, Recipe};
use crate::scenario::{Dir, Entity, Lane, Scenario};
use crate::state::{
    AssemblerState, BeltItem, BeltState, EntityState, InserterPhase, InserterState, SinkState,
    Snapshot, SplitterState,
};

/// Which of a belt's two lanes. Stored as an index so it can address an array.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LaneSide {
    Left,
    Right,
}

impl LaneSide {
    /// The array index of this lane (`left = 0`, `right = 1`).
    pub fn index(self) -> usize {
        match self {
            LaneSide::Left => 0,
            LaneSide::Right => 1,
        }
    }

    /// The other lane.
    pub fn other(self) -> LaneSide {
        match self {
            LaneSide::Left => LaneSide::Right,
            LaneSide::Right => LaneSide::Left,
        }
    }
}

/// One item on a lane: its position (units from the output end) and its stable
/// item index. Positions on a lane are kept ascending (output end first).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LaneItem {
    pub pos: u32,
    pub item: u16,
}

/// The mutable state of one entity in the live world. Parallel to the scenario's
/// `entities`, so index `i` here is index `i` there and in the output.
#[derive(Debug, Clone)]
pub enum Machine {
    Belt(Belt),
    Splitter(Splitter),
    Inserter(Inserter),
    Assembler(Assembler),
    Source(Source),
    Sink(Sink),
}

/// A two-lane belt. Each lane's items are ordered from the output end backward.
#[derive(Debug, Clone)]
pub struct Belt {
    pub x: i32,
    pub y: i32,
    pub dir: Dir,
    /// Units an unobstructed item advances per tick.
    pub speed: u32,
    /// `[left, right]` lanes; each a list of items ascending by `pos`.
    pub lanes: [Vec<LaneItem>; 2],
}

/// A two-tile balancer. Round-robin pull from its two inputs, round-robin push to
/// its two outputs, lanes preserved. Holds no items between ticks.
#[derive(Debug, Clone)]
pub struct Splitter {
    pub x: i32,
    pub y: i32,
    pub dir: Dir,
    /// Which input to pull from next (`0`/`1`).
    pub rr_in: u8,
    /// Which output to push to next (`0`/`1`).
    pub rr_out: u8,
}

/// A swing arm running a small state machine on an integer timer.
#[derive(Debug, Clone)]
pub struct Inserter {
    pub x: i32,
    pub y: i32,
    pub dir: Dir,
    /// Ticks held between pickup and drop.
    pub swing: u16,
    /// The held item's index while swinging.
    pub held: Option<u16>,
    /// Ticks remaining in the current swing (`0` while idle).
    pub swing_left: u16,
}

/// A 3×3 crafting machine.
#[derive(Debug, Clone)]
pub struct Assembler {
    pub x: i32,
    pub y: i32,
    pub recipe: &'static Recipe,
    /// Input buffer: item index → count.
    pub inputs: HashMap<u16, u16>,
    /// Output buffer: item index → count.
    pub output: HashMap<u16, u16>,
    /// Ticks remaining in the current craft (`0` when idle/not crafting).
    pub craft_left: u16,
}

/// A periodic emitter fixture.
#[derive(Debug, Clone)]
pub struct Source {
    pub x: i32,
    pub y: i32,
    pub dir: Dir,
    /// The item index this source emits.
    pub item: u16,
    /// Which lane(s) to emit onto.
    pub lane: Lane,
    /// Ticks between emissions.
    pub period: u32,
}

/// A consume-everything fixture.
#[derive(Debug, Clone)]
pub struct Sink {
    pub x: i32,
    pub y: i32,
    pub dir: Dir,
    /// Item index → total consumed.
    pub consumed: HashMap<u16, u64>,
}

/// The live world: the machines (in scenario order), the current tick, and a tile
/// lookup so the tick advance can resolve neighbours (downstream belt, pickup /
/// drop tiles, the assembler covering a tile).
#[derive(Debug, Clone)]
pub struct World {
    /// Current tick (`0` before any advance).
    pub tick: u64,
    /// Grid width/height (for off-grid neighbour checks).
    pub width: i32,
    pub height: i32,
    /// The machines, parallel to the scenario's `entities`.
    pub machines: Vec<Machine>,
    /// Anchor / footprint tile → machine index. A 3×3 assembler registers all
    /// nine of its tiles; a 2-tile splitter both of its.
    tiles: HashMap<(i32, i32), usize>,
}

impl World {
    /// Build the live world from a (validated) scenario.
    pub fn new(scenario: &Scenario) -> World {
        let mut machines = Vec::with_capacity(scenario.entities.len());
        let mut tiles: HashMap<(i32, i32), usize> = HashMap::new();

        for (index, entity) in scenario.entities.iter().enumerate() {
            let machine = match entity {
                Entity::Belt { x, y, dir, tier } => {
                    tiles.insert((*x, *y), index);
                    Machine::Belt(Belt {
                        x: *x,
                        y: *y,
                        dir: *dir,
                        speed: prototypes::belt_speed(tier).expect("validated tier"),
                        lanes: [Vec::new(), Vec::new()],
                    })
                }
                Entity::Splitter { x, y, dir } => {
                    // Footprint: the anchor and one step perpendicular-clockwise
                    // of `dir` (for E/W: (x, y+1); for N/S: (x+1, y)).
                    let (sx, sy) = splitter_second_tile(*x, *y, *dir);
                    tiles.insert((*x, *y), index);
                    tiles.insert((sx, sy), index);
                    Machine::Splitter(Splitter {
                        x: *x,
                        y: *y,
                        dir: *dir,
                        rr_in: 0,
                        rr_out: 0,
                    })
                }
                Entity::Inserter { x, y, dir, tier } => {
                    tiles.insert((*x, *y), index);
                    Machine::Inserter(Inserter {
                        x: *x,
                        y: *y,
                        dir: *dir,
                        swing: prototypes::inserter_swing(tier).expect("validated tier"),
                        held: None,
                        swing_left: 0,
                    })
                }
                Entity::Assembler { x, y, recipe } => {
                    for dy in 0..3 {
                        for dx in 0..3 {
                            tiles.insert((*x + dx, *y + dy), index);
                        }
                    }
                    Machine::Assembler(Assembler {
                        x: *x,
                        y: *y,
                        recipe: prototypes::recipe(recipe).expect("validated recipe"),
                        inputs: HashMap::new(),
                        output: HashMap::new(),
                        craft_left: 0,
                    })
                }
                Entity::Source {
                    x,
                    y,
                    dir,
                    item,
                    lane,
                    period,
                } => {
                    tiles.insert((*x, *y), index);
                    Machine::Source(Source {
                        x: *x,
                        y: *y,
                        dir: *dir,
                        item: prototypes::item_index(item).expect("validated item"),
                        lane: *lane,
                        period: *period,
                    })
                }
                Entity::Sink { x, y, dir } => {
                    tiles.insert((*x, *y), index);
                    Machine::Sink(Sink {
                        x: *x,
                        y: *y,
                        dir: *dir,
                        consumed: HashMap::new(),
                    })
                }
            };
            machines.push(machine);
        }

        World {
            tick: 0,
            width: scenario.grid.width,
            height: scenario.grid.height,
            machines,
            tiles,
        }
    }

    /// The machine index occupying `(x, y)`, if any.
    pub fn machine_at(&self, x: i32, y: i32) -> Option<usize> {
        self.tiles.get(&(x, y)).copied()
    }

    /// Every machine's footprint tiles, parallel to the scenario's `entities` — a
    /// 3×3 assembler yields nine, a two-tile splitter two, everything else one.
    ///
    /// This exists so a *renderer* never re-derives placement geometry. The rule
    /// that a splitter's second tile sits perpendicular-clockwise of its flow (and
    /// that an assembler spreads 3×3 about its anchor) belongs to the engine; a
    /// browser playback layer that reimplemented it could drift from the
    /// simulation it is drawing. Each tile list is sorted so the output is stable
    /// across runs (the backing map is unordered).
    pub fn footprints(&self) -> Vec<Vec<(i32, i32)>> {
        let mut out = vec![Vec::new(); self.machines.len()];
        for (&(x, y), &index) in &self.tiles {
            out[index].push((x, y));
        }
        for tiles in &mut out {
            tiles.sort_unstable();
        }
        out
    }

    /// Capture the canonical state of the world at the current tick.
    pub fn snapshot(&self) -> Snapshot {
        let entities = self
            .machines
            .iter()
            .map(|m| m.to_state(self.tick))
            .collect();
        Snapshot::new(self.tick, entities)
    }
}

/// The second tile of a splitter anchored at `(x, y)` facing `dir`: one step
/// perpendicular-clockwise of the flow. For E/W flow the pair straddles the `y`
/// axis (`(x, y+1)`); for N/S flow it straddles the `x` axis (`(x+1, y)`).
pub fn splitter_second_tile(x: i32, y: i32, dir: Dir) -> (i32, i32) {
    match dir {
        Dir::E | Dir::W => (x, y + 1),
        Dir::N | Dir::S => (x + 1, y),
    }
}

impl Machine {
    /// Render this machine's canonical state at `tick`.
    fn to_state(&self, tick: u64) -> EntityState {
        match self {
            Machine::Belt(belt) => EntityState::Belt(BeltState {
                left: lane_items(&belt.lanes[LaneSide::Left.index()]),
                right: lane_items(&belt.lanes[LaneSide::Right.index()]),
            }),
            Machine::Splitter(splitter) => EntityState::Splitter(SplitterState {
                rr_in: splitter.rr_in,
                rr_out: splitter.rr_out,
            }),
            Machine::Inserter(inserter) => EntityState::Inserter(InserterState {
                phase: if inserter.held.is_some() {
                    InserterPhase::Swing
                } else {
                    InserterPhase::Idle
                },
                held: inserter
                    .held
                    .map(|i| prototypes::item_name(i).expect("known item").to_string()),
                swing_left: inserter.swing_left,
            }),
            Machine::Assembler(assembler) => EntityState::Assembler(AssemblerState {
                inputs: count_map_u16(&assembler.inputs),
                output: count_map_u16(&assembler.output),
                craft_left: assembler.craft_left,
            }),
            Machine::Source(source) => EntityState::Source {
                emit_phase: (tick % source.period as u64) as u32,
            },
            Machine::Sink(sink) => EntityState::Sink(SinkState {
                consumed: count_map_u64(&sink.consumed),
            }),
        }
    }
}

/// Convert a lane's live items to the JSON output items (output end first).
fn lane_items(lane: &[LaneItem]) -> Vec<BeltItem> {
    lane.iter()
        .map(|i| BeltItem {
            pos: i.pos,
            item: prototypes::item_name(i.item)
                .expect("known item")
                .to_string(),
        })
        .collect()
}

/// Convert a live `index → u16 count` buffer to the JSON `item id → count` map,
/// dropping zero entries so an emptied buffer serializes as `{}`.
fn count_map_u16(map: &HashMap<u16, u16>) -> std::collections::BTreeMap<String, u16> {
    map.iter()
        .filter(|&(_, &count)| count > 0)
        .map(|(&index, &count)| {
            (
                prototypes::item_name(index)
                    .expect("known item")
                    .to_string(),
                count,
            )
        })
        .collect()
}

/// Convert a live `index → u64 count` buffer (a sink's totals) to the JSON map.
fn count_map_u64(map: &HashMap<u16, u64>) -> std::collections::BTreeMap<String, u64> {
    map.iter()
        .filter(|&(_, &count)| count > 0)
        .map(|(&index, &count)| {
            (
                prototypes::item_name(index)
                    .expect("known item")
                    .to_string(),
                count,
            )
        })
        .collect()
}

#[cfg(test)]
#[path = "world.test.rs"]
mod tests;
