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
    AssemblerState, BeltItem, BeltState, EntityState, FurnaceState, InserterPhase, InserterState,
    SinkState, Snapshot, SplitterState,
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
    LaneSplitter(LaneSplitter),
    Inserter(Inserter),
    Assembler(Crafter),
    /// A 2×2 coal-fired smelter. Structurally a [`Crafter`] like the assembler —
    /// same buffers, recipe pointer, and craft countdown — but with a smaller
    /// footprint, its own canonical kind tag, and a smelting recipe.
    Furnace(Crafter),
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

/// A two-tile balancer. Round-robin pull from its two inputs, round-robin push
/// across the four output *lanes*. Holds no items between ticks.
#[derive(Debug, Clone)]
pub struct Splitter {
    pub x: i32,
    pub y: i32,
    pub dir: Dir,
    /// Per-**lane** output alternation cursor, **item-agnostic**: bit `L` (`0` = left
    /// lane, `1` = right lane) is the output belt (`0`/`1`) the next item on that lane
    /// should go to, whatever that item's type. After routing one it flips to the other
    /// belt. Only the two low bits are used; the rest are always `0`. Each lane's cursor
    /// is independent, so a lane is balanced only against the **corresponding lane** of
    /// the other output belt — never against the other lane of its own belt. The cursor
    /// chooses only the **belt**; the input **lane is preserved**.
    pub out_pref: u16,
    /// Which input belt (`0`/`1`) is tried first this tick, flipped each tick so that
    /// when two input belts compete for one output lane neither starves.
    pub in_first: u8,
}

/// A two-tile **unzip** splitter. Same footprint as the balancing [`Splitter`], but
/// it takes a **single input** (the belt behind its anchor tile — the bottom cell has
/// no input) and unzips that one belt's two lanes onto the two outputs: a **left**-lane
/// item goes to the top output belt's **left** (outer) lane, a **right**-lane item to
/// the bottom output belt's **right** (outer) lane. So the two inner lanes of the
/// outputs stay empty and the flow is split onto the two outer lanes. The routing is
/// fully deterministic and holds no items between ticks, so it retains no state.
#[derive(Debug, Clone)]
pub struct LaneSplitter {
    pub x: i32,
    pub y: i32,
    pub dir: Dir,
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

/// A crafting machine: an input buffer, an output buffer, a fixed recipe, and a
/// craft countdown. Both the 3×3 [`Machine::Assembler`] and the 2×2
/// [`Machine::Furnace`] are `Crafter`s — they share the identical craft loop (the
/// crafters phase in [`crate::tick`]) and inserter interaction; only their
/// footprint, canonical kind tag, and recipe class differ.
#[derive(Debug, Clone)]
pub struct Crafter {
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
    /// nine of its tiles; a 2×2 furnace all four; a 2-tile splitter both of its.
    tiles: HashMap<(i32, i32), usize>,
    /// Maximal chains of **collinear, same-direction** belts that end-feed one
    /// another, each ordered **downstream-first** (index 0 is the most-downstream
    /// tile). The belt phase advances a whole run as one long lane, so a packed
    /// run moves forward as a single rigid block — the frozen-belt property the
    /// spec requires. Perpendicular connections (curves / side-loads) are *not*
    /// part of a run; they merge across runs by forcing. Derived once from the
    /// static layout. See [`World::advance_belts`].
    pub(crate) runs: Vec<Vec<usize>>,
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
                        out_pref: 0,
                        in_first: 0,
                    })
                }
                Entity::LaneSplitter { x, y, dir } => {
                    // Same two-tile footprint as the balancing splitter: the anchor
                    // plus one step perpendicular-clockwise of `dir`.
                    let (sx, sy) = splitter_second_tile(*x, *y, *dir);
                    tiles.insert((*x, *y), index);
                    tiles.insert((sx, sy), index);
                    Machine::LaneSplitter(LaneSplitter {
                        x: *x,
                        y: *y,
                        dir: *dir,
                    })
                }
                Entity::Inserter { x, y, dir } => {
                    tiles.insert((*x, *y), index);
                    Machine::Inserter(Inserter {
                        x: *x,
                        y: *y,
                        dir: *dir,
                        swing: prototypes::INSERTER_SWING,
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
                    Machine::Assembler(Crafter {
                        x: *x,
                        y: *y,
                        recipe: prototypes::recipe(recipe).expect("validated recipe"),
                        inputs: HashMap::new(),
                        output: HashMap::new(),
                        craft_left: 0,
                    })
                }
                Entity::Furnace { x, y, recipe } => {
                    // A 2×2 block, anchored at its top-left like the assembler.
                    for dy in 0..2 {
                        for dx in 0..2 {
                            tiles.insert((*x + dx, *y + dy), index);
                        }
                    }
                    Machine::Furnace(Crafter {
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

        let runs = build_runs(&machines, &tiles);

        World {
            tick: 0,
            width: scenario.grid.width,
            height: scenario.grid.height,
            machines,
            tiles,
            runs,
        }
    }

    /// The machine index occupying `(x, y)`, if any.
    pub fn machine_at(&self, x: i32, y: i32) -> Option<usize> {
        self.tiles.get(&(x, y)).copied()
    }

    /// Whether belt `idx` is a pure curve (a run continuation, not a side-load) —
    /// see [`belt_is_pure_curve`].
    pub(crate) fn is_pure_curve(&self, idx: usize) -> bool {
        belt_is_pure_curve(&self.machines, &self.tiles, idx)
    }

    /// Every machine's footprint tiles, parallel to the scenario's `entities` — a
    /// 3×3 assembler yields nine, a 2×2 furnace four, a two-tile splitter two,
    /// everything else one.
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

/// Whether belt `idx` is a **pure curve**: its only belt feeder is a single
/// *perpendicular* belt, so flow turns 90° through it with no straight-through feed
/// and no second side-load. A pure curve is a **continuation of its feeder's run** —
/// the two lanes carry through the turn preserved (left stays left, right stays
/// right) and both flow at belt speed, exactly like a straight belt that happens to
/// bend — not a side-load, which forces one lane across per tick. A belt with a
/// collinear feeder, no feeder, or two or more feeders is NOT a pure curve (a
/// side-load or a junction), and keeps the forcing behaviour.
pub(crate) fn belt_is_pure_curve(
    machines: &[Machine],
    tiles: &HashMap<(i32, i32), usize>,
    idx: usize,
) -> bool {
    let belt = |i: usize| match &machines[i] {
        Machine::Belt(b) => Some(b),
        _ => None,
    };
    let Some(b) = belt(idx) else { return false };
    let mut belt_feeders = 0;
    let mut feeder_dir = None;
    for d in [Dir::N, Dir::S, Dir::E, Dir::W] {
        let (tx, ty) = d.step(b.x, b.y);
        let Some(&fi) = tiles.get(&(tx, ty)) else {
            continue;
        };
        // Anything on the neighbour tile that points back toward `idx` FEEDS it. A
        // pure curve is fed by exactly one thing — a single perpendicular belt — so a
        // source, an inserter, or a splitter that also feeds this belt (its own
        // straight supply) rules the curve out: it is a side-load, not a bend.
        let into = d.opposite();
        match &machines[fi] {
            Machine::Belt(fb) if fb.dir == into => {
                belt_feeders += 1;
                feeder_dir = Some(fb.dir);
            }
            Machine::Source(s) if s.dir == into => return false,
            Machine::Inserter(ins) if ins.dir == into => return false,
            Machine::Splitter(sp) if sp.dir == into => return false,
            Machine::LaneSplitter(sp) if sp.dir == into => return false,
            _ => {}
        }
    }
    // Exactly one belt feeds it, and it comes in perpendicular (a bend, not a straight
    // feed), with nothing else supplying the belt.
    belt_feeders == 1 && feeder_dir != Some(b.dir)
}

/// Assemble the belt [`runs`](World::runs): maximal chains of belts that end-feed
/// one another, each ordered downstream-first.
///
/// A belt continues a run into the belt one tile ahead **in its own facing** when
/// that belt either shares the facing (`E → E`, a straight run) **or is a pure
/// [curve](belt_is_pure_curve)** (`E → S`, the flow bending 90° with lanes
/// preserved). A perpendicular *side-load* target (one that also has its own
/// straight feed, or a second feeder) is a different run — it connects by forcing,
/// not rigid-block flow — and so is a belt facing a splitter, sink, inserter, or
/// empty space.
fn build_runs(machines: &[Machine], tiles: &HashMap<(i32, i32), usize>) -> Vec<Vec<usize>> {
    let belt = |idx: usize| match &machines[idx] {
        Machine::Belt(b) => Some(b),
        _ => None,
    };
    let at = |x: i32, y: i32| tiles.get(&(x, y)).copied();
    // The belt one tile ahead in `idx`'s facing, iff it continues the run — either
    // collinear (same facing) or a pure curve (a 90° bend fed solely by `idx`).
    let run_down = |idx: usize| -> Option<usize> {
        let b = belt(idx)?;
        let (nx, ny) = b.dir.step(b.x, b.y);
        let n = at(nx, ny)?;
        let nb = belt(n)?;
        (nb.dir == b.dir || belt_is_pure_curve(machines, tiles, n)).then_some(n)
    };
    // A run head is a belt with nothing feeding it into the run: no collinear belt
    // behind it, and it is not itself a pure curve (which would make it a mid-run
    // continuation of the perpendicular belt that bends into it).
    let is_head = |idx: usize| -> bool {
        let Some(b) = belt(idx) else { return false };
        let (dx, dy) = b.dir.delta();
        if let Some(back) = at(b.x - dx, b.y - dy)
            && belt(back).map(|bk| bk.dir) == Some(b.dir)
        {
            return false; // fed by a collinear belt
        }
        !belt_is_pure_curve(machines, tiles, idx)
    };

    let mut runs: Vec<Vec<usize>> = Vec::new();
    let mut visited = vec![false; machines.len()];
    // Walk each head downstream; the collected chain is upstream-first, so reverse
    // it to land downstream-first. `idx` indexes `machines` and `visited` in step
    // and feeds the belt/head closures, so it is a genuine index loop.
    #[allow(clippy::needless_range_loop)]
    for idx in 0..machines.len() {
        if belt(idx).is_none() || visited[idx] || !is_head(idx) {
            continue;
        }
        let mut chain = Vec::new();
        let mut cur = Some(idx);
        while let Some(c) = cur {
            if visited[c] {
                break; // guard against a pathological cycle
            }
            visited[c] = true;
            chain.push(c);
            cur = run_down(c);
        }
        chain.reverse();
        runs.push(chain);
    }
    // Any belt still unvisited is part of a pure loop (no head). Degrade it to a
    // singleton run rather than dropping it — cycles are not valid flow anyway.
    #[allow(clippy::needless_range_loop)]
    for idx in 0..machines.len() {
        if belt(idx).is_some() && !visited[idx] {
            visited[idx] = true;
            runs.push(vec![idx]);
        }
    }
    runs
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
                out_pref: splitter.out_pref,
                in_first: splitter.in_first,
            }),
            Machine::LaneSplitter(_) => EntityState::LaneSplitter {},
            Machine::Inserter(inserter) => EntityState::Inserter(InserterState {
                // Loaded → swinging out; empty but still mid-motion → swinging back;
                // empty and at rest → idle, ready to grab.
                phase: if inserter.held.is_some() {
                    InserterPhase::Swing
                } else if inserter.swing_left > 0 {
                    InserterPhase::Return
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
            Machine::Furnace(furnace) => EntityState::Furnace(FurnaceState {
                inputs: count_map_u16(&furnace.inputs),
                output: count_map_u16(&furnace.output),
                craft_left: furnace.craft_left,
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
